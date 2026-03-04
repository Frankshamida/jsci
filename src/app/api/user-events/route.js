import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch user-created events
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const createdBy = searchParams.get('createdBy');
    const eventType = searchParams.get('eventType');
    const upcoming = searchParams.get('upcoming') === 'true';
    // 'all' param used by pastors — when no createdBy filter, all events are returned

    let query = supabase.from('user_events')
      .select('*, users!user_events_created_by_fkey(firstname, lastname, ministry, role)')
      .eq('is_active', true)
      .order('event_date', { ascending: true });

    if (createdBy) query = query.eq('created_by', createdBy);
    if (eventType) query = query.eq('event_type', eventType);
    if (upcoming) query = query.gte('event_date', new Date().toISOString());

    const { data, error } = await query;
    if (error) throw error;

    // Add creator_name for display
    if (data) {
      data.forEach(e => {
        if (e.users) {
          e.creator_name = `${e.users.firstname} ${e.users.lastname}`;
          e.creator_ministry = e.users.ministry || '';
          e.creator_role = e.users.role || '';
        }
      });
    }

    // If userId is provided, also fetch user's RSVP status for each event
    if (userId && data) {
      const eventIds = data.map(e => e.id);
      if (eventIds.length > 0) {
        const { data: rsvps } = await supabase.from('user_event_rsvps')
          .select('event_id, status')
          .eq('user_id', userId)
          .in('event_id', eventIds);

        const rsvpMap = {};
        (rsvps || []).forEach(r => { rsvpMap[r.event_id] = r.status; });
        data.forEach(e => { e.myRsvp = rsvpMap[e.id] || null; });
      }
    }

    // Fetch RSVP counts for each event
    if (data) {
      const eventIds = data.map(e => e.id);
      if (eventIds.length > 0) {
        const { data: allRsvps } = await supabase.from('user_event_rsvps')
          .select('event_id, status')
          .in('event_id', eventIds);

        const countMap = {};
        (allRsvps || []).forEach(r => {
          if (!countMap[r.event_id]) countMap[r.event_id] = { going: 0, maybe: 0, notGoing: 0 };
          if (r.status === 'Going') countMap[r.event_id].going++;
          else if (r.status === 'Maybe') countMap[r.event_id].maybe++;
          else if (r.status === 'Not Going') countMap[r.event_id].notGoing++;
        });
        data.forEach(e => { e.rsvpCounts = countMap[e.id] || { going: 0, maybe: 0, notGoing: 0 }; });
      }
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create a user event
export async function POST(request) {
  try {
    const body = await request.json();
    const { title, description, eventType, eventDate, endDate, location, createdBy, createdByName, ministry } = body;

    if (!title || !eventDate || !createdBy) {
      return NextResponse.json({ success: false, message: 'Title, event date, and creator are required' }, { status: 400 });
    }

    // Verify user has permission to create this event type
    const { data: user, error: userError } = await supabase.from('users')
      .select('allowed_event_types')
      .eq('id', createdBy)
      .single();

    if (userError) throw userError;

    const allowedTypes = user?.allowed_event_types || [];
    if (!allowedTypes.includes(eventType || 'Event')) {
      return NextResponse.json({ success: false, message: 'You do not have permission to create this type of event' }, { status: 403 });
    }

    const { data, error } = await supabase.from('user_events').insert({
      title,
      description: description || null,
      event_type: eventType || 'Event',
      event_date: eventDate,
      end_date: endDate || null,
      location: location || null,
      created_by: createdBy,
      created_by_name: createdByName || null,
      ministry: ministry || null,
    }).select('*, users!user_events_created_by_fkey(firstname, lastname, ministry, role)').single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Event created successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update a user event
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, userId, userRole, ...updates } = body;

    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    // Verify ownership or pastor/admin role
    const { data: event } = await supabase.from('user_events').select('created_by').eq('id', id).single();
    if (!event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    const isPastorOrAdmin = ['Pastor', 'Admin', 'Super Admin'].includes(userRole);
    if (event.created_by !== userId && !isPastorOrAdmin) {
      return NextResponse.json({ success: false, message: 'You can only edit your own events' }, { status: 403 });
    }

    // If changing event type and user is the owner (not pastor/admin override), verify permission
    if (updates.eventType && event.created_by === userId && !isPastorOrAdmin) {
      const { data: user } = await supabase.from('users').select('allowed_event_types').eq('id', userId).single();
      const allowed = user?.allowed_event_types || [];
      if (!allowed.includes(updates.eventType)) {
        return NextResponse.json({ success: false, message: `You don't have permission for event type: ${updates.eventType}` }, { status: 403 });
      }
    }

    const updateData = {};
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.eventType) updateData.event_type = updates.eventType;
    if (updates.eventDate) updateData.event_date = updates.eventDate;
    if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
    if (updates.location !== undefined) updateData.location = updates.location;
    if (updates.status) updateData.status = updates.status;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

    const { data, error } = await supabase.from('user_events').update(updateData).eq('id', id)
      .select('*, users!user_events_created_by_fkey(firstname, lastname, ministry, role)').single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Event updated successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Soft-delete a user event
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
    const userRole = searchParams.get('userRole');

    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    // Verify ownership or pastor/admin role
    const { data: event } = await supabase.from('user_events').select('created_by').eq('id', id).single();
    if (!event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    const isPastorOrAdmin = ['Pastor', 'Admin', 'Super Admin'].includes(userRole);
    if (event.created_by !== userId && !isPastorOrAdmin) {
      return NextResponse.json({ success: false, message: 'You can only delete your own events' }, { status: 403 });
    }

    const { error } = await supabase.from('user_events').update({ is_active: false }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
