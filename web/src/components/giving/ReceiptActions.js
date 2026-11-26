'use client';

// The receipt's Print button (Print, or Save as PDF in the same window).
export function PrintButton() {
  return <button type="button" className="gv-btn is-primary" onClick={() => window.print()}>Print or save as PDF</button>;
}
