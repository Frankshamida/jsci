# Data Fetching & Caching Architecture

How this app should read data, so that a screen almost never waits on Supabase,
and so the same rules hold on a phone, a desktop, an in-app browser and the
Expo mobile app.

---

## 1. Where we are today

Measured in this repo:

| Fact | Number |
| --- | --- |
| API routes | 87 (`web/src/app/api/**/route.js`) |
| `fetch()` calls in the dashboard alone | 224 (`web/src/app/dashboard/page.js`) |
| Routes with an in-process cache (`serverCache.js`) | 9 |
| Routes sending `Cache-Control` | 5 |
| Client-side caching of API responses | none (only the daily verse and `userData`) |

What already exists and is good:

- **`web/src/lib/serverCache.js`** — TTL map + in-flight dedupe + rate limiter,
  living in the Node process. Collapses simultaneous identical reads into one
  Supabase call.
- **`web/src/lib/pollingConfig.js`** — `useSmartPoll`, which pauses on hidden
  tabs and idle users and backs off on errors.
- **Supabase Realtime** channels for notifications, chat, live streams,
  recordings, lineup and permissions.

What is missing, and is the reason screens feel slow:

1. **No client cache.** Every `loadX()` goes to the network. Re-opening the
   same modal, switching sections and back, or reloading the page all re-fetch
   from zero. The user watches a spinner for data they were looking at five
   seconds ago.
2. **No request deduplication in the browser.** Two components needing the same
   list make two requests.
3. **No revalidation model.** Freshness is decided ad hoc per call site, so the
   only two settings in practice are "always fetch" and "poll".
4. **`serverCache` is per-instance.** On Vercel, each lambda instance has its
   own copy, and it is empty after every cold start. It helps bursts, not the
   steady state.
5. **Nothing survives a reload.** Closing the tab throws away everything.

---

## 2. Principles

1. **The screen renders from cache first, always.** The network is a background
   correction, not a precondition for pixels.
2. **A spinner is only for a genuine cold start** — no cached copy at all. If
   there is a cached copy, it renders, and a thin "updating" hint appears if the
   revalidation is slow.
3. **Freshness is a property of the data, not of the call site.** One registry
   declares it once; every caller inherits it.
4. **Money and attendance are never *only* cached.** They render instantly from
   cache but always revalidate, and destructive actions read fresh.
5. **Cache is disposable.** It can vanish (iOS eviction, private mode, quota)
   and the app must be correct without it.
6. **One core, several storage drivers.** Browser, in-app webview and React
   Native differ only in where bytes are written.

---

## 3. The layers

```
┌──────────────────────────────────────────────────────────────┐
│  L0  Memory (per tab)         Map<key, entry>                │
│      instant · dedupes in-flight · lost on reload            │
├──────────────────────────────────────────────────────────────┤
│  L1  Persistent client        IndexedDB → localStorage → none │
│      survives reload & offline · user-scoped · LRU + TTL     │
├──────────────────────────────────────────────────────────────┤
│  L2  HTTP / Vercel edge       Cache-Control · ETag → 304     │
│      shared between users (public data only)                 │
├──────────────────────────────────────────────────────────────┤
│  L3  Server memory            serverCache.js (exists)        │
│      collapses concurrent misses into one query              │
├──────────────────────────────────────────────────────────────┤
│  L4  Supabase                 the only source of truth       │
└──────────────────────────────────────────────────────────────┘
```

A read walks down only as far as it has to. A write walks up, invalidating by
tag as it goes.

**Invalidation bus** sits beside the layers: Supabase Realtime events and local
mutations both publish tags (`events`, `registrations:<eventId>`, …) that drop
the matching L0/L1 entries and trigger revalidation on any mounted screen using
them.

---

## 4. Data classes

Every resource is declared as one of four classes. This is the whole freshness
policy; nothing else in the app decides TTLs.

