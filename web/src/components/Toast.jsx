'use client';

// The dashboards' pop-up message (top right): an icon for what kind of news it
// is, the message, and a close button. Styles: .toast-notification in
// app/dashboard/dashboard.css. `toast` is { message, type, ms, id }.

const ICONS = {
  success: 'fa-circle-check',
  danger: 'fa-circle-exclamation',
  warning: 'fa-triangle-exclamation',
  info: 'fa-circle-info',
};

export default function Toast({ toast, onClose }) {
  if (!toast) return null;
  const type = ICONS[toast.type] ? toast.type : 'info';
  return (
    <div
      key={toast.id}
      className={`toast-notification toast-${type}`}
      role={type === 'danger' ? 'alert' : 'status'}
      aria-live={type === 'danger' ? 'assertive' : 'polite'}
      style={{ '--toast-ms': `${toast.ms || 4000}ms` }}
    >
      <i className={`fas ${ICONS[type]} toast-icon`} aria-hidden="true"></i>
      <span className="toast-text">{toast.message}</span>
      {onClose && (
        <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss message">
          <i className="fas fa-xmark" aria-hidden="true"></i>
        </button>
      )}
    </div>
  );
}
