/* ============================================================
   Joyful Sound Church - RFID card reader
   Arduino Uno + RC522, read by the dashboard over USB.

   WIRING - exactly the diagram this was written for:

       RC522        Arduino Uno
       ---------    -----------
       SDA / SS  -> pin 10
       SCK       -> pin 13
       MOSI      -> pin 11
       MISO      -> pin 12
       IRQ       -> not connected
       GND       -> GND
       RST       -> pin 9
       3.3V      -> 3.3V     <-- 3.3V. NOT 5V. 5V kills the module.

   OPTIONAL - the door display. Leave it off and everything below still works
   exactly as it did; the dashboard screen is then the only display.

       16x2 I2C LCD   Arduino Uno
       ------------   -----------
       VCC         -> 5V
       GND         -> GND
       SDA         -> A4        <-- the LCD's pins, not the RC522's
       SCL         -> A5

       Buzzer      -> pin 3     (other leg to GND)
       Green LED   -> pin 4     (through a 220 ohm resistor to GND)
       Red LED     -> pin 5     (through a 220 ohm resistor to GND)

   The RC522's own pin marked "SDA" is NOT an I2C pin - on that module it is
   the SPI chip select, which is why it goes to pin 10 and not to A4. A4 and
   A5 are the only I2C pins the Uno has, and the LCD needs both of them.

   LIBRARIES
       Arduino IDE -> Sketch -> Include Library -> Manage Libraries
         "MFRC522"           by GithubCommunity      (always)
         "LiquidCrystal I2C" by Frank de Brabander   (only with a display)

   ------------------------------------------------------------
   WHERE THE NAME ON THE SCREEN COMES FROM
   ------------------------------------------------------------
   Not from here. This board has no network and no attendee list - it cannot
   have one. Who holds a card is a question about the database, and the
   database is behind the website.

   So a tap is a conversation, not a lookup:

       board  ->  UID:A1B2C3D4          this is the number I just read
       desk   ->  OK:Juan Dela Cruz     I asked the server; that is who it is

   The browser at the desk is what turns one into the other. It reads the UID
   line over USB, calls /api/rfid/event-checkin, and sends the answer back
   down the same cable. See src/app/dashboard/page.js - sendToReader().

   WHAT COMES BACK
       OK:<name>     on the list, now checked in   green LED, one beep
       DUP:<name>    already through the door      green LED, two beeps
       NO:<reason>   refused or unknown card       red LED, three beeps
       INFO:<text>   taken, but not a check-in     no LED, one short beep

   INFO is what comes back while a dialog on the dashboard is registering a
   card rather than checking anybody in. Nothing has been decided about that
   card yet, so nothing is lit - but the board is told, because it has been
   showing "Checking..." since the tap and cannot clear that on its own.

   If nothing comes back within a few seconds the screen says so. That is the
   honest answer: the card was read fine and the desk did not reply, which is
   a different problem from a card that will not read, and telling those two
   apart at the door is the whole point of saying it.

   A tap is never decided here. The green light means the server said yes -
   this sketch has no opinion about who is registered, which is what keeps the
   board and the database from ever disagreeing.
   ------------------------------------------------------------

   ------------------------------------------------------------
   IF A CARD WILL NOT READ, READ THIS FIRST
   ------------------------------------------------------------
   The RC522 is a 13.56 MHz reader. It reads MIFARE cards and NFC tags and
   nothing else.

   The thin white cards and round blue fobs sold in most shops here are
   125 kHz (EM4100 / TK4100). They are a different technology at a different
   frequency, and an RC522 will NEVER read one, no matter how close you hold
   it. There is nothing to fix in software - it is like trying to tune an FM
   radio to an AM station.

   How to tell them apart:
     - Hold the card to a phone with NFC turned on. If the phone reacts, it is
       13.56 MHz and the RC522 can read it.
     - 13.56 MHz cards are usually sold as "MIFARE Classic", "MIFARE 1K",
       "NTAG213" or "NFC". 125 kHz ones are sold as "EM4100", "TK4100",
       "proximity card" or just "RFID card".
     - The blue keyfob and white card that came in the RC522 kit ARE the right
       kind. Try those first - if the kit card reads and yours does not, yours
       is 125 kHz.

   If even the kit card will not read, it is the wiring or the power. The
   VERSION line this sketch prints at startup will say which - see below.

   The other real cause is power: the RC522 wants more current than the Uno's
   3.3V regulator likes to give when the aerial is transmitting. If reads are
   intermittent and get worse the longer it runs, power the module from a
   separate 3.3V supply with the grounds tied together. Adding the LCD makes
   this more likely, not less - it draws from the same regulator.
   ------------------------------------------------------------

   WHAT IT PRINTS
       At startup, once:

           READY:RC522
           VERSION:0x92          the chip talking back. See the table below.
           GAIN:MAX

       Then one block per card:

           TYPE:MIFARE 1KB
           UID:A1B2C3D4

       And a heartbeat every 5 seconds when nothing is happening:

           ALIVE

       The UID line carries the UID and NOTHING else - no card type, no
       spacing, no trailing note. The dashboard reads everything after "UID:"
       as the card number, so anything else on that line becomes part of it.
       Card type goes on its own line above. Print whatever you like while
       debugging as long as it does not start with "UID:".

       Nothing about the display is ever printed. What the LCD shows is the
       desk's own answer being read back to it, which would be noise in the
       reader output panel.

   YOU DO NOT HAVE TO FLASH THIS SKETCH FIRST
       The dashboard also reads the MFRC522 library's own DumpInfo example -
       the one everybody uses to prove the wiring works - which prints

           Card UID: C3 C8 D6 E4
           Card SAK: 08
           PICC type: MIFARE 1KB
           <then all sixty-four blocks of the card>

       "Card UID:" is read exactly as "UID:" is, spacing and all, so a board
       already running DumpInfo works at the desk as it stands. The sector
       dump is folded away in the reader output panel.

       This sketch is still the better one to run for a desk reader: it blocks
       repeat reads on the board, reports the chip version so a wiring fault
       names itself, drives the door display, and does not spend a second
       dumping sectors nobody reads. (The dashboard also ignores a card
       repeated within 2.5 seconds, so DumpInfo will not check one person in
       thirty times either.)

   WHAT THE VERSION MEANS
       0x91 / 0x92    a genuine RC522. Good.
       0x88 / 0x12    a clone. Usually works.
       0x00 / 0xFF    the chip is NOT talking. This is a wiring or power
                      fault, not a card fault. Check 3.3V first, then SDA
                      (pin 10), then RST (pin 9). Nothing will read until
                      this line shows something else.

   BAUD RATE
       9600. The dashboard defaults to it. If you change it here, change it
       in the dashboard's Baud box too.
   ============================================================ */

