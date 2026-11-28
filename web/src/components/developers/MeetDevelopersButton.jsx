'use client';

// "Meet the Developers" in the footers: always opens the window, whatever the
// session cookie or "Don't show this again" say.

import { openDevelopers } from '@/lib/developerWelcome';
import './developers.css';

export default function MeetDevelopersButton({ className = '' }) {
  return (
    <button type="button" className={`dw-footer-link ${className}`.trim()} onClick={() => openDevelopers('manual')} aria-haspopup="dialog">
      Meet the Developers
    </button>
  );
}
