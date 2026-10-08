import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ---- A network blip is not an error ----
// A request to Supabase that dies on the wire - a connection reset by the
// gateway while the project is busy, a DNS hiccup, a socket that timed out -
// comes back from the client as "TypeError: fetch failed", and that went
// straight into a red toast at the desk. It is tried again instead, a moment
// later, up to three times in all:
//
//   reads (GET / HEAD)   on any network failure, and on 502/503/504 from the
//                        gateway - asking again changes nothing
//   writes               only when the request provably never left: the
//                        connection was refused or never opened, or the name
//                        did not resolve. A write that may have arrived is
//                        never sent twice.
//
// Still failing after that, the message says what happened in words.
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
const BUSY = new Set([502, 503, 504]);
const TRIES = 3;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (i) => 300 * 2 ** i + Math.floor(Math.random() * 150);

export async function resilientFetch(input, init = {}) {
  const method = String(init.method || input?.method || 'GET').toUpperCase();
  const read = READS.has(method);
  // A body that can be sent again as it is (PostgREST sends JSON text).
  const resendable = init.body == null || typeof init.body === 'string';
  for (let i = 0; ; i += 1) {
    try {
      const res = await fetch(input, init);
      if (read && BUSY.has(res.status) && i < TRIES - 1) { await pause(backoff(i)); continue; }
      return res;
    } catch (err) {
      if (err?.name === 'AbortError' || init.signal?.aborted) throw err;
      const code = err?.cause?.code || err?.code || '';
      const retry = resendable && (read || NEVER_SENT.has(code));
      if (retry && i < TRIES - 1) { await pause(backoff(i)); continue; }
      const why = code ? ` (${code})` : '';
      const failed = new TypeError(`Could not reach the database${why} - check the connection and try again.`);
      failed.cause = err;
      throw failed;
    }
  }
}

let supabase;
let supabaseAdmin;

try {
  supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: resilientFetch } });
} catch (error) {
  console.warn('⚠️ Supabase client initialization failed. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  supabase = null;
}

// Admin client bypasses RLS - only use in server-side API routes
try {
  if (supabaseServiceRoleKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: resilientFetch },
    });
  } else {
    supabaseAdmin = supabase; // fallback to anon if no service key
  }
} catch (error) {
  console.warn('⚠️ Supabase admin client initialization failed.');
  supabaseAdmin = supabase;
}

export { supabase, supabaseAdmin };