#include <SPI.h>
#include <MFRC522.h>

/* ---- the optional display ----------------------------------------------
   Set HAS_LCD to 0 for a board with no screen on it. Everything else - the
   reading, the UID line, the desk - is unchanged either way; only the local
   display is compiled out. The LEDs and buzzer are driven regardless, since
   they cost two pins and are useful without a screen. */
#define HAS_LCD  1

/* 1 for a buzzer that sounds on its own when given 5V (an active one - most
   kits have these). 0 for a passive one, which only clicks unless it is given
   a tone to play. If it clicks instead of beeping, change this. */
#define ACTIVE_BUZZER 1

#if HAS_LCD
  #include <Wire.h>
  #include <LiquidCrystal_I2C.h>
  /* 0x27 on nearly all of these backpacks; a few are 0x3F. If the backlight
     comes on but the screen stays blank, try the other one. */
  #define LCD_ADDR 0x27
  LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
#endif

#define SS_PIN      10   // SDA on the RC522
#define RST_PIN      9
#define BUZZER_PIN   3
#define LED_OK_PIN   4   // green - the desk said yes
#define LED_NO_PIN   5   // red   - the desk said no

MFRC522 reader(SS_PIN, RST_PIN);

/* Holding a card against the aerial reads it many times a second. Without a
   guard the desk would get thirty taps from one person, so the same card is
   ignored until either it has been away for a moment or a different card is
   presented. */
