# RFID card reader — setting it up

The dashboard reads cards three different ways. Pick whichever you have; all
three end up in the same place (**Sidebar → People & Roles → RFID Reader**, for
Super Admin and Admin), and all three produce the *same* card number — a card
registered on the Arduino is recognised by the phone, and the other way round.

---

## Before anything else: run the migrations

Open the Supabase SQL editor and run these two, in this order:

    web/supabase/migrations/rfid_cards.sql
    web/supabase/migrations/rfid_event_checkin.sql

Both are safe to run more than once. Nothing below will work until they have
been run — the page will load and the reader will read, but every tap will
fail to save.

---

## Option A — a USB RFID reader (nothing to install)

The common USB readers are **keyboards** as far as the computer is concerned.
They type the card number and press Enter. There is no driver, no permission
prompt and no browser restriction — it works on any computer and in any
browser.

1. Plug the reader in.
2. Open **RFID Reader** and leave the mode on **USB Reader**.
3. Click the box that says *Waiting for a card…* so it has the caret.
4. Tap a card.

The one thing to know: the reader types into whatever is focused, exactly like
a keyboard. If the caret is in some other field, the card number goes there
instead. That is why the scan box is visible and why the page puts the caret
back into it after every tap.

---

## Option B — Arduino Uno + RC522 (the wiring in the diagram)

### Wire it

| RC522 | Arduino Uno |
|-------|-------------|
| SDA (SS) | pin 10 |
| SCK | pin 13 |
| MOSI | pin 11 |
| MISO | pin 12 |
| IRQ | *not connected* |
| GND | GND |
| RST | pin 9 |
| 3.3V | **3.3V** |

**3.3V, not 5V.** The RC522 is a 3.3V part and 5V on that pin destroys it.
This is the single most common way these modules die.

### Flash it

1. Arduino IDE → **Sketch → Include Library → Manage Libraries**, search
   `MFRC522`, install the one by *GithubCommunity*.
2. Open `rfid-rc522/rfid-rc522.ino`, select **Arduino Uno** and your port,
   upload.
3. **Tools → Serial Monitor**, set to **9600 baud**. You should see:

       READY:RC522
       VERSION:0x92

   Tap a card and a line appears:

       UID:A1B2C3D4

   If `VERSION` reads `0x00` the module is not talking — check the 3.3V line
   and the SDA wire first, they account for nearly all of it.
4. **Close the Serial Monitor.** Only one program can hold the port, and while
   the monitor has it the browser cannot.

### Connect it to the dashboard

1. Open **RFID Reader**, switch to **Arduino + RC522**.
2. **Connect Reader**, pick the Arduino from the list the browser shows.
3. Tap a card.

**This mode needs Chrome or Edge on a computer**, served over `https://` or
`http://localhost`. The Web Serial API does not exist in Safari or Firefox, and
not on phones. The page says so rather than failing quietly — if you are on one
of those, use Option A. In production this means the site must be on HTTPS;
Vercel and most hosts do that already.

---

## Option C — an Android phone, with no reader at all

A phone with NFC already contains the reader. The card's number is read by the
phone itself, so there is nothing to plug in and nothing to carry to the door
but the phone.

1. Open the dashboard **on the phone**, on the deployed `https://` address.
2. Open **RFID Reader**. On a phone it starts on **Phone NFC** already.
3. Tap **Start scanning**, and tap **Allow** when the phone asks about NFC.
4. Hold a card flat against the **top back** of the phone.

### What it will and will not do

This is not a limitation of the dashboard — it is what phones and browsers can
do — so it is worth knowing before ordering anything:

| | |
|---|---|
| **Android + Chrome** | Works. Also Edge and other Chrome-based browsers. |
| **iPhone** | Does **not** work, on any iPhone or iOS version. Safari has no Web NFC and Chrome on iOS is Safari underneath. Reading a card on an iPhone needs a native app, which this is not. |
| **`http://` addresses** | Refused. NFC needs a secure page, so the dev server over the LAN will not do — use the deployed `https://` site. |
| **MIFARE Classic cards** | Depends on the phone, not on this code. Phones with an NXP NFC chip read them; Broadcom and some Qualcomm ones never could. Those cards still work on the Arduino reader. |
| **NTAG / NFC stickers** | Work on every NFC phone. If phone reading matters, buy these. |

### "No supported app for this NFC tag"

This is the message everybody hits first, and it is **not** a fault in the card
or the phone. It is Android saying it handled the tag itself, which it only
does when no app was in reader mode at that moment. For a web page that means
**the scan was not running**.

