// Turns what a request or the database said into something a church member
// can read. Messages already written for people pass through unchanged (only
// a leading "Error:" is dropped); technical ones are replaced.

// Only patterns that come from browsers, Postgres, PostgREST or JavaScript
// itself, so a message written for people is never replaced.
const RULES = [
  [/failed to fetch|networkerror when attempting|network request failed|^load failed$|err_internet_disconnected|net::err_/i,
    "We can't reach the server. Please check your internet connection and try again."],
  [/unexpected token .* in json|is not valid json|json\.parse|unexpected end of json/i,
    'The server sent back something unexpected. Please try again in a moment.'],
  [/\bjwt\b|jwt expired|invalid jwt|refresh token not found/i,
    'Your session has ended. Please sign in again.'],
  [/\btimed out\b|\btimeout\b|aborterror|the user aborted a request|signal is aborted/i,
    'That took too long. Please try again.'],
  [/duplicate key value|violates unique constraint/i,
    'That is already saved, so nothing new was added.'],
  [/violates (check|foreign key|not-null) constraint|invalid input syntax for|invalid input value for enum|out of range for type/i,
    'Some of the details could not be saved. Please check them and try again.'],
  [/permission denied for|row-level security policy/i,
    "You don't have access to do that. If you think you should, please ask an admin."],
  [/^too many requests$|^rate limit(ed)?\b/i,
    'That was a lot at once. Please wait a moment and try again.'],
  [/^(internal server error|500|bad gateway|502|503|service unavailable)$/i,
    'Something went wrong on our side. Please try again in a moment.'],
  [/^(typeerror|referenceerror|syntaxerror)\b|cannot read propert(y|ies) of|is not a function\b|undefined is not an object/i,
    'Something went wrong. Please refresh the page and try again.'],
];

export function friendlyMessage(message) {
  let text = String(message ?? '').trim();
  text = text.replace(/^(error|err)\s*[:-]\s*/i, '').trim();
  if (!text || /^(undefined|null|\[object object\]|error)$/i.test(text)) {
    return 'Something went wrong. Please try again.';
  }
  for (const [re, nice] of RULES) if (re.test(text)) return nice;
  return text;
}

// Long enough to read: 4 to 8 seconds.
export const toastDuration = (text) => Math.min(8000, Math.max(4000, 2000 + String(text || '').length * 45));
