'use client';

// Spotify's iFrame API (developer.spotify.com/documentation/embeds): Spotify's
// own embedded player, which a page can load songs into, play, pause and seek,
// and which reports what it is doing. Spotify songs only ever play through it.
// The script is loaded once, the first time a Spotify song is played.

let apiPromise = null;

export function loadSpotifyIframeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const before = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => { before?.(api); resolve(api); };
    const script = document.createElement('script');
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.async = true;
    script.onerror = () => { apiPromise = null; reject(new Error('Could not load the Spotify player.')); };
    document.body.appendChild(script);
  });
  return apiPromise;
}

export const spotifyUri = (spotifyId) => `spotify:track:${spotifyId}`;
