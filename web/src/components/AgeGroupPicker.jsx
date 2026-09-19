'use client';

import {
  registerableTiers, representativeTiers, tierAgeLabel, tierFee, tierKey,
} from '@/lib/eventPricing';

// "Which age group is this person?" - the one place that question is asked.
//
// An event that prices adults, children and toddlers differently (ADULTS ₱300 ·
// 6-10 YRS ₱100 · 5 AND BELOW FREE) needs this on every screen that registers
// somebody: the public form, a member booking for themselves, the admin desk and
// the committee desk. Four copies of a price list is how the four of them end up
// disagreeing, so there is one.
//
// An event with no age groups renders nothing at all, which is what keeps every
// existing event and every existing form exactly as it was.
export default function AgeGroupPicker({
  event,
  value,                 // the chosen group's label
  onChange,              // (label) => void
  title = 'Age Group',
  hint = '',
  compact = false,       // no heading - for a row inside a roster form
  disabled = false,
  // 'all' offers every group, children included - that is a roster, where a
  // child is one of the people being added. 'adult' leaves the children's
  // groups out: it is asking who is HOLDING a booking, and a 7-year-old cannot
  // hold one, take the call about the payment or be the name the desk asks for.
  scope = 'all',
}) {
  const options = scope === 'adult' ? representativeTiers(event) : registerableTiers(event);
  if (options.length === 0) return null;

  const chosen = value ? tierKey(value) : tierKey(options[0].label);

  return (
    <div className={`evt-tier-pick ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="evt-tier-pick-head">
          <i className="fas fa-user-group"></i>
          <span>{title}</span>
          {hint && <em className="evt-tier-pick-hint">{hint}</em>}
        </div>
      )}

      <div className="evt-tier-chips">
        {options.map((t) => {
          const fee = tierFee(event, t);
          const on = tierKey(t.label) === chosen;
          return (
            <button
              type="button"
              key={t.label}
              className={`evt-tier-chip ${on ? 'on' : ''} ${t.nameOnly ? 'kid' : ''}`}
              onClick={() => onChange(t.label)}
              disabled={disabled}
              aria-pressed={on}
            >
              <span className="evt-tier-chip-text">
                <strong>{t.label}</strong>
                {/* A children's group says what it asks for, because it asks for
                    less than the others and that is the reassuring part. */}
                <small>{tierAgeLabel(t)}{t.nameOnly ? ' · name only' : ''}</small>
              </span>
              <span className={`evt-tier-chip-fee ${fee > 0 ? '' : 'free'}`}>
                {fee > 0 ? `₱${fee}` : 'FREE'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
