// ============================================================
// One group chat. Newest at the bottom, as in any messenger.
//   - checks for new messages every 3 seconds while it is open (and the
//     app is in front), and marks them seen
//   - your messages show at once, then tick: sending (clock), sent (one
//     check), delivered (two checks), seen (two gold checks), and under your
//     latest message, who has seen it
//   - hold a message to copy it, or to unsend one of yours
// ============================================================
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, AppState, BackHandler, FlatList, Keyboard, LayoutAnimation, Linking, Platform,
  Pressable, Text, TextInput, View, type ListRenderItem,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useSession } from '../session';
import type { StackProps } from '../routes';
import { useDialog } from '../dialog';
import { useMiniPlayerInset } from '../player';
import { Avatar, Button, EmptyState, Icon, LoadingView, type IconName } from '../components';
import { font, fonts, makeStyles, radius, space, tint, useTheme } from '../theme';
import { firstName } from '../utils';
import {
  chatApi, clockTime, dayKey, dayLabel, getRoomCache, markRoomRead, newClientId, refreshChatRooms, setRoomCache,
  useChatRooms, type ChatMessage, type ChatReceipt,
} from '../chat';

const POLL_MS = 3000;
const RUN_GAP_MS = 5 * 60 * 1000; // messages closer than this, from one person, read as one run
const OVERLAP_MS = 10 * 1000;     // ask a little before the newest message, so nothing slips between polls
const MAX_LENGTH = 2000;

type LocalState = 'sending' | 'failed';
type Local = ChatMessage & { local?: LocalState };
type Tick = LocalState | 'sent' | 'delivered' | 'seen';

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: Local; mine: boolean; showName: boolean; tail: boolean; tick: Tick | null; seenBy: ChatReceipt[] | null };

// Oldest first; ones still being sent stay at the end whatever the phone's clock says.
const sortMessages = (list: Local[]) =>
  list.sort((a, b) => (a.local ? 1 : 0) - (b.local ? 1 : 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt));

const keyOf = (m: Local) => (m.clientId ? `${m.senderId}:${m.clientId}` : m.id);
const newestSent = (list: Local[]) => { for (let i = list.length - 1; i >= 0; i--) if (!list[i].local) return list[i]; return null; };

