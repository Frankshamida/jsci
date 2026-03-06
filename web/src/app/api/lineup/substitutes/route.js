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
    // Open subs for other SLs to accept (exclude own requests)
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
    const { requesterId, requesterName, requesterProfilePicture, scheduleId, scheduleDate, reason } = body;

    if (!requesterId || !scheduleDate || !reason) {
      return NextResponse.json({ success: false, message: 'Requester ID, date, and reason are required' }, { status: 400 });
    }

    // Check if already exists
    const { data: existing } = await supabase
      .from('lineup_substitutes')
      .select('id')
      .eq('requester_id', requesterId)
      .eq('schedule_date', scheduleDate)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: false, message: 'You already have a substitute request for this date' }, { status: 409 });
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
        status: 'Pending Admin',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Substitute request submitted! Waiting for admin approval.', data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update substitute request (admin approve/reject, SL accept, thank you)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, action, adminNote, reviewedBy, substituteId, substituteName, substituteProfilePicture, thankYouMessage, songLeaderIds } = body;

    if (!id || !action) {
      return NextResponse.json({ success: false, message: 'ID and action are required' }, { status: 400 });
    }

    // Get the sub request
    const { data: sub } = await supabase.from('lineup_substitutes').select('*').eq('id', id).single();
    if (!sub) return NextResponse.json({ success: false, message: 'Sub request not found' }, { status: 404 });

    const dateFormatted = new Date(sub.schedule_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    // ADMIN APPROVE → status becomes "Open for Sub", notify all Song Leaders
    if (action === 'admin-approve') {
      await supabase.from('lineup_substitutes').update({
        status: 'Open for Sub',
        admin_note: adminNote || null,
        reviewed_by: reviewedBy || null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      // Notify ALL Song Leader users (except the requester)
      if (songLeaderIds && songLeaderIds.length > 0) {
        const notifications = songLeaderIds
          .filter(slId => slId !== sub.requester_id)
          .map(slId => ({
            user_id: slId,
            title: '🔔 Substitute Request Available!',
            message: `${sub.requester_name} is requesting a substitute Song Leader for ${dateFormatted}. Reason: "${sub.reason}". Are you available to sub?`,
            type: 'substitute',
            link: '/dashboard?section=create-lineup',
          }));
        if (notifications.length > 0) {
          await supabase.from('notifications').insert(notifications);
        }
      }

      // Notify requester that their request was approved
      await supabase.from('notifications').insert({
        user_id: sub.requester_id,
        title: '✅ Sub Request Approved!',
        message: `Your substitute request for ${dateFormatted} has been approved by the admin. All Song Leaders have been notified and can now accept your request.`,
        type: 'substitute',
        link: '/dashboard?section=create-lineup',
      });

      return NextResponse.json({ success: true, message: 'Sub request approved! All Song Leaders have been notified.' });
    }

    // ADMIN REJECT
    if (action === 'admin-reject') {
      await supabase.from('lineup_substitutes').update({
        status: 'Rejected',
        admin_note: adminNote || null,
        reviewed_by: reviewedBy || null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      await supabase.from('notifications').insert({
        user_id: sub.requester_id,
        title: '❌ Sub Request Rejected',
        message: `Your substitute request for ${dateFormatted} was rejected.${adminNote ? ` Admin note: ${adminNote}` : ''}`,
        type: 'substitute',
        link: '/dashboard?section=create-lineup',
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

      // Update the schedule: change the song_leader to the substitute's name
      // and store the original song leader for clean tracking
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

      // Notify the requester
      await supabase.from('notifications').insert({
        user_id: sub.requester_id,
        title: '🎉 Substitute Found!',
        message: `${substituteName} has accepted your substitute request for ${dateFormatted}! They will lead worship for you on that date. The lineup has been reassigned.`,
        type: 'substitute',
        link: '/dashboard?section=create-lineup',
      });

      return NextResponse.json({ success: true, message: `You accepted the sub! You're now substituting for ${sub.requester_name} on ${dateFormatted}.` });
    }

    // SEND THANK YOU
    if (action === 'thank-you') {
      const msg = thankYouMessage || 'Thank you for substituting! God bless you! 🙏';

      await supabase.from('lineup_substitutes').update({
        thank_you_sent: true,
        thank_you_message: msg,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      // Notify the substitute
      if (sub.substitute_id) {
        await supabase.from('notifications').insert({
          user_id: sub.substitute_id,
          title: `💛 ${sub.requester_name} says Thank You!`,
          message: msg,
          type: 'substitute',
          link: '/dashboard?section=create-lineup',
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
