/* ============================================================
   Age-based pricing for events.

   A poster like

       ADULTS ₱300  ·  6-10 YRS OLD ₱100  ·  KIDS (5 BELOW) FREE
       +₱200 accommodation  ·  +₱100 accommodation  ·  name only, under a parent

   used to have nowhere to live: an event carried ONE registration_fee. Each
   age group is now a row in event_price_tiers, and these helpers are the one
   place that knows how to read them - the public form, the member form, the
   admin desk, the committee desk and the server all price a person through
   here, so a change of rule lands everywhere at once.

   An event with NO tiers is the normal case and stays exactly as it was:
   has_fee + registration_fee (or early_bird_price while that deadline holds).
   Nothing in here changes what such an event costs.

   Pure functions only - safe on the server and in a client component.
   ============================================================ */

// How a tier is keyed when it is referred to by name: across a save the rows
// are deleted and re-inserted, so ids change but labels do not.
export function tierKey(label) {
  return String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// The event's age groups, in poster order. Accepts the shape the API returns
// (snake_case rows) and the shape the admin form holds (camelCase drafts), so
// the create-event preview and the live event price a person identically.
export function eventTiers(evt) {
  const raw = evt?.event_price_tiers || evt?.priceTiers || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t, i) => ({
      id: t.id ?? null,
      position: Number(t.position ?? i + 1) || i + 1,
      label: String(t.label ?? '').trim(),
      minAge: numOrNull(t.min_age ?? t.minAge),
      maxAge: numOrNull(t.max_age ?? t.maxAge),
      fee: Number(t.fee) || 0,
      earlyFee: numOrNull(t.early_fee ?? t.earlyFee),
      // Anything but an explicit false means this group registers as normal.
      requiresRegistration: (t.requires_registration ?? t.requiresRegistration ?? true) !== false,
      // A children's group: a name and nothing else, registered under a parent
      // or guardian whose church and contact number the child's row inherits.
      nameOnly: (t.name_only ?? t.nameOnly ?? false) === true,
      note: (t.note ?? '') || '',
    }))
    .filter((t) => t.label)
    .sort((a, b) => a.position - b.position);
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasPriceTiers(evt) {
  return eventTiers(evt).length > 0;
}

// The groups that can be picked on a form. Every group registers - a child at
// the event is at the event, whatever they paid - so this is all of them unless
// an older event still carries a group marked as not registering.
export function registerableTiers(evt) {
  return eventTiers(evt).filter((t) => t.requiresRegistration);
}

// The groups a person can be registered under ON THEIR OWN: everything except
// the children's groups, which are always registered under somebody.
//
// It is also what a group booking's representative may be. A 7-year-old cannot
// hold a booking for eleven people, take the calls about the payment or be the
// name the desk asks for, so the representative is one of these.
export function representativeTiers(evt) {
  return registerableTiers(evt).filter((t) => !t.nameOnly);
}

// Is this a children's group - a name, a guardian and nothing else?
export function isNameOnlyTier(tier) {
  return !!tier && tier.nameOnly === true;
}

// The children's groups, named for the sentence that tells a parent where
// their toddler goes.
export function nameOnlyTiers(evt) {
  return registerableTiers(evt).filter((t) => t.nameOnly);
}

// Is the early-bird price in force right now?
export function isEarlyBird(evt) {
  if (!evt?.early_bird_deadline) return false;
  const until = new Date(evt.early_bird_deadline).getTime();
  return Number.isFinite(until) && Date.now() <= until;
}

// What one group pays, early-bird price included when it has one and the
// deadline still holds.
export function tierFee(evt, tier) {
  if (!tier) return 0;
  if (tier.earlyFee != null && isEarlyBird(evt)) return Number(tier.earlyFee) || 0;
  return Number(tier.fee) || 0;
}

// Find a group by id or by name. Registrations store the NAME, so a group
// looked up after the event was edited still resolves.
export function findTier(evt, idOrLabel) {
  if (!idOrLabel) return null;
  const tiers = eventTiers(evt);
  const wanted = String(idOrLabel);
  return tiers.find((t) => t.id && t.id === wanted)
    || tiers.find((t) => tierKey(t.label) === tierKey(wanted))
    || null;
}

// What a form starts on: the first group a person can be registered under on
// their own, which on a poster written the usual way is the adults. Never a
// children's group - nobody's default is "toddler".
export function defaultTier(evt) {
  return representativeTiers(evt)[0] || registerableTiers(evt)[0] || null;
}

// The group a person belongs to at a given age, or null when no group covers it.
export function tierForAge(evt, age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  return eventTiers(evt).find((t) => (t.minAge == null || n >= t.minAge)
    && (t.maxAge == null || n <= t.maxAge)) || null;
}

