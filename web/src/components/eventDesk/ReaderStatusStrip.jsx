'use client';

/* ============================================================
   The reader strip at the top of every desk dialog.

   Which reader is decided by the machine, not by the person standing at the
   door: a computer gets the USB wedge and the Arduino, a phone gets its own
   aerial and arms it by itself. The tabs only appear where a device genuinely
   has both - everywhere else there is nothing to choose, and a switch offering
   a reader the machine cannot have is how a queue stops.

   Takes the whole useRfidReader return as `reader`, and `boxFocused` - whether
   the dialog's own capture box has the caret, which is the entire question of
   "is the USB wedge going to work" and the one thing this component cannot
   know for itself.
   ============================================================ */

export default function ReaderStatusStrip({ reader, boxFocused = false }) {
  const {
    bothMethods, method, setScanMethod,
    nfcSupported, secureContext, nfcStatus, nfcNeedsTap, setNfcHalted,
    startNfc, stopNfc,
    serialStatus, paired, webSerialSupported, connect, disconnect, chip,
  } = reader;

  return (
    <div className="rfid-method">
      <div className="rfid-method-head">
        <span className="rfid-method-label">Scan method</span>
        {bothMethods ? (
          <div className="rfid-method-tabs">
            <button
              type="button"
              className={`rfid-method-tab ${method === 'usb' ? 'on' : ''}`}
              onClick={() => setScanMethod('usb')}
            >
              <i className="fas fa-keyboard"></i> USB RFID Reader
            </button>
            <button
              type="button"
              className={`rfid-method-tab ${method === 'nfc' ? 'on' : ''}`}
              onClick={() => setScanMethod('nfc')}
              title={'Read cards with this phone’s own aerial'}
            >
              <i className="fas fa-mobile-screen-button"></i> Phone NFC
            </button>
          </div>
        ) : (
          /* One reader, named rather than offered: this device has no other.
             A phone cannot have a serial port, and a computer has no aerial. */
          <span className={`rfid-method-only ${method}`}>
            {method === 'nfc' ? (
              <><i className="fas fa-mobile-screen-button"></i> Phone NFC <em>automatic</em></>
            ) : (
              <><i className="fas fa-keyboard"></i> USB RFID or Arduino <em>this computer</em></>
            )}
          </span>
        )}
      </div>

      {method === 'nfc' ? (
        /* ---- The phone's own aerial ----
           Nothing to connect and nothing to press: the scan is started for the
           person the moment a desk opens. The one thing this panel still has
           to be honest about is the state it is in, because a phone that is
           not in reader mode looks identical to one that is - Android quietly
           answers the card itself and nothing reaches this page. */
        <div className={`rfid-method-panel nfc ${nfcStatus === 'scanning' ? 'live' : ''}`}>
          <i className={`fas ${nfcStatus === 'scanning' ? 'fa-wifi' : 'fa-mobile-screen-button'} rfid-method-icon`}></i>
          <b>
            {!nfcSupported ? 'Phone NFC not available here'
              : !secureContext ? 'Phone NFC needs https://'
                : nfcStatus === 'scanning' ? 'Phone NFC on — hold the card'
                  : nfcStatus === 'starting' ? 'Turning NFC on…'
                    : nfcStatus === 'error' ? 'NFC could not start'
                      : nfcNeedsTap ? 'Tap the screen once to arm NFC'
                        : 'Waiting for NFC…'}
          </b>
          <p>
            {!nfcSupported
              ? 'This needs Chrome on an Android phone with NFC. Safari on iPhone cannot read cards from a web page at all.'
              : !secureContext
                ? 'Open the deployed https:// site on the phone — NFC is refused on a plain http address.'
                : nfcStatus === 'scanning'
                  ? 'Hold the attendee’s card flat against the back of the phone, near the top.'
                  : nfcStatus === 'error'
                    ? 'Switch NFC on in the phone’s settings, then tap the screen once.'
                    : nfcNeedsTap
                      ? 'The phone wants one tap before it will let a web page read cards. Tap anywhere — it only ever asks once.'
                      : 'Starting by itself. Keep NFC switched on and this tab in front.'}
          </p>
          {/* Only where it is genuinely needed. Stopping is worth offering
              while it reads; starting is worth offering only when the
              automatic attempt could not - and never as the normal way in. */}
          {nfcStatus === 'scanning' ? (
            <button
              type="button"
              className="btn-secondary rfid-method-go"
              onClick={() => { setNfcHalted(true); stopNfc(); }}
            >
              <i className="fas fa-stop"></i> Stop NFC Scan
            </button>
          ) : (nfcNeedsTap || nfcStatus === 'error') && nfcSupported && secureContext ? (
            <button
              type="button"
              className="btn-primary rfid-method-go"
              onClick={() => startNfc()}
              disabled={nfcStatus === 'starting'}
            >
              <i className="fas fa-wifi"></i> Turn NFC on
            </button>
          ) : null}
        </div>
      ) : (
        /* ---- The readers plugged into a computer ----
           Both listed, both live: a wedge reader types wherever the caret is
           and the Arduino arrives on the serial port, and neither needs
           choosing between. */
        <div className="rfid-method-panel usb">
          <div className="rfid-status-strip">
            {/* A wedge reader is a keyboard, and the desk listens for one on
                the window itself - so it is armed with nothing focused, which
                is the normal state of a counter dialog. The only thing that
                takes the card away from it is a caret sitting in a text box,
                and that is what the second wording is about. */}
            <span className="rfid-stat ok" title="A USB reader types the card number. It lands here on its own unless the caret is inside a text box.">
              <i className="fas fa-keyboard"></i>
              <span className="rfid-stat-label">USB reader</span>
              <b>{boxFocused ? 'Ready' : 'Listening'}</b>
            </span>

            <span
              className={`rfid-stat ${
                serialStatus === 'open' ? 'ok'
                  : serialStatus === 'opening' ? 'warn'
                    : serialStatus === 'error' ? 'bad' : 'off'}`}
              title="Arduino + RC522, read over the USB cable. It connects by itself once this browser has been shown the board once."
            >
              <i className="fas fa-microchip"></i>
              <span className="rfid-stat-label">Arduino</span>
              <b>
                {serialStatus === 'open' ? 'Connected'
                  : serialStatus === 'opening' ? 'Opening…'
                    : serialStatus === 'error' ? 'Failed'
                      : !webSerialSupported ? 'No support'
                        : paired ? 'Unplugged'
                          : 'Not set up'}
              </b>
              {/* Only shown when it is actually needed: a board this browser
                  has already been shown connects itself, and a button
                  offering to do what just happened by itself is noise. */}
              {webSerialSupported && serialStatus !== 'open' && serialStatus !== 'opening' && (
                <button type="button" className="rfid-stat-btn" onClick={connect}>
                  {paired ? 'Connect' : 'Allow'}
                </button>
              )}
              {serialStatus === 'open' && (
                <button
                  type="button"
                  className="rfid-stat-btn ghost icon-only"
                  onClick={disconnect}
                  title="Disconnect the board"
                  aria-label="Disconnect the board"
                >
                  <i className="fas fa-xmark"></i>
                </button>
              )}
            </span>

            {/* The chip's own answer, once it has given one. A board that
                opened its port but whose RC522 never replied looks
                "connected" and reads nothing, which is the most confusing
                state of all. */}
            {serialStatus === 'open' && chip && (
              <span
                className={`rfid-stat ${chip.ok ? 'ok' : 'bad'}`}
                title={chip.ok
                  ? `The RC522 chip is answering the board${chip.version ? ` (${chip.version})` : ''}.`
                  : `The RC522 chip is not answering the board (${chip.version}). This is wiring or power, not the card.`}
              >
                <i className="fas fa-wave-square"></i>
                <span className="rfid-stat-label">RC522</span>
                <b>
                  {chip.ok ? 'Responding' : 'No reply'}
                  {/* The version is the detail, not the state. First to go
                      when the row has to fit a phone. */}
                  {chip.version && (
                    <span className="rfid-stat-extra">{` (${chip.version})`}</span>
                  )}
                </b>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
