import { supabaseAdmin } from '@/lib/supabase';
import { uidCandidates } from '@/lib/rfid';

// Registrations a card can resolve to: settled ones. See the check-in route.
const VERIFIED_STATUSES = ['registered', 'payment_verified', 'paid_pending_turnover'];

// ---- Cards handed back ----
// A card returned at the desk (rfid_card_returns.sql) is nobody's any more:
// free for somebody else at the same event, not only at the next one. A
// return lets go of the link; returns made before that kept it, so a link
// still counts as handed back when that attendee returned that card after it
// was given to them. A card given again later is theirs again.
const ms = (iso) => (iso ? new Date(iso).getTime() || 0 : 0);
export async function splitReturnedLinks(links) {
  const list = links || [];
  if (!list.length) return { held: [], returned: [] };
  const { data: rets, error } = await supabaseAdmin
    .from('rfid_card_returns')
    .select('registration_id, uid, returned_at')
    .in('registration_id', [...new Set(list.map((l) => l.registration_id))]);
  // No returns table yet: nothing has been handed back.
  if (error) return { held: list, returned: [] };
  const backAt = (l) => (rets || [])
    .filter((r) => r.registration_id === l.registration_id && r.uid === l.uid && ms(r.returned_at) >= ms(l.assigned_at))
    .map((r) => r.returned_at)[0] || null;
  const held = [];
  const returned = [];
  list.forEach((l) => {
    const at = backAt(l);
    if (at) returned.push({ ...l, returned_at: at });
    else held.push(l);
  });
  return { held, returned };
}
// Let go of handed-back links, so the card can be given again at their event.
export async function releaseLinks(links) {
  const ids = (links || []).map((l) => l.id).filter(Boolean);
  if (!ids.length) return;
  const { error } = await supabaseAdmin.from('rfid_event_cards').delete().in('id', ids);
  if (error) throw error;
}

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
  // More than one row can answer to the same card (two spellings of it saved
  // before readings were normalised). maybeSingle() turns that into "nobody",
  // so take them all and prefer the closest spelling - candidates are ordered
  // most-likely first - then the card given out first.
  const best = (rows) => (rows || [])
    .sort((a, b) => candidates.indexOf(a.uid) - candidates.indexOf(b.uid)
      || String(a.assigned_at || '').localeCompare(String(b.assigned_at || '')))[0] || null;

  // The card and the registration it points at in one query (the foreign key
  // on registration_id lets PostgREST embed it) - a tap at the door is waited
  // on by a queue, and the second round trip was pure waiting. If the embed
  // is refused for any reason, the plain two-step lookup below still runs.
  const embedded = await supabaseAdmin
    .from('rfid_event_cards')
    .select(`*, registration:event_registrations(${regFields})`)
    .eq('event_id', eventId)
    .in('uid', candidates);
  const links = embedded.error
    ? (await supabaseAdmin
      .from('rfid_event_cards')
      .select('*')
      .eq('event_id', eventId)
      .in('uid', candidates)).data
    : embedded.data;
  // A card handed back answers to nobody - not to the person who returned it.
  const { held, returned } = await splitReturnedLinks(links);
  const link = best(held);

  if (link && !embedded.error) {
    const data = link.registration || null;
    return { registration: data, result: data ? 'matched' : 'unknown' };
  }
  if (link) {
    const { data } = await supabaseAdmin
      .from('event_registrations')
      .select(regFields)
      .eq('id', link.registration_id)
      .maybeSingle();
    return { registration: data || null, result: data ? 'matched' : 'unknown' };
  }

  const { data: memberCards } = await supabaseAdmin
    .from('rfid_cards')
    .select('*, users:user_id (id, firstname, lastname)')
    .in('uid', candidates);
  const memberCard = best(memberCards);

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

  // Handed back: by a link an older return kept, or - since a return lets go
  // of the link - by the return on file. Nobody's now; the desk says whose it was.
  let back = returned[0]
    ? { registrationId: returned[0].registration_id, name: returned[0].registration?.attendee_name || '', at: returned[0].returned_at }
    : null;
  if (!back) {
    const { data: rets, error: retErr } = await supabaseAdmin
      .from('rfid_card_returns')
      .select('registration_id, returned_at, event_registrations(attendee_name)')
      .eq('event_id', eventId)
      .in('uid', candidates)
      .order('returned_at', { ascending: false })
      .limit(1);
    const r = !retErr && rets?.[0];
    if (r) back = { registrationId: r.registration_id, name: r.event_registrations?.attendee_name || '', at: r.returned_at };
  }
  if (back) {
    if (!back.name) {
      const { data } = await supabaseAdmin
        .from('event_registrations').select('attendee_name').eq('id', back.registrationId).maybeSingle();
      back.name = data?.attendee_name || '';
    }
    return {
      registration: null,
      result: 'returned',
      returned: back,
      message: `This card was returned${back.name ? ` by ${back.name}` : ''} - it is free to give to somebody else.`,
    };
  }

  return {
    registration: null,
    result: 'unknown',
    message: 'This card is not linked to anyone at this event yet.',
  };
}

