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

   LIBRARY
       Arduino IDE -> Sketch -> Include Library -> Manage Libraries
       search "MFRC522" -> install the one by GithubCommunity.

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
   separate 3.3V supply with the grounds tied together.
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
       names itself, and does not spend a second dumping sectors nobody reads.
       (The dashboard also ignores a card repeated within 2.5 seconds, so
       DumpInfo will not check one person in thirty times either.)

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

#define SS_PIN  10   // SDA on the RC522
#define RST_PIN  9

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

byte chipVersion = 0;

void setup() {
  Serial.begin(9600);
  while (!Serial) { /* only matters on boards with native USB */ }

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
  }

  /* Turn the aerial up. The library's default gain is well below the chip's
     maximum, and on the small PCB aerial that is the difference between
     reading a card at 10mm and at 30mm. There is no downside on a desk
     reader - the range is still only a few centimetres. */
  reader.PCD_SetAntennaGain(MFRC522::RxGain_max);
  reader.PCD_AntennaOn();
  Serial.println(F("GAIN:MAX"));

  lastBeatAt = millis();
}

void loop() {
  unsigned long now = millis();

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
  } else {
    // Still held against the aerial - push the window out so the block lasts
    // until the card actually leaves, rather than expiring under it.
    lastUidAt = now;
  }

  // The heartbeat is only interesting when nothing is happening.
  lastBeatAt = now;

  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
}
