/* ============================================================
   Joyful Sound Church - RFID card reader (simple)
   Arduino Uno + RC522 + 16x2 I2C LCD + 2 LEDs + buzzer

   This one shows the card number on its own screen the instant it reads it.
   It does not wait for the desk to answer, so it works with nothing plugged
   into the USB port but power.

   It still prints the same UID line the dashboard reads, so if the USB cable
   IS plugged into a computer with the Events RFID screen open, every tap
   lands in the database exactly as before. The difference from
   hardware/rfid-rc522 is only what the LCD shows: this one shows the number,
   that one waits and shows the member's name.

   ------------------------------------------------------------
   WIRING
   ------------------------------------------------------------

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

       16x2 I2C LCD   Arduino Uno
       ------------   -----------
       VCC         -> 5V
       GND         -> GND
       SDA         -> A4
       SCL         -> A5

       Red LED     -> pin 2     (through a 220 ohm resistor to GND)
       Green LED   -> pin 3     (through a 220 ohm resistor to GND)
       Buzzer      -> pin 4     (other leg to GND)

   The RC522's own pin marked "SDA" is NOT an I2C pin - on that module it is
   the SPI chip select, which is why it goes to pin 10 and A4/A5 stay free for
   the LCD. A4 and A5 are the only I2C pins the Uno has.

   LIBRARIES
       Arduino IDE -> Sketch -> Include Library -> Manage Libraries
         "MFRC522"           by GithubCommunity
         "LiquidCrystal I2C" by Frank de Brabander

   ------------------------------------------------------------
   WHAT IT DOES ON A TAP
   ------------------------------------------------------------
       Waiting      red LED on        "Tap your card"
       Card read    green LED + beep  "UID: C4 A4 B5 F4"
       Then         back to red       ready for the next one

   The red light is the resting state on purpose. A reader showing nothing at
   all looks broken, and the person at the door taps again harder instead of
   waiting - so there is always one light on, and which one it is says whether
   the reader is waiting for a card or has just taken one.

   ------------------------------------------------------------
   IF A CARD WILL NOT READ, READ THIS FIRST
   ------------------------------------------------------------
   The RC522 is a 13.56 MHz reader. The thin white cards and round blue fobs
   sold in most shops here are 125 kHz (EM4100 / TK4100) - a different
   technology at a different frequency, and an RC522 will NEVER read one, no
   matter how close you hold it.

   Hold the card to a phone with NFC turned on. If the phone reacts it is
   13.56 MHz and this reader can read it. If nothing happens it is 125 kHz and
   you need different cards, not different code. The white card and blue fob
   that came in the RC522 kit ARE the right kind - try those first.

   If even the kit card will not read, the VERSION line printed at startup
   says whether it is the wiring:

       0x91 / 0x92    a genuine RC522. Good.
       0x88 / 0x12    a clone. Usually works.
       0x00 / 0xFF    the chip is NOT talking. Check 3.3V (never 5V) first,
                      then SDA to pin 10, then RST to pin 9.
   ============================================================ */

#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

/* 0x27 on nearly all of these backpacks; a few are 0x3F. If the backlight
   comes on but the screen stays blank, try the other one. */
#define LCD_ADDR 0x27
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

/* 1 for a buzzer that sounds on its own when given 5V (an active one - most
   kits have these). 0 for a passive one, which only clicks unless it is given
   a tone to play. If it clicks instead of beeping, change this to 0. */
#define ACTIVE_BUZZER 1

#define SS_PIN       10   // SDA on the RC522
#define RST_PIN       9
#define RED_LED_PIN   2   // on while waiting for a card
#define GREEN_LED_PIN 3   // on for a moment as a card is read
#define BUZZER_PIN    4

MFRC522 reader(SS_PIN, RST_PIN);

/* How long the number stays on the screen before it goes back to waiting. */
const unsigned long SHOW_UID_MS = 2500;

/* Holding a card against the aerial reads it many times a second. Without a
   guard one person would be counted thirty times, so the same card is ignored
   until either it has been away for a moment or a different card is
   presented. */
const unsigned long REPEAT_BLOCK_MS = 2500;
String        lastUid   = "";
unsigned long lastUidAt = 0;

unsigned long scanCount = 0;

/* ============================================================
   The screen
   ============================================================ */

/* Writing a padded 16 characters rather than clearing first. lcd.clear() is a
   slow command, and blanking a row before redrawing it is what makes these
   screens flicker; overwriting the old text with the new one plus spaces
   leaves nothing to flicker. */
void printRow(byte row, const char *text) {
  lcd.setCursor(0, row);
  byte i = 0;
  for (; i < 16 && text[i]; i++) lcd.write(text[i]);
  for (; i < 16; i++) lcd.write(' ');
}

/* The same, for a line that may be too long to fit. A 4-byte card number fits
   exactly ("UID: C4 A4 B5 F4" is sixteen characters). A 7-byte NTAG does not,
   so rather than cutting half the number off the screen it is slid across. */
