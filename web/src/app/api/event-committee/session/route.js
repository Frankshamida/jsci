import { NextResponse } from 'next/server';
import { findEventActor, isEventManager, isCommitteeMember, committeeEventIds } from '@/lib/eventCommittee';

// The committee session for somebody who is ALREADY signed in on the main site.
//
// /api/event-committee/login exists for arriving at the portal cold, with a
// password. This is the other door: a member who is looking at the main
// dashboard has already proved who they are, and asking them to type the same
// password again to cross between two screens of the same app is friction for
// its own sake. So the main dashboard asks this route "may this account open
// the committee dashboard, and under what assignments", and gets back the same
// session shape the login route returns.
//
// It answers for committee accounts only. A userId that is not on the
// committee - and is not an Admin - is refused, so this is never a general
// account lookup. Nothing here is a permission in its own right either: every
// committee route re-checks the caller with findEventActor / canWorkEvent, so
// a forged session in a browser's storage buys nothing.

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ success: false, message: 'userId required' }, { status: 400 });

    const actor = await findEventActor(userId);
    if (!actor) return NextResponse.json({ success: false, message: 'Account not found' }, { status: 404 });
    if (actor.is_active === false) {
      return NextResponse.json({ success: false, message: 'This account is deactivated.' }, { status: 403 });
    }

    const manager = isEventManager(actor);
    if (!manager && !isCommitteeMember(actor)) {
      return NextResponse.json({
        success: false,
        code: 'NOT_COMMITTEE',
        message: 'Your account is not on the Event Committee yet. An Admin needs to add you before you can open this dashboard.',
      }, { status: 403 });
    }

    // Only what the dashboard puts on screen - no email, no member id. The
    // less this hands back, the less a stolen userId is worth.
    return NextResponse.json({
      success: true,
      data: {
        id: actor.id,
        firstname: actor.firstname,
        lastname: actor.lastname,
        role: actor.role || 'Guest',
        profile_picture: actor.profile_picture || null,
        isEventManager: manager,
        isCommittee: isCommitteeMember(actor),
        // Managers are never scoped - they run every event. An empty list
        // means every event for a committee member too; see the migration.
        committeeEvents: manager ? [] : (committeeEventIds(actor) || []),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