const unsigned long REPEAT_BLOCK_MS = 2500;
String   lastUid       = "";
unsigned long lastUidAt = 0;

/* A line every few seconds when nothing is being tapped, so the dashboard can
   tell "the board is fine, nobody has tapped anything" apart from "the board
   stopped talking". Without it a dead sketch and an idle one look identical. */
const unsigned long HEARTBEAT_MS = 5000;
unsigned long lastBeatAt = 0;

/* How long to wait for the desk to say who the card was. Long enough for a
   database lookup on a tired laptop over patchy wifi; short enough that the
   queue does not decide the reader has died. */
const unsigned long REPLY_TIMEOUT_MS = 4000;

/* How long a name stays on the screen before it goes back to waiting. */
const unsigned long RESULT_HOLD_MS = 2500;

byte chipVersion = 0;
unsigned int checkedIn = 0;

/* One line at a time from the desk. 48 bytes because the browser cuts the
   text at 40 and the prefix is never more than four - on a chip with 2K of
   RAM the size of every buffer is a decision, not a default. */
char inBuf[48];
byte inLen = 0;

/* ============================================================
   The display
   ============================================================ */

/* Writing a padded 16 characters rather than clearing first. lcd.clear() is a
   slow command, and blanking a row before redrawing it is what makes these
   screens flicker; overwriting the old text with the new one plus spaces
   leaves nothing to flicker. */
void printRow(byte row, const char *text) {
#if HAS_LCD
  lcd.setCursor(0, row);
  byte i = 0;
  for (; i < 16 && text[i]; i++) lcd.write(text[i]);
  for (; i < 16; i++) lcd.write(' ');
#else
  (void)row; (void)text;
#endif
}

/* A name too long for the screen, slid across it. "Maria Concepcion Dela
   Cruz" is not an unusual name here, and cutting it to "Maria Concepcio" at a
   door is worse than making the person wait a second to read it. */
void printRowHeld(byte row, const char *text, unsigned long holdMs) {
#if HAS_LCD
  byte len = strlen(text);
  if (len <= 16) {
    printRow(row, text);
    delay(holdMs);
    return;
  }
  char window[17];
  for (byte start = 0; start + 16 <= len; start++) {
    memcpy(window, text + start, 16);
    window[16] = '\0';
    printRow(row, window);
    delay(300);
  }
  delay(700);
#else
  (void)row; (void)text;
  delay(holdMs);
#endif
}

void showIdle() {
#if HAS_LCD
  printRow(0, "Tap your ID...");
  // The label padded to the full width first, then the number written over
  // the end of it. Printed rather than formatted into a buffer on purpose:
  // snprintf is not reliably declared by Arduino.h on AVR, and pulling in
  // stdio for one line costs about 1.5K of flash.
  printRow(1, "Checked in:");
  lcd.setCursor(12, 1);
  lcd.print(checkedIn);
#endif
}

/* Works with either kind of buzzer. The frequency is ignored by an active
   one, which has its own oscillator and only knows on and off. */
void beep(unsigned int freq, unsigned int ms) {
#if ACTIVE_BUZZER
  (void)freq;
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
#else
  tone(BUZZER_PIN, freq, ms);
  delay(ms);
  noTone(BUZZER_PIN);
#endif
}

/* ============================================================
   What the desk said
   ============================================================ */

void verdictOk(const char *name) {
  checkedIn++;
  digitalWrite(LED_NO_PIN, LOW);
  digitalWrite(LED_OK_PIN, HIGH);
  printRow(0, "WELCOME");
  beep(2200, 150);
  printRowHeld(1, name, RESULT_HOLD_MS);
  digitalWrite(LED_OK_PIN, LOW);
  showIdle();
}

