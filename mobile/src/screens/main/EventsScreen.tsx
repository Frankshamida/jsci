// ============================================
// JSCI Mobile — Events Screen
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card, EmptyState } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { Event } from '../../types';
import Toast from 'react-native-toast-message';

export default function EventsScreen() {
  const { user, isFeatureEnabled } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const res = await api.getEvents(false, 50);
      if (res.success) setEvents(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const onRefresh = () => { setRefreshing(true); loadEvents(); };

  const handleRsvp = async (eventId: string) => {
    if (!isFeatureEnabled('events.rsvp')) {
      Toast.show({ type: 'error', text1: 'Disabled', text2: 'RSVP has been disabled by administrator' });
      return;
    }
    if (!user?.id) return;
    try {
      const res = await api.rsvpEvent(eventId, user.id, 'going');
      if (res.success) {
        Toast.show({ type: 'success', text1: 'RSVP Confirmed', text2: 'You\'re going to this event!' });
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: res.message || 'RSVP failed' });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const isUpcoming = (dateStr: string) => new Date(dateStr) >= new Date();

  const renderEvent = ({ item }: { item: Event }) => (
    <Card style={styles.eventCard}>
      <View style={styles.eventDateBadge}>
        <Text style={styles.eventDateDay}>{new Date(item.event_date).getDate()}</Text>
        <Text style={styles.eventDateMonth}>{new Date(item.event_date).toLocaleDateString('en-US', { month: 'short' })}</Text>
      </View>
      <View style={styles.eventContent}>
        <Text style={styles.eventTitle} numberOfLines={2}>{item.title}</Text>
        {item.description && <Text style={styles.eventDesc} numberOfLines={2}>{item.description}</Text>}
        <View style={styles.eventMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
            <Text style={styles.metaText}>{formatTime(item.event_date)}</Text>
          </View>
          {item.location && (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={14} color={Colors.textMuted} />
              <Text style={styles.metaText} numberOfLines={1}>{item.location}</Text>
            </View>
          )}
        </View>
        {isUpcoming(item.event_date) && isFeatureEnabled('events.rsvp') && (
          <TouchableOpacity style={styles.rsvpBtn} onPress={() => handleRsvp(item.id)} activeOpacity={0.7}>
            <LinearGradient colors={['#c9980b', '#a67c00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.rsvpGradient}>
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.rsvpText}>RSVP</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        renderItem={renderEvent}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        ListEmptyComponent={loading ? null : <EmptyState icon="calendar-outline" title="No Events" message="Check back later for upcoming events" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.lg, gap: Spacing.md },
  eventCard: { flexDirection: 'row', gap: Spacing.lg },
  eventDateBadge: {
    width: 52, height: 56, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryMuted, alignItems: 'center', justifyContent: 'center',
  },
  eventDateDay: { color: Colors.primary, fontSize: FontSize.xl, fontWeight: '800' },
  eventDateMonth: { color: Colors.primaryDark, fontSize: FontSize.xs, fontWeight: '600', textTransform: 'uppercase' },
  eventContent: { flex: 1 },
  eventTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '700', marginBottom: Spacing.xs },
  eventDesc: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.sm },
  eventMeta: { flexDirection: 'row', gap: Spacing.lg, marginBottom: Spacing.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  metaText: { color: Colors.textMuted, fontSize: FontSize.xs },
  rsvpBtn: { alignSelf: 'flex-start', marginTop: Spacing.xs },
  rsvpGradient: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full,
  },
  rsvpText: { color: '#fff', fontSize: FontSize.xs, fontWeight: '700' },
});