| Class | Meaning | fresh | stale-while-revalidate | Persisted (L1) | Edge (L2) | Examples in this repo |
| --- | --- | --- | --- | --- | --- | --- |
| **static** | Config that changes when an admin edits it | 1 h | 24 h | yes | `s-maxage=300, swr=86400` | `/api/admin/terms`, `/api/payment-methods`, `/api/hero-media`, price tiers |
| **reference** | Slow-moving lists that many screens read | 5 min | 1 h | yes | private + ETag | `/api/admin/users`, `/api/admin/ministries`, `/api/admin/roles`, `/api/admin/permissions-control` |
| **content** | Feeds people read and occasionally write | 45 s | 10 min | yes | public `s-maxage=30, swr=120` when not personalised | `/api/events?published=1`, `/api/announcements`, `/api/community`, `/api/recordings` |
| **live** | Transactional state a desk acts on | 0–10 s | 60 s | **no** (memory only) | `no-store` + ETag | `/api/events/registrations`, `/api/events/installments`, `/api/attendance`, `/api/messages`, `/api/notifications` |
| **bypass** | A card tap. Not a read at all — see §5 | never | never | **no** | `no-store, no-cache` | `/api/rfid/scan`, `/api/rfid/event-checkin`, `/api/rfid/cards` |

Rules that ride on the class:

- **live is never written to disk.** A registration list contains names, phone
  numbers and payment state; it should not outlive the tab on a shared desk
  machine.
- **live still renders from memory cache.** Re-opening the Manage modal shows
  the previous rows immediately while the fresh copy lands — which is exactly
  the "no more loading" the desk wants — but the copy is always revalidated.
- **content and below are safe to render stale** for their window.

---

## 5. The RFID exemption

**RFID scanning opts out of every layer above.** No L0, no L1, no edge, no
`serverCache`. A tap goes to Supabase and back, every single time.

This is not an oversight in the caching design; it is the one place where
caching would be actively wrong, and it is worth being explicit about why.

### 5.1 Why a tap is not a read

Everywhere else in this app, two identical requests a second apart are the same
question asked twice, and answering the second from cache is free correctness.
At a card reader that is false:

- **The same card tapped twice is two different events.** At the meal counter
  ([`lookupClaimCard`](src/app/dashboard/page.js)), the second tap is the one
  that must answer *"they already took lunch"*. A cache keyed on
  `eventId + uid` would replay the first answer — the system would hand out a
  second lunch and be certain it had not.
- **The answer changes between taps because of the taps.** Check-in writes
  `attended`; the claims counters write rows. Any `fresh` window at all means
  the reader is looking at the world as it was before the last person in the
  queue.
- **`?uid=` lookups are GETs, so the browser and the CDN would cache them on
  their own** unless told not to. This is the failure most likely to appear at
  a real door: it works all day on the office desktop and misbehaves in an
  in-app browser on somebody's phone at the venue.

So: **`bypass` is a class, declared in the registry like any other**, and
`useResource` refuses to serve it from cache. Making it a declared class rather
than "just don't use the hook here" means the exemption survives the next person
who migrates a screen.

### 5.2 The rules

| Rule | Why |
| --- | --- |
| `cache: 'no-store'` on the fetch **and** `Cache-Control: no-store, no-cache, must-revalidate` on the response | Belt and braces. Some in-app webviews honour one and not the other |
| A `&_=<counter>` nonce on every scan URL | The last resort for webviews that ignore both headers. Cheap, and it makes "is this cached?" un-askable |
| No in-flight dedupe | Two taps are two events. The shared-promise optimisation in `useResource` must not apply |
| No `serverCache` on the scan routes | `resolveCard()` reads `rfid_event_cards` → `event_registrations` fresh. These are already written to look up one card; they are fast, and they must be right |
| One **idempotency key per tap** (`scanId`, a UUID generated at the reader) | See below |
| Never revalidate a scan screen on window focus | The desk alt-tabs constantly. A focus-triggered refetch of a *lookup* is harmless; of a *check-in*, it is a double entry |

### 5.3 Idempotency: the double-scan bug, solved properly

The realistic bug at a venue is not a stale cache, it is a **retry**: the desk
taps, the venue Wi-Fi stalls, the request is retried (by the user, by the
browser, or by our own error handling), and the person is checked in twice — or
handed two kits.

