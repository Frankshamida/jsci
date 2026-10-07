'use client';

import { useCallback, useEffect, useState } from 'react';
import './roomListImport.css';

// Accommodation > Live sheet: the rooming list in a Google Sheet that the
// system keeps up to date. Two ways:
//
//   My own sheet   the user's own Google Sheet. A small script is pasted into
//                  it (Apps Script) and deployed as a web app; the system
//                  writes the names through it. See lib/roomList/ownSheet.js.
//   System-made    the system makes the sheet from the imported list, in the
//                  Google account the app is connected to. See liveSheet.js.
//
//   eventId, actorId
//   onClose()
//   onToast(message, tone)

const SHEETS_API = 'https://console.cloud.google.com/apis/library/sheets.googleapis.com';
const KIND_LABEL = { xlsx: 'Excel', csv: 'CSV', docx: 'Word', pdf: 'PDF' };

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  return new Date(iso).toLocaleString();
}

export default function RoomSheetPanel({ eventId, actorId, onClose, onToast }) {
  const [state, setState] = useState(null); // { made, madeError, own, ownError }
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [confirmLink, setConfirmLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);

  const base = `/api/events/room-list/sheet?eventId=${encodeURIComponent(eventId)}&actorId=${encodeURIComponent(actorId || '')}`;
  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      const data = await res.json();
      if (data.success) {
        setState(data.data);
        setTab((t) => t || (data.data.made?.url && !data.data.own ? 'made' : 'own'));
      } else setError(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  // Kept fresh while open: the sheets are updated in the background, and
  // "updated 5 seconds ago" is the proof it is working.
  useEffect(() => {
    load();
    const poll = setInterval(load, 10000);
    const clock = setInterval(() => tick((n) => n + 1), 5000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  const act = async (action, extra = {}) => {
    setBusy(action);
    setError('');
    try {
      const res = await fetch('/api/events/room-list/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, actorId, action, ...extra }),
      });
      const data = await res.json();
      if (data.data) setState(data.data);
      if (!data.success) { setError(data.message); return null; }
      if (data.data?.confirm) { setConfirmLink(data.data.confirm); return data; }
      setConfirmLink(null);
      setConfirmStop('');
      if (data.message) onToast?.(data.message, 'success');
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy('');
    }
  };

  const copyText = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast?.(`${what} copied`, 'success');
      return true;
    } catch {
      onToast?.(`Could not copy the ${what.toLowerCase()} - select it and copy it by hand`, 'warning');
      return false;
    }
  };

  const copyScript = async () => {
    setBusy('script');
    setError('');
    try {
      const res = await fetch(`${base}&script=1`);
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      if (await copyText(data.data.script, 'Script')) setCopied(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const own = state?.own;
  const made = state?.made;
  const madeLive = !!made?.url;
  const cannotMake = made?.kind && !['xlsx', 'csv'].includes(made.kind) && !madeLive;

  // ---- My own sheet ----
  const ownBody = own ? (
    <>
      <div className="rls-link">
        <input className="form-control" readOnly value={own.url} onFocus={(ev) => ev.target.select()} aria-label="Google Sheet link" />
        <button type="button" className="btn-secondary" onClick={() => copyText(own.url, 'Link')}><i className="fas fa-copy"></i> Copy link</button>
        <a className="btn-secondary" href={own.url} target="_blank" rel="noopener noreferrer"><i className="fas fa-arrow-up-right-from-square"></i> Open</a>
      </div>
      {own.error ? (
        <p className="rli-note warn"><i className="fas fa-triangle-exclamation"></i><span>{own.error}</span></p>
      ) : (
        <p className="rls-ok">
          <i className="fas fa-circle-check"></i>
          <span>
            Connected to <b>{own.title || 'your sheet'}</b> - {own.rooms} {own.rooms === 1 ? 'room' : 'rooms'} on it.
            {own.syncedAt ? ` Updated ${ago(own.syncedAt)}.` : ''}
          </span>
        </p>
      )}
      {own.unplaced?.length > 0 && (
        <p className="rli-note warn">
          <i className="fas fa-circle-question"></i>
          <span>
            Not written to: tab <b>{own.unplaced.join(', ')}</b> - its name does not say which room it is for. Rename the tab
            after its room (its room number or type), then press <b>Read the sheet again</b>.
          </span>
        </p>
      )}
      <p className="rls-hint">
        Names change on the sheet a few seconds after they change here. Anything typed into the name boxes is replaced -
        make room changes in the system. Added rows or rooms to the sheet? Press <b>Read the sheet again</b>.
      </p>
    </>
  ) : confirmLink ? (
    <div className="rls-confirm-box">
      <p>
        <i className="fas fa-triangle-exclamation"></i>
        <span>
          <b>{confirmLink.title}</b> has <b>{confirmLink.written}</b> {confirmLink.written === 1 ? 'name' : 'names'} written in it now.
          Connecting replaces them with the system&rsquo;s list - <b>{confirmLink.inRooms}</b> {confirmLink.inRooms === 1 ? 'person' : 'people'} in rooms.
        </span>
      </p>
      <p className="rls-hint">
        To bring the sheet&rsquo;s names into the system first, close this, use <b>Import list</b> with the sheet&rsquo;s link,
        then connect it here.
      </p>
      <p className="rls-hint">Found on it: {confirmLink.roomsFound} of the event&rsquo;s {confirmLink.roomsTotal} rooms.</p>
    </div>
  ) : (
    <ol className="rls-steps">
      <li>
        <b>Copy the script</b>
        <button type="button" className="btn-secondary" onClick={copyScript} disabled={!!busy}>
          <i className={`fas ${busy === 'script' ? 'fa-spinner fa-spin' : copied ? 'fa-check' : 'fa-copy'}`}></i> {copied ? 'Copied - copy again' : 'Copy script'}
        </button>
      </li>
      <li>
        <b>Paste it into your sheet.</b> Open your Google Sheet &gt; <b>Extensions</b> &gt; <b>Apps Script</b>. Delete everything in
        the editor, paste, and press <b>Save</b>.
      </li>
      <li>
        <b>Deploy it.</b> <b>Deploy</b> &gt; <b>New deployment</b> &gt; gear icon &gt; <b>Web app</b>. Execute as: <b>Me</b>.
        Who has access: <b>Anyone</b>. Press <b>Deploy</b>, then allow access (if Google warns the app is unverified: Advanced &gt; Go
        to the project &gt; Allow).
        <em>Not &ldquo;Test deployments&rdquo; - that link only works while you are signed in.</em>
      </li>
      <li>
        <b>Paste the Web app URL here</b> (it ends in <code>/exec</code>):
        <input
          className="form-control"
          value={hookUrl}
          onChange={(ev) => { setHookUrl(ev.target.value); setError(''); }}
          placeholder="https://script.google.com/macros/s/.../exec"
          disabled={!!busy}
        />
      </li>
    </ol>
  );

  // ---- A sheet the system makes ----
  const madeBody = !madeLive ? (
    <>
      <ul className="rli-how">
        <li>
          <i className="fas fa-file-excel"></i>
          <span>
            Made from {made?.fileName ? <b>{made.fileName}</b> : <>a list of <b>every room</b> (no hotel list imported yet)</>}
            {' '}- the same design, every tab - in the Google account this app is connected to.
          </span>
        </li>
        <li><i className="fas fa-link"></i> Anyone with the link can <b>view</b> it. Send the link to the hotel or the team.</li>
        <li><i className="fas fa-bolt"></i> Every change to the rooms shows on it within seconds.</li>
      </ul>
      {state?.madeError && <p className="rli-note warn"><i className="fas fa-triangle-exclamation"></i><span>{state.madeError}</span></p>}
      {cannotMake && (
        <p className="rli-note warn">
          <i className="fas fa-triangle-exclamation"></i>
          <span>
            This event&rsquo;s list is a {KIND_LABEL[made.kind] || made.kind} file. A Google Sheet is made from an Excel or CSV
            list - import the Excel version of the hotel&rsquo;s list first.
          </span>
        </p>
      )}
    </>
  ) : (
    <>
      <div className="rls-link">
        <input className="form-control" readOnly value={made.url} onFocus={(ev) => ev.target.select()} aria-label="Google Sheet link" />
        <button type="button" className="btn-secondary" onClick={() => copyText(made.url, 'Link')}><i className="fas fa-copy"></i> Copy link</button>
        <a className="btn-secondary" href={made.url} target="_blank" rel="noopener noreferrer"><i className="fas fa-arrow-up-right-from-square"></i> Open</a>
      </div>
      {made.error ? (
        <p className="rli-note warn"><i className="fas fa-triangle-exclamation"></i><span>{made.error}</span></p>
      ) : (
        <p className="rls-ok">
          <i className="fas fa-circle-check"></i>
          <span>Up to date{made.syncedAt ? ` - updated ${ago(made.syncedAt)}` : ''}. Made from <b>{made.fileName}</b>.</span>
        </p>
      )}
      {made.mode === 'upload' && (
        <p className="rli-note">
          <i className="fas fa-circle-info"></i>
          <span>
            Each change re-sends the whole sheet, because the <b>Google Sheets API</b> is off for this app&rsquo;s Google project -
            it still works, but the sheet reloads for whoever has it open. Turn it on for names that change in place:{' '}
            <a href={SHEETS_API} target="_blank" rel="noopener noreferrer">Google Cloud Console &gt; Google Sheets API &gt; Enable</a>.
          </span>
        </p>
      )}
    </>
  );

  // ---- Footer ----
  let foot;
  if (tab === 'own') {
    if (own) {
      foot = confirmStop === 'own' ? (
        <>
          <span className="rls-confirm">Stop writing to your sheet? It keeps the names it has now.</span>
          <button type="button" className="btn-secondary" onClick={() => setConfirmStop('')} disabled={!!busy}>Keep it</button>
          <button type="button" className="btn-danger" onClick={() => act('own-unlink')} disabled={!!busy}>
            <i className={`fas ${busy === 'own-unlink' ? 'fa-spinner fa-spin' : 'fa-link-slash'}`}></i> Disconnect
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn-secondary rls-stop" onClick={() => setConfirmStop('own')} disabled={!!busy}>
            <i className="fas fa-link-slash"></i> Disconnect
          </button>
          <button type="button" className="btn-secondary" onClick={() => act('own-reread')} disabled={!!busy}>
            <i className={`fas ${busy === 'own-reread' ? 'fa-spinner fa-spin' : 'fa-table-list'}`}></i> Read the sheet again
          </button>
          <button type="button" className="btn-primary" onClick={() => act('sync')} disabled={!!busy}>
            <i className={`fas ${busy === 'sync' ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i> Update now
          </button>
        </>
      );
    } else if (confirmLink) {
      foot = (
        <>
          <button type="button" className="btn-secondary" onClick={() => setConfirmLink(null)} disabled={!!busy}>Cancel</button>
          <button type="button" className="btn-danger" onClick={() => act('own-link', { hookUrl, confirm: true })} disabled={!!busy}>
            <i className={`fas ${busy === 'own-link' ? 'fa-spinner fa-spin' : 'fa-check'}`}></i> Replace them and connect
          </button>
        </>
      );
    } else {
      foot = (
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => act('own-link', { hookUrl })} disabled={!!busy || !hookUrl.trim()}>
            <i className={`fas ${busy === 'own-link' ? 'fa-spinner fa-spin' : 'fa-plug'}`}></i>
            {busy === 'own-link' ? ' Reading your sheet...' : ' Connect my sheet'}
          </button>
        </>
      );
    }
  } else if (madeLive) {
    foot = confirmStop === 'made' ? (
      <>
        <span className="rls-confirm">Stop updating it? The sheet stays in Google Drive as it is now.</span>
        <button type="button" className="btn-secondary" onClick={() => setConfirmStop('')} disabled={!!busy}>Keep it live</button>
        <button type="button" className="btn-danger" onClick={() => act('stop')} disabled={!!busy}>
          <i className={`fas ${busy === 'stop' ? 'fa-spinner fa-spin' : 'fa-link-slash'}`}></i> Stop
        </button>
      </>
    ) : (
      <>
        <button type="button" className="btn-secondary rls-stop" onClick={() => setConfirmStop('made')} disabled={!!busy}>
          <i className="fas fa-link-slash"></i> Stop live updates
        </button>
        <button type="button" className="btn-primary" onClick={() => act('sync')} disabled={!!busy}>
          <i className={`fas ${busy === 'sync' ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i> Update now
        </button>
      </>
    );
  } else {
    foot = (
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={!!busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={() => act('create')} disabled={!!busy || loading || cannotMake || !!state?.madeError}>
          <i className={`fas ${busy === 'create' ? 'fa-spinner fa-spin' : 'fa-table-cells'}`}></i>
          {busy === 'create' ? ' Making the sheet...' : ' Make the Google Sheet'}
        </button>
      </>
    );
  }

  return (
    <div className="evt-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="evt-modal rli-modal rli-modal-pick" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
        <div className="evt-modal-head">
          <div>
            <h3><i className="fas fa-table-cells"></i> Live Google Sheet</h3>
            <p>The rooming list, kept up to date by the system</p>
          </div>
          <button type="button" className="evt-modal-close" onClick={onClose} disabled={!!busy} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="evt-modal-body">
          {loading ? (
            <p className="rls-loading"><i className="fas fa-spinner fa-spin"></i> Checking...</p>
          ) : (
            <>
              <div className="rli-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'own'} className={tab === 'own' ? 'on' : ''} onClick={() => { setTab('own'); setError(''); }}>
                  <i className="fas fa-user-pen"></i> My own Google Sheet{own ? ' ✓' : ''}
                </button>
                <button type="button" role="tab" aria-selected={tab === 'made'} className={tab === 'made' ? 'on' : ''} onClick={() => { setTab('made'); setError(''); }}>
                  <i className="fas fa-wand-magic-sparkles"></i> Let the system make one{madeLive ? ' ✓' : ''}
                </button>
              </div>
              {tab === 'own' && state?.ownError && (
                <p className="rli-note warn"><i className="fas fa-triangle-exclamation"></i><span>{state.ownError}</span></p>
              )}
              {tab === 'own' ? ownBody : madeBody}
            </>
          )}
          {error && <p className="rli-error"><i className="fas fa-triangle-exclamation"></i> {error}</p>}
        </div>

        <div className="evt-modal-foot rls-foot">{foot}</div>
      </div>
    </div>
  );
}
