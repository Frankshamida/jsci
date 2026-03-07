import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch substitute requests
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requesterId = searchParams.get('requesterId');
    const substituteId = searchParams.get('substituteId');
    const all = searchParams.get('all');
    const status = searchParams.get('status');
    const openForMe = searchParams.get('openForMe');
    const userId = searchParams.get('userId');

    let query = supabase.from('lineup_substitutes').select('*').order('created_at', { ascending: false });

    if (requesterId && !all) {
      query = query.eq('requester_id', requesterId);
    }
    if (substituteId) {
      query = query.eq('substitute_id', substituteId);
    }
    if (status) {
      query = query.eq('status', status);
    }
    // Filter by role type
    const roleType = searchParams.get('roleType');
    if (roleType) {
      query = query.eq('role_type', roleType);
    }
    // Open subs for others to accept (exclude own requests)
    if (openForMe && userId) {
      query = query.eq('status', 'Open for Sub').neq('requester_id', userId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create a substitute request
export async function POST(request) {
  try {
    const body = await request.json();
    const { requesterId, requesterName, requesterProfilePicture, scheduleId, scheduleDate, reason, roleType } = body;

    if (!requesterId || !scheduleDate || !reason) {
      return NextResponse.json({ success: false, message: 'Requester ID, date, and reason are required' }, { status: 400 });
    }

    const role = roleType || 'Song Leader';

    // Check if already exists for this user, date, and role
    const { data: existing } = await supabase
      .from('lineup_substitutes')
      .select('id')
      .eq('requester_id', requesterId)
      .eq('schedule_date', scheduleDate)
      .eq('role_type', role)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: false, message: 'You already have a substitute request for this date and role' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('lineup_substitutes')
      .insert({
        requester_id: requesterId,
        requester_name: requesterName,
        requester_profile_picture: requesterProfilePicture || null,
        schedule_id: scheduleId || null,
        schedule_date: scheduleDate,
        reason,
        role_type: role,
        status: 'Pending Admin',
      })
      .select()
      .single();

    if (error) throw error;

    // Notify all admins and superadmins about the new sub request (with ministry role)
    const dateFormatted = new Date(scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    try {
      const { data: admins } = await supabase
        .from('users')
        .select('id')
        .in('role', ['Admin', 'SuperAdmin']);
      if (admins && admins.length > 0) {
        const adminNotifs = admins.map(a => ({
          user_id: a.id,
          title: `📋 New Sub Request — ${role}`,
          message: `${requesterName} (${role}) is requesting a substitute for ${dateFormatted}. Reason: "${reason}". Please review and approve or reject.`,
          type: 'substitute',
          link: '/dashboard?section=create-lineup',
        }));
        await supabase.from('notifications').insert(adminNotifs);
      }
    } catch (notifErr) {
      console.error('Failed to notify admins:', notifErr);
    }

    return NextResponse.json({ success: true, message: 'Substitute request submitted! Waiting for admin approval.', data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update substitute request (admin approve/reject, SL accept, thank you)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, action, adminNote, reviewedBy, substituteId, substituteName, substituteProfilePicture, thankYouMessage, songLeaderIds, memberIds } = body;

    if (!id || !action) {
      return NextResponse.json({ success: false, message: 'ID and action are required' }, { status: 400 });
    }

    // Get the sub request
    const { data: sub } = await supabase.from('lineup_substitutes').select('*').eq('id', id).single();
    if (!sub) return NextResponse.json({ success: false, message: 'Sub request not found' }, { status: 404 });

    const dateFormatted = new Date(sub.schedule_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    // ADMIN APPROVE → status becomes "Open for Sub", notify ALL members with matching role
    if (action === 'admin-approve') {
      await supabase.from('lineup_substitutes').update({
        status: 'Open for Sub',
        admin_note: adminNote || null,
        reviewed_by: reviewedBy || null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      // Determine which members to notify based on role_type
      const roleLabel = sub.role_type || 'Song Leader';
      const rolePlural = roleLabel === 'Song Leader' ? 'Song Leaders' : roleLabel === 'Backup Singer' ? 'Backup Singers' : roleLabel === 'Instrumentalist' ? 'Instrumentalists' : roleLabel === 'Dancer' ? 'Dancers' : roleLabel + 's';

      // Fetch ALL matching-role members directly from DB (server-side)
      // This guarantees every member with the matching role gets notified
      let roleMembers = [];
      try {
        const roleKeyword = roleLabel === 'Song Leader' ? 'Song Leaders' : roleLabel;
        const { data: members } = await supabase
          .from('users')
          .select('id')
          .eq('is_active', true)
          .eq('status', 'Verified')
          .eq('ministry', 'Praise And Worship')
          .ilike('sub_role', `%${roleKeyword}%`);
        roleMembers = (members || []).map(m => m.id);
      } catch (fetchErr) {
        console.error('Failed to fetch role members:', fetchErr);
        // Fallback to frontend-passed IDs if DB query fails
        roleMembers = memberIds || songLeaderIds || [];
      }

      if (roleMembers.length > 0) {
        const notifications = roleMembers
          .filter(mId => mId !== sub.requester_id)
          .map(mId => ({
            user_id: mId,
            title: `🔔 ${roleLabel} Sub Request Available!`,
            message: `${sub.requester_name} (${roleLabel}) is requesting a substitute for ${dateFormatted}. Reason: "${sub.reason}". Are you available to sub?`,
            type: 'substitute',
            link: '/dashboard?section=praise-worship',
          }));
        if (notifications.length > 0) {
          await supabase.from('notifications').insert(notifications);
        }
      }

      // Notify requester that their request was approved
      await supabase.from('notifications').insert({
        user_id: sub.requester_id,
        title: `✅ Sub Request Approved! (${roleLabel})`,
        message: `Your substitute request (${roleLabel}) for ${dateFormatted} has been approved by the admin. All ${rolePlural} have been notified and can volunteer to sub for you.`,
        type: 'substitute',
        link: '/dashboard?section=praise-worship',
      });

      return NextResponse.json({ success: true, message: `Sub request approved! All ${rolePlural} have been notified.` });
    }

    // ADMIN REJECT
    if (action === 'admin-reject') {
      const roleLabel = sub.role_type || 'Song Leader';
      await supabase.from('lineup_substitutes').update({
        status: 'Rejected',
        admin_note: adminNote || null,
        reviewed_by: reviewedBy || null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      await supabase.from('notifications').insert({
        user_id: sub.requester_id,
        title: `❌ Sub Request Rejected (${roleLabel})`,
        message: `Your substitute request (${roleLabel}) for ${dateFormatted} was rejected.${adminNote ? ` Admin note: ${adminNote}` : ''}`,
        type: 'substitute',
        link: '/dashboard?section=praise-worship',
      });

      return NextResponse.json({ success: true, message: 'Sub request rejected.' });
    }

    // SONG LEADER ACCEPT → they become the substitute
    if (action === 'accept') {
      if (!substituteId || !substituteName) {
        return NextResponse.json({ success: false, message: 'Substitute info required' }, { status: 400 });
      }

      if (sub.status !== 'Open for Sub') {
        return NextResponse.json({ success: false, message: 'This sub request is no longer available.' }, { status: 409 });
      }

      await supabase.from('lineup_substitutes').update({
        status: 'Accepted',
        substitute_id: substituteId,
        substitute_name: substituteName,
        substitute_profile_picture: substituteProfilePicture || null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      // Only update the schedule song_leader column for Song Leader subs
      const roleLabel = sub.role_type || 'Song Leader';
      if (roleLabel === 'Song Leader') {
        try {
          await supabase.from('schedules')
            .update({ 
              song_leader: substituteName,
              original_song_leader: sub.requester_name,
              original_song_leader_id: sub.requester_id,
            })
            .eq('schedule_date', sub.schedule_date);
        } catch (schedErr) {
          console.error('Failed to update schedule song_leader:', schedErr);
        }
      } else if (roleLabel === 'Backup Singer') {
        // Replace the requester in the backup_singers JSONB array
        try {
          const { data: sched } = await supabase.from('schedules').select('backup_singers').eq('schedule_date', sub.schedule_date).single();
          if (sched) {
            const backups = (sched.backup_singers || []).map(b =>
              b.toLowerCase() === sub.requester_name.toLowerCase() ? substituteName : b
            );
            await supabase.from('schedules').update({ backup_singers: backups }).eq('schedule_date', sub.schedule_date);
          }
        } catch (schedErr) {
          console.error('Failed to update schedule backup_singers:', schedErr);
        }
      }

      // Notify the requester
      await supabase.from('notifications').insert({
        user_id: sub.requester_id,
        title: '🎉 Substitute Found!',
        message: `${substituteName} has accepted your substitute request (${roleLabel}) for ${dateFormatted}! The lineup has been updated.`,
        type: 'substitute',
        link: '/dashboard?section=praise-worship',
      });

      return NextResponse.json({ success: true, message: `You accepted the sub! You're now substituting for ${sub.requester_name} on ${dateFormatted}.` });
    }

    // SEND THANK YOU
    if (action === 'thank-you') {
      const msg = thankYouMessage || 'Thank you for substituting! God bless you! 🙏';
      const roleLabel = sub.role_type || 'Song Leader';

      await supabase.from('lineup_substitutes').update({
        thank_you_sent: true,
        thank_you_message: msg,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      // Notify the substitute with full context
      if (sub.substitute_id) {
        await supabase.from('notifications').insert({
          user_id: sub.substitute_id,
          title: `💛 ${sub.requester_name} says Thank You!`,
          message: `${sub.requester_name} sent you a thank you message for substituting as ${roleLabel} on ${dateFormatted}: "${msg}"`,
          type: 'substitute',
          link: '/dashboard?section=praise-worship',
        });
      }

      return NextResponse.json({ success: true, message: 'Thank you message sent!' });
    }

    return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Cancel a sub request
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const { error } = await supabase.from('lineup_substitutes').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Substitute request cancelled.' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
