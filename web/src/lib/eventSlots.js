// Which registrations actually hold a seat at an event.
//
// A slot is held by money that has arrived, or by a plan that commits to it:
//
//   registered        a free event - there is nothing to pay, so the seat is theirs
//   payment_verified  paid in full and confirmed
//   installment       on a flexible plan: part-paid, and the balance is owed to
//                     the event, not in question. The seat is reserved for them
//                     for the whole time they are paying it down.
//
// Everything else is deliberately left out:
//
//   pending_payment   nobody has paid anything
//   payment_submitted a payment was sent but has not been checked, so it may
//                     yet turn out not to exist
//   cancelled         gone
//
// Counting each registration once is what keeps the arithmetic honest: a person
// on a plan is a single row that shows in both the Registrations tab and the
// Flexible Installment tab, and it must cost the event one seat, not two.
export const SLOT_HOLDING_STATUSES = ['registered', 'payment_verified', 'installment'];
