// A web page shown inside a card (the church's Street View), in the phone app:
// a web view. Links out of it open in the phone's browser / Maps app, not in
// the little box. The web app uses embed.web.tsx (a plain frame).
import React, { useMemo } from 'react';
import { Linking, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { SITE_URL } from './config';

export function EmbedFrame({ src, background, onLoaded, style }: {
  src: string; background: string; onLoaded: () => void; style?: StyleProp<ViewStyle>;
}) {
  const html = useMemo(() => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${background}}iframe{display:block;border:0;width:100%;height:100%}</style>
</head><body>
<iframe src="${src}" allowfullscreen loading="eager" referrerpolicy="strict-origin-when-cross-origin"
  onload="window.ReactNativeWebView && window.ReactNativeWebView.postMessage('loaded')"></iframe>
</body></html>`, [src, background]);
  const origin = src.split('/').slice(0, 3).join('/');

  return (
    <WebView
      source={{ html, baseUrl: SITE_URL }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      nestedScrollEnabled
      scrollEnabled={false}
      setSupportMultipleWindows={false}
      onMessage={(e) => { if (e.nativeEvent.data === 'loaded') onLoaded(); }}
      onShouldStartLoadWithRequest={(req) => {
        const url = req.url || '';
        if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith(SITE_URL) || url.startsWith(origin)) return true;
        if (req.isTopFrame === false) return true;
        Linking.openURL(url).catch(() => {});
        return false;
      }}
      style={style}
    />
  );
}