void verdictDuplicate(const char *name) {
  digitalWrite(LED_NO_PIN, LOW);
  digitalWrite(LED_OK_PIN, HIGH);
  printRow(0, "ALREADY IN");
  beep(1800, 90); delay(70); beep(1800, 90);
  printRowHeld(1, name, RESULT_HOLD_MS);
  digitalWrite(LED_OK_PIN, LOW);
  showIdle();
}

void verdictRefused(const char *reason) {
  digitalWrite(LED_OK_PIN, LOW);
  digitalWrite(LED_NO_PIN, HIGH);
  printRow(0, "NOT REGISTERED");
  for (byte i = 0; i < 3; i++) { beep(500, 100); delay(80); }
  printRowHeld(1, reason, RESULT_HOLD_MS);
  digitalWrite(LED_NO_PIN, LOW);
  showIdle();
}

/* The card read perfectly and nobody answered. Saying that plainly matters:
   the person at the door is about to be told "your card does not work", and
   it does - the desk's browser is not connected, or the port is held by the
   Arduino IDE's Serial Monitor. Neither has anything to do with the card. */
void verdictNoReply() {
  digitalWrite(LED_OK_PIN, LOW);
  digitalWrite(LED_NO_PIN, LOW);
  printRow(0, "Card read OK");
  beep(700, 200);
  printRowHeld(1, "No reply - desk?", RESULT_HOLD_MS);
  showIdle();
}

/* Neither yes nor no. The desk took the card for something that is not a
   check-in - registering it to somebody, handing it out - so there is no name
   to show and no door to open. No light, because a colour here would be read
   as a decision that was never made. */
void verdictInfo(const char *text) {
  digitalWrite(LED_OK_PIN, LOW);
  digitalWrite(LED_NO_PIN, LOW);
  printRow(0, "Card read");
  beep(1600, 80);
  printRowHeld(1, text, RESULT_HOLD_MS);
  showIdle();
}

/* One line from the desk, acted on. Returns true only for a line that really
   was a verdict, so anything else the port carries is ignored rather than
   mistaken for an answer. */
bool applyVerdict(char *line) {
  char *colon = strchr(line, ':');
  if (!colon) return false;
  *colon = '\0';
  char *text = colon + 1;
  while (*text == ' ') text++;

  if (strcasecmp(line, "OK") == 0)   { verdictOk(text);        return true; }
  if (strcasecmp(line, "DUP") == 0)  { verdictDuplicate(text); return true; }
  if (strcasecmp(line, "NO") == 0)   { verdictRefused(text);   return true; }
  if (strcasecmp(line, "INFO") == 0) { verdictInfo(text);      return true; }
  return false;
}

/* Whatever has arrived from the desk, a line at a time. Called both while
   waiting for an answer and while idle - a reply that arrives after the wait
   gave up is still the truth about the last card, and showing it late beats
   showing nothing. */
bool pumpSerial() {
  bool acted = false;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (inLen == 0) continue;
      inBuf[inLen] = '\0';
      inLen = 0;
      if (applyVerdict(inBuf)) acted = true;
    } else if (inLen < sizeof(inBuf) - 1) {
      inBuf[inLen++] = c;
    }
    /* A line longer than the buffer loses its tail rather than running off
       the end of it. On an AVR that overrun would quietly corrupt whatever
       variable happens to sit next in memory. */
  }
  return acted;
}

/* Ask, then wait. The screen says what it is doing, because a door display
   that goes blank for two seconds after a tap reads as a broken one, and the
   card gets tapped again. */
void awaitVerdict() {
  printRow(0, "Checking...");
  printRow(1, "");
  unsigned long started = millis();
  while (millis() - started < REPLY_TIMEOUT_MS) {
    if (pumpSerial()) return;
  }
  verdictNoReply();
}

/* ============================================================ */

void setup() {
  Serial.begin(9600);
  while (!Serial) { /* only matters on boards with native USB */ }

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_OK_PIN, OUTPUT);
  pinMode(LED_NO_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_OK_PIN, LOW);
  digitalWrite(LED_NO_PIN, LOW);

