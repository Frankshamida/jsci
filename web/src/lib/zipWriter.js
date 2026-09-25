// ============================================================
// A very small ZIP writer, and why the app has its own
// ============================================================
// .xlsx and .docx are both ZIP archives of XML files. Writing them properly is
// the difference between a spreadsheet that opens with its headings bold and
// its columns the right width, and an HTML table renamed .xls that makes Excel
// put up a "the file format and extension don't match" warning before anybody
// sees a single row.
//
// The alternative was a library. SheetJS and docx are ~400KB each, they would
// be loaded by a dashboard that already ships a lot of JavaScript, and between
// them they would cover two of the four formats this app exports. What is
// actually needed to write those two containers is a ZIP with no compression -
// about eighty lines, all of it below.
//
// Deliberately STORE (method 0), not DEFLATE. The browser has no synchronous
// deflate to call, and CompressionStream is not on every device this app runs
// on. An uncompressed .xlsx of a thousand registrations is a few hundred KB,
// which is a file somebody downloads once, and every reader opens it happily -
// the ZIP spec has allowed stored entries since 1989.
// ============================================================

// CRC-32, table built once on first use.
let crcTable = null;
function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

function crc32(bytes) {
  if (!crcTable) crcTable = makeCrcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * MS-DOS date/time, which is what a ZIP entry carries. Seconds have one bit
 * less than they need, hence the halving - a two-second resolution is the
 * format's, not ours.
 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Build a ZIP from `{ name, text }` entries.
 *
 * Names use forward slashes and no leading slash, which is what the Open XML
 * readers expect - a backslash here is the classic "the file is corrupt" bug.
 *
 * @param {Array<{name: string, text: string}>} files
 * @param {string} mimeType  what the resulting Blob calls itself
 * @returns {Blob}
 */
export function zipFiles(files, mimeType = 'application/zip') {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(new Date());
  const chunks = [];      // the file data section, in order
  const central = [];     // one central-directory record per entry
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.text);
    const crc = crc32(dataBytes);

    // ---- local file header ----
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);   // signature
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // flags: names are UTF-8
    local.setUint16(8, 0, true);            // method: stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dataBytes.length, true);  // compressed size
    local.setUint32(22, dataBytes.length, true);  // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);           // no extra field

    chunks.push(new Uint8Array(local.buffer), nameBytes, dataBytes);

    // ---- central directory record, written out at the end ----
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014B50, true);
    dir.setUint16(4, 20, true);             // version made by
    dir.setUint16(6, 20, true);             // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, stamp.time, true);
    dir.setUint16(14, stamp.date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, dataBytes.length, true);
    dir.setUint32(24, dataBytes.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint16(30, 0, true);             // extra length
    dir.setUint16(32, 0, true);             // comment length
    dir.setUint16(34, 0, true);             // disk number
    dir.setUint16(36, 0, true);             // internal attributes
    dir.setUint32(38, 0, true);             // external attributes
    dir.setUint32(42, offset, true);        // where the local header starts
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + dataBytes.length;
  });

  const centralSize = central.reduce((total, part) => total + part.length, 0);

  // ---- end of central directory ----
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);          // where the central directory starts
  end.setUint16(20, 0, true);               // no archive comment

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: mimeType });
}

/** XML text escaping. Everything written into these documents goes through it. */
export function xmlEscape(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not legal in XML 1.0 at all, and a stray one from
    // a pasted name takes the whole document down with it.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export default zipFiles;