- Tap **Start scanning**, then **Allow** when the phone asks about NFC.
- Keep the tab in front. Android suspends the scan when you switch apps or
  lock the screen; the page restarts it when you come back, but a card tapped
  while you were away goes to Android instead.
- Once this site has been allowed once, the scan starts on its own every time
  the reader screen is opened — the Start button is only needed for the very
  first permission.

If the phone reads nothing at all: the aerial is a small patch near the top
back on most phones, not the middle, and a thick case blocks it. Slide the card
about slowly with the case off before concluding anything.

Nothing is ever written to the card. Only its serial number is read, so a blank
card straight out of the packet works.

---

## Using it

**Registering a card.** Tap an unregistered card. The page asks who it belongs
to; search, pick the person, optionally label it (*"blue fob"*), register. A
member can hold more than one card.

**At the door.** Turn on **Mark present on tap**. Each tap marks that member
present for today. Tapping twice does not create two records — the second tap
reports what the first one did.

Leave that switch **off** while registering cards, or you will mark the whole
queue present while handing out their cards.

**Lost cards** are marked lost rather than deleted, so the record of who held
what survives. A card marked lost is refused on tap and can be reactivated.

**Every tap is logged**, including cards belonging to nobody — those are the
ones worth seeing, because they are a person standing at the door waiting.

---

## The Arduino IDE will not upload the sketch

**If the dashboard has the port open, the Arduino IDE cannot upload.** Only one
program can hold a serial port, and the browser counts. The IDE reports it as
something like `avrdude: ser_open(): can't open device "COM4"` or
`programmer is not responding`, neither of which mentions the browser.

Press **Disconnect** in the reader status strip (it is in the Assign RFID and
Scan RFID dialogs, and on the RFID Reader page), or just close the tab, then
upload.

It works the other way round too: while the IDE's **Serial Monitor** is open,
the dashboard cannot connect. Whichever one you want to use, the other has to
let go first.

Other upload failures:

- **Wrong board or port** — Tools → Board → *Arduino Uno*, Tools → Port → the
  one that disappears when you unplug the board.
- **A clone with no driver** — many cheap Unos use a CH340 USB chip. If no port
  appears at all when the board is plugged in, install the CH340 driver.
- **Nothing at all happens** — try a different USB cable. A surprising number
  are charge-only and carry no data.

---

## The card will not read — start here

**The most likely answer is that the card is the wrong frequency, and no
amount of holding it closer will ever fix it.**

The RC522 is a **13.56 MHz** reader. It reads MIFARE cards and NFC tags. The
thin white cards and round blue fobs sold in most shops here are **125 kHz**
(EM4100 / TK4100) — a different technology at a different frequency. An RC522
cannot read one, the way an FM radio cannot tune an AM station.

How to tell which you have:

- **Hold it to a phone with NFC turned on.** If the phone reacts, it is
  13.56 MHz and the RC522 can read it. If nothing happens, it is 125 kHz.
- 13.56 MHz cards are sold as *MIFARE Classic*, *MIFARE 1K*, *NTAG213*, *NFC*.
  125 kHz ones are sold as *EM4100*, *TK4100*, *proximity card*, or just
  *RFID card*.
- **The white card and blue fob that came in the RC522 kit are the right
  kind.** Try those first. If the kit card reads and yours does not, yours is
  125 kHz — you need different cards, not different code.

If a 125 kHz card is what you have and you want to keep using it, buy a
**125 kHz USB reader** instead of the RC522 and use *USB Reader* mode. Those
plug in as keyboards and need no wiring at all.

### Checking the reader is connected at all

Every place you can tap a card shows a **reader status strip** with both kinds
of reader on it:

- **USB reader — Ready / Click the box below.** These type into whatever has
  the caret, so "ready" means the scan box has it. If it says *Click the box
  below*, the number will land somewhere else.
- **Arduino — Connected / Not connected / Failed.** With a **Connect** button
  right there; no need to go to another page. Once connected it stays
  connected while you move between the event screens.
- **RC522 — Responding (0x92) / No reply (0x00).** Only appears once the
  Arduino is connected, and it is the one that matters most: a board whose
  port opened fine but whose RC522 never answered looks connected and reads
  nothing.

### If even the kit card will not read

Connect the reader in the dashboard and look at the **diagnostics strip** on
the RFID Reader page. It reports what the RC522 said about itself:

