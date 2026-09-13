'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeUid, isPlausibleUid, formatUid } from '@/lib/rfid';

/* ============================================================
   Every reader a desk can have, in one hook.

   Lifted out of the Admin dashboard so the Event Committee desk can have the
   same door. It was one long stretch of the Admin page; a second copy in the
   committee page would have been two readers to fix every time one broke, and
   they would have drifted within a month. The committee screen already shares
   dashboard.css for exactly this reason - this is the same argument about the
   behaviour rather than the paint.

   THREE READERS, ALL LISTENING AT ONCE

     'keyboard'  A USB RFID reader is a KEYBOARD as far as the computer is
                 concerned. It types the card number and presses Enter.
                 Nothing to install, nothing to permit, works in every
                 browser.
     'serial'    The Arduino + RC522 talks over the USB serial port. That
                 needs the Web Serial API: Chrome or Edge, on a desktop, over
                 https or localhost. Never available on a phone.
     'nfc'       The phone's own aerial, through Web NFC. Chrome on Android
                 only - Safari on iPhone has none, whatever the phone.

   There is deliberately no "which reader" setting. A desk can have a USB
   reader plugged in, an Arduino on the serial port and a phone in someone's
   hand, and which one a card is tapped on is not a decision worth making in
   advance - every one of them is listened to at once, and they all arrive at
   onTap as the same card number.

   USAGE

     const reader = useRfidReader({ active: scanDialogOpen, onTap });

   `active` is "does this screen want the reader right now". When it goes
   false the port is closed and the NFC scan called off - a port left open
   stays locked to this tab, and an NFC scan left running keeps firing taps at
   whatever screen replaced this one.

   `onTap(uid, source)` is called once per card. Every reader routes through
   it, so there is no second code path to keep in step.
   ============================================================ */