// What an add-on costs someone in this group. An add-on with no override for
// the group costs what it costs everybody - so an event that prices its extras
// the same way for everyone never has to think about this.
export function addonFeeFor(addon, tier) {
  const base = Number(addon?.fee) || 0;
  if (!tier) return base;
  const map = addon?.tier_fees || addon?.tierFees;
  if (!map || typeof map !== 'object') return base;
  const raw = map[tierKey(tier.label)];
  if (raw === undefined || raw === null || raw === '') return base;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : base;
}

// The price an event charges when it has no age groups - which is every event
// that existed before they did.
export function flatBaseAmount(evt) {
  if (!evt || !evt.has_fee) return 0;
  const early = evt.early_bird_price != null && isEarlyBird(evt);
  return Number(early ? evt.early_bird_price : evt.registration_fee) || 0;
}

// What ONE person pays before their extras: their age group's price, or the
// event's single price when it has no groups.
export function baseAmountFor(evt, tier) {
  if (!hasPriceTiers(evt)) return flatBaseAmount(evt);
  const t = tier || defaultTier(evt);
  return t ? tierFee(evt, t) : flatBaseAmount(evt);
}

// "11 and up", "6-10 yrs old", "5 and below", "All ages" - how a group's ages
// read next to its name.
export function tierAgeLabel(tier) {
  if (!tier) return '';
  const { minAge, maxAge } = tier;
  if (minAge == null && maxAge == null) return 'All ages';
  if (minAge != null && maxAge != null) {
    return minAge === maxAge ? `${minAge} yrs old` : `${minAge}-${maxAge} yrs old`;
  }
  if (minAge != null) return `${minAge} and up`;
  return `${maxAge} and below`;
}

// An add-on's question, shortened to the thing it is asking about. The admin
// writes a question - "Do you want accommodation?" - because that is what an
// attendee is answering on the form. On a price card there is no question being
// asked, only a line item, and the full sentence wraps a 120px card to three
// lines for one word of meaning.
export function addonShortLabel(question) {
  const t = String(question || '').trim().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
  if (!t) return '';
  // The article only goes when it IS an article: "(a|an)?" without the space
  // after it happily eats the first letter of "accommodation".
  const short = t.replace(
    /^(?:do|would|will|can|may)\s+(?:you|u)\s+(?:want|need|like|prefer|require|avail(?:\s+of)?)\s+(?:to\s+(?:avail(?:\s+of)?|get|have|book)\s+)?(?:(?:a|an|the|any)\s+)?/i,
    '',
  );
  const out = (short || t).trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// A tier's price as it reads on a chip: "₱300", or "FREE" when it costs nothing.
export function tierPriceLabel(evt, tier) {
  const fee = tierFee(evt, tier);
  return fee > 0 ? `₱${fee}` : 'FREE';
}

// What the event costs, in one line, for a poster or a list row:
// "Free" · "₱300" · "₱100 - ₱300" when the groups differ.
export function eventFeeLabel(evt) {
  // Read off the paying groups. A children's group is free by nature, and
  // letting it into the range turns every tiered event into "Free - ₱300",
  // which reads as though an adult might get in for nothing.
  const tiers = representativeTiers(evt);
  if (tiers.length === 0) {
    const flat = flatBaseAmount(evt);
    return evt?.has_fee && flat > 0 ? `₱${flat}` : 'Free';
  }
  const fees = tiers.map((t) => tierFee(evt, t));
  const low = Math.min(...fees);
  const high = Math.max(...fees);
  if (high <= 0) return 'Free';
  if (low === high) return `₱${high}`;
  return low > 0 ? `₱${low} - ₱${high}` : `Free - ₱${high}`;
}

// The three groups nearly every poster uses, offered as a starting point so an
// admin fills in prices rather than inventing the whole table.
export const STARTER_TIERS = [
  { label: 'Adults', minAge: 11, maxAge: null, fee: '', earlyFee: '', requiresRegistration: true, nameOnly: false, note: '' },
  { label: '6-10 Yrs Old', minAge: 6, maxAge: 10, fee: '', earlyFee: '', requiresRegistration: true, nameOnly: false, note: '' },
  {
    label: 'Kids (5 Below)',
    minAge: null,
    maxAge: 5,
    fee: '0',
    earlyFee: '',
    requiresRegistration: true,
    // Registered, counted and badged - but with a name only, under whoever
    // brought them. No note: the event page says that for itself, and a
    // sentence written in here would only be one more thing to edit.
    nameOnly: true,
    note: '',
  },
];