void printRowScroll(byte row, const String &text, unsigned long holdMs) {
  if (text.length() <= 16) {
    printRow(row, text.c_str());
    delay(holdMs);
    return;
  }
  for (unsigned int start = 0; start + 16 <= text.length(); start++) {
    printRow(row, text.substring(start, start + 16).c_str());
    delay(300);
  }
  delay(700);
}

/* Waiting for a card: red on, green off. */
void showIdle() {
  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, HIGH);
  printRow(0, "Tap your card");
  // The label padded to the full width first, then the number written over
  // the end of it. Printed rather than formatted into a buffer on purpose:
  // snprintf is not reliably declared by Arduino.h on AVR, and pulling in
  // stdio for one line costs about 1.5K of flash.
  printRow(1, "Scans:");
  lcd.setCursor(7, 1);
  lcd.print(scanCount);
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

/* ============================================================ */

void setup() {
  Serial.begin(9600);

  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  lcd.init();        // a few versions of this library call it begin()
  lcd.backlight();
  printRow(0, "  JSCI RFID");
  printRow(1, "  starting up...");

  SPI.begin();
  reader.PCD_Init();
  delay(50);

  Serial.println(F("READY:RC522"));

  byte chipVersion = reader.PCD_ReadRegister(MFRC522::VersionReg);
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
    printRow(1, "Check wiring/3V3");
    delay(2500);
  }

  /* Turn the aerial up. The library's default gain is well below the chip's
     maximum, and on the small PCB aerial that is the difference between
     reading a card at 10mm and at 30mm. */
  reader.PCD_SetAntennaGain(MFRC522::RxGain_max);
  reader.PCD_AntennaOn();
  Serial.println(F("GAIN:MAX"));

  /* Both LEDs and the buzzer, once. Standing at a door wondering whether a
     light is broken or the reader is simply idle is worth one beep at startup
     to rule out. */
  digitalWrite(RED_LED_PIN, HIGH);
  digitalWrite(GREEN_LED_PIN, HIGH);
  beep(1500, 120);
  digitalWrite(GREEN_LED_PIN, LOW);

  showIdle();
}

void loop() {
  // Nothing on the aerial: nothing to do.
  if (!reader.PICC_IsNewCardPresent()) return;
  if (!reader.PICC_ReadCardSerial())   return;

  // The number, twice: spaced for the screen, unbroken for the dashboard.
  String uidSpaced = "";
  String uidPlain  = "";
  for (byte i = 0; i < reader.uid.size; i++) {
    // Every byte as two characters. Without the pad, byte 0x0A prints as "A"
    // and the whole number shifts - a card that reads differently every time
    // it is tapped, which is a miserable thing to debug.
    if (reader.uid.uidByte[i] < 0x10) { uidSpaced += "0"; uidPlain += "0"; }
    uidSpaced += String(reader.uid.uidByte[i], HEX);
    uidPlain  += String(reader.uid.uidByte[i], HEX);
    if (i + 1 < reader.uid.size) uidSpaced += " ";
  }
  uidSpaced.toUpperCase();
  uidPlain.toUpperCase();

  unsigned long now = millis();
  bool sameCardAgain = (uidPlain == lastUid) && (now - lastUidAt < REPEAT_BLOCK_MS);

  if (sameCardAgain) {
    // Still held against the aerial - push the window out so the block lasts
    // until the card actually leaves, rather than expiring under it.
    lastUidAt = now;
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();
    return;
  }

  lastUid   = uidPlain;
  lastUidAt = now;
  scanCount++;

  /* Light and sound together, the moment it reads. Both start before the
     screen is written because the LCD takes a few milliseconds per character
     and the beep should land with the tap, not after it. */
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, HIGH);

  // Card type first, on its own line - the UID line must carry the UID and
  // nothing else, because the dashboard reads everything after "UID:" as the
  // card number.
  MFRC522::PICC_Type type = reader.PICC_GetType(reader.uid.sak);
  Serial.print(F("TYPE:"));
  Serial.println(reader.PICC_GetTypeName(type));

  Serial.print(F("UID:"));
  Serial.println(uidPlain);

  // The card is let go before the screen is written, so the aerial is free
  // while the number is being shown. Otherwise a card held there through the
  // whole display is still selected when it ends, and the next person's card
  // cannot be seen until this one is lifted.
  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();

  beep(2200, 150);

  printRow(1, "Scan #");
  lcd.setCursor(6, 1);
  lcd.print(scanCount);

  // Built up rather than written as "UID: " + uidSpaced. On AVR a string
  // literal on the LEFT of a + has no matching operator, and that one is a
  // confusing compile error to meet for the first time.
  String line = "UID: ";
  line += uidSpaced;
  printRowScroll(0, line, SHOW_UID_MS);

  // The screen took a couple of seconds. Lifting the card during them must
  // not let it read again the instant they end.
  lastUidAt = millis();

  showIdle();
}
