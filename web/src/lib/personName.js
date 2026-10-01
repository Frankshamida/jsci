// "Cassiopeia Hope Balais" -> { last: 'BALAIS', first: 'Cassiopeia Hope' }.
// Particles stay with the surname ("De Leon", "Dela Cruz"), and so do
// suffixes (Jr., III). The same rule the verification desk lists by.

const PARTICLES = new Set(['de', 'dela', 'del', 'delos', 'de los', 'los', 'la', 'las', 'san', 'sta', 'sta.', 'santa', 'santo', 'van', 'von', 'di', 'da', 'du', 'mc']);

const titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ')
  .toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

export function splitLastFirst(raw) {
  const words = titleCase(raw).split(' ').filter(Boolean);
  if (words.length < 2) return { last: (words[0] || '').toUpperCase(), first: '' };
  let end = words.length;
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(words[end - 1]) ? words[--end] : '';
  let start = end - 1;
  while (start > 1 && PARTICLES.has(words[start - 1].toLowerCase())) start -= 1;
  const last = words.slice(start, end).join(' ');
  return { last: `${last}${suffix ? ` ${suffix}` : ''}`.toUpperCase(), first: words.slice(0, start).join(' ') };
}
