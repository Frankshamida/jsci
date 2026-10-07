// A rooming list for an event that has not had one imported: the same shape
// as the hotel's sheet - the room type, the room number in a box down as many
// rows as it sleeps, the pax, and a line per bed for a name. Built as a
// plain .xlsx by hand, so it is read back by the same reader as an imported
// one and filled the same way.
import JSZip from 'jszip';
import { compareRoomNumbers } from '@/lib/rooms';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (c) => String.fromCharCode(65 + c);

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4E3B5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * @param {object} event { title }
 * @param {Array} rooms the event's rooms
 * @returns {Promise<Buffer>} an .xlsx with every room and an empty line per bed
 */
export async function blankRoomList(event, rooms) {
  const sorted = [...rooms].sort((a, b) => String(a.room_type).localeCompare(String(b.room_type))
    || compareRoomNumbers(a.room_number, b.room_number));
  const rows = new Map(); // row number -> [xml cells]
  const merges = [];
  const put = (r, c, text, s) => {
    if (!rows.has(r)) rows.set(r, []);
    const v = text === '' || text === undefined ? '' : `<is><t xml:space="preserve">${esc(text)}</t></is>`;
    rows.get(r).push(`<c r="${col(c)}${r}" s="${s}"${v ? ' t="inlineStr"' : ''}>${v}</c>`);
  };

  const title = `ROOM ASSIGNMENT${event?.title ? ` - ${String(event.title).toUpperCase()}` : ''}`;
  for (let c = 0; c < 4; c += 1) { put(1, c, c === 0 ? title : '', 1); put(2, c, '', 1); }
  merges.push('A1:D2');
  ['TYPE OF ROOM', 'ROOM NO.', 'PAX', 'NAME OF GUESTS'].forEach((h, c) => put(3, c, h, 2));

  let r = 4;
  sorted.forEach((room) => {
    const lines = Math.max(1, Number(room.pax) || 1);
    for (let k = 0; k < lines; k += 1) {
      put(r + k, 0, k === 0 ? String(room.room_type || '').toUpperCase() : '', 3);
      put(r + k, 1, k === 0 ? String(room.room_number) : '', 3);
      put(r + k, 2, k === 0 ? `${room.pax} PAX` : '', 3);
      put(r + k, 3, '', 4);
    }
    if (lines > 1) {
      merges.push(`A${r}:A${r + lines - 1}`, `B${r}:B${r + lines - 1}`, `C${r}:C${r + lines - 1}`);
    }
    r += lines;
  });

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="13" customWidth="1"/><col min="3" max="3" width="9" customWidth="1"/><col min="4" max="4" width="48" customWidth="1"/></cols>
<sheetData>${[...rows.entries()].map(([n, cells]) => `<row r="${n}"${n <= 2 ? ' ht="18" customHeight="1"' : ''}>${cells.join('')}</row>`).join('')}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="portrait" fitToHeight="0"/>
</worksheet>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`, { createFolders: false });
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, { createFolders: false });
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ROOM ASSIGNMENT" sheetId="1" r:id="rId1"/></sheets></workbook>`, { createFolders: false });
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`, { createFolders: false });
  zip.file('xl/styles.xml', STYLES, { createFolders: false });
  zip.file('xl/worksheets/sheet1.xml', sheet, { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
