'use client';

// One member in Joyful Cares: why they are on the list, their last Sundays,
// the AI's suggestion and draft message, what the Pastors have done, and
// their history. A panel over the page (a dialog), full screen on a phone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { STEP_KINDS, URGENCY, DRAFT_LANGS, NOTE_KINDS, LIMITS, fillDraft } from '@/lib/joyfulCares';
import { Avatar, StatusPill, SundayDots, day, at, pct, plural, ago, manilaDay } from './careBits';

const TIMELINE_ICONS = {
  here: ['fa-circle-check', 'good'],
  missed: ['fa-circle-xmark', 'warn'],
  excused: ['fa-circle-minus', 'muted'],
  duty: ['fa-music', 'good'],
  'duty-missed': ['fa-triangle-exclamation', 'warn'],
  upcoming: ['fa-calendar-day', 'info'],
  excuse: ['fa-envelope', 'muted'],
  sub: ['fa-right-left', 'muted'],
};
const TIMELINE_PREVIEW = 14;
const addDays = (ymd, n) => { const t = new Date(`${ymd}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export default function CareMember({ memberId, actorId, canOpen, onMessage, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [ai, setAi] = useState(null);
  const [aiFresh, setAiFresh] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState(null); // null | 'care' | 'edit' | 'close' | 'contacted'
  const [form, setForm] = useState({ assignedTo: '', followUpOn: '', note: '', outcome: '' });
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState('');
  const [showAll, setShowAll] = useState(false);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const busyRef = useRef('');
  busyRef.current = busy;
  const closeFn = useRef(onClose);
  closeFn.current = onClose;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cares?actorId=${encodeURIComponent(actorId)}&memberId=${encodeURIComponent(memberId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'This member could not be loaded.');
      setDetail(json);
      setAi(json.member.ai);
      setAiFresh(!!json.member.aiFresh);
      setError('');
    } catch (e) { setError(e.message); }
  }, [actorId, memberId]);

  useEffect(() => { load(); }, [load]);

  // A dialog: focus in, Escape out, focus back to what opened it.
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busyRef.current) closeFn.current(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  const m = detail?.member;
  const today = detail?.today;

  const act = async (action, extra = {}, done = '') => {
    setBusy(action);
    setFlash('');
    try {
      const res = await fetch('/api/cares', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, memberId, action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'That could not be saved.');
      setMode(null);
      setFlash(done);
      await load();
      onChanged();
      return true;
    } catch (e) {
      setFlash(e.message);
      return false;
    } finally { setBusy(''); }
  };

  const suggest = async (refresh) => {
    setAiBusy(true);
    setAiError('');
    try {
      const res = await fetch('/api/cares/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, memberId, refresh: !!refresh }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The suggestion could not be made.');
      setAi(json.ai);
      setAiFresh(true);
    } catch (e) { setAiError(e.message); } finally { setAiBusy(false); }
  };

  const openForm = (which) => {
    setFlash('');
    setForm({
      assignedTo: m?.care.assignedTo || actorId,
      followUpOn: m?.care.followUpOn || addDays(today, 7),
      note: '',
      outcome: '',
    });
    setMode(which);
  };

  const draft = ai ? fillDraft(ai.drafts?.[lang] || ai.drafts?.en, m?.firstname) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft); setFlash('Message copied.'); } catch { setFlash('Copy did not work here; select the text and copy it.'); }
  };

  const events = detail?.timeline || [];
  const shown = showAll ? events : events.slice(0, TIMELINE_PREVIEW);
  const s = m?.signals;
  const canChat = canOpen('messages') && m?.canMessage;
  const ready = detail?.tablesReady !== false;

  return (
    <div className="jc-panel-backdrop" onClick={() => !busy && onClose()}>
      <aside className="jc-panel" role="dialog" aria-modal="true" aria-labelledby="jc-panel-title"
        ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <header className="jc-panel-head">
          {m ? <Avatar person={m} size={56} ring={m.status} /> : <span className="jc-avatar jc-skel" style={{ width: 56, height: 56 }} />}
          <div className="jc-panel-who">
            <h3 id="jc-panel-title">{m ? m.name : 'Loading…'}</h3>
            {m && (
              <div className="jc-panel-sub">
                <StatusPill status={m.status} small />
                {m.ministries.map((x) => (
                  <span key={x.key} className="jc-chip"><i className={`fas ${x.icon}`} aria-hidden="true"></i>{x.title}{x.head ? ' · head' : ''}</span>
                ))}
              </div>
            )}
          </div>
          <button ref={closeRef} type="button" className="jc-icon-btn" onClick={onClose} aria-label="Close">
            <i className="fas fa-xmark" aria-hidden="true"></i>
          </button>
        </header>

        {error && <p className="jc-error" role="alert">{error}</p>}
        {!m && !error && <div className="jc-panel-skel" aria-busy="true"><span /><span /><span /></div>}

        {m && (
          <div className="jc-panel-body">
            {flash && <p className="jc-flash" role="status">{flash}</p>}

            {/* Why they are here */}
            {m.flags.length > 0 && (
              <section className={`jc-why is-${m.status}`} aria-label="Why they are on the list">
                <h4><i className="fas fa-circle-info" aria-hidden="true"></i>What we noticed</h4>
                <ul>{m.flags.map((f) => <li key={f}>{f}</li>)}</ul>
              </section>
            )}

            {/* The numbers */}
            <section className="jc-facts" aria-label="Attendance">
              <div className="jc-facts-dots">
                <span className="jc-facts-label">Last {s.last8.length || 8} recorded Sundays</span>
                <SundayDots weeks={s.last8} />
              </div>
              <dl className="jc-facts-grid">
                <div><dt>Sundays in a row missed</dt><dd>{s.neverChecksIn ? '—' : s.streak}</dd></div>
                <div><dt>Sunday attendance</dt><dd>{pct(s.rate8)}<small>{s.ratePrev != null ? ` was ${pct(s.ratePrev)}` : ''}</small></dd></div>
                <div><dt>Lineup duties missed</dt><dd>{s.missedDuties30}<small> in 30 days</small></dd></div>
                <div><dt>Excuses sent</dt><dd>{s.excuses30}<small> in 30 days</small></dd></div>
                <div><dt>Last check-in</dt><dd className="is-text">{ago(today, s.lastCheckIn) || 'None yet'}</dd></div>
                <div><dt>Last reached out</dt><dd className="is-text">{s.lastContact ? ago(today, manilaDay(s.lastContact)) : 'Not yet'}</dd></div>
              </dl>
            </section>

            {/* The AI's suggestion */}
            <section className="jc-ai" aria-labelledby="jc-ai-title">
              <div className="jc-ai-head">
                <h4 id="jc-ai-title"><i className="fas fa-wand-magic-sparkles" aria-hidden="true"></i>Care suggestion</h4>
                {ai && <span className={`jc-urgency is-${ai.urgency}`}>{URGENCY[ai.urgency]}</span>}
              </div>
              {!ai && !aiBusy && (
                <>
                  <p className="jc-muted">Get a suggested next step and a short message you could send, in English, Tagalog or Cebuano. The AI sees the numbers and their own excuse notes, never their name or your notes.</p>
                  <button type="button" className="jc-btn jc-btn-ai" onClick={() => suggest(false)}>
                    <i className="fas fa-wand-magic-sparkles" aria-hidden="true"></i>Suggest a next step
                  </button>
                </>
              )}
              {aiBusy && <p className="jc-ai-thinking" role="status"><span className="jc-spinner" aria-hidden="true" />Thinking about how to help…</p>}
              {ai && !aiBusy && (
                <>
                  <p className="jc-ai-step">
                    <span className="jc-ai-step-icon" aria-hidden="true"><i className={`fas ${STEP_KINDS[ai.stepKind]?.icon || 'fa-heart'}`}></i></span>
                    <span><strong>{STEP_KINDS[ai.stepKind]?.label || 'Next step'}</strong>{ai.step ? `: ${fillDraft(ai.step, m.firstname)}` : ''}</span>
                  </p>
                  <p className="jc-ai-summary">{fillDraft(ai.summary, m.firstname)}</p>
                  <div className="jc-langs" role="tablist" aria-label="Message language">
                    {DRAFT_LANGS.map((l) => (
                      <button key={l.id} type="button" role="tab" aria-selected={lang === l.id} className={`jc-lang ${lang === l.id ? 'is-on' : ''}`}
                        onClick={() => setLang(l.id)} disabled={!ai.drafts?.[l.id]}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <blockquote className="jc-draft">{draft}</blockquote>
                  <div className="jc-row">
                    {canChat && (
                      <button type="button" className="jc-btn jc-btn-primary" onClick={() => { onClose(); onMessage(m.id, draft); }}>
                        <i className="fas fa-paper-plane" aria-hidden="true"></i>Message with this draft
                      </button>
                    )}
                    <button type="button" className="jc-btn" onClick={copy}><i className="fas fa-copy" aria-hidden="true"></i>Copy</button>
                    <button type="button" className="jc-link" onClick={() => suggest(true)}>Ask again</button>
                  </div>
                  <p className="jc-fine">
                    {aiFresh ? `Suggested ${ago(today, manilaDay(ai.at))}.` : 'Things have changed since this suggestion: ask again for a fresh one.'} A starting point only; you know them best.
                  </p>
                </>
              )}
              {aiError && <p className="jc-error" role="alert">{aiError}</p>}
            </section>

            {/* Care */}
            <section className="jc-care" aria-labelledby="jc-care-title">
              <h4 id="jc-care-title"><i className="fas fa-heart" aria-hidden="true"></i>Care</h4>
              {!ready && <p className="jc-error">Saving needs the Joyful Cares tables: run supabase/migrations/joyful_cares.sql in Supabase.</p>}
              {m.care.inCare ? (
                <p className="jc-care-state">
                  In care{m.care.assignedName ? <> with <strong>{m.care.assignedName}</strong></> : ''}
                  {m.care.since ? ` since ${at(m.care.since, { month: 'short', day: 'numeric' })}` : ''}
                  {m.care.followUpOn && (
                    <span className={`jc-due ${m.care.followUpOn < today ? 'is-late' : m.care.followUpOn === today ? 'is-today' : ''}`}>
                      Follow up {m.care.followUpOn === today ? 'today' : m.care.followUpOn < today ? `was due ${day(m.care.followUpOn, { month: 'short', day: 'numeric' })}` : `by ${day(m.care.followUpOn, { weekday: 'short', month: 'short', day: 'numeric' })}`}
                    </span>
                  )}
                </p>
              ) : (
                <p className="jc-muted">Not in care. Take them into care to give them a Pastor and a follow-up date.</p>
              )}

              {!mode && (
                <div className="jc-row">
                  {!m.care.inCare && <button type="button" className="jc-btn jc-btn-primary" disabled={!ready} onClick={() => openForm('care')}><i className="fas fa-heart" aria-hidden="true"></i>Take into care</button>}
                  {m.care.inCare && <button type="button" className="jc-btn" disabled={!ready} onClick={() => openForm('edit')}><i className="fas fa-user-pen" aria-hidden="true"></i>Change Pastor or date</button>}
                  <button type="button" className="jc-btn" disabled={!ready || !!busy} onClick={() => openForm('contacted')}><i className="fas fa-comment-dots" aria-hidden="true"></i>I reached out</button>
                  {m.flags.length > 0 && !m.care.inCare && (
                    <button type="button" className="jc-btn" disabled={!ready || !!busy} onClick={() => act('clear', {}, 'Flags cleared. New absences will show again.')}>
                      <i className="fas fa-broom" aria-hidden="true"></i>All clear (was there)
                    </button>
                  )}
                  {m.care.inCare && <button type="button" className="jc-btn" disabled={!ready} onClick={() => openForm('close')}><i className="fas fa-circle-check" aria-hidden="true"></i>Close care</button>}
                </div>
              )}

              {(mode === 'care' || mode === 'edit') && (
                <form className="jc-form" onSubmit={(e) => { e.preventDefault(); act(mode === 'care' ? 'care' : 'update', { assignedTo: form.assignedTo, followUpOn: form.followUpOn, note: form.note }, mode === 'care' ? 'Taken into care.' : 'Care updated.'); }}>
                  <div className="jc-form-grid">
                    <label>
                      <span>Pastor</span>
                      <select value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
                        {(detail.pastors || []).map((p) => <option key={p.id} value={p.id}>{p.id === actorId ? `${p.name} (me)` : p.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Follow up by</span>
                      <input type="date" value={form.followUpOn} min={today} onChange={(e) => setForm((f) => ({ ...f, followUpOn: e.target.value }))} />
                    </label>
                  </div>
                  {mode === 'care' && (
                    <label>
                      <span>Note <em>optional, only Pastors see it</em></span>
                      <textarea rows={2} maxLength={LIMITS.note} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                    </label>
                  )}
                  <div className="jc-row jc-row-end">
                    <button type="button" className="jc-btn" onClick={() => setMode(null)} disabled={!!busy}>Cancel</button>
                    <button type="submit" className="jc-btn jc-btn-primary" disabled={!!busy}>{busy ? 'Saving…' : mode === 'care' ? 'Take into care' : 'Save'}</button>
                  </div>
                </form>
              )}

              {mode === 'contacted' && (
                <form className="jc-form" onSubmit={(e) => { e.preventDefault(); act('contacted', { note: form.note }, 'Noted that you reached out.'); }}>
                  <label>
                    <span>How did it go? <em>optional</em></span>
                    <textarea rows={2} maxLength={LIMITS.note} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. Called her. Her mother is in the hospital; she will be back after two weeks." />
                  </label>
                  <div className="jc-row jc-row-end">
                    <button type="button" className="jc-btn" onClick={() => setMode(null)} disabled={!!busy}>Cancel</button>
                    <button type="submit" className="jc-btn jc-btn-primary" disabled={!!busy}>{busy ? 'Saving…' : 'Save'}</button>
                  </div>
                </form>
              )}

              {mode === 'close' && (
                <form className="jc-form" onSubmit={(e) => { e.preventDefault(); act('close', { outcome: form.outcome }, 'Care closed. Praise God!'); }}>
                  <label>
                    <span>How did it end? <em>optional</em></span>
                    <textarea rows={2} maxLength={LIMITS.outcome} value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))} placeholder="e.g. Back serving on the lineup." />
                  </label>
                  <div className="jc-row jc-row-end">
                    <button type="button" className="jc-btn" onClick={() => setMode(null)} disabled={!!busy}>Cancel</button>
                    <button type="submit" className="jc-btn jc-btn-primary" disabled={!!busy}>{busy ? 'Saving…' : 'Close care'}</button>
                  </div>
                </form>
              )}
            </section>

            {/* A private note */}
            <section className="jc-notes" aria-labelledby="jc-notes-title">
              <h4 id="jc-notes-title"><i className="fas fa-lock" aria-hidden="true"></i>Private note</h4>
              <form onSubmit={async (e) => { e.preventDefault(); if (note.trim() && await act('note', { body: note }, 'Note saved.')) setNote(''); }}>
                <label className="jc-sr" htmlFor="jc-note-input">A note only Pastors can see</label>
                <textarea id="jc-note-input" rows={2} maxLength={LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Only Pastors see these notes." disabled={!ready} />
                <div className="jc-row jc-row-end">
                  <button type="submit" className="jc-btn" disabled={!ready || !note.trim() || !!busy}>{busy === 'note' ? 'Saving…' : 'Add note'}</button>
                </div>
              </form>
            </section>

            {/* History */}
            <section className="jc-timeline" aria-labelledby="jc-time-title">
              <h4 id="jc-time-title"><i className="fas fa-clock-rotate-left" aria-hidden="true"></i>History</h4>
              {events.length === 0 ? <p className="jc-muted">Nothing recorded yet.</p> : (
                <ol>
                  {shown.map((e, i) => {
                    const noteKind = e.kind.startsWith('note-') ? NOTE_KINDS[e.kind.slice(5)] : null;
                    const [icon, tone] = noteKind ? [noteKind.icon, 'note'] : (TIMELINE_ICONS[e.kind] || ['fa-circle', 'muted']);
                    return (
                      <li key={`${e.date}-${e.kind}-${i}`} className={`jc-ev is-${tone}`}>
                        <span className="jc-ev-icon" aria-hidden="true"><i className={`fas ${icon}`}></i></span>
                        <div className="jc-ev-body">
                          <span className="jc-ev-when">
                            {day(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                            {e.author ? ` · ${e.author}` : ''}
                          </span>
                          <span className="jc-ev-text">
                            {noteKind ? <strong>{noteKind.label}{e.text ? ': ' : ''}</strong> : null}
                            {noteKind ? <span className="jc-pre">{e.text}</span> : e.text}
                          </span>
                          {e.quote && <q className="jc-ev-quote">{e.quote}</q>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {events.length > TIMELINE_PREVIEW && (
                <button type="button" className="jc-link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show less' : `Show all ${plural(events.length, 'entry', 'entries')}`}
                </button>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
