'use client';

// Phone field with a country dial-code selector. Stores a single combined
// string like "+63 9171234567" via onChange, so it maps straight to a field.
const COUNTRIES = [
  { code: 'PH', dial: '+63', flag: '🇵🇭', name: 'Philippines' },
  { code: 'US', dial: '+1', flag: '🇺🇸', name: 'United States' },
  { code: 'SG', dial: '+65', flag: '🇸🇬', name: 'Singapore' },
  { code: 'MY', dial: '+60', flag: '🇲🇾', name: 'Malaysia' },
  { code: 'ID', dial: '+62', flag: '🇮🇩', name: 'Indonesia' },
  { code: 'AU', dial: '+61', flag: '🇦🇺', name: 'Australia' },
  { code: 'JP', dial: '+81', flag: '🇯🇵', name: 'Japan' },
  { code: 'KR', dial: '+82', flag: '🇰🇷', name: 'South Korea' },
  { code: 'HK', dial: '+852', flag: '🇭🇰', name: 'Hong Kong' },
  { code: 'AE', dial: '+971', flag: '🇦🇪', name: 'UAE' },
  { code: 'SA', dial: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { code: 'GB', dial: '+44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: 'CA', dial: '+1', flag: '🇨🇦', name: 'Canada' },
  { code: 'IN', dial: '+91', flag: '🇮🇳', name: 'India' },
  { code: 'CN', dial: '+86', flag: '🇨🇳', name: 'China' },
];

const DEFAULT_DIAL = '+63';

function parseValue(value) {
  const raw = (value || '').trim();
  if (!raw) return { dial: DEFAULT_DIAL, number: '' };
  // Longest matching dial code wins (e.g. +852 before +8)
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => raw.startsWith(c.dial));
  if (match) return { dial: match.dial, number: raw.slice(match.dial.length).trim() };
  return { dial: DEFAULT_DIAL, number: raw };
}

export default function PhoneInput({ value, onChange, placeholder = '9XX XXX XXXX', disabled }) {
  const { dial, number } = parseValue(value);

  const emit = (nextDial, nextNumber) => {
    const clean = (nextNumber || '').replace(/[^\d]/g, '');
    onChange?.(clean ? `${nextDial} ${clean}` : '');
  };

  return (
    <div className="phone-input">
      <select
        className="phone-input-dial"
        value={dial}
        disabled={disabled}
        onChange={(e) => emit(e.target.value, number)}
        aria-label="Country code"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.dial}>{c.flag} {c.dial}</option>
        ))}
      </select>
      <input
        type="tel"
        className="phone-input-number"
        value={number}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => emit(dial, e.target.value)}
        inputMode="numeric"
      />
    </div>
  );
}
