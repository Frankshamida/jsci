// A web page shown inside a card (the church's Street View), in the web app:
// a plain frame. See embed.tsx for the phone app.
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export function EmbedFrame({ src, background, onLoaded, style }: {
  src: string; background: string; onLoaded: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {React.createElement('iframe', {
        src,
        title: 'Church street view',
        allowFullScreen: true,
        loading: 'eager',
        referrerPolicy: 'strict-origin-when-cross-origin',
        onLoad: onLoaded,
        style: { border: 0, width: '100%', height: '100%', display: 'block', background },
      })}
    </View>
  );
}
