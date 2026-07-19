import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DIR = 'd:/JSCI/jsci/web/public/assets';
const BACKUP = path.join(DIR, '_originals');
if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP);

// Per-file rules: [maxWidth, format-options]. Default applied otherwise.
const rules = {
  // Logos (keep transparency -> PNG, palette compressed)
  'ISOM_Logo.png': { w: 500, png: true },
  'LOGO.png':      { w: 320, png: true },
  'LOGO2.png':     { w: 320, png: true },
  // Pastor portraits (PNG w/ possible transparency)
  'dr-dorothy-pior.png':   { w: 520, png: true },
  'dr-weldon-pior.png':    { w: 520, png: true },
  'ptr-eldan-gambe.png':   { w: 520, png: true },
  'ptr-psalm-gambe.png':   { w: 520, png: true },
  'ptr-gracelyn-gambe.png':{ w: 520, png: true },
};

const jpgFiles = fs.readdirSync(DIR).filter(f => /\.(jpe?g)$/i.test(f));
const heroLike = new Set([
  'worship-service.jpg','community-outreach.jpg','youth-event.jpg',
  'christian-leadership-conference.jpg','baptism-service.jpg',
]);

function fmt(bytes){ return (bytes/1024).toFixed(0)+'KB'; }

async function run() {
  let before = 0, after = 0;

  // 1. PNG logos + portraits
  for (const [file, rule] of Object.entries(rules)) {
    const src = path.join(DIR, file);
    if (!fs.existsSync(src)) continue;
    const bak = path.join(BACKUP, file);
    if (!fs.existsSync(bak)) fs.copyFileSync(src, bak);
    const b = fs.statSync(bak).size; before += b;
    const buf = await sharp(bak)
      .resize({ width: rule.w, withoutEnlargement: true })
      .png({ compressionLevel: 9, quality: 78, effort: 8, palette: true })
      .toBuffer();
    fs.writeFileSync(src, buf);
    const a = fs.statSync(src).size; after += a;
    console.log(`${file}: ${fmt(b)} -> ${fmt(a)}`);
  }

  // 2. JPG photos
  for (const file of jpgFiles) {
    const src = path.join(DIR, file);
    const bak = path.join(BACKUP, file);
    if (!fs.existsSync(bak)) fs.copyFileSync(src, bak);
    const b = fs.statSync(bak).size; before += b;
    const maxW = heroLike.has(file) ? 1600 : 1100;
    const buf = await sharp(bak)
      .resize({ width: maxW, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true, progressive: true })
      .toBuffer();
    fs.writeFileSync(src, buf);
    const a = fs.statSync(src).size; after += a;
    console.log(`${file}: ${fmt(b)} -> ${fmt(a)}`);
  }

  // 3. Mascot GIF -> animated WebP (new file)
  const gif = path.join(DIR, 'Joy_Mascot.gif');
  if (fs.existsSync(gif)) {
    const bak = path.join(BACKUP, 'Joy_Mascot.gif');
    if (!fs.existsSync(bak)) fs.copyFileSync(gif, bak);
    const b = fs.statSync(bak).size; before += b;
    const out = path.join(DIR, 'Joy_Mascot.webp');
    const buf = await sharp(bak, { animated: true })
      .resize({ width: 240, withoutEnlargement: true })
      .webp({ quality: 60, effort: 5 })
      .toBuffer();
    fs.writeFileSync(out, buf);
    const a = fs.statSync(out).size; after += a;
    console.log(`Joy_Mascot.gif -> Joy_Mascot.webp: ${fmt(b)} -> ${fmt(a)}`);
  }

  console.log(`\nTOTAL: ${fmt(before)} -> ${fmt(after)}  (saved ${fmt(before-after)}, ${(100*(before-after)/before).toFixed(0)}%)`);
}
run().catch(e => { console.error(e); process.exit(1); });