- **"RC522 responding (0x92)"** — the board is fine. The problem is the card.
- **"RC522 not responding (0x00)"** — the chip never answered the Arduino.
  This is wiring or power, not the card. Check **3.3V (never 5V)** first, then
  **SDA → pin 10**, then **RST → pin 9**. Nothing will read until this line
  changes.
- **"Waiting for the board…"** — nothing has arrived at all. Wrong baud rate,
  or the sketch is not running. Press the Arduino's reset button.

Press **Show reader output** to see every line the board sends, exactly as it
sends it. That is the difference between "the reader is silent" and "the
reader is talking and something else is wrong", which need opposite fixes.

The sketch also turns the aerial gain up to maximum, which typically takes the
read distance from about 10mm to about 30mm. If reads are intermittent and get
worse the longer it runs, the Uno's 3.3V regulator is struggling — power the
RC522 from a separate 3.3V supply with the grounds tied together.

---

## Checking people in at an event

There are two doors onto the same thing. Use whichever suits where you already
are — they read and write the same records, so cards handed out in one show up
immediately in the other.

### From the event itself (usually what you want)

**Events → open an event → Manage.**

**Registrations tab.** Every attendee row has a **Manage** menu; verified rows
carry **Assign RFID** in it. Press it, tap a card, done — that number is now
that attendee's for this event, and everything on their registration (name,
church, contact, payment, group) is reached through it. The menu then shows
the number, with **Replace RFID** and **Remove RFID** beneath it.

Unverified rows do not offer it. A card gets somebody through a door, so
handing one out before the payment is confirmed would give away exactly the
access the verification step exists to withhold. Verify them first — that item
is directly above in the same menu — and the option appears.

**Attendance tab.** There is an **RFID** column showing each attendee's number
(with an *Assign* button where there is none), and a **Scan RFID to Check In**
button beside the QR one. The scanner stays open between taps, because a door
has a queue: tap, the attendee's **name appears in large type** with their
church underneath, they are checked in, press *Next attendee* and tap the next
one. It sets the same `attended` flag the QR scanner sets, so the two can be
mixed freely on the same door.

### From the RFID Reader page

Switch the purpose at the top of the page from **Members** to **Event
check-in**, then choose the event.

Only **verified** registrations appear on the list — `registered` for a free
event, `payment_verified` for a paid one. That is deliberate: a card gets
somebody through the door, so handing one to an unverified registration would
give away exactly the access the verification step exists to withhold. Verify
them under Events first and they appear here.

This page is the better one when you are working through a stack of cards
away from a particular event, or want the reader diagnostics on screen.

**Handing out cards.** Press *Give card* next to a name; the pad turns amber
and the next card tapped becomes theirs for that event. Cards are reusable
across events — hand them out at the door, take them back at the end, use the
same box next month.

**At the door.** Tap. The system checks them in and sets the same `attended`
flag the QR scanner sets, so the two can be mixed freely. Tapping twice says
"already checked in" rather than overwriting the time they actually arrived.

A tap resolves in two steps: first a card handed out for this event, then the
member's own permanent card if they have one. So a member who registered with
their account can tap the card they already carry, and a walk-in guest with no
account can be handed one at the door — both end up at a registration.

What you may see instead of a check-in:

- **"… has no verified registration for this event"** — the card and the
  person are both known; they are simply not on this event's list.
- **"… is not verified yet"** — they are on the list but the payment has not
  been confirmed.
- **"not linked to anyone at this event yet"** — an unknown card. Use
  *Give card* to hand it to someone.

---

## Other problems

- **"Failed to execute 'open' on 'SerialPort': Failed to open serial port"**
  The port chooser worked, so permissions are fine — something else is holding
  the port, and a serial port can only be held by one program at a time. In
  order of likelihood: the **Arduino IDE Serial Monitor is still open** (close
  it), another browser tab is connected to the board, or a dev hot-reload left
  it open in this tab (refresh with F5). This is *not* a deployment problem —
  `http://localhost` is a secure context and Web Serial works there.
- **Nothing happens at all.** In USB Reader mode, is the caret in the scan box?
  In Arduino mode, is the Serial Monitor still open holding the port?
- **The number is different every time.** Almost always a wiring fault on the
  Arduino — reseat SDA and SCK.
- **Registered on one reader, not recognised on another.** Should not happen:
  the same card reads back differently on different readers and the system
  converts between the formats (`web/src/lib/rfid.js`). If it does happen, the
  card row keeps the raw string its reader sent in `raw_uid` — compare that
  with the `uid` column and the mismatch will be visible.
- **"Already registered to …"** — the card is on file under someone else.
  Remove it from them first.
