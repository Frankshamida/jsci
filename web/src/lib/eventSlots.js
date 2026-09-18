// Which registrations actually hold a seat at an event.
//
// A slot is held by money that has arrived, or by a plan that commits to it:
//
//   registered        a free event - there is nothing to pay, so the seat is theirs
//   payment_verified  paid in full and confirmed
//   payment_submitted paid, and waiting on an admin to verify it. The money has
//                     been sent and the seat is theirs while the church checks
//                     the proof - holding it back until verification would let
//                     the event oversell to people who paid later, and would make
//                     the counter jump only when an admin happens to log in.
//                     A rejected payment moves the row to another status and the
//                     seat is released then.
//   installment       on a flexible plan: part-paid, and the balance is owed to
//                     the event, not in question. The seat is reserved for them
//                     for the whole time they are paying it down.
//   pending_cash      registered to pay in cash at the desk. No money has
//                     arrived, and in that sense it is pending_payment - but it
//                     is pending BY ARRANGEMENT. The church chose to offer cash
//                     for this event, and somebody who took that offer has to
//                     still have a seat when they turn up with the notes in
//                     their hand. Holding it back would mean only the people
//                     who pay online can rely on registering, which is the
//                     opposite of what offering cash is for.
//                     It is NOT in VERIFIED_STATUSES: the seat is theirs, but
//                     the door still asks for the money first.
//
// Everything else is deliberately left out:
//
//   pending_payment   nobody has paid anything, and nobody arranged not to
//   cancelled         gone
//
// Counting each registration once is what keeps the arithmetic honest: a person
// on a plan is a single row that shows in both the Registrations tab and the
// Flexible Installment tab, and it must cost the event one seat, not two.
export const SLOT_HOLDING_STATUSES = ['registered', 'payment_verified', 'payment_submitted', 'installment', 'pending_cash'];

// Registered to pay in cash, money not yet collected. Its own status rather
// than a flag on pending_payment, because every list, filter and counter in
// this app reads a status - a flag would have to be threaded through all of
// them, and would be forgotten in one of them.
export const CASH_PENDING_STATUS = 'pending_cash';