Fix it at the source rather than by hoping the network behaves:

1. The reader generates a `scanId` (`crypto.randomUUID()`) **at the moment of
   the tap**, not at the moment of the request.
2. It rides on the POST body. Retries of that tap reuse the same `scanId`.
3. `/api/rfid/event-checkin` keeps a short server-side window (60 s, in the
   existing `serverCache` — the one legitimate use of it here) mapping
   `scanId → result`. A repeat returns **the original result**, without writing
   anything.
4. The response says which it was: `{ replayed: true }` renders as the same
   green confirmation rather than a second success, so the desk is never told
   a person arrived twice.

This also makes the offline queue below safe, because replaying a queued tap
cannot double-write.

### 5.4 Offline: the queue, and being honest about it

Venue Wi-Fi drops. Today a failed tap is simply lost.

- Taps that fail with a **network** error (not a server rejection) go into a
  durable, ordered queue in IndexedDB — `{ scanId, eventId, uid, kind, tappedAt }`.
- The queue drains on `online`, oldest first, one at a time. `scanId` makes the
  drain idempotent.
- **The desk must see the difference.** A queued tap renders amber —
  *"Queued — not yet confirmed (3 waiting)"* — never the green tick. The one
  thing worse than a lost scan is a desk believing a scan landed when it did not.
- `tappedAt` is what gets recorded as the attendance time, not the drain time,
  so the record still says when the person actually walked in.
- Anything still queued when the section is closed raises a confirm: *"3 taps
  have not reached the server yet."*

### 5.5 What around the reader *is* cached

The scan path is exempt; the furniture around it is not, and this is where the
speed comes from.

- **The event roster** is prefetched into memory when the RFID desk opens, so
  the matched name and church render the instant the server answers — the
  round trip returns an id and a status, not a screenful of text to wait on.
- **The card list** (`/api/rfid/cards`) and the overview counts are `reference`
  and `content` respectively; they refresh on their own schedule.
- After any check-in, the bus invalidates `registrations:<eventId>` and
  `checkin:<eventId>`, so the Attendance tab and the counters are correct
  without polling.

Net effect: the reader still does exactly one authoritative round trip per tap
— which is what makes it trustworthy — but everything drawn around that answer
is already in memory, so the tap *feels* instant.

---

## 6. Anti-bug rules for every table and list

Caching makes some existing bug classes louder. These rules are not optional
extras; they are what keeps the tables correct once data can arrive from two
places. Most of them are worth doing even without the cache.

### 6.1 Out-of-order responses — the classic table bug

Typing in the registrations search fires a request per keystroke. Response 3
can land after response 5, and the table then shows results for a query the
user has already moved past. This exists in the app **today**.

Every fetch carries a sequence number; only a response whose sequence is the
newest is allowed to call `setState`. `useResource` does this internally, and
an `AbortController` cancels the superseded request so it does not even finish.

### 6.2 Identity, not position

Rows are keyed by `r.id` — never by array index. When a cached list is replaced
by a fresh one, React must be able to tell "the same row, updated" from "a
different row in that slot", or a click during a refresh acts on the wrong
person. This is the difference between a refresh that flickers and one that
takes somebody's money against the wrong name.

### 6.3 A write always wins over an in-flight read

If a revalidation started *before* a local mutation and lands *after* it, it
must be discarded — otherwise the row you just marked paid flips back to unpaid
for a second, and anyone watching taps the button again. Each cache key carries
a `mutatedAt`; a response that started before it is dropped.

### 6.4 Never mix a cached list with a fresh detail

A modal opened from a cached row shows cached values instantly *and* revalidates
that one record. Until it lands, destructive buttons (Collect Cash, Delete,
Refund) stay disabled. The user sees the data immediately; they just cannot act
on a stale copy of it.

### 6.5 Paginate against a snapshot

Page 2 of a list that changed between pages silently duplicates or skips rows.
Cache the list per `(filters, page)` and invalidate **all pages** of a list on
any write to it. If a write lands while a paged list is open, return to page 1
rather than trying to patch pages in place.

### 6.6 Empty is a value, not a missing value

