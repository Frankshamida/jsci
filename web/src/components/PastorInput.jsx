'use client';

import { useEffect, useState } from 'react';

// The "Ptr. ____" field, with the pastors already given for the church typed
// above it. Same idea as the church list: a church's pastor is spelled the
// same way by everyone who comes from it, so it is offered rather than retyped
// in a dozen spellings. The suggestions depend on the church - with no church
// typed there is nothing to suggest.
//
// variant 'evt' is the dashboard's styling, 'hp' the public page's.
const LOOKS = {
  evt: { prefix: 'evt-prefix-input', invalid: 'evt-field-error', list: 'evt-church-list' },
  hp: { prefix: 'hp-prefix-input', invalid: 'invalid', list: 'hp-church-list' },
};

export default function PastorInput({
  eventId,
  churchName,
  value,
  onChange,
  invalid = false,
  variant = 'evt',
  placeholder = 'Juan Cruz',
  disabled = false,
}) {
  const look = LOOKS[variant] || LOOKS.evt;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const church = String(churchName || '').trim();

  useEffect(() => {
    if (!open || !eventId || !church) { setOptions([]); return undefined; }
    const q = String(value || '').trim();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/registrations?pastors=1&eventId=${eventId}`
          + `&church=${encodeURIComponent(church)}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setOptions(data.success ? data.data || [] : []);
      } catch { setOptions([]); }
    }, 220);
    return () => clearTimeout(timer);
  }, [open, eventId, church, value]);

  // Nothing to offer beyond what is already typed.
  const shown = options.filter((o) => o.name.toLowerCase() !== String(value || '').trim().toLowerCase());

  return (
    <div style={{ position: 'relative' }}>
      <div className={`${look.prefix} ${invalid ? look.invalid : ''}`}>
        <span>Ptr.</span>
        <input
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
        />
      </div>
      {open && shown.length > 0 && (
        <ul className={look.list}>
          {shown.map((o) => (
            <li key={o.name}>
              <button type="button" onMouseDown={() => { onChange(o.name); setOpen(false); }}>
                <span>Ptr. {o.name}</span>
                {o.count > 0 && <em>{o.count} registered</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
