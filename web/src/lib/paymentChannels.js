// What KIND a saved payment channel is, in one place.
//
// A `payment_methods` row is one of three things:
//
//   bank    an account at a bank        - BDO, BPI, Maribank
//   online  an e-wallet or gateway      - GCash, Maya, PayPal
//   cash    money handed to a person    - "Cash on the day"
//
// The first two are an ACCOUNT you send money to, so they carry a number, a
// name and usually a QR. Cash is not an account: there is nothing to send to,
// nothing to copy and nothing to scan. What it carries instead is the one thing
// the other two rarely need - instructions saying WHERE and WHEN to hand the
// money over ("at the registration desk, from 8am on the day").
//
// Before this existed, every screen answered "is this cash?" its own way - a
// free-text chip on the event, an `allow_cash` switch on apparel, a regex on
// the label. The regex is the reason this file matters: /^cash$/i matches the
// word "Cash" and nothing else, so a channel an Admin named "Cash on the day"
// was NOT recognised as cash by any of them. Every check now goes through
// isCashChannel / isCashMethodName below.

export const CASH = 'cash';
export const BANK = 'bank';
export const ONLINE = 'online';

// The Type dropdown on the Mode of Payment form, and the filter tabs beside it.
export const PAYMENT_CATEGORIES = [
  { key: BANK, label: 'Bank Transfer', plural: 'Bank Transfers', icon: 'fas fa-building-columns' },
  { key: ONLINE, label: 'Online Payment', plural: 'Online Payments', icon: 'fas fa-mobile-screen-button' },
  { key: CASH, label: 'Cash', plural: 'Cash', icon: 'fas fa-money-bill-wave' },
];

// A channel ROW is cash. This is the reliable test - it reads the category the
// Admin chose rather than guessing from what they typed in the name.
export const isCashChannel = (channel) => String(channel?.category || '').toLowerCase() === CASH;

// A channel NAME is cash, used where only the stored label survives: an old
// registration row, or an event whose free-text "Cash" / "Pay at Church" chip
// predates the Mode of Payment page. Deliberately broader than the old
// /^cash$/i - but "GCash" is an online wallet and must never match, which is
// why the word has to stand on its own.
export const isCashMethodName = (name) => {
  const s = String(name || '').trim();
  if (!s) return false;
  if (/gcash/i.test(s)) return false;
  return /(^|[^a-z])cash([^a-z]|$)/i.test(s) || /pay at (the )?church/i.test(s) || /walk[- ]?in/i.test(s);
};

// The question every payment screen actually asks: "was this paid in cash?"
// `channel` is the resolved payment_methods row when there is one; `name` is
// the label that was stored. Either is enough.
export const isCashPayment = (channel, name) => (channel ? isCashChannel(channel) : isCashMethodName(name));

// The badge beside a channel's name. Cash says where the money goes rather than
// what the channel is called, because "Cash" twice on one line reads as a typo.
export const channelTypeLabel = (channel) => {
  if (isCashChannel(channel)) return 'Cash';
  return channel?.category === BANK ? 'Bank Transfer' : 'Online Payment';
};

export const channelTypeIcon = (channel) => {
  if (isCashChannel(channel)) return 'fas fa-money-bill-wave';
  return channel?.category === BANK ? 'fas fa-building-columns' : 'fas fa-mobile-screen-button';
};

// Cash has no account, so the account/QR half of the form and of every payer
// card is simply not drawn for it.
export const channelHasAccount = (channel) => !isCashChannel(channel);

// Nobody gets a reference number or a receipt for money handed across a desk,
// so the two fields that are otherwise required are not asked for.
export const channelNeedsProof = (channel) => !isCashChannel(channel);

// The amber a cash circle is drawn in when it has no logo - matches
// .pm-logo-cash in dashboard.css.
export const CASH_COLOR = '#d97706';
export const defaultChannelColor = (category) => (category === CASH ? CASH_COLOR : '#1e3a8a');

// What the "name" field is called, which is different for all three: a bank has
// a bank name, a wallet has a channel name, and cash is named for the moment
// the money changes hands.
export const channelNameLabel = (category) => {
  if (category === CASH) return 'Cash Option Name *';
  return category === BANK ? 'Bank Name *' : 'Channel Name *';
};

export const channelNamePlaceholder = (category) => {
  if (category === CASH) return 'e.g. Cash on the day';
  return category === BANK ? 'e.g. BDO, BPI, Maribank' : 'e.g. GCash, Maya, PayPal';
};

// For cash this is the whole point of the row, so it is asked for plainly and
// marked required-ish in the copy rather than hidden behind "(optional)".
export const channelNotesLabel = (category) => (category === CASH
  ? 'Payment Instructions'
  : 'Notes / Instructions (optional)');

export const channelNotesPlaceholder = (category) => (category === CASH
  ? 'e.g. Pay at the registration desk on the day of the event. Please bring the exact amount.'
  : 'e.g. Please send the deposit slip to the church office.');

// Does this event take cash? Used to decide whether to print the "online
// payment only" warning, and whether the payer may skip the receipt.
// `channels` are the event's resolved rows; `labels` is events.payment_methods,
// which is all an event created before Mode of Payment existed has.
export const eventTakesCash = (channels, labels) => (channels || []).some(isCashChannel)
  || ((channels || []).length === 0 && (labels || []).some(isCashMethodName));
