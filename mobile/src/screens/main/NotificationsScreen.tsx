// ============================================
// JSCI Mobile — Notifications Screen
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card, EmptyState, Button } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { Notification } from '../../types';
import Toast from 'react-native-toast-message';

export default function NotificationsScreen() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await api.getNotifications(user.id);
      if (res.success) setNotifications(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const onRefresh = () => { setRefreshing(true); loadNotifications(); };

  const getIcon = (type: string): { name: string; color: string } => {
    switch (type) {
      case 'event': return { name: 'calendar', color: Colors.primary };
      case 'message': return { name: 'mail', color: Colors.info };
      case 'announcement': return { name: 'megaphone', color: Colors.warning };
      case 'community': return { name: 'people', color: Colors.success };
      case 'schedule': return { name: 'time', color: '#a78bfa' };
      default: return { name: 'notifications', color: Colors.textMuted };
    }
  };

  const handleMarkRead = async (id: string) => {
    if (!user?.id) return;
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (e) { /* silent */ }
  };

  const handleMarkAllRead = async () => {
    if (!user?.id) return;
    try {
      const res = await api.markAllNotificationsRead(user.id);
      if (res.success) {
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        Toast.show({ type: 'success', text1: 'All Cleared', text2: 'Notifications marked as read.' });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const renderNotification = ({ item }: { item: Notification }) => {
    const icon = getIcon(item.type);
    return (
      <TouchableOpacity
        onPress={() => !item.is_read && handleMarkRead(item.id)}
        activeOpacity={0.7}
      >
        <Card style={[styles.notifCard, !item.is_read && styles.unreadCard]}>
          <View style={styles.notifRow}>
            <View style={[styles.iconCircle, { backgroundColor: icon.color + '20' }]}>
              <Ionicons name={icon.name as any} size={20} color={icon.color} />
            </View>
            <View style={styles.notifContent}>
              <Text style={[styles.notifTitle, !item.is_read && styles.unreadText]}>{item.title}</Text>
              <Text style={styles.notifMessage} numberOfLines={2}>{item.message}</Text>
              <Text style={styles.notifTime}>{timeAgo(item.created_at)}</Text>
            </View>
            {!item.is_read && <View style={styles.unreadDot} />}
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header Action */}
      {unreadCount > 0 && (
        <View style={styles.headerBar}>
          <Text style={styles.headerCount}>{unreadCount} unread</Text>
          <TouchableOpacity onPress={handleMarkAllRead}>
            <Text style={styles.markAllText}>Mark all as read</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        ListEmptyComponent={loading ? null : <EmptyState icon="notifications-off-outline" title="No Notifications" message="You're all caught up!" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  headerBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.cardBorder,
  },
  headerCount: { color: Colors.textMuted, fontSize: FontSize.sm },
  markAllText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },

  list: { padding: Spacing.lg, gap: Spacing.sm },

  notifCard: { padding: Spacing.md },
  unreadCard: { borderLeftWidth: 3, borderLeftColor: Colors.primary },
  notifRow: { flexDirection: 'row', alignItems: 'flex-start' },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md,
  },
  notifContent: { flex: 1 },
  notifTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '500', marginBottom: 2 },
  unreadText: { fontWeight: '700' },
  notifMessage: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, marginBottom: 4 },
  notifTime: { color: Colors.textMuted, fontSize: FontSize.xs },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.primary, marginTop: 8, marginLeft: Spacing.sm,
  },
});
