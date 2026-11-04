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

## How it stays light

- **One request on open:** `/api/ministry/home` sends the profile, lineups, excuses,
  substitutes and attendance together.
- **Cached on the phone:** the app fetches the dashboard again only when it is over
  5 minutes old, on pull-to-refresh, or after you change something. There is no polling.
- **Small recordings:** practice audio is recorded as mono AAC at 48 kbps (~360 KB per
  minute), with a 10-minute cap so it fits the upload limit.
- **YouTube previews:** the thumbnails are plain image links (`i.ytimg.com`), not the
  YouTube API.
- **Smaller app:** only the Ionicons font is bundled, and release builds are minified
  and shrunk.

## Layout

| Path | What |
| --- | --- |
| `src/session.tsx` | Sign-in, the cached dashboard, the fingerprint lock |
| `src/api.ts` | All server calls |
| `src/recordings.ts` | Practice recordings, cached per lineup |
| `src/screens/` | Login, Lock, Home, Lineup, Song Editor, Recorder, Requests, Request form, Attendance, Profile |
