// Event names are displayed title-cased everywhere ("miracle working god" ->
// "Miracle Working God") so admin typing habits don't leak into the UI.
// Words that are already all-caps (acronyms like JSCI, VIP) and anything that
// looks like an email or URL are left exactly as they were typed.
export const titleCaseEvent = (value) => {
  if (typeof value !== 'string' || !value.trim()) return value;
  return value.replace(/\S+/g, (word) => {
    if (word.includes('@') || /^https?:\/\//i.test(word)) return word;
    if (/^[^a-z]*$/.test(word) && /[A-Z]/.test(word)) return word;
    return word.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  });
};

// Title-cases an event row, including a nested `event` (registration rows).
export const withTitleCase = (row) => (row && typeof row === 'object'
  ? {
      ...row,
      ...(row.title ? { title: titleCaseEvent(row.title) } : {}),
      ...(row.event ? { event: withTitleCase(row.event) } : {}),
    }
  : row);
