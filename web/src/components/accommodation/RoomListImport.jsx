'use client';

import { useMemo, useRef, useState } from 'react';
import './roomListImport.css';

// Accommodation > Import list.
//
// Two steps, and the second is the point of it. The hotel's list is read -
// its rooms by their numbers, the names on each room's lines - and every
// name is put next to the person it was matched to. Nothing is saved until
// somebody has looked and pressed Assign.
//
// A name is taken as somebody only when it IS their name and they paid for a
// bed. Anything less - "Juan Cruz" for Juan Dela Cruz, two Mark Tans, a name
// nobody registered - is left for the person at the screen: a suggestion they
// can take with one click, or anybody on the event they choose from the list,
// or nobody. The server checks all of it again before writing.
//
//   eventId, actorId   who and what
//   rooms              the event's rooms, for room numbers and pax
//   onDone(message)    imported; the screen behind reloads
//   onClose()          left without importing

const ACCEPT = '.xlsx,.xlsm,.csv,.docx,.pdf';
const KIND_LABEL = { xlsx: 'Excel', docx: 'Word', csv: 'CSV', pdf: 'PDF' };

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; }
};

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

export default function RoomListImport({ eventId, actorId, rooms, onDone, onClose }) {
  const [stage, setStage] = useState('pick'); // pick | reading | review | saving
  const [source, setSource] = useState('file');
  const [file, setFile] = useState(null);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [problems, setProblems] = useState([]);
  const [preview, setPreview] = useState(null);
  const [picks, setPicks] = useState({});
  const [lists, setLists] = useState({});
  const [removeMissing, setRemoveMissing] = useState(false);
  const [onlyNeeds, setOnlyNeeds] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const roomsById = useMemo(() => new Map((rooms || []).map((r) => [r.id, r])), [rooms]);

  // ---- Read ----
  const read = async () => {
    setError('');
    setProblems([]);
    if (source === 'file' && !file) { setError('Choose the file first.'); return; }
    if (source === 'link' && !link.trim()) { setError('Paste the Google Sheets or Docs link first.'); return; }
    setStage('reading');
    try {
      const fd = new FormData();
      fd.append('eventId', eventId);
      fd.append('actorId', actorId || '');
      fd.append('step', 'preview');
      if (source === 'file') fd.append('file', file);
      else fd.append('link', link.trim());
      const res = await fetch('/api/events/room-list', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) { setError(data.message); setStage('pick'); return; }
      // Only exact names start picked. Everything else starts empty.
      const first = {};
      data.groups.forEach((g) => g.slots.forEach((s) => s.entries.forEach((e) => {
        first[e.id] = e.status === 'matched' ? e.regId : '';
      })));
      setPicks(first);
      setLists(Object.fromEntries(data.groups.filter((g) => g.list).map((g) => [g.key, g.roomId || ''])));
      setPreview(data);
      setRemoveMissing(false);
      setOnlyNeeds(false);
      setStage('review');
    } catch (err) {
      setError(err.message || 'The file could not be sent.');
      setStage('pick');
    }
  };

  // ---- What the picks add up to ----
  const view = useMemo(() => {
    if (!preview) return null;
    const people = new Map(preview.people.map((p) => [p.id, p]));
    const paid = preview.people.filter((p) => p.entitled).sort((a, b) => a.name.localeCompare(b.name));
    const currentRoom = new Map(preview.current.map((c) => [c.registrationId, c.roomId]));
    const roomOf = (g) => (g.list ? lists[g.key] || '' : g.roomId);

    // Where each person is picked.
    const pickedAt = new Map();
    preview.groups.forEach((g) => g.slots.forEach((s) => s.entries.forEach((e) => {
      const id = picks[e.id];
      if (!id) return;
      if (!pickedAt.has(id)) pickedAt.set(id, []);
      pickedAt.get(id).push({ group: g, slot: s, entry: e });
    })));

    // Rooms afterwards: who stays, plus who the list puts there.
    const after = new Map();
    preview.current.forEach((c) => {
      if (pickedAt.has(c.registrationId) || removeMissing) return;
      after.set(c.roomId, (after.get(c.roomId) || 0) + 1);
    });
    preview.groups.forEach((g) => {
      const roomId = roomOf(g);
      if (!roomId) return;
      g.slots.forEach((s) => s.entries.forEach((e) => {
        if (picks[e.id]) after.set(roomId, (after.get(roomId) || 0) + 1);
      }));
    });

    const blocking = [];
    pickedAt.forEach((at, id) => {
      if (at.length > 1) blocking.push(`${people.get(id)?.name || 'Somebody'} is picked ${at.length} times (${at.map((a) => a.slot.where).join(', ')}).`);
    });
    const overRooms = new Set();
    after.forEach((count, roomId) => {
      const room = roomsById.get(roomId);
      if (room && count > (Number(room.pax) || 1)) {
        overRooms.add(roomId);
        blocking.push(`Room ${room.room_number} would have ${count} people - it sleeps ${room.pax}.`);
      }
    });
    preview.groups.forEach((g) => {
      if (g.list && !roomOf(g) && g.slots.some((s) => s.entries.some((e) => picks[e.id]))) {
        blocking.push(`Choose which room the list on "${g.label}" is for.`);
      }
    });

    let names = 0;
    let exact = 0;
    let chosen = 0;
    let needs = 0;
    preview.groups.forEach((g) => g.slots.forEach((s) => s.entries.forEach((e) => {
      names += 1;
      const p = picks[e.id];
      if (p && p === e.regId) exact += 1;
      else if (p) chosen += 1;
      else needs += 1;
    })));
    const notOnList = preview.current.filter((c) => !pickedAt.has(c.registrationId)).length;
    const assigning = pickedAt.size;
    // Who the system has in each room right now - what Export writes.
    const nowIn = new Map();
    preview.current.forEach((c) => nowIn.set(c.roomId, (nowIn.get(c.roomId) || 0) + 1));

    return { people, paid, currentRoom, pickedAt, after, blocking, overRooms, roomOf, names, exact, chosen, needs, notOnList, assigning, nowIn };
  }, [preview, picks, lists, removeMissing, roomsById]);

  // ---- Assign ----
  const apply = async () => {
    if (!preview || !view || view.blocking.length) return;
    setStage('saving');
    setError('');
    setProblems([]);
    try {
      const fd = new FormData();
      fd.append('eventId', eventId);
      fd.append('actorId', actorId || '');
      fd.append('step', 'apply');
      fd.append('sha', preview.file.sha);
      fd.append('decisions', JSON.stringify({ picks, lists, removeMissing }));
      if (preview.file.data) fd.append('file', b64ToBlob(preview.file.data), preview.file.name);
      else fd.append('file', file);
      const res = await fetch('/api/events/room-list', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        setProblems(data.problems || []);
        setStage('review');
        return;
      }
      onDone(data.message);
    } catch (err) {
      setError(err.message || 'The list could not be saved.');
      setStage('review');
    }
  };

  const setPick = (entryId, regId) => setPicks((p) => ({ ...p, [entryId]: regId }));

  // ---- One name off the list ----
  const statusOf = (e) => {
    const p = picks[e.id];
    if (p && (view.pickedAt.get(p)?.length || 0) > 1) return { tone: 'bad', icon: 'fa-clone', text: 'Picked twice' };
    if (p && p === e.regId) return { tone: 'ok', icon: 'fa-check', text: 'Exact match' };
    if (p) return { tone: 'set', icon: 'fa-user-check', text: 'You chose' };
    if (e.status === 'ambiguous') return { tone: 'warn', icon: 'fa-users', text: `${e.options.length} people have this name - choose` };
    if (e.status === 'check') return { tone: 'warn', icon: 'fa-circle-question', text: 'Not an exact match' };
    if (e.status === 'no_accommodation') return { tone: 'bad', icon: 'fa-bed', text: 'Did not avail accommodation' };
    return { tone: 'bad', icon: 'fa-user-xmark', text: 'Not registered for this event' };
  };

  const entryRow = (g, s, e) => {
    const st = statusOf(e);
    const pick = picks[e.id] || '';
    const roomId = view.roomOf(g);
    const nowIn = pick ? view.currentRoom.get(pick) : null;
    const movesFrom = pick && nowIn && nowIn !== roomId ? roomsById.get(nowIn)?.room_number : null;
    const paidOptions = (e.options || []).filter((o) => view.people.get(o.id)?.entitled);
    const suggestion = !pick && e.status === 'check' ? paidOptions[0] : null;
    const notPaid = e.status === 'no_accommodation' ? view.people.get(e.options?.[0]?.id) : null;
    return (
      <div className={`rli-entry tone-${st.tone}`} key={e.id}>
        <div className="rli-entry-read">
          <span className="rli-entry-text">{e.text}</span>
          <small>{s.where}</small>
        </div>
        <i className="fas fa-arrow-right rli-entry-arrow" aria-hidden="true"></i>
        <div className="rli-entry-pick">
          <select
            value={pick}
            onChange={(ev) => setPick(e.id, ev.target.value)}
            aria-label={`Who "${e.text}" is`}
            className={pick ? 'set' : ''}
          >
            <option value="">- Leave unassigned -</option>
            {paidOptions.length > 0 && (
              <optgroup label={e.status === 'ambiguous' ? 'People with this name' : 'Closest names'}>
                {paidOptions.map((o) => {
                  const p = view.people.get(o.id);
                  return <option key={`s-${o.id}`} value={o.id}>{o.name}{p?.church ? ` - ${p.church}` : ''}</option>;
                })}
              </optgroup>
            )}
            <optgroup label="Everybody who paid for accommodation">
              {view.paid.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.church ? ` - ${p.church}` : ''}{view.pickedAt.has(p.id) && p.id !== pick ? ' (already on this list)' : ''}
                </option>
              ))}
            </optgroup>
          </select>
          <span className={`rli-chip tone-${st.tone}`}><i className={`fas ${st.icon}`}></i> {st.text}</span>
          {suggestion && (
            <button type="button" className="rli-suggest" onClick={() => setPick(e.id, suggestion.id)}>
              Is it <b>{suggestion.name}</b>? Use them
            </button>
          )}
          {notPaid?.why && <span className="rli-why">{notPaid.name} {notPaid.why}.</span>}
          {movesFrom && <span className="rli-move"><i className="fas fa-right-left"></i> Moves from {movesFrom}</span>}
        </div>
      </div>
    );
  };

  const needsYou = (e) => !picks[e.id] || (view.pickedAt.get(picks[e.id])?.length || 0) > 1;

  // ---- Screens ----
  const head = (
    <div className="evt-modal-head">
      <div>
        <h3><i className="fas fa-file-import"></i> Import rooming list</h3>
        <p>{preview ? `${preview.file.name} · ${KIND_LABEL[preview.file.kind] || preview.file.kind}` : 'Excel, CSV, Word, PDF, or a Google Sheets / Docs link'}</p>
      </div>
      <button type="button" className="evt-modal-close" onClick={onClose} disabled={stage === 'saving'} aria-label="Close">
        <i className="fas fa-times"></i>
      </button>
    </div>
  );

  if (stage === 'pick' || stage === 'reading') {
    const reading = stage === 'reading';
    return (
      <div className="evt-modal-overlay" onClick={reading ? undefined : onClose}>
        <div className="evt-modal rli-modal rli-modal-pick" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
          {head}
          <div className="evt-modal-body">
            <div className="rli-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={source === 'file'} className={source === 'file' ? 'on' : ''} onClick={() => setSource('file')}>
                <i className="fas fa-file-arrow-up"></i> Upload a file
              </button>
              <button type="button" role="tab" aria-selected={source === 'link'} className={source === 'link' ? 'on' : ''} onClick={() => setSource('link')}>
                <i className="fab fa-google-drive"></i> Google link
              </button>
            </div>

            {source === 'file' ? (
              <label
                className={`rli-drop ${dragging ? 'over' : ''} ${file ? 'has' : ''}`}
                onDragOver={(ev) => { ev.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(ev) => {
                  ev.preventDefault();
                  setDragging(false);
                  const f = ev.dataTransfer.files?.[0];
                  if (f) { setFile(f); setError(''); }
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  onChange={(ev) => { setFile(ev.target.files?.[0] || null); setError(''); }}
                  disabled={reading}
                />
                <i className={`fas ${file ? 'fa-file-circle-check' : 'fa-cloud-arrow-up'}`}></i>
                {file ? (
                  <>
                    <b>{file.name}</b>
                    <span>{(file.size / 1024).toFixed(0)} KB · click to choose another</span>
                  </>
                ) : (
                  <>
                    <b>Drop the hotel&rsquo;s list here, or click to choose it</b>
                    <span>.xlsx · .csv · .docx · .pdf - up to 8 MB</span>
                  </>
                )}
              </label>
            ) : (
              <div className="rli-link">
                <input
                  type="url"
                  className="form-control"
                  value={link}
                  onChange={(ev) => { setLink(ev.target.value); setError(''); }}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  disabled={reading}
                />
                <p>The file must be shared as <b>Anyone with the link</b>. Or download it from Google (File &gt; Download &gt; .xlsx or .docx) and upload that.</p>
              </div>
            )}

            <ul className="rli-how">
              <li><i className="fas fa-hashtag"></i> Rooms are found by their numbers - the rooms already added to this event. Every tab is read: a tab with just a list of lines (like the dorm&rsquo;s) is matched to its room by the tab&rsquo;s name, and you can change it.</li>
              <li><i className="fas fa-user-shield"></i> A name is only taken as somebody when it is exactly their name and they paid for accommodation. Everything else waits for you.</li>
              <li><i className="fas fa-floppy-disk"></i> Nothing is saved until you check the names and press Assign. Export gives back this same file, with the names the system has.</li>
            </ul>

            {error && <p className="rli-error"><i className="fas fa-triangle-exclamation"></i> {error}</p>}
          </div>
          <div className="evt-modal-foot">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={reading}>Cancel</button>
            <button type="button" className="btn-primary" onClick={read} disabled={reading}>
              <i className={`fas ${reading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}`}></i> {reading ? 'Reading the list...' : 'Read the list'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Review ----
  const saving = stage === 'saving';
  // A list tab (the dorm's) is always shown, names or not: which room it is
  // for decides whose names the export writes on it, and that has to be seen.
  const listTabs = preview.groups.filter((g) => g.list);
  const withNames = preview.groups.filter((g) => !g.list && g.slots.some((s) => s.entries.length));
  const empty = preview.groups.filter((g) => !g.list && !g.slots.some((s) => s.entries.length));
  const cards = [...listTabs, ...withNames];
  const shownGroups = onlyNeeds
    ? cards.filter((g) => g.slots.some((s) => s.entries.some(needsYou)) || view.overRooms.has(view.roomOf(g)) || (g.list && !view.roomOf(g)))
    : cards;
  const tabWord = preview.file.kind === 'xlsx' ? 'Tab ' : '';

  return (
    <div className="evt-modal-overlay">
      <div className="evt-modal rli-modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
        {head}
        <div className="evt-modal-body rli-body">
          <div className="rli-summary">
            <div><b>{view.names}</b><em>names read</em></div>
            <div className="ok"><b>{view.exact}</b><em>exact matches</em></div>
            <div className="set"><b>{view.chosen}</b><em>chosen by you</em></div>
            <div className={view.needs ? 'warn' : ''}><b>{view.needs}</b><em>unassigned</em></div>
          </div>

          {preview.stored && (
            <p className="rli-note"><i className="fas fa-clock-rotate-left"></i> This replaces <b>{preview.stored.fileName}</b>, imported {fmtDate(preview.stored.importedAt)}. Export will use this new file.</p>
          )}
          {preview.unknown.length > 0 && (
            <p className="rli-note warn">
              <i className="fas fa-triangle-exclamation"></i>
              <span>
                These look like rooms but are not on this event&rsquo;s room list, so the names beside them were not read:{' '}
                <b>{preview.unknown.map((u) => `${u.text} (${u.where})`).join(', ')}</b>. Add the rooms under Accommodation and import again.
              </span>
            </p>
          )}
          {preview.notes.map((n) => <p className="rli-note" key={n}><i className="fas fa-circle-info"></i> {n}</p>)}
          {view.names === 0 && (
            <p className="rli-note">
              <i className="fas fa-circle-info"></i>
              No names are written on this list. Importing it still keeps the file, so Export can fill it in with the names the system has.
            </p>
          )}

          {withNames.length > 0 && (
            <div className="rli-filter">
              <button type="button" className={!onlyNeeds ? 'on' : ''} onClick={() => setOnlyNeeds(false)}>All ({cards.length})</button>
              <button type="button" className={onlyNeeds ? 'on' : ''} onClick={() => setOnlyNeeds(true)}>Need you</button>
            </div>
          )}

          {shownGroups.map((g) => {
            const roomId = view.roomOf(g);
            const room = roomId ? roomsById.get(roomId) : null;
            const count = roomId ? view.after.get(roomId) || 0 : 0;
            const over = roomId && view.overRooms.has(roomId);
            const blanks = g.slots.filter((s) => !s.entries.length).length;
            const shownSlots = onlyNeeds ? g.slots.filter((s) => s.entries.some(needsYou)) : g.slots;
            const nowIn = roomId ? view.nowIn.get(roomId) || 0 : 0;
            return (
              <section className={`rli-room ${g.list ? 'rli-tab' : ''} ${g.list && !roomId ? 'unset' : ''} ${over ? 'over' : ''}`} key={g.key}>
                <header>
                  {g.list ? (
                    <div className="rli-room-list">
                      <span>
                        <i className="fas fa-table-list"></i> {tabWord}<b>{g.label}</b>
                        {g.title && g.title !== g.label ? <em> &ldquo;{g.title}&rdquo;</em> : null}
                        {' '}- {g.slots.length} {g.slots.length === 1 ? 'line' : 'lines'} - is the list for
                      </span>
                      <select value={lists[g.key] || ''} onChange={(ev) => setLists((l) => ({ ...l, [g.key]: ev.target.value }))}>
                        <option value="">- choose the room -</option>
                        {[...(g.guesses || []).map((id) => roomsById.get(id)).filter(Boolean),
                          ...(rooms || []).filter((r) => !(g.guesses || []).includes(r.id))]
                          .map((r) => <option key={r.id} value={r.id}>{r.room_number} - {r.room_type} ({r.pax} pax)</option>)}
                      </select>
                    </div>
                  ) : (
                    <h4>
                      <span className="rli-room-num">{room?.room_number || g.label}</span>
                      {room?.room_type && <em>{room.room_type}</em>}
                      <small>{g.where}</small>
                    </h4>
                  )}
                  {room && (
                    <span className={`rli-pax ${over ? 'over' : ''}`} title="People in the room after this import, of what it sleeps">
                      <i className="fas fa-bed"></i> {count} / {room.pax} pax
                    </span>
                  )}
                </header>
                <div className="rli-entries">
                  {shownSlots.flatMap((s) => s.entries.map((e) => entryRow(g, s, e)))}
                </div>
                {g.list ? (
                  // What the export will write on this tab.
                  !roomId ? (
                    <p className="rli-tab-note warn">
                      <i className="fas fa-hand-point-up"></i>
                      Choose the room this tab is for. On export, its lines are filled with the people the system has in that room.
                    </p>
                  ) : (
                    <p className="rli-tab-note">
                      <i className="fas fa-file-export"></i>
                      <span>
                        On export, this tab&rsquo;s lines are filled with the people in <b>{room.room_number}</b>.
                        {' '}The system has <b>{nowIn}</b> {nowIn === 1 ? 'person' : 'people'} in it now
                        {nowIn > g.slots.length ? ` - more than the ${g.slots.length} lines, so the extra names share the last line` : ''}.
                      </span>
                    </p>
                  )
                ) : (!onlyNeeds && blanks > 0 && (
                  <p className="rli-blank">{blanks} empty {blanks === 1 ? 'line' : 'lines'} - filled in on export with whoever the system puts in this room.</p>
                ))}
              </section>
            );
          })}
          {onlyNeeds && shownGroups.length === 0 && (
            <p className="rli-allgood"><i className="fas fa-circle-check"></i> Every name is matched. Nothing needs you.</p>
          )}

          {!onlyNeeds && empty.length > 0 && (
            <p className="rli-empty-rooms">
              <i className="fas fa-door-open"></i>
              <span>
                <b>{empty.length} {empty.length === 1 ? 'room has' : 'rooms have'} no names on the list:</b>{' '}
                {empty.map((g) => g.label).join(', ')}. Their lines are kept, and filled in on export.
              </span>
            </p>
          )}
        </div>

        <div className="rli-foot">
          {(view.blocking.length > 0 || problems.length > 0 || error) && (
            <div className="rli-blocking">
              {error && <b><i className="fas fa-triangle-exclamation"></i> {error}</b>}
              <ul>
                {[...new Set([...view.blocking, ...problems])].map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}
          {view.notOnList > 0 && (
            <label className="rli-remove">
              <input type="checkbox" checked={removeMissing} onChange={(ev) => setRemoveMissing(ev.target.checked)} disabled={saving} />
              <span>
                Also take out the <b>{view.notOnList}</b> {view.notOnList === 1 ? 'person who is' : 'people who are'} in a room now but not on this list.
                <em>Left unticked, they keep their rooms.</em>
              </span>
            </label>
          )}
          <div className="rli-foot-actions">
            <button type="button" className="btn-secondary" onClick={() => { setStage('pick'); setPreview(null); setError(''); setProblems([]); }} disabled={saving}>
              <i className="fas fa-arrow-left"></i> Another file
            </button>
            <button type="button" className="btn-primary" onClick={apply} disabled={saving || view.blocking.length > 0}>
              <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>
              {saving ? ' Saving...' : view.assigning > 0 ? ` Assign ${view.assigning} ${view.assigning === 1 ? 'person' : 'people'}` : ' Keep this file, assign nobody'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
