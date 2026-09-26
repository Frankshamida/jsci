'use client';

// Where the money is for a walk-in paid in full, asked as the attendee is
// added rather than fixed afterwards from the row menu:
//   verified  - collected here, in front of whoever is recording it
//   turnover  - paid, but a committee member, usher or church contact took the
//               money and has still to hand it in (Paid - Pending Turnover)
//   unpaid    - not collected yet
const OPTIONS = [
  { key: 'verified', icon: 'fa-circle-check', label: 'Collected & Verified', hint: 'The money is here now.' },
  { key: 'turnover', icon: 'fa-hand-holding-dollar', label: 'Paid - Pending Turnover', hint: 'Paid, but someone else is holding the money.' },
  { key: 'unpaid', icon: 'fa-clock', label: 'Not Yet Collected', hint: 'Save it and verify the payment later.' },
];

export default function PayStatusPicker({ value, holder, onChange, onHolderChange, disabled }) {
  return (
    <>
      <div className="evt-plan-head" style={{ marginTop: 4 }}>Payment Status</div>
      <div className="evt-pay-status">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`evt-plan-option ${value === o.key ? 'on' : ''}`}
            onClick={() => onChange(o.key)}
            disabled={disabled}
          >
            <i className={`fas ${o.icon}`}></i>
            <span><strong>{o.label}</strong><small>{o.hint}</small></span>
          </button>
        ))}
      </div>
      {value === 'turnover' && (
        <>
          <div className="form-group" style={{ marginTop: 10 }}>
            <label>Who Is Holding The Money? *</label>
            <input
              className="form-control"
              value={holder || ''}
              onChange={(e) => onHolderChange(e.target.value)}
              placeholder="e.g. Ptr. Juan Cruz, or the usher's name"
              maxLength={120}
              disabled={disabled}
            />
          </div>
          <p className="evt-muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            <i className="fas fa-circle-info"></i> Their attendance QR and RFID card unlock now, but the money stays out of
            Cash Collected until you use <b>Confirm Turnover</b> once it is handed in.
          </p>
        </>
      )}
    </>
  );
}
