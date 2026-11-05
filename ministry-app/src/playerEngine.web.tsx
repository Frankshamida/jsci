// The song player's video, in the web app: a frame showing the website's
// player page (same site, so the app talks to it directly). Browsers on
// iPhone only start sound after a tap, so YouTube's own controls show and a
// tap on the video always works.
import React, { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

export interface EngineHandle { send: (cmd: object) => void }

type Frame = { contentWindow?: { cmd?: (c: object) => void; postMessage: (m: unknown, o: string) => void } | null };

export function PlayerEngine({ uri, onMessage, handleRef, style }: {
  uri: string;
  onMessage: (data: string) => void;
  handleRef: React.MutableRefObject<EngineHandle | null>;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = useRef<Frame | null>(null);
  const listener = useRef(onMessage);
  listener.current = onMessage;

  useEffect(() => {
    const win = globalThis as unknown as {
      addEventListener: (t: string, f: (e: { source: unknown; data: unknown }) => void) => void;
      removeEventListener: (t: string, f: (e: { source: unknown; data: unknown }) => void) => void;
    };
    const onWindowMessage = (e: { source: unknown; data: unknown }) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      if (typeof e.data === 'string') listener.current(e.data);
    };
    win.addEventListener('message', onWindowMessage);
    handleRef.current = {
      send: (cmd) => {
        const w = frame.current?.contentWindow;
        if (!w) return;
        if (typeof w.cmd === 'function') w.cmd(cmd); // same site: call it directly (keeps the tap)
        else w.postMessage(JSON.stringify({ jsciCmd: cmd }), '*');
      },
    };
    return () => { win.removeEventListener('message', onWindowMessage); handleRef.current = null; };
  }, [handleRef]);

  const src = `${uri}${uri.includes('?') ? '&' : '?'}controls=1`;
  return (
    <View style={style}>
      {React.createElement('iframe', {
        ref: (el: Frame | null) => { frame.current = el; },
        src,
        title: 'Song player',
        allow: 'autoplay; encrypted-media; picture-in-picture',
        style: { border: 0, width: '100%', height: '100%', display: 'block', background: '#000' },
      })}
    </View>
  );
}

export const ENGINE_NEEDS_TAP = true;
