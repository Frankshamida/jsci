// ============================================
// JSCI Mobile — Announcements Screen
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card, EmptyState } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { Announcement } from '../../types';

export default function AnnouncementsScreen() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await api.getAnnouncements();
      if (res.success) setAnnouncements(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  const onRefresh = () => { setRefreshing(true); loadAnnouncements(); };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'urgent': return Colors.danger;
      case 'high': return Colors.warning;
      case 'normal': return Colors.primary;
      default: return Colors.textMuted;
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const renderItem = ({ item }: { item: Announcement }) => (
    <Card style={styles.card}>
      {/* Priority Badge */}
      {item.priority && item.priority !== 'normal' && (
        <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(item.priority) + '20' }]}>
          <Ionicons name={item.priority === 'urgent' ? 'alert-circle' : 'arrow-up'} size={14} color={getPriorityColor(item.priority)} />
          <Text style={[styles.priorityText, { color: getPriorityColor(item.priority) }]}>
            {item.priority.toUpperCase()}
          </Text>
        </View>
      )}

      {/* Title */}
      <Text style={styles.title}>{item.title}</Text>

      {/* Content */}
      <Text style={styles.content} numberOfLines={4}>{item.content}</Text>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerItem}>
          <Ionicons name="person-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>{item.author_name || 'Admin'}</Text>
        </View>
        <View style={styles.footerItem}>
          <Ionicons name="calendar-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>{formatDate(item.created_at)}</Text>
        </View>
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={announcements}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        ListEmptyComponent={loading ? null : <EmptyState icon="megaphone-outline" title="No Announcements" message="Check back later for updates from the church." />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.lg, gap: Spacing.md },

  card: { padding: Spacing.lg },
  priorityBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full, marginBottom: Spacing.sm,
  },
  priorityText: { fontSize: FontSize.xs, fontWeight: '800', letterSpacing: 0.5 },
  title: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: '700', marginBottom: Spacing.sm },
  content: { color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 22, marginBottom: Spacing.lg },

  footer: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: Colors.cardBorder, paddingTop: Spacing.md,
  },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  footerText: { color: Colors.textMuted, fontSize: FontSize.xs },
});
