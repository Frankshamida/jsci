// ============================================
// JSCI Mobile — Messages Screen
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card, EmptyState, Button } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { Message } from '../../types';
import Toast from 'react-native-toast-message';

export default function MessagesScreen() {
  const { user, isFeatureEnabled } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');

  // Compose
  const [showCompose, setShowCompose] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await api.getMessages(user.id, tab);
      if (res.success) setMessages(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, tab]);

  useEffect(() => { setLoading(true); loadMessages(); }, [loadMessages]);

  const onRefresh = () => { setRefreshing(true); loadMessages(); };

  const handleSend = async () => {
    if (!body.trim() || !recipient.trim() || !user) return;
    setSending(true);
    try {
      const res = await api.sendMessage(user.id, recipient.trim(), subject.trim(), body.trim());
      if (res.success) {
        setShowCompose(false);
        setRecipient(''); setSubject(''); setBody('');
        Toast.show({ type: 'success', text1: 'Sent!', text2: 'Message delivered.' });
        if (tab === 'sent') loadMessages();
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: res.message });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setSending(false);
    }
  };

  const handleMarkRead = async (msgId: string) => {
    if (!user?.id) return;
    try {
      await api.markMessageRead(msgId);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_read: true } : m));
    } catch (e) { /* silent */ }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <TouchableOpacity onPress={() => !item.is_read && tab === 'inbox' && handleMarkRead(item.id)} activeOpacity={0.7}>
      <Card style={[styles.msgCard, !item.is_read && tab === 'inbox' && styles.unreadCard]}>
        <View style={styles.msgRow}>
          {/* Unread Dot */}
          {!item.is_read && tab === 'inbox' && <View style={styles.unreadDot} />}

          <View style={styles.msgContent}>
            <View style={styles.msgHeader}>
              <Text style={[styles.msgName, !item.is_read && tab === 'inbox' && styles.unreadText]} numberOfLines={1}>
                {tab === 'inbox' ? item.sender_name : item.recipient_name}
              </Text>
              <Text style={styles.msgTime}>{formatTime(item.created_at)}</Text>
            </View>
            {item.subject && <Text style={styles.msgSubject} numberOfLines={1}>{item.subject}</Text>}
            <Text style={styles.msgPreview} numberOfLines={2}>{item.content}</Text>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['inbox', 'sent'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Ionicons name={t === 'inbox' ? 'mail-outline' : 'send-outline'} size={18} color={tab === t ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'inbox' ? 'Inbox' : 'Sent'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        ListEmptyComponent={loading ? null : <EmptyState icon={tab === 'inbox' ? 'mail-open-outline' : 'paper-plane-outline'} title={tab === 'inbox' ? 'No Messages' : 'No Sent Messages'} message={tab === 'inbox' ? 'Your inbox is empty.' : "You haven't sent any messages yet."} />}
      />

      {/* Compose FAB */}
      {isFeatureEnabled('messages.send') && (
        <TouchableOpacity style={styles.fab} onPress={() => setShowCompose(true)} activeOpacity={0.8}>
          <Ionicons name="create-outline" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Compose Modal */}
      <Modal visible={showCompose} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Message</Text>
              <TouchableOpacity onPress={() => setShowCompose(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="To (email or name)"
              placeholderTextColor={Colors.textMuted}
              value={recipient}
              onChangeText={setRecipient}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Subject (optional)"
              placeholderTextColor={Colors.textMuted}
              value={subject}
              onChangeText={setSubject}
            />
            <TextInput
              style={[styles.input, styles.bodyInput]}
              placeholder="Write your message..."
              placeholderTextColor={Colors.textMuted}
              value={body}
              onChangeText={setBody}
              multiline
              textAlignVertical="top"
            />

            <Button title={sending ? 'Sending...' : 'Send Message'} onPress={handleSend} disabled={!body.trim() || !recipient.trim() || sending} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  tabRow: {
    flexDirection: 'row', marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    padding: Spacing.xs, gap: Spacing.xs,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, gap: Spacing.xs,
  },
  tabActive: { backgroundColor: Colors.primaryMuted },
  tabText: { color: Colors.textMuted, fontWeight: '600', fontSize: FontSize.sm },
  tabTextActive: { color: Colors.primary },

  list: { padding: Spacing.lg, gap: Spacing.sm },

  msgCard: { padding: Spacing.md },
  unreadCard: { borderLeftWidth: 3, borderLeftColor: Colors.primary },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start' },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.primary, marginTop: 8, marginRight: Spacing.sm,
  },
  msgContent: { flex: 1 },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  msgName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '500', flex: 1, marginRight: Spacing.sm },
  unreadText: { fontWeight: '700' },
  msgTime: { color: Colors.textMuted, fontSize: FontSize.xs },
  msgSubject: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '600', marginBottom: 4 },
  msgPreview: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 20 },

  // FAB
  fab: {
    position: 'absolute', bottom: Spacing.xl, right: Spacing.xl,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    elevation: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    maxHeight: '80%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  modalTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: '700' },
  input: {
    backgroundColor: Colors.inputBg,
    color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.inputBorder,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    fontSize: FontSize.md, marginBottom: Spacing.md,
  },
  bodyInput: { minHeight: 120, maxHeight: 200 },
});