export default function useRfidReader({ active = false, onTap } = {}) {
  // ---- The serial board ----
  const [serialStatus, setSerialStatus] = useState('idle'); // idle|opening|open|error
  const [baud, setBaud] = useState(9600);
  const [error, setError] = useState('');
  // What the sketch reported about itself at startup.
  const [chip, setChip] = useState(null); // { version, ok }
  const [cardType, setCardType] = useState('');
  // The number off the card that was just held to the aerial, shown the
  // moment it is read rather than after the lookup comes back. A tap that
  // reads fine but belongs to nobody, and a tap that never read at all, look
  // the same on screen otherwise - and only one of them is a reader problem.
  const [liveUid, setLiveUid] = useState('');
  // Everything the reader has said, card lines and all the rest. This is the
  // only way to tell "the reader is silent" apart from "the reader is talking
  // and the dashboard is not listening properly" - and those two have
  // completely different fixes.
  const [raw, setRaw] = useState([]);
  const [showRaw, setShowRaw] = useState(false);
  // The MFRC522 library's own example sketch dumps all sixty-four blocks of a
  // MIFARE 1K after every read. Worth having when the wiring is in doubt and
  // pure noise the rest of the time, so it is kept and hidden.
  const [hideDump, setHideDump] = useState(true);
  // Last time ANY line arrived, heartbeat included. Proves the board is alive.
  const [lastHeard, setLastHeard] = useState(null);
  // Has this browser ever been shown which board to use? Until it has, the
  // chooser is unavoidable and the screen has to ask for one click. After it
  // has, the board connects itself and the screen should never mention it
  // again - so the two states cannot share one wording.
  const [paired, setPaired] = useState(false);

  // ---- The phone as the reader ----
  const [nfcSupported, setNfcSupported] = useState(false);
  const [secureContext, setSecureContext] = useState(true);
  const [nfcStatus, setNfcStatus] = useState('idle'); // idle | starting | scanning | error
  // The phone would not start its scan without a tap. Not an error worth a
  // banner - the next tap anywhere starts it - but the panel has to say so.
  const [nfcNeedsTap, setNfcNeedsTap] = useState(false);
  // Stopped on purpose. The aerial otherwise arms itself from any tap, which
  // would make Stop do nothing at all.
  const [nfcHalted, setNfcHalted] = useState(false);
  // What the phone said when it saw a card it could not read. A card that is
  // the wrong kind and a phone with NFC switched off are the same silence
  // otherwise, and they have nothing to do with each other.
  const [nfcNote, setNfcNote] = useState('');

  // What kind of machine this is, because the answer decides which reader is
  // even possible. Asked once after mount and then treated as fact -
  // 'desktop' until then, which is what the server renders.
  const [deviceKind, setDeviceKind] = useState('desktop'); // desktop | phone
  const [scanMethod, setScanMethod] = useState('usb');
  const methodChosenRef = useRef(false);

  // ---- Refs ----
  // The serial port and its read loop live outside React state: they are not
  // rendered, and putting a stream in state would tear it down on re-render.
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const keepReadingRef = useRef(false);
  // The write side of the same port. The board is not only a reader: once the
  // server has said whose card that was, the answer goes back down the wire so
  // the LCD at the door can show the name. Held separately because the two
  // locks are released independently, and a writer left locked keeps the port
  // open after a disconnect.
  const writerRef = useRef(null);
  const openingRef = useRef(false);
  // The keyboard-wedge buffer, and when its last character arrived.
  const keyRef = useRef({ buf: '', at: 0 });
  // The last card a reader handed over, and when. Our own sketch blocks
  // repeats on the board; the library's example sketch does not, and re-reads
  // a card thirty times a second for as long as it is held there. Without
  // this that is thirty check-ins for one person.
  const lastTapRef = useRef({ uid: '', at: 0 });
  // The tap handler is called from a serial read loop and a key listener,
  // both of which outlive the render that created them. A ref keeps them
  // pointed at the current one instead of the one from first mount.
  const sinkRef = useRef(onTap);
  useEffect(() => { sinkRef.current = onTap; }, [onTap]);

  const nfcAbortRef = useRef(null);
  // Whether a scan is SUPPOSED to be running. Chrome suspends Web NFC when
  // the page stops being the visible, focused tab, and does not always bring
  // it back - so "should it be scanning" has to be remembered separately from
  // "is it scanning", or the reader dies quietly when somebody checks a
  // message and comes back.
  const nfcWantedRef = useRef(false);

  const webSerialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  /* ---- The log ----
     A rolling window of what the reader said. Capped: a heartbeat every five
     seconds is 17k lines a day, and nobody needs yesterday's. */
  const pushRaw = useCallback((line, kind) => {
    setRaw((prev) => {
      const next = [...prev, { at: new Date(), line, kind: kind || 'in' }];
      return next.length > 200 ? next.slice(-200) : next;
    });
    setLastHeard(new Date());
  }, []);

  /* ---- Talking back to the board ----
     The desk knows the one thing the reader never can: whose card that was.
     An Uno has no network of its own, so a name on the LCD at the door can
     only have come from here.

       OK:Juan Dela Cruz     on the list - green light, one beep
       DUP:Juan Dela Cruz    already through the door for this day
       NO:Not on this list   refused - red light

     None of this is required for a tap to work. A desk with no LCD, a board
     running the library's DumpInfo example, a USB keyboard-wedge reader -
     none of them has a writer at all, and every one still checks people in
     exactly as before. This is a display, not a step in the decision. */
  const sendToReader = useCallback(async (prefix, text) => {
    const writer = writerRef.current;
    if (!writer) return;
    // Two kilobytes of RAM and a sixteen character screen. A long church name
    // arriving in full would be read into a buffer that cannot hold it, which
    // on an AVR is not an error - it is silent corruption of whatever sits
    // next to it. Cut it here, where there is room to think about it.
    const line = `${prefix}:${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40)}\n`;
    try {
      await writer.write(new TextEncoder().encode(line));
    } catch {
      // The board was unplugged mid-queue. The tap already counted on the
      // server, so this is cosmetic and must not surface as a failure.
    }
  }, []);

  /* One card, however it arrived, with the repeat guard every reader needs. */
  const deliverTap = useCallback((uid, source) => {
    const prev = lastTapRef.current;
    const held = prev.uid === uid && Date.now() - prev.at < 2500;
    // Held against the aerial: push the window out so the block lasts until
    // the card actually leaves, rather than expiring underneath it.
    lastTapRef.current = { uid, at: Date.now() };
    if (!held) sinkRef.current?.(uid, source);
  }, []);

  /* ============================================================
     Web NFC - the phone's own aerial
     ============================================================ */

  const explainNfcError = (err) => {
    const name = err?.name || '';
    const msg = String(err?.message || err || '');

    if (name === 'NotAllowedError') {
      return 'The phone would not allow the scan. Tap "Allow" when it asks to use NFC — if it never asked, NFC permission for this site was refused before: clear it in the browser\'s site settings and try again.';
    }
    if (name === 'NotSupportedError') {
      return 'This phone has no NFC, or its browser cannot use it. Android Chrome can; Safari on iPhone cannot, whatever the phone.';
    }
    if (name === 'NotReadableError') {
      return 'NFC is switched off. Turn it on in the phone\'s settings — usually Settings, Connected devices, NFC — then start the scan again.';
    }
    if (name === 'SecurityError') {
      return 'The browser blocked NFC because this page is not on https://. Open the deployed site rather than a local address.';
    }
    return msg || 'Could not start the NFC scan';
  };

  const stopNfc = useCallback(() => {
    nfcWantedRef.current = false;
    try { nfcAbortRef.current?.abort(); } catch { /* already gone */ }
    nfcAbortRef.current = null;
    setNfcStatus('idle');
  }, []);

  // opts.quiet - this attempt was made by the page rather than asked for by a
  // person. A browser that wants a tap first has not failed at anything, so
  // nothing is said about it: the panel asks for the tap and the next one
  // starts the scan for real.
  const startNfc = useCallback(async (opts = {}) => {
    const quiet = opts?.quiet === true;
    if (typeof window === 'undefined' || !('NDEFReader' in window)) {
      if (!quiet) {
        setError('This browser cannot read NFC. Use Chrome on Android — Safari on iPhone has no support for it.');
        setNfcStatus('error');
      }
      return;
    }
    // Already scanning. scan() twice on one aerial throws, and the throw
    // would read as a failure to the person watching.
    if (nfcAbortRef.current) return;

    setError('');
    setNfcNote('');
    setNfcStatus('starting');
    setNfcHalted(false);
    nfcWantedRef.current = true;
    try {
      const ndef = new window.NDEFReader();
      const control = new AbortController();
      nfcAbortRef.current = control;

      ndef.onreading = (event) => {
        // The serial number, not the tag's contents. Nothing has to be
        // WRITTEN to a card for this to work - a blank card out of the packet
        // has a UID and that is all this needs.
        const uid = normalizeUid(event.serialNumber);
        if (!isPlausibleUid(uid)) {
          setNfcNote('The phone read a card but it gave no usable number. That card cannot be used here.');
          return;
        }
        pushRaw(`Card UID: ${formatUid(uid)}`, 'uid');
        setLiveUid(uid);
        setNfcNote('');
        deliverTap(uid, 'nfc');
      };

      // A card was there and could not be read. Almost always a MIFARE
      // Classic on a phone whose NFC chip cannot do MIFARE Classic, which is
      // a hardware fact about the phone and not something to keep retrying.
      ndef.onreadingerror = () => {
        pushRaw('The phone saw a card but could not read it', 'err');
        setNfcNote('A card was there but the phone could not read it. Most often this is a MIFARE Classic card on a phone whose NFC chip cannot read them — the same card will still work on the RC522 reader. NTAG cards and NFC stickers work on every phone.');
      };

      await ndef.scan({ signal: control.signal });
      setNfcStatus('scanning');
      setNfcNeedsTap(false);
    } catch (err) {
      nfcAbortRef.current = null;
      nfcWantedRef.current = false;
      // Calling the scan off is not a failure worth reporting.
      if (err?.name === 'AbortError') { setNfcStatus('idle'); return; }
      // The page tried by itself and the browser wanted a person. Left as
      // idle and flagged, so the panel asks for the tap instead of showing a
      // red error about something nobody did wrong.
      if (quiet) {
        setNfcStatus('idle');
        setNfcNeedsTap(err?.name === 'NotAllowedError');
        return;
      }
      setNfcStatus('error');
      setError(explainNfcError(err));
    }
  }, [pushRaw, deliverTap]);

  /* ============================================================
     The Arduino, over the USB serial port
     ============================================================ */

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;
    try {
      if (readerRef.current) {
        await readerRef.current.cancel().catch(() => {});
        try { readerRef.current.releaseLock(); } catch { /* already released */ }
        readerRef.current = null;
      }
      // The writer holds a lock on port.writable, and close() on a port with a
      // locked stream never resolves - the port would stay open with nothing
      // reading it and the next connect would fail as "already open". Only the
      // lock is dropped, not the stream: awaiting writer.close() hangs if the
      // board is not draining, and port.close() below closes it anyway.
      if (writerRef.current) {
        try { writerRef.current.releaseLock(); } catch { /* already released */ }
        writerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close().catch(() => {});
        portRef.current = null;
      }
    } finally {
      openingRef.current = false;
      setSerialStatus('idle');
      setChip(null);
      setLiveUid('');
    }
  }, []);

  const explainSerialError = (err) => {
    const name = err?.name || '';
    const msg = String(err?.message || err || '');
    if (/Failed to open serial port/i.test(msg) || name === 'NetworkError') {
      return 'Could not open the port - another program is holding it. Close the Arduino IDE Serial Monitor (and the Serial Plotter, and any other tab connected to this board), then press Connect again.';
    }
    if (name === 'InvalidStateError') {
      return 'That port is already open in this tab. Press Disconnect, or refresh the page, then try again.';
    }
    if (name === 'SecurityError') {
      return 'The browser blocked the port. This needs to be running on https:// or http://localhost.';
    }
    return msg || 'Could not open the reader';
  };

  // Opening a port that has already been chosen. Split out from the choosing
  // because the two have completely different rules: picking a port needs a
  // click and shows the browser's chooser, opening one the browser already
  // remembers needs neither. Everything after the pick is identical, and the
  // read loop must not exist twice.
  const openPort = useCallback(async (port, { silent = false } = {}) => {
    if (openingRef.current) return false;
    openingRef.current = true;
    setError('');
    setSerialStatus('opening');
    try {
      // A port THIS tab already opened is still open, and open() on an open
      // port throws. That happens on a dev hot-reload, and after a connect
      // that got half way, and Chrome hands back the same port object either
      // time - so the state has to be checked rather than assumed.
      if (port.readable || port.writable) {
        try { await port.close(); } catch { /* not ours to close - open() will say so */ }
      }

      await port.open({ baudRate: Number(baud) || 9600 });
      portRef.current = port;
      keepReadingRef.current = true;
      setSerialStatus('open');

      // The write side, for sending the resolved name back to the LCD. Not
      // every board has anything listening for it, and a port opened only for
      // reading is still perfectly usable - so a failure here is swallowed
      // rather than failing the whole connect.
      try {
        writerRef.current = port.writable ? port.writable.getWriter() : null;
      } catch {
        writerRef.current = null;
      }

      const streamReader = port.readable.getReader();
      readerRef.current = streamReader;
      const decoder = new TextDecoder();
      let buffer = '';

      // Serial arrives in whatever sized chunks the driver feels like, which
      // is not the same as line by line - a UID can and does get split across
      // two reads. So bytes go into a buffer and only whole lines come out.
      (async () => {
        try {
          while (keepReadingRef.current) {
            const { value, done } = await streamReader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let cut;
            while ((cut = buffer.search(/[\r\n]/)) >= 0) {
              const line = buffer.slice(0, cut).trim();
              buffer = buffer.slice(cut + 1);
              if (!line) continue;

              // EVERY line is logged, whatever it is. Only lines the sketch
              // marks as a card are treated as one - but seeing the rest is
              // how you find out the board is fine and the card is the wrong
              // frequency, rather than guessing at both.
              // Two sketches are in circulation on these boards and they say
              // the same thing differently:
              //
              //   ours, hardware/rfid-rc522   UID:C3C8D6E4
              //   MFRC522 library DumpInfo    Card UID: C3 C8 D6 E4
              //
              // DumpInfo is what most boards arrive flashed with, because it
              // is the example everybody uses to prove the wiring works. Both
              // are read here, so a working board does not have to be
              // reflashed before the desk can use it.
              const hit = /^(?:card\s+)?uid\s*[:=]\s*([0-9a-f][0-9a-f\s:.\-]*)$/i.exec(line);
              const version = /^VERSION[:=]\s*(.+)$/i.exec(line);
              // DumpInfo calls it "PICC type: MIFARE 1KB"; ours says "TYPE:".
              const type = /^(?:TYPE|PICC\s+type)\s*[:=]\s*(.+)$/i.exec(line);

              if (version) {
                const v = version[1].trim();
                // 0x00 and 0xFF both mean the chip never answered - a wiring
                // or power fault, and no card will read until it is fixed.
                const dead = /^0x?(00|FF)$/i.test(v.replace(/\s/g, ''));
                setChip({ version: v, ok: !dead });
              }
              if (type) setCardType(type[1].trim());

              // The heartbeat proves the board is alive; logging one line
              // every five seconds would bury everything else.
              if (/^ALIVE$/i.test(line)) { setLastHeard(new Date()); continue; }

              // DumpInfo's sector dump: sixty-four rows of hex per tap, plus
              // its header. Kept, because it is the proof the card is really
              // being talked to, but marked so it can be folded away - the
              // UID line is worthless if it scrolls off the top instantly.
              const isDump = !hit && (
                /^(sector|block)\b/i.test(line)
                || /^\s*\d+\s+\d+\s+[0-9a-f]{2}(\s+[0-9a-f]{2})+/i.test(line)
                || /^\s*[0-9a-f]{2}(\s+[0-9a-f]{2}){3,}/i.test(line)
              );

              pushRaw(
                line,
                hit ? 'uid' : /^ERROR/i.test(line) ? 'err' : isDump ? 'dump' : 'in',
              );

              if (hit) {
                const uid = normalizeUid(hit[1]);
                if (isPlausibleUid(uid)) {
                  // A card read at all proves the chip is answering, which is
                  // the one thing DumpInfo never says out loud.
                  setChip((c) => (c && c.version ? c : { version: '', ok: true }));
                  setLiveUid(uid);
                  deliverTap(uid, 'serial');
                }
              }
            }
            // A reader that never sends a newline would grow this forever.
            if (buffer.length > 256) buffer = buffer.slice(-64);
          }
        } catch (err) {
          if (keepReadingRef.current) {
            // Unplugging the board mid-session lands here.
            setError(`The reader stopped: ${err.message}. Check the USB cable, then press Connect again.`);
            setSerialStatus('error');
            keepReadingRef.current = false;
            portRef.current = null;
          }
        }
      })();
      openingRef.current = false;
      return true;
    } catch (err) {
      // A port that failed to open was never ours; leaving the ref set would
      // make Disconnect try to close somebody else's port.
      portRef.current = null;
      keepReadingRef.current = false;
      // A silent attempt is one nobody asked for - the board is simply not
      // there, or something else has it. Shouting about it would put a red
      // banner on a screen the person opened to do something else entirely.
      if (silent) setSerialStatus('idle');
      else {
        setError(explainSerialError(err));
        setSerialStatus('error');
      }
      openingRef.current = false;
      return false;
    }
  }, [baud, pushRaw, deliverTap]);

  // Picking the board. This is the one step the browser will not let happen
  // on its own: requestPort() must come from a click, and it always shows the
  // chooser. It only has to happen ONCE per board per browser - after that
  // the permission is remembered and autoConnect below opens it with no
  // chooser and no click, which is why this is not on the hot path.
  const connect = useCallback(async () => {
    if (!webSerialSupported) {
      setError('This browser cannot open a USB serial port. Use Chrome or Edge on a computer, or switch to USB Reader mode.');
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      setPaired(true);
      await openPort(port);
    } catch (err) {
      // Closing the port chooser without picking anything is a normal thing
      // to do, not an error worth shouting about.
      if (err?.name === 'NotFoundError') { setSerialStatus('idle'); return; }
      setError(explainSerialError(err));
      setSerialStatus('error');
    }
  }, [webSerialSupported, openPort]);

  // The board, opened by itself.
  //
  // getPorts() returns the ports this origin has ALREADY been granted, and
  // Chrome keeps that grant across reloads and restarts. Opening one of those
  // needs no gesture and shows no chooser - so the permission dialog is a
  // once-per-board event, not a once-per-tap one.
  //
  // More than one port can be remembered (a board plugged into a different
  // socket enumerates as a new one), and a remembered port may be unplugged
  // or held by the Arduino IDE. So they are tried in turn until one opens,
  // newest first - the newest grant is the board most recently chosen.
  const autoConnect = useCallback(async () => {
    if (!webSerialSupported) return false;
    // Already open, or opening: leave it alone. Two open() calls racing on one
    // port is how a port ends up locked with nothing reading it.
    if (portRef.current || openingRef.current) return false;

    let ports = [];
    try {
      ports = await navigator.serial.getPorts();
    } catch { return false; }
    setPaired(ports.length > 0);
    if (!ports.length) return false;

    for (const port of [...ports].reverse()) {
      if (portRef.current) return true;
      // eslint-disable-next-line no-await-in-loop
      if (await openPort(port, { silent: true })) return true;
    }
    return false;
  }, [webSerialSupported, openPort]);

  /* ============================================================
     What this device can actually do, asked once after mount
     ============================================================
       a phone      has an NFC aerial and cannot ever have a serial port, so
                    the phone IS the reader. Web NFC only exists in Chrome on
                    Android, so NDEFReader being there is itself the proof.
       a computer   has no aerial, so the reader is the thing plugged into it:
                    a USB wedge that types, or the Arduino on a serial port.
                    Both listen at once; neither needs choosing between.

     The user-agent check is only a second opinion for the tablet case - a
     touch device with no serial port and no Web NFC is still not a desktop,
     and offering it a USB reader it cannot have is worse than saying so. */
  useEffect(() => {
    const hasNfc = 'NDEFReader' in window;
    const hasSerial = 'serial' in navigator;
    const uaMobile = /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i
      .test(navigator.userAgent || '');
    const kind = (hasNfc || (uaMobile && !hasSerial)) ? 'phone' : 'desktop';

    setNfcSupported(hasNfc);
    setSecureContext(window.isSecureContext !== false);
    setDeviceKind(kind);

    // Chosen once, so a later re-render cannot fight somebody who switched
    // deliberately on a device that genuinely has both.
    if (!methodChosenRef.current) {
      methodChosenRef.current = true;
      setScanMethod(kind === 'phone' ? 'nfc' : 'usb');
    }
  }, []);

  const isPhone = deviceKind === 'phone';
  // Which readers this device could use at all. Only where both are possible
  // is there anything to choose - everywhere else the choice is noise, and a
  // tab offering a reader the machine cannot have is worse than noise.
  const canUseNfc = nfcSupported;
  const canUseUsb = !isPhone;
  const bothMethods = canUseNfc && canUseUsb;
  // What is actually being used, whatever the tabs say: a phone has nothing
  // else, and a computer cannot use its own aerial because it has none.
  const method = bothMethods ? scanMethod : (canUseNfc ? 'nfc' : 'usb');

  /* ---- Serial lifecycle ----
     Let go of the port when the desk is left or the page is closed. A port
     left open stays locked to this tab and the next connect attempt fails. */
  useEffect(() => {
    if (active) { autoConnect(); return; }
    if (portRef.current) disconnect();
  }, [active, autoConnect, disconnect]);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  // Plugged in while the desk is open. Without this the board sits there
  // doing nothing until somebody thinks to press Connect.
  useEffect(() => {
    if (!webSerialSupported || !active) return undefined;

    const onConnect = () => { if (!portRef.current) autoConnect(); };
    // Unplugged. The read loop notices too, but only when a read fails, and
    // that can be a while - this says so at once, and clears the state so the
    // next plug-in is a clean open rather than an InvalidStateError.
    const onDisconnect = (e) => {
      if (portRef.current && (!e.target || e.target === portRef.current)) {
        keepReadingRef.current = false;
        readerRef.current = null;
        portRef.current = null;
        openingRef.current = false;
        setSerialStatus('idle');
        setChip(null);
        setLiveUid('');
      }
    };

    navigator.serial.addEventListener('connect', onConnect);
    navigator.serial.addEventListener('disconnect', onDisconnect);
    return () => {
      navigator.serial.removeEventListener('connect', onConnect);
      navigator.serial.removeEventListener('disconnect', onDisconnect);
    };
  }, [webSerialSupported, active, autoConnect]);

  /* ---- NFC lifecycle ---- */
  useEffect(() => {
    if (!active) { stopNfc(); setNfcHalted(false); }
  }, [active, stopNfc]);

  useEffect(() => () => { stopNfc(); }, [stopNfc]);

  /* ---- Keeping the phone in reader mode ----
     "No supported app for this NFC tag" is Android saying it handled the tag
     itself, which it only does when NO app was in reader mode at that moment.
     For a web page that means the scan was not running - so the whole fix is
     making sure it is, and restarting it when the browser drops it.

     scan() needs a user gesture only for the PERMISSION prompt. Once this
     site has been granted NFC it can be started without one - so a phone that
     has said yes before never has to press Start again. */
  useEffect(() => {
    if (!active || method !== 'nfc' || !nfcSupported || !secureContext) return undefined;
    if (nfcHalted || nfcWantedRef.current || nfcAbortRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const status = await navigator.permissions?.query({ name: 'nfc' });
        // Refused before, permanently: starting it would only throw.
        if (cancelled || status?.state === 'denied') return;
      } catch { /* the browser cannot be asked - try it and see */ }
      if (!cancelled) startNfc({ quiet: true });
    })();
    return () => { cancelled = true; };
  }, [active, method, nfcSupported, secureContext, nfcHalted, startNfc]);

  // The gesture Chrome wants, taken from a tap that was going to happen
  // anyway. Making that touch be "anywhere" rather than a Start button of its
  // own is the whole difference between a reader that works when you pick the
  // phone up and one that needs explaining.
  useEffect(() => {
    if (!active || method !== 'nfc' || !nfcSupported || !secureContext) return undefined;
    if (nfcHalted || nfcStatus === 'scanning' || nfcStatus === 'starting') return undefined;
    const arm = () => {
      if (nfcAbortRef.current) return;
      startNfc();
    };
    document.addEventListener('pointerdown', arm, { once: true });
    return () => document.removeEventListener('pointerdown', arm);
  }, [active, method, nfcSupported, secureContext, nfcStatus, nfcHalted, startNfc]);

  // Chrome suspends Web NFC while the page is not the visible, focused tab,
  // and coming back does not reliably resume it. Without this, checking a
  // message mid-queue leaves a reader that looks connected and reads nothing.
  useEffect(() => {
    if (!nfcSupported) return undefined;
    const rearm = () => {
      if (document.visibilityState !== 'visible') return;
      if (!nfcWantedRef.current) return;
      // The abort controller survives a suspend, so it cannot be trusted as
      // proof the scan is live. Tear it down and start cleanly.
      try { nfcAbortRef.current?.abort(); } catch { /* already gone */ }
      nfcAbortRef.current = null;
      startNfc({ quiet: true });
    };
    document.addEventListener('visibilitychange', rearm);
    window.addEventListener('focus', rearm);
    return () => {
      document.removeEventListener('visibilitychange', rearm);
      window.removeEventListener('focus', rearm);
    };
  }, [nfcSupported, startNfc]);

  /* ---- A USB reader pretending to be a keyboard ----
     It types the number and presses Enter, far faster than hands can. The gap
     between keystrokes is what tells the two apart: under 120ms is machinery,
     above it is a person, and a person's keystrokes must not be collected
     into a card number.

     Always, while the desk is open - not only when a "USB reader" mode is
     selected. A wedge reader is a keyboard: listening for it costs nothing
     when there is none, and not listening for it is indistinguishable from a
     broken one. */
  useEffect(() => {
    if (!active) return undefined;

    const onKeyDown = (e) => {
      // Anything typed INTO a field belongs to that field. The scan box has
      // its own handler; this listener is for taps that land on the page with
      // nothing focused.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

      const now = Date.now();
      const state = keyRef.current;
      if (now - state.at > 120) state.buf = '';
      state.at = now;

      if (e.key === 'Enter') {
        const captured = state.buf;
        state.buf = '';
        if (isPlausibleUid(captured)) {
          e.preventDefault();
          sinkRef.current?.(captured, 'keyboard');
        }
        return;
      }
      if (e.key.length === 1) state.buf += e.key;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  /* What to tell somebody standing at the pad. Every reader that is actually
     live gets a mention, because with all of them listening at once "hold it
     on the reader" is ambiguous - and when none is live, saying so is the
     only useful thing on the screen.

     `boxFocused` is whether the dialog's own capture box has the caret, which
     is the whole of "is the USB wedge going to work" - so the caller passes
     it in rather than the hook guessing. */
  const readyHint = (boxFocused) => {
    const live = [];
    if (serialStatus === 'open') live.push('the RC522 aerial');
    if (nfcStatus === 'scanning') live.push('the back of the phone');
    if (boxFocused) live.push('the USB reader');
    if (live.length === 0) {
      return isPhone
        ? 'Start the phone scan above first.'
        : 'No reader is listening yet. Click the box below for a USB reader, or connect the Arduino above.';
    }
    if (live.length === 1) return `Hold the card on ${live[0]}.`;
    return `Hold the card on ${live.slice(0, -1).join(', ')} or ${live[live.length - 1]}.`;
  };

  return {
    // serial
    serialStatus, baud, setBaud, paired, webSerialSupported,
    connect, disconnect, autoConnect,
    // the board's own report
    chip, cardType, liveUid, setLiveUid,
    // the log
    raw, setRaw, showRaw, setShowRaw, hideDump, setHideDump, lastHeard, pushRaw,
    // nfc
    nfcSupported, secureContext, nfcStatus, nfcNeedsTap, nfcHalted, setNfcHalted,
    nfcNote, startNfc, stopNfc,
    // which reader
    deviceKind, isPhone, canUseNfc, canUseUsb, bothMethods, method,
    scanMethod, setScanMethod,
    // everything else
    error, setError, sendToReader, readyHint, deliverTap,
  };
}