`[]` must be cached and rendered as "nobody here yet". Treating empty as a miss
means every genuinely empty table re-fetches forever — and shows a spinner
where it should show a sentence.

### 6.7 Every cached screen can be reloaded by hand

A visible refresh control, on every table, that calls `refresh({ force: true })`
and skips every layer. It costs one button and it converts *"the system is
buggy"* into *"I pressed refresh and it was right"* — which is also the fastest
way to find out whether a report is a cache problem or a data problem.

---

## 7. Client modules

Four new files. No new dependencies: this is ~400 lines total, and hand-rolling
it avoids shipping React Query to a page that already loads a lot of JS.

### 7.1 `web/src/lib/cacheStore.js` — the storage engine

```js
// Driver chain, picked once at module load:
//   IndexedDB  → normal browsers, big quota, async, survives reload
//   localStorage → in-app webviews and anything where IDB throws (~5 MB)
//   memory only → Safari private mode, blocked storage, SSR
//
// Every read and write is wrapped in try/catch. Storage failing is normal,
// not exceptional: the app degrades to memory and keeps working.

export const cacheStore = {
  get(key),            // → { value, savedAt, etag } | undefined   (async)
  set(key, entry),     // fire-and-forget, never throws            (async)
  drop(keyOrPrefix),   // one key, or everything under a prefix
  purgeNamespace(ns),  // logout / user switch
  stats(),             // { hits, misses, bytes, driver }
};
```

Key shape:

```
jsci:v<BUILD_ID>:<userId|anon>:<resource>:<paramsHash>
```

- **`BUILD_ID`** (`process.env.NEXT_PUBLIC_BUILD_ID`, set from the Vercel commit
  SHA) means a deploy that changes a response shape cannot be poisoned by old
  entries — on boot, anything with a different build prefix is dropped.
- **`userId`** namespaces everything. Logging out calls `purgeNamespace`, so a
  shared phone never leaks the previous account's data into the next session.
- **`paramsHash`** is a stable stringify of the query object, so
  `?eventId=12&limit=50` and `?limit=50&eventId=12` are one entry.

Budget and eviction:

- Skip caching any payload over **512 KB** (the community feed with images can
  get there) unless the resource opts in.
- Soft cap: **4 MB** on localStorage, **25 MB** on IndexedDB. When over, evict
  by least-recently-read until under 80 % of the cap.
- On `QuotaExceededError`, evict 25 % and retry once, then fall back to memory
  for the rest of the session.

### 7.2 `web/src/lib/resources.js` — the registry

One entry per endpoint. This file is the contract; call sites stop deciding.

```js
export const RESOURCES = {
  eventsPublished: {
    path: '/api/events',
    query: { published: 1 },
    class: 'content',
    tags: ['events'],
  },
  eventRegistrations: {
    path: '/api/events/registrations',
    class: 'live',
    // A tag per event, so collecting cash on event 12 does not invalidate 11.
    tags: (p) => ['registrations', `registrations:${p.eventId}`],
  },
  permissionOverrides: {
    path: '/api/admin/permissions-control',
    class: 'reference',
    tags: ['permissions'],
  },
  // …one line per endpoint the UI reads
};
```

### 7.3 `web/src/lib/useResource.js` — the hook

```js
const { data, isStale, isRevalidating, error, refresh, mutate } =
  useResource('eventRegistrations', { eventId }, { enabled: !!eventId });
```

Behaviour, in order:

1. **Synchronous L0 read.** If memory has an entry, `data` is populated on the
   very first render — no flash, no spinner, no layout jump.
2. **L1 read** (async, one tick later) when memory missed. The screen goes from
   skeleton to content without a network round trip.
3. **Decide:** within `fresh` → stop. Within `stale` → return cached and
   revalidate in the background. Beyond → return cached (marked stale) and
   revalidate at the foreground priority.
4. **Dedupe.** Concurrent callers of the same key share one promise. Ten
   components, one request.
5. **Revalidate on:** mount (per the rules above), window focus (throttled to
   once per 10 s), `online` event, a matching invalidation tag, an explicit
   `refresh()`, or a `useSmartPoll` tick for `live` resources.
