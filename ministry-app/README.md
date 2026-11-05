# JSCI Ministry

The Praise & Worship team app (Android APK and iOS). Only verified users with the
**Ministry Member** role can sign in.

Built with Expo SDK 54 (React Native 0.81, Hermes). The app talks only to the website's
`/api/ministry/*` routes (`src/config.ts` → `API_BASE_URL`). It holds no database key and
makes no AI or YouTube API calls.

## Run on your phone while developing

```bash
npm install
npx expo start          # opens a QR code
```

Fingerprint lock, recording and secure storage need a real build. They don't work in
Expo Go, so make a development or preview build:

## Build

```bash
npm i -g eas-cli
eas login
eas init                                  # first time only: links the project (adds projectId to app.json)
eas build -p android --profile preview    # APK you can install directly
eas build -p ios --profile production     # needs an Apple Developer account
```

## Website side

- Deploy the web project, which contains `web/src/app/api/ministry/*`.
- In Vercel, set `MINISTRY_APP_SECRET` to a long random string. It signs the app's
  30-day sign-in tokens. Changing it signs everyone out.
- `SUPABASE_SERVICE_ROLE_KEY` must be set: the chat and swap tables are server-only.
- Run `web/supabase/migrations/ministry_app_v1_3.sql` once in Supabase (1.3: swaps,
  group chats, GPS check-in columns). Safe to run again.
- `web/public/ministry-player.html` is the in-app song player page; the app loads it
  from the website, so YouTube sees a real web page.

## How it stays light

- **One request on open:** `/api/ministry/home` sends the profile, lineups, excuses,
  substitutes and attendance together.
- **Cached on the phone:** the app fetches the dashboard again only when it is over
  5 minutes old, on pull-to-refresh, or after you change something. There is no polling.
- **Small recordings:** practice audio is recorded as mono AAC at 48 kbps (~360 KB per
  minute), with a 10-minute cap so it fits the upload limit.
- **YouTube previews:** the thumbnails are plain image links (`i.ytimg.com`), not the
  YouTube API.
- **Smaller app:** only the fonts in use are bundled (Font Awesome 6 and five Outfit
  weights), and release builds are minified and shrunk.

## Look

The app uses the website's look:
- **Colours:** from `web/src/app/dashboard/dashboard.css`, in light and dark versions.
- **Icons:** Font Awesome 6, the same ones the website uses.
- **Font:** Outfit.

**Light and dark mode:** the app follows the phone's setting. People can change it in
Profile → Appearance, or with the moon/sun button on Home and on the sign-in screen.

**Android:** the Home and Back buttons are hidden. Swiping up from the bottom shows them
for a moment.

## Layout

| Path | What |
| --- | --- |
| `src/theme.tsx` | Palettes (light/dark), fonts, `useTheme`, `makeStyles` |
| `src/icons.tsx` | Font Awesome 6 icons (any FA6 name) |
| `src/keyboard.tsx` | Keeps the field being typed in above the keyboard |
| `src/session.tsx` | Sign-in, the cached dashboard, the fingerprint lock |
| `src/api.ts` | Server calls (feature modules add their own through `request`) |
| `src/months.ts` | The schedule by month, cached (Home's calendar) |
| `src/player.tsx` | The YouTube song player and its mini player |
| `src/lyrics.ts` | A lineup's lyrics, cached |
| `src/chat.ts` | Group chats: API, room list, unread badge |
| `src/attendance.ts` | GPS check-in: API, church location, distance |
| `src/planner.ts` | Schedule Plotter: lineups and approvals |
| `src/recordings.ts` | Practice recordings, cached per lineup |
| `src/screens/` | Login, Lock, Home, Lineup, Song Editor, Recorder, Requests, Request form, Lyrics editor, Teammate, Chat list, Chat room, Attendance, Plotter, Lineup editor, Profile |

Server side (`web/src/lib/`): `ministryAuth.js` (tokens), `ministryApp.js` (profile,
lineup shape, church date), `ministrySchedule.js` (months, REST days, teammate history),
`ministrySwaps.js`, `ministryLyrics.js`, `ministryChat.js`.