export default function ChatRoomScreen({ route, navigation }: StackProps<'ChatRoom'>) {
  const { room, title } = route.params;
  const { profile } = useSession();
  const me = profile?.id || '';
  const { colors: c, scheme } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();
  const playerInset = useMiniPlayerInset();
  const { rooms } = useChatRooms();
  const summary = rooms?.find((r) => r.room === room);

  const cached = getRoomCache(room);
  const [messages, setMessages] = useState<Local[]>(cached?.messages || []);
  const [receipts, setReceipts] = useState<ChatReceipt[]>(cached?.receipts || []);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [memberCount, setMemberCount] = useState(cached?.memberCount ?? summary?.memberCount ?? 0);
  const [loaded, setLoaded] = useState(!!cached);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [menuFor, setMenuFor] = useState<Local | null>(null);
  const [openMeta, setOpenMeta] = useState<string | null>(null); // a tapped message shows its time
  const [toast, setToast] = useState<string | null>(null);

  const listRef = useRef<Local[]>(messages);
  const receiptsRef = useRef<ChatReceipt[]>(receipts);
  const receiptsJson = useRef(JSON.stringify(receipts));
  const serverTime = useRef<string | null>(cached?.serverTime || null);
  const hasMoreRef = useRef(hasMore);
  const memberCountRef = useRef(memberCount);
  const loadedRef = useRef(loaded);
  const mounted = useRef(true);
  const polling = useRef(false);
  const boxRef = useRef<View>(null);
  const keyboard = useKeyboardOverlap(boxRef);

  useEffect(() => () => { mounted.current = false; }, []);

  // Every change goes through here: the screen, the refs the poller reads, and the cache.
  const save = useCallback((next: Local[] | null, extra?: { receipts?: ChatReceipt[]; hasMore?: boolean; memberCount?: number }) => {
    if (next) { listRef.current = next; setMessages(next); }
    if (extra?.receipts) { receiptsRef.current = extra.receipts; setReceipts(extra.receipts); }
    if (extra?.hasMore !== undefined) { hasMoreRef.current = extra.hasMore; setHasMore(extra.hasMore); }
    if (extra?.memberCount !== undefined && extra.memberCount !== memberCountRef.current) {
      memberCountRef.current = extra.memberCount;
      setMemberCount(extra.memberCount);
    }
    setRoomCache(room, {
      messages: listRef.current.filter((m) => !m.local),
      receipts: receiptsRef.current,
      hasMore: hasMoreRef.current,
      serverTime: serverTime.current,
      memberCount: memberCountRef.current,
    });
  }, [room]);

  // New or changed messages into the list. null when nothing changed (no re-render).
  const merge = useCallback((current: Local[], incoming: ChatMessage[], deletedIds: string[] = []): Local[] | null => {
    let changed = false;
    const byKey = new Map(current.map((m) => [keyOf(m), m]));
    for (const m of incoming) {
      const k = keyOf(m);
      const old = byKey.get(k);
      if (!old || old.local || old.id !== m.id || old.deleted !== m.deleted || old.body !== m.body || old.senderPicture !== m.senderPicture || old.senderName !== m.senderName) {
        byKey.set(k, m);
        changed = true;
      }
    }
    if (deletedIds.length) {
      const gone = new Set(deletedIds);
      byKey.forEach((m, k) => { if (gone.has(m.id) && !m.deleted) { byKey.set(k, { ...m, deleted: true, body: '' }); changed = true; } });
    }
    return changed ? sortMessages([...byKey.values()]) : null;
  }, []);

  const takeReceipts = (next: ChatReceipt[]) => {
    const json = JSON.stringify(next);
    if (json === receiptsJson.current) return undefined;
    receiptsJson.current = json;
    return next;
  };

  // The newest page, replacing what is shown (first open, or after a long time away).
  const loadLatest = useCallback(async () => {
    const res = await chatApi.messages(room, { read: true });
    if (!mounted.current) return;
    if (!res.ok) { setLoadError(res.message); return; }
    serverTime.current = res.data.serverTime;
    const pending = listRef.current.filter((m) => m.local);
    const next = merge(pending, res.data.messages) || sortMessages([...pending]);
    save(next, { receipts: takeReceipts(res.data.receipts) || receiptsRef.current, hasMore: res.data.hasMore, memberCount: res.data.memberCount });
    loadedRef.current = true;
    setLoaded(true);
    setLoadError(null);
    markRoomRead(room, newestSent(next) || undefined);
  }, [room, merge, save]);

  // The 3-second check: anything newer, anything unsent, who has seen what.
  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const newest = newestSent(listRef.current);
      if (!newest) { await loadLatest(); return; }
      const res = await chatApi.messages(room, {
        after: new Date(Date.parse(newest.createdAt) - OVERLAP_MS).toISOString(),
        read: true,
        deletedSince: serverTime.current ? new Date(Date.parse(serverTime.current) - 5000).toISOString() : undefined,
        limit: 100,
      });
      if (!mounted.current) return;
      if (!res.ok) { setLoadError(res.message); return; }
      serverTime.current = res.data.serverTime;
      if (res.data.hasMore) { await loadLatest(); return; } // away a long time: start from the newest page
      const next = merge(listRef.current, res.data.messages, res.data.deletedIds);
      const nextReceipts = takeReceipts(res.data.receipts);
      if (next || nextReceipts || res.data.memberCount !== memberCountRef.current) {
        save(next, { receipts: nextReceipts, memberCount: res.data.memberCount });
      }
      if (next) markRoomRead(room, newestSent(next) || undefined);
      setLoadError(null);
    } finally {
      polling.current = false;
    }
  }, [room, merge, save, loadLatest]);

  // While open and in front: poll, one loop at a time. Leaving brings the
  // tab badge up to date.
  useFocusEffect(useCallback(() => {
    let focused = true;
    let chain = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const halt = () => { chain++; if (timer) clearTimeout(timer); timer = null; };
    const start = () => {
      halt();
      const id = chain;
      const tick = async () => {
        await poll();
        if (focused && id === chain && AppState.currentState === 'active') timer = setTimeout(tick, POLL_MS);
      };
      tick();
    };
    markRoomRead(room);
    start();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : halt()));
    return () => {
      focused = false;
      halt();
      sub.remove();
      refreshChatRooms();
    };
  }, [room, poll]));

  // Scrolled to the top: the page before.
  const loadOlder = useCallback(async () => {
    if (!hasMoreRef.current || loadingOlder) return;
    const oldest = listRef.current.find((m) => !m.local);
    if (!oldest) return;
    setLoadingOlder(true);
    const res = await chatApi.messages(room, { before: oldest.createdAt });
    if (!mounted.current) return;
    setLoadingOlder(false);
    if (res.ok) save(merge(listRef.current, res.data.messages), { hasMore: res.data.hasMore });
  }, [room, loadingOlder, merge, save]);

  // ---- Sending ----

  const send = useCallback(async (body: string, clientId = newClientId()) => {
    const clean = body.trim();
    if (!clean || !profile) return;
    const draft: Local = {
      id: `local-${clientId}`, room, body: clean, deleted: false, senderId: me, senderName: profile.fullName,
      senderPicture: profile.profilePicture, createdAt: new Date().toISOString(), clientId, local: 'sending',
    };
    save(sortMessages([...listRef.current.filter((m) => keyOf(m) !== keyOf(draft)), draft]));
    const res = await chatApi.send(room, clean, clientId);
    if (!mounted.current) return;
    if (res.ok) {
      save(merge(listRef.current, [res.data]));
      markRoomRead(room, res.data);
    } else {
      save(listRef.current.map((m) => (keyOf(m) === keyOf(draft) ? { ...m, local: 'failed' as const } : m)));
      if (/too fast|wait/i.test(res.message)) setToast(res.message);
    }
  }, [room, me, profile, save, merge]);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    send(body);
  };

  const retry = useCallback((m: Local) => { if (m.local === 'failed' && m.clientId) send(m.body, m.clientId); }, [send]);

  const unsend = useCallback(async (m: Local) => {
    const ok = await dialog.confirm({
      icon: 'trash-can', tone: 'danger', title: 'Unsend this message?',
      message: 'It will be removed for everyone in this chat.', confirmText: 'Unsend', cancelText: 'Keep it',
    });
    if (!ok) return;
    const before = listRef.current;
    save(before.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x)));
    const res = await chatApi.unsend(m.id);
    if (!res.ok && mounted.current) {
      save(listRef.current.map((x) => (x.id === m.id ? m : x)));
      dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Could not unsend', message: res.message });
    }
  }, [dialog, save]);

  const copy = useCallback(async (m: Local) => {
    await Clipboard.setStringAsync(m.body).catch(() => {});
    setToast('Copied');
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Header ----

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View>
          <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
          {memberCount > 0 && <Text style={s.headerSub}>{memberCount} {memberCount === 1 ? 'member' : 'members'}</Text>}
        </View>
      ),
    });
  }, [navigation, title, memberCount, s]);

  // ---- Rows: messages with day lines, in runs ----

  const rowCache = useRef(new Map<string, Row>());
  const rows = useMemo<Row[]>(() => {
    let maxRead = 0;
    let maxDelivered = 0;
    receipts.forEach((r) => {
      if (r.readAt) maxRead = Math.max(maxRead, Date.parse(r.readAt));
      if (r.deliveredAt) maxDelivered = Math.max(maxDelivered, Date.parse(r.deliveredAt));
    });
    const tickFor = (m: Local): Tick => {
      if (m.local) return m.local;
      const t = Date.parse(m.createdAt);
      if (t <= maxRead) return 'seen';
      if (t <= maxDelivered) return 'delivered';
      return 'sent';
    };
    let myLatest: Local | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.senderId === me && !m.local && !m.deleted) { myLatest = m; break; }
    }

    const out: Row[] = [];
    const nextCache = new Map<string, Row>();
    const sameSeen = (a: ChatReceipt[] | null, b: ChatReceipt[] | null) =>
      a === b || (!!a && !!b && a.length === b.length && a.every((r, i) => r.userId === b[i].userId && r.picture === b[i].picture));
    const breaks = (a: Local, b: Local) => a.senderId !== b.senderId || dayKey(a.createdAt) !== dayKey(b.createdAt)
      || Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) > RUN_GAP_MS;
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      if (!prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)) {
        out.push({ kind: 'day', key: `day-${dayKey(m.createdAt)}`, label: dayLabel(m.createdAt) });
      }
      const mine = m.senderId === me;
      const seenBy = myLatest && m.id === myLatest.id
        ? receipts.filter((r) => r.readAt && Date.parse(r.readAt) >= Date.parse(m.createdAt))
        : null;
      const row: Row = {
        kind: 'msg', key: keyOf(m), msg: m, mine,
        showName: !mine && (!prev || breaks(prev, m)),
        tail: !next || breaks(m, next),
        tick: mine ? tickFor(m) : null,
        seenBy,
      };
      const old = rowCache.current.get(row.key);
      const keep = old && old.kind === 'msg' && old.msg === row.msg && old.showName === row.showName && old.tail === row.tail
        && old.tick === row.tick && sameSeen(old.seenBy, row.seenBy);
      const use = keep ? old! : row;
      nextCache.set(row.key, use);
      out.push(use);
    });
    rowCache.current = nextCache;
    return out.reverse(); // the list is upside down: newest first
  }, [messages, receipts, me]);

  const onLongPress = useCallback((m: Local) => { Keyboard.dismiss(); setMenuFor(m); }, []);
  const onPress = useCallback((m: Local) => {
    if (m.local === 'failed') { retry(m); return; }
    setOpenMeta((id) => (id === m.id ? null : m.id));
  }, [retry]);
  const onSeenPress = useCallback((people: ChatReceipt[]) => {
    dialog.alert({ icon: 'eye', title: 'Seen by', message: people.map((p) => p.name).join('\n'), confirmText: 'Close' });
  }, [dialog]);

  const renderItem = useCallback<ListRenderItem<Row>>(({ item }) => {
    if (item.kind === 'day') return <DayLine label={item.label} />;
    return (
      <MessageRow
        row={item}
        showMeta={item.tail || !!item.msg.local || openMeta === item.msg.id}
        onPress={onPress}
        onLongPress={onLongPress}
        onSeenPress={onSeenPress}
      />
    );
  }, [openMeta, onPress, onLongPress, onSeenPress]);

  const menuOptions = useMemo(() => {
    if (!menuFor) return [];
    const m = menuFor;
    const options: { label: string; icon: IconName; danger?: boolean; run: () => void }[] = [];
    if (m.local === 'failed') options.push({ label: 'Send again', icon: 'rotate-right', run: () => retry(m) });
    if (!m.deleted && m.body) options.push({ label: 'Copy text', icon: 'copy', run: () => copy(m) });
    if (m.local === 'failed') {
      options.push({ label: 'Delete', icon: 'trash-can', danger: true, run: () => save(listRef.current.filter((x) => keyOf(x) !== keyOf(m))) });
    } else if (m.senderId === me && !m.deleted && !m.local) {
      options.push({ label: 'Unsend', icon: 'trash-can', danger: true, run: () => unsend(m) });
    }
    return options;
  }, [menuFor, me, retry, copy, unsend, save]);

  const bottomPad = keyboard.open ? keyboard.overlap + space.sm : insets.bottom + playerInset + space.sm;
  const canSend = text.trim().length > 0;

  return (
    <View ref={boxRef} style={s.screen} collapsable={false}>
      {!loaded ? (
        loadError ? (
          <View style={s.center}>
            <EmptyState icon="wifi" title="Could not open this chat" text={loadError} />
            <Button title="Try again" icon="rotate-right" onPress={() => { setLoadError(null); loadLatest(); }} />
          </View>
        ) : <LoadingView message="Loading messages…" />
      ) : messages.length === 0 ? (
        <View style={s.center}>
          <EmptyState icon="comments" title={`Say hello to ${title}`} text="Messages here are seen by everyone in this chat." />
        </View>
      ) : (
        <FlatList
          data={rows}
          inverted
          renderItem={renderItem}
          keyExtractor={(r) => r.key}
          contentContainerStyle={s.listContent}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          ListFooterComponent={(
            <View style={s.top}>
              {loadingOlder ? <ActivityIndicator color={c.secondary} />
                : !hasMore ? <Text style={s.topText}>This is the start of {title}.</Text> : null}
            </View>
          )}
        />
      )}

      {loaded && loadError && <View style={s.offline}><Icon name="wifi" size={11} color={c.warning} /><Text style={s.offlineText}>Reconnecting…</Text></View>}

      <View style={[s.composer, { paddingBottom: bottomPad }]}>
        <View style={s.inputBox}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Message ${title}`}
            placeholderTextColor={c.textMuted}
            keyboardAppearance={scheme}
            selectionColor={c.secondary}
            cursorColor={c.secondary}
            multiline
            maxLength={MAX_LENGTH}
            style={s.input}
            accessibilityLabel="Message"
          />
        </View>
        <Pressable
          onPress={submit}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={({ pressed }) => [s.sendWrap, !canSend && s.sendOff, pressed && s.pressed]}
        >
          <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.send}>
            <Icon name="paper-plane" size={17} color="#ffffff" />
          </LinearGradient>
        </Pressable>
      </View>

      {toast && <View style={s.toast} pointerEvents="none"><Text style={s.toastText}>{toast}</Text></View>}
      {menuFor && <ActionSheet options={menuOptions} onClose={() => setMenuFor(null)} bottom={insets.bottom} />}
    </View>
  );
}

// ---- Pieces ----

function DayLine({ label }: { label: string }) {
  const s = useStyles();
  return (
    <View style={s.day}>
      <Text style={s.dayText}>{label}</Text>
    </View>
  );
}

// Text with its http(s) links tappable.
function Linked({ text, style, linkStyle }: { text: string; style: object; linkStyle: object }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <Text style={style}>
      {parts.map((p, i) => (/^https?:\/\//.test(p)
        ? <Text key={i} style={linkStyle} onPress={() => Linking.openURL(p).catch(() => {})}>{p}</Text>
        : p))}
    </Text>
  );
}

function Ticks({ tick }: { tick: Tick }) {
  const { colors: c } = useTheme();
  if (tick === 'sending') return <Icon name="clock" regular size={10} color={c.textMuted} />;
  if (tick === 'failed') return <Icon name="circle-exclamation" size={11} color={c.danger} />;
  if (tick === 'sent') return <Icon name="check" size={10} color={c.textMuted} />;
  const color = tick === 'seen' ? c.goldText : c.textMuted;
  return (
    <View style={{ flexDirection: 'row' }}>
      <Icon name="check" size={10} color={color} />
      <Icon name="check" size={10} color={color} style={{ marginLeft: -5 }} />
    </View>
  );
}

const TICK_LABEL: Record<Tick, string> = { sending: 'Sending…', failed: 'Not sent · Tap to retry', sent: 'Sent', delivered: 'Delivered', seen: 'Seen' };

const MessageRow = React.memo(function MessageRow({ row, showMeta, onPress, onLongPress, onSeenPress }: {
  row: Extract<Row, { kind: 'msg' }>;
  showMeta: boolean;
  onPress: (m: Local) => void;
  onLongPress: (m: Local) => void;
  onSeenPress: (people: ChatReceipt[]) => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const { msg, mine, showName, tail, tick, seenBy } = row;
  const failed = msg.local === 'failed';
  const press = () => onPress(msg);
  const hold = () => onLongPress(msg);

  const bubbleShape = [s.bubble, mine ? s.bubbleMine : s.bubbleTheirs, tail && (mine ? s.tailMine : s.tailTheirs)];
  const content = msg.deleted ? (
    <View style={[s.removed, mine ? s.removedMine : null]}>
      <Icon name="ban" size={11} color={c.textMuted} />
      <Text style={s.removedText}>{mine ? 'You unsent a message' : 'Message removed'}</Text>
    </View>
  ) : mine ? (
    <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[bubbleShape, failed && s.failedBubble]}>
      <Linked text={msg.body} style={s.textMine} linkStyle={s.linkMine} />
    </LinearGradient>
  ) : (
    <View style={bubbleShape}>
      <Linked text={msg.body} style={s.textTheirs} linkStyle={s.linkTheirs} />
    </View>
  );

  return (
    <View style={[s.row, mine ? s.rowMine : s.rowTheirs, tail ? s.rowTail : s.rowRun]}>
      {!mine && (
        <View style={[s.avatarSlot, showMeta && s.avatarAboveMeta]}>
          {tail ? <Avatar name={msg.senderName} picture={msg.senderPicture} size={30} /> : null}
        </View>
      )}
      <View style={[s.column, mine ? s.columnMine : s.columnTheirs]}>
        {showName && <Text style={s.name} numberOfLines={1}>{msg.senderName}</Text>}
        <Pressable onPress={press} onLongPress={hold} delayLongPress={350} accessibilityRole="text"
          accessibilityHint="Hold for options" style={({ pressed }) => pressed && s.pressedBubble}>
          {content}
        </Pressable>
        {showMeta && (
          <Pressable onPress={failed ? press : undefined} disabled={!failed} style={[s.meta, mine && s.metaMine]}>
            <Text style={[s.metaText, failed && s.metaFailed]}>
              {failed ? TICK_LABEL.failed : `${clockTime(msg.createdAt)}${mine && tick && tick !== 'sending' ? ` · ${TICK_LABEL[tick]}` : ''}`}
            </Text>
            {mine && tick && <Ticks tick={tick} />}
          </Pressable>
        )}
        {seenBy && seenBy.length > 0 && (
          <Pressable onPress={() => onSeenPress(seenBy)} style={s.seen} accessibilityRole="button" accessibilityLabel={`Seen by ${seenBy.length}`}>
            <Text style={s.seenText}>
              Seen by {seenBy.length <= 2 ? seenBy.map((p) => firstName(p.name)).join(' & ') : seenBy.length}
            </Text>
            <View style={s.seenFaces}>
              {seenBy.slice(0, 5).map((p, i) => (
                <View key={p.userId} style={[s.seenFace, i > 0 && s.seenFaceOverlap]}>
                  <Avatar name={p.name} picture={p.picture} size={18} />
                </View>
              ))}
              {seenBy.length > 5 && <Text style={s.seenMore}>+{seenBy.length - 5}</Text>}
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
});

// Hold-a-message menu, drawn over the chat. The phone's Back button closes it.
function ActionSheet({ options, onClose, bottom }: {
  options: { label: string; icon: IconName; danger?: boolean; run: () => void }[]; onClose: () => void; bottom: number;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => back.remove();
  }, [fade, onClose]);

  const lift = fade.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  return (
    <Animated.View style={[s.sheetBack, { opacity: fade }]}>
      <Pressable style={s.flex} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View style={[s.sheet, { paddingBottom: bottom + space.md, transform: [{ translateY: lift }] }]}>
        {options.map((o) => (
          <Pressable key={o.label} onPress={() => { onClose(); o.run(); }} style={({ pressed }) => [s.sheetRow, pressed && s.sheetPressed]} accessibilityRole="button">
            <Icon name={o.icon} size={16} color={o.danger ? c.danger : c.goldText} />
            <Text style={[s.sheetText, o.danger && { color: c.danger }]}>{o.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={onClose} style={({ pressed }) => [s.sheetRow, s.sheetCancel, pressed && s.sheetPressed]} accessibilityRole="button">
          <Text style={[s.sheetText, s.sheetCancelText]}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// How much of this screen the keyboard covers. Android draws edge to edge, so
// its window does not shrink for the keyboard: the cover is measured, as in
// src/keyboard.tsx. iOS moves with the keyboard's own animation.
function useKeyboardOverlap(boxRef: React.RefObject<View | null>) {
  const [state, setState] = useState({ open: false, overlap: 0 });
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const animate = (duration?: number) => {
      if (ios) LayoutAnimation.configureNext({ duration: duration || 250, update: { type: LayoutAnimation.Types.keyboard } });
    };
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const top = e.endCoordinates.screenY;
      boxRef.current?.measureInWindow((_x, y, _w, h) => {
        animate(e.duration);
        setState({ open: true, overlap: Math.max(0, y + h - top) });
      });
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      animate(e?.duration);
      setState({ open: false, overlap: 0 });
    });
    return () => { show.remove(); hide.remove(); };
  }, [boxRef]);
  return state;
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', padding: space.xl },
  pressed: { opacity: 0.85 },

  headerTitle: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  headerSub: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.medium, marginTop: -1 },

  listContent: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  top: { alignItems: 'center', paddingVertical: space.lg },
  topText: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.medium },

  day: { alignItems: 'center', marginVertical: space.md },
  dayText: {
    color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.semibold, paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: radius.pill, backgroundColor: c.scheme === 'light' ? '#eceef1' : c.card, overflow: 'hidden',
  },

  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  rowRun: { marginBottom: 2 },
  rowTail: { marginBottom: space.md },
  avatarSlot: { width: 30 },
  avatarAboveMeta: { marginBottom: 18 },
  column: { maxWidth: '78%' },
  columnMine: { alignItems: 'flex-end' },
  columnTheirs: { alignItems: 'flex-start' },
  name: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, marginBottom: 3, marginLeft: 4 },

  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 },
  bubbleMine: {},
  bubbleTheirs: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.scheme === 'light' ? '#eceef1' : c.border,
    boxShadow: c.scheme === 'light' ? '0px 1px 4px rgba(0, 0, 0, 0.05)' : undefined,
  },
  tailMine: { borderBottomRightRadius: 5 },
  tailTheirs: { borderBottomLeftRadius: 5 },
  failedBubble: { opacity: 0.6 },
  pressedBubble: { opacity: 0.8 },
  textMine: { color: '#ffffff', fontSize: font.md, fontFamily: fonts.regular, lineHeight: 21 },
  textTheirs: { color: c.text, fontSize: font.md, fontFamily: fonts.regular, lineHeight: 21 },
  linkMine: { color: '#ffffff', textDecorationLine: 'underline', fontFamily: fonts.semibold },
  linkTheirs: { color: c.info, textDecorationLine: 'underline', fontFamily: fonts.semibold },

  removed: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill,
    borderWidth: 1, borderStyle: 'dashed', borderColor: c.borderStrong,
  },
  removedMine: {},
  removedText: { color: c.textMuted, fontSize: font.sm, fontFamily: fonts.regular, fontStyle: 'italic' },

  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, marginHorizontal: 4 },
  metaMine: { justifyContent: 'flex-end' },
  metaText: { color: c.textMuted, fontSize: 10.5, fontFamily: fonts.medium },
  metaFailed: { color: c.danger, fontFamily: fonts.semibold },

  seen: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginRight: 2 },
  seenText: { color: c.textSecondary, fontSize: 10.5, fontFamily: fonts.medium },
  seenFaces: { flexDirection: 'row', alignItems: 'center' },
  seenFace: { borderRadius: 10, borderWidth: 1.5, borderColor: c.background },
  seenFaceOverlap: { marginLeft: -6 },
  seenMore: { color: c.textSecondary, fontSize: 10, fontFamily: fonts.bold, marginLeft: 4 },

  offline: {
    position: 'absolute', top: space.sm, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: tint(c.warning, 0.4),
  },
  offlineText: { color: c.warning, fontSize: font.xs, fontFamily: fonts.semibold },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm,
    backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border,
  },
  inputBox: { flex: 1, backgroundColor: c.input, borderRadius: 22, borderWidth: 1, borderColor: c.border, paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center' },
  input: { color: c.text, fontSize: font.md, fontFamily: fonts.regular, maxHeight: 118, paddingTop: Platform.OS === 'ios' ? 12 : 9, paddingBottom: Platform.OS === 'ios' ? 12 : 9, textAlignVertical: 'center' },
  sendWrap: { borderRadius: 22, overflow: 'hidden' },
  sendOff: { opacity: 0.4 },
  send: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', paddingRight: 2 },

  toast: {
    position: 'absolute', top: space.lg, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: c.scheme === 'light' ? '#1a1a2e' : '#e0e0e0',
  },
  toastText: { color: c.scheme === 'light' ? '#ffffff' : '#1a1a2e', fontSize: font.sm, fontFamily: fonts.semibold },

  sheetBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: {
    backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.sm, paddingHorizontal: space.md,
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 15, paddingHorizontal: space.md, borderRadius: radius.md },
  sheetPressed: { backgroundColor: c.goldMuted },
  sheetText: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  sheetCancel: { justifyContent: 'center', marginTop: space.xs, borderTopWidth: 1, borderTopColor: c.border, borderRadius: 0 },
  sheetCancelText: { color: c.textSecondary, textAlign: 'center', flex: 1 },
}));
