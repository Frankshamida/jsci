'use client';

// The dashboard sidebar's menu, laid out by lib/sidebarLayout.js.
//
// Full sidebar: pinned pages, then dropdowns. One dropdown is open at a time
// and the one holding the page on screen opens by itself. Opening one is this
// component's own state, so it does not re-render the whole dashboard - that
// is what made the old dropdowns stutter. The open/close is a CSS grid-row
// transition, so it is smooth for any number of pages.
//
// Collapsed rail (icons only, desktop): each dropdown is one icon that opens
// its pages beside the rail. On a phone the sidebar is a full drawer even when
// the rail is on, so there the dropdowns open in place.

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isItemActive } from '@/lib/sidebarLayout';
import './sidebarNav.css';

const PHONE = '(max-width: 768px)';

function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}

// Beside the rail, level with the button, kept on screen.
function beside(button, count) {
  const r = button.getBoundingClientRect();
  const height = 52 + count * 46;
  return { left: r.right + 10, top: Math.max(8, Math.min(r.top, window.innerHeight - height - 8)) };
}

function Count({ n }) {
  if (!n) return null;
  return <span className="sn-count" aria-label={`${n} new`}>{n > 99 ? '99+' : n}</span>;
}

// tabs: which Give choice and which Giving page are showing ({ give, giving }).
export default function SidebarNav({ entries, activeSection, tabs = {}, collapsed: railClass, renderItem, badges = {} }) {
  const phone = usePhone();
  const rail = railClass && !phone;
  const tabKey = `${tabs.give || ''}|${tabs.giving || ''}`;
  const activeKey = entries.find((e) => e.type === 'group' && e.items.some((it) => isItemActive(it, activeSection, tabs)))?.key || null;
  // A small label above a part of a dropdown (Giving: Manage, Your giving).
  const renderItems = (items) => items.map((it) => (it.heading
    ? <Fragment key={`h-${it.id}`}><div className="sn-sub">{it.heading}</div>{renderItem(it)}</Fragment>
    : renderItem(it)));

  // null = follow the page on screen; '' = all closed; a key = that one open.
  const [chosen, setChosen] = useState(null);
  const openKey = chosen === null ? activeKey : chosen;
  // Going to another page (from anywhere) opens that page's dropdown.
  useEffect(() => { setChosen(null); }, [activeSection, tabKey]);

  const [flyout, setFlyout] = useState(null); // { key, style }
  const flyRef = useRef(null);
  const buttons = useRef({});

  useEffect(() => { setFlyout(null); }, [rail, activeSection, tabKey]);
  useEffect(() => {
    if (!flyout) return undefined;
    const onDown = (e) => {
      if (!flyRef.current?.contains(e.target) && !buttons.current[flyout.key]?.contains(e.target)) setFlyout(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') { buttons.current[flyout.key]?.focus(); setFlyout(null); } };
    const onMove = () => setFlyout(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
    };
  }, [flyout]);
  useEffect(() => { if (flyout) flyRef.current?.querySelector('.menu-item:not(.disabled)')?.focus(); }, [flyout]);

  const total = (items) => items.reduce((n, it) => n + (badges[it.id] || 0), 0);

  const group = (e) => {
    const open = openKey === e.key;
    const hasActive = e.key === activeKey;
    const n = total(e.items);
    if (rail) {
      const isOpen = flyout?.key === e.key;
      return (
        <button
          key={e.key}
          ref={(el) => { buttons.current[e.key] = el; }}
          type="button"
          className={`menu-item sn-rail-btn ${hasActive ? 'active' : ''} ${isOpen ? 'is-open' : ''}`}
          title={e.label}
          aria-label={e.label}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={(ev) => setFlyout(isOpen ? null : { key: e.key, style: beside(ev.currentTarget, e.items.length) })}
        >
          <span className="menu-icon"><i className={e.icon}></i></span>
          {n > 0 && <span className="sn-rail-dot" aria-hidden="true"></span>}
        </button>
      );
    }
    return (
      <div key={e.key} className={`sn-group ${open ? 'open' : ''}`}>
        <button
          type="button"
          className={`sn-head ${hasActive ? 'has-active' : ''}`}
          aria-expanded={open}
          onClick={() => setChosen(open ? '' : e.key)}
        >
          <span className="menu-icon"><i className={e.icon}></i></span>
          <span className="menu-label">{e.label}</span>
          {!open && <Count n={n} />}
          <i className="fas fa-chevron-down sn-chev" aria-hidden="true"></i>
        </button>
        {/* Closed: inert, so its pages are not in the tab order. */}
        <div className="sn-items" {...(open ? {} : { inert: '' })}>
          <div className="sn-inner">{renderItems(e.items)}</div>
        </div>
      </div>
    );
  };

  const flyGroup = flyout && entries.find((e) => e.type === 'group' && e.key === flyout.key);

  return (
    <>
      {entries.map((e, i) => {
        if (e.type === 'divider') return <div key={`d${i}`} className="sn-divider" role="separator"></div>;
        if (e.type === 'item') return renderItem(e.item);
        return group(e);
      })}
      {rail && flyGroup && createPortal(
        // A click on a page closes it (the page opens; this bubbles up here).
        <div ref={flyRef} className="sn-flyout" role="menu" aria-label={flyGroup.label} style={flyout.style} onClick={() => setFlyout(null)}>
          <div className="sn-flyout-title">{flyGroup.label}</div>
          {renderItems(flyGroup.items)}
        </div>,
        document.body,
      )}
    </>
  );
}