6. **`mutate(updater, { revalidate })`** writes the optimistic value into L0 (and
   L1 when persisted) so the UI updates instantly on a write, then reconciles.

Existing `useSmartPoll` keeps its job: it is the *trigger*, `useResource` is the
*cache*. Polling a cached resource becomes a cheap conditional request (below),
so the intervals in `POLL_MS` can stay where they are or go *down*.

### 7.4 `web/src/lib/cacheBus.js` — invalidation

```js
invalidateTags(['registrations:12']);   // after collecting cash
subscribeTags(['events'], handler);     // useResource subscribes itself
```

Two publishers:

- **Local mutations.** Every POST/PUT/DELETE names the tags it dirties. The
  existing `openEventRegistrations(...)` full-reload calls collapse into one
  `invalidateTags`.
- **Supabase Realtime.** The channels already open map table events to tags:
  `event_registrations` → `registrations:<row.event_id>`. This is what makes
  long TTLs safe — the cache is corrected by push, not by guessing a number.

---

## 8. Server side

### 8.1 `withCache` route helper

Wrap read routes so all three server-side mechanisms come from one place:

```js
export const GET = withCache(
  { key: (req) => `events:published`, ttlMs: 30_000, scope: 'public' },
  async (req) => { /* existing Supabase query */ },
);
```

It does three things:

1. **`serverCache.cached()`** — the existing L3, so concurrent misses share one
   Supabase call.
2. **ETag.** Hash the serialised payload, compare with `If-None-Match`, return
   **304 with an empty body** when unchanged. A poll of a 60 KB registration
   list becomes ~200 bytes over the wire. Pair with L3 and the 304 usually costs
   no Supabase query at all.
3. **`Cache-Control`** by scope:
   - `public` → `public, max-age=20, s-maxage=60, stale-while-revalidate=300`
     so the Vercel edge answers most readers for the whole church.
   - `private` → `private, max-age=0, must-revalidate` + ETag.
   - `live` → `no-store` + ETag (the 304 is still the win).

**Never** put personalised data behind `s-maxage`. The rule of thumb: if the
response varies by `userId`, it is `private` or `live`.

### 8.2 Make L3 worth more

`serverCache` is per-instance and cold on every deploy. Two cheap improvements:

- Raise TTLs for `static`/`reference` routes to minutes — they are invalidated
  explicitly by their own write handlers, which already call `cacheInvalidate`.
- If Supabase load is still the bottleneck after Phase 2, put **Vercel KV /
  Upstash Redis** behind the same `cached()` signature so the cache is shared
  across instances and survives deploys. The call sites do not change; only the
  implementation of `cached()` does. *(Worth doing only if measurement says so —
  it adds a dependency and a paid tier.)*

---

## 9. Cross-platform & cross-browser

| Target | Driver | Notes |
| --- | --- | --- |
| Chrome / Edge / Firefox desktop & Android | IndexedDB | Full budget, nothing special |
| Safari macOS/iOS | IndexedDB | **Script-writable storage is evicted after 7 days of no use.** Cache is a cache; never the source of truth |
| Safari private mode / locked-down webviews | memory | `localStorage` can *throw on access*, not just return null — every access is wrapped |
| Facebook / Messenger in-app browser (common for shared event links) | localStorage, sometimes memory | IDB is flaky in some versions; the driver probes with a real write at boot and falls back |
| Old Android WebView | localStorage | Keep entries small; the 512 KB skip rule matters most here |
| **Expo mobile app** (`mobile/`) | `AsyncStorage` | Same `cacheStore` interface, different driver. `mobile/src/services/api.ts` gets the same `useResource` port so the app behaves identically offline |

Deliberately **not** required: a Service Worker. It would add offline page
shells, but it also adds an update-and-stale-app class of bug that is hard to
support for a church's mixed device fleet. The architecture above works without
one; a SW can be added later purely for the static shell if wanted.

