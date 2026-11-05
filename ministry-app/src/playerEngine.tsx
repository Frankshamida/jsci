// The song player's video, in the phone app: a web view showing the website's
// player page (web/public/ministry-player.html). The web app uses
// playerEngine.web.tsx instead (a plain frame).
import React, { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

export interface EngineHandle { send: (cmd: object) => void }

export function PlayerEngine({ uri, onMessage, handleRef, style }: {
  uri: string;
  onMessage: (data: string) => void;
  handleRef: React.MutableRefObject<EngineHandle | null>;
  style?: StyleProp<ViewStyle>;
}) {
  const webRef = useRef<WebView>(null);
  useEffect(() => {
    handleRef.current = {
      send: (cmd) => webRef.current?.injectJavaScript(`window.cmd && window.cmd(${JSON.stringify(cmd)}); true;`),
    };
    return () => { handleRef.current = null; };
  }, [handleRef]);
  return (
    <WebView
      ref={webRef}
      source={{ uri }}
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo={false}
      setSupportMultipleWindows={false}
      scrollEnabled={false}
      bounces={false}
      style={style}
      containerStyle={style}
    />
  );
}

// The phone app starts songs by itself; a browser may need a tap on the video.
export const ENGINE_NEEDS_TAP = false;
