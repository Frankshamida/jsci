import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { Banner, Card, EmptyState, Icon, LoadingView, Screen } from '../components';
import { font, fonts, makeStyles, radius, space, useTheme } from '../theme';
import { firstName } from '../utils';
import { listTime, refreshChatRooms, refreshChatRoomsIfStale, useChatRooms, type ChatRoomSummary } from '../chat';

// The Chat tab: the group chats you are in, busiest first.
export default function ChatListScreen() {
  const { rooms, error } = useChatRooms();
  const s = useStyles();
  const nav = useAppNav();

  useFocusEffect(useCallback(() => { refreshChatRoomsIfStale(); }, []));

  if (!rooms && !error) return <LoadingView message="Loading your chats…" />;

  return (
    <Screen onRefresh={refreshChatRooms}>
      <Text style={s.title}>Chat</Text>
      <Text style={s.subtitle}>Talk with your ministry teams. Each chat is for the people in that role.</Text>

      {error && <Banner tone={rooms ? 'warn' : 'danger'} text={rooms ? `Showing saved chats. ${error}` : error} />}

      {rooms && rooms.length === 0 && (
        <Card><EmptyState icon="comments" title="No chats yet" text="Your chats appear here once an admin gives you a ministry role." /></Card>
      )}

      {rooms && rooms.length > 0 && (
        <Card style={s.list}>
          {rooms.map((r, i) => (
            <RoomRow key={r.room} room={r} first={i === 0} onPress={() => nav.navigate('ChatRoom', { room: r.room, title: r.title })} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

const RoomRow = React.memo(function RoomRow({ room, first, onPress }: { room: ChatRoomSummary; first: boolean; onPress: () => void }) {
  const { colors: c } = useTheme();
  const { profile } = useSession();
  const s = useStyles();
  const last = room.lastMessage;
  const unread = room.unread > 0;
  const who = last ? (last.senderId === profile?.id ? 'You' : firstName(last.senderName)) : '';
  const preview = !last ? 'No messages yet. Say hello!' : last.deleted ? `${who} removed a message` : `${who}: ${last.body.replace(/\s+/g, ' ')}`;

  return (
    <Card onPress={onPress} style={[s.row, !first && s.divider]}>
      <LinearGradient colors={room.room === 'all' ? c.hero : c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
        <Icon name={room.icon} size={19} color={room.room === 'all' ? c.accent : '#ffffff'} />
      </LinearGradient>
      <View style={s.flex}>
        <View style={s.top}>
          <Text style={[s.name, unread && s.nameUnread]} numberOfLines={1}>{room.title}</Text>
          {last && <Text style={[s.time, unread && s.timeUnread]}>{listTime(last.createdAt)}</Text>}
        </View>
        <View style={s.top}>
          <Text style={[s.preview, unread && s.previewUnread, last?.deleted && s.italic]} numberOfLines={1}>{preview}</Text>
          {unread
            ? <View style={s.badge}><Text style={s.badgeText}>{room.unread > 99 ? '99+' : room.unread}</Text></View>
            : <Text style={s.members}>{room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}</Text>}
        </View>
      </View>
    </Card>
  );
});

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  title: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold, marginTop: space.sm },
  subtitle: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19, marginTop: 2, marginBottom: space.md },
  list: { padding: 0, overflow: 'hidden' },
  // A row is a flat, borderless card inside the list card.
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md,
    marginBottom: 0, borderRadius: 0, borderWidth: 0, backgroundColor: 'transparent', boxShadow: undefined,
  },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  nameUnread: { fontFamily: fonts.bold },
  time: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular },
  timeUnread: { color: c.goldText, fontFamily: fonts.bold },
  preview: { flex: 1, color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, marginTop: 2 },
  previewUnread: { color: c.text, fontFamily: fonts.semibold },
  italic: { fontStyle: 'italic' },
  members: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular },
  badge: { minWidth: 22, height: 22, borderRadius: radius.pill, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger },
  badgeText: { color: '#ffffff', fontSize: 11, fontFamily: fonts.bold },
}));
