import { supabaseAdmin } from '@/lib/supabase';
import { uidCandidates } from '@/lib/rfid';

// Registrations a card can resolve to: settled ones. See the check-in route.
const VERIFIED_STATUSES = ['registered', 'payment_verified', 'paid_pending_turnover'];

// One card, at one event, to the registration it belongs to.
//
// Shared by the door check-in and the public photo unlock. Lifted out of the
// check-in POST because two different desks ask the same
// question and want different things done about the answer: the door checks
// them in, the kit and meal counters only need to know who is standing there.
// Two copies of this two-step lookup would drift, and a card that works at
// the door but not at the meal counter is a miserable thing to explain.
//
// Step one is a card handed out for THIS event. Step two is the member's own
// card, then whether that member is on this event's list.
export async function resolveEventCard(eventId, raw, regFields) {
  const candidates = uidCandidates(raw);

  const { data: link } = await supabaseAdmin
    .from('rfid_event_cards')
    .select('*')
    .eq('event_id', eventId)
    .in('uid', candidates)
    .maybeSingle();

  if (link) {
    const { data } = await supabaseAdmin
      .from('event_registrations')
      .select(regFields)
      .eq('id', link.registration_id)
      .maybeSingle();
    return { registration: data || null, result: data ? 'matched' : 'unknown' };
  }

  const { data: memberCard } = await supabaseAdmin
    .from('rfid_cards')
    .select('*, users:user_id (id, firstname, lastname)')
    .in('uid', candidates)
    .maybeSingle();

  if (memberCard && memberCard.is_active) {
    const { data } = await supabaseAdmin
      .from('event_registrations')
      .select(regFields)
      .eq('event_id', eventId)
      .eq('user_id', memberCard.user_id)
      .in('status', VERIFIED_STATUSES)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) return { registration: data, result: 'matched' };

    // The card is known and the person is known - they are simply not on
    // this event's list. Saying which of those it is saves the desk from
    // wondering whether the card is broken.
    const who = memberCard.users
      ? `${memberCard.users.firstname || ''} ${memberCard.users.lastname || ''}`.trim()
      : 'That member';
    return {
      registration: null,
      result: 'not_registered',
      message: `${who} has no verified registration for this event.`,
    };
  }

  return {
    registration: null,
    result: 'unknown',
    message: 'This card is not linked to anyone at this event yet.',
  };
}