#if HAS_LCD
  lcd.init();        // a few versions of this library call it begin()
  lcd.backlight();
  printRow(0, "  JSCI CHECK-IN");
  printRow(1, "  starting up...");
#endif

  SPI.begin();
  reader.PCD_Init();
  delay(50);

  Serial.println(F("READY:RC522"));

  chipVersion = reader.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print(F("VERSION:0x"));
  Serial.println(chipVersion, HEX);

  if (chipVersion == 0x00 || chipVersion == 0xFF) {
    // Said plainly, because this is the single most common failure and the
    // symptom on its own ("my card will not read") points at the card.
    Serial.println(F("ERROR:The RC522 is not responding. This is wiring or power, not the card."));
    Serial.println(F("ERROR:Check 3.3V (NOT 5V), then SDA to pin 10, then RST to pin 9."));
    // On the screen too. Nobody at a door is watching the Serial Monitor, and
    // this fault refuses every card for a reason that is not the card's.
    printRow(0, "RC522 NOT FOUND");
    printRowHeld(1, "Check wiring/3V3", 2500);
  }

  /* Turn the aerial up. The library's default gain is well below the chip's
     maximum, and on the small PCB aerial that is the difference between
     reading a card at 10mm and at 30mm. There is no downside on a desk
     reader - the range is still only a few centimetres. */
  reader.PCD_SetAntennaGain(MFRC522::RxGain_max);
  reader.PCD_AntennaOn();
  Serial.println(F("GAIN:MAX"));

  /* Both LEDs and the buzzer, once. Standing at a door wondering whether the
     red light is broken or the person is genuinely not on the list is worth
     one beep at startup to rule out. */
  digitalWrite(LED_OK_PIN, HIGH);
  digitalWrite(LED_NO_PIN, HIGH);
  beep(1500, 120);
  digitalWrite(LED_OK_PIN, LOW);
  digitalWrite(LED_NO_PIN, LOW);

  showIdle();
  lastBeatAt = millis();
}

void loop() {
  unsigned long now = millis();

  // A late answer to the last card, or anything else the desk has sent.
  pumpSerial();

  if (now - lastBeatAt >= HEARTBEAT_MS) {
    Serial.println(F("ALIVE"));
    lastBeatAt = now;
  }

  // Nothing on the aerial: nothing to do.
  if (!reader.PICC_IsNewCardPresent()) return;
  if (!reader.PICC_ReadCardSerial())   return;

  String uid = "";
  for (byte i = 0; i < reader.uid.size; i++) {
    // Every byte as two characters. Without the pad, byte 0x0A prints as "A"
    // and the whole number shifts - a card that reads differently every time
    // it is tapped, which is a miserable thing to debug.
    if (reader.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(reader.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  bool sameCardAgain = (uid == lastUid) && (now - lastUidAt < REPEAT_BLOCK_MS);

  if (!sameCardAgain) {
    // Type first, on its own line - the UID line must stay pure.
    MFRC522::PICC_Type type = reader.PICC_GetType(reader.uid.sak);
    Serial.print(F("TYPE:"));
    Serial.println(reader.PICC_GetTypeName(type));

    Serial.print(F("UID:"));
    Serial.println(uid);

    lastUid   = uid;
    lastUidAt = now;

    // The card is halted before the wait rather than after it, so the aerial
    // is free while the desk is being asked. Otherwise a card held there for
    // the two seconds of the lookup is still selected when the wait ends, and
    // the next person's card cannot be seen until this one is lifted.
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();

    awaitVerdict();

    // The wait and the name on screen took seconds, and nothing was sent
    // during them. Without this the heartbeat fires the instant they end, for
    // no reason but the clock.
    lastBeatAt = millis();
    // Lifting the card during the wait must not let it read again at once.
    lastUidAt  = millis();
    return;
  }

  // Still held against the aerial - push the window out so the block lasts
  // until the card actually leaves, rather than expiring under it.
  lastUidAt = now;

  // The heartbeat is only interesting when nothing is happening.
  lastBeatAt = now;

  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
}