Also: **respect Save-Data and slow connections.** When
`navigator.connection?.saveData` is true, widen `fresh` windows by 4× and skip
background revalidation on `content` — a phone on a weak signal at a venue
should lean harder on the cache, not fight for bandwidth.

---

## 10. What must never be stale-only

| Situation | Rule |
| --- | --- |
| Collect Cash modal | Renders from cache instantly, but issues a revalidation on open and disables the confirm button until it lands (or the request errors) |
| RFID card taps | `bypass` — no cache at any layer, idempotency key per tap, offline queue shown as unconfirmed. See §5 |
| Attendance list behind the reader | `live`, memory only, always revalidate |
| Slot counts on a nearly-full event | Revalidate before the registration write, and let the server be the authority on overflow |
| Anything written in the last 5 s by this tab | Served from the optimistic L0 entry, never from L1 or the edge |
| Permissions & roles | `reference`, but a Realtime change on `role_permissions` invalidates immediately — a revoked permission must not survive on a cached menu |

---

## 11. Rollout

Each phase is independently shippable and leaves the app working.

**Phase 0 — foundation (no behaviour change).**
Add `cacheStore.js`, `useResource.js`, `resources.js`, `cacheBus.js`. Wire three
safe read-only screens: published events on the home page, announcements, terms.
Verify with the stats overlay.

**Phase 1 — server conditional requests.**
`withCache` + ETag + `Cache-Control` on the ten most-requested GETs
(`/api/events`, `/api/announcements`, `/api/community`,
`/api/events/registrations`, `/api/admin/users`, `/api/admin/permissions-control`,
`/api/notifications`, `/api/messages`, `/api/recordings`, `/api/payment-methods`).
This alone cuts bytes and Supabase queries on every existing poll, before any
screen is migrated.

**Phase 2 — migrate the dashboard, section by section.**
The 224 `fetch()` calls become `useResource` reads. Order by pain:
events → registrations → community → users/permissions → messages → the rest.
Each migrated `loadX()` deletes a manual `useState` + `useEffect` pair, so the
file gets smaller as it goes.

**Phase 3 — Realtime invalidation.**
Point the existing channels at `invalidateTags`. Once push-correction is in,
re-tune `POLL_MS` — most pollers become a safety net at 5–10 minutes instead of
30–180 seconds.

**Phase 3.5 — RFID hardening (can be done first, and probably should be).**
Independent of the cache work: `scanId` idempotency, `no-store` on both ends,
the offline queue with its amber unconfirmed state, and the roster prefetch.
This is the piece that stops scanning being flaky at a venue, and none of it
depends on Phases 0–3.

**Phase 4 — mobile + prefetch.**
AsyncStorage driver for `mobile/`. Warm the cache on login: in an idle callback,
fetch the handful of resources the user's role opens most, so the first tap on a
section is instant.

---

## 12. How we will know it worked

Instrument before changing anything, so the comparison is real.

- **`window.__cacheStats`** in dev: hits, misses, 304s, bytes saved, driver in
  use. A hit rate under ~70 % on `content` after Phase 2 means the TTLs are
  wrong.
- **Supabase dashboard**: requests/day before Phase 1 vs. after Phase 3.
- **Perceived speed**: time from clicking a sidebar section to first content.
  Target: **0 ms for a revisit** (cache render), unchanged for a cold start.
- **Network panel on a throttled 3G profile**: re-opening the Manage modal
  should show rows immediately and issue one conditional request that comes back
  304.

---

## 13. Risks and honest limits

- **Stale money data is the real risk.** Section 10 exists to contain it; the
  Collect Cash and attendance screens must be migrated *with* their revalidation
  rules, not before them.
- **A cache makes bugs stickier.** Anything odd on screen has a new possible
  cause. `window.__cacheStats` plus a one-key "drop cache" dev button is the
  mitigation; a visible build id helps support.
- **iOS eviction and in-app browsers mean some users never get L1 benefits.**
  They still get L0, dedupe, 304s and the edge cache — the design degrades
  gradually rather than failing.
- **Estimated effort**: Phase 0–1 is roughly a day's work; Phase 2 is the long
  one, and it is incremental. Nothing here requires a rewrite or a new
  dependency.
