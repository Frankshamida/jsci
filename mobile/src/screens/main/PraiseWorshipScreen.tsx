// ============================================
// JSCI Mobile — Praise & Worship Screen
// Schedule Lineups, My Schedule, Notifications
// Matching web dashboard dark navy + gold design
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Dimensions, Linking, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const { width } = Dimensions.get('window');

// ─── Sub-Role Icons ─────────────────────────
const SUB_ROLE_ICONS: Record<string, string> = {
  'Song Leaders': 'mic',
  'Backup Singer': 'people',
  'Instrumentalists': 'musical-notes',
  'Dancers': 'body',
  'Lyrics': 'document-text',
  'Multimedia': 'desktop',
};

// ─── Types ──────────────────────────────────
interface ScheduleItem {
  scheduleId: string;
  songLeader: string;
  songLeaderPicture: string | null;
  backupSingers: string[];
  backupSingerProfiles: { name: string; profilePicture: string | null }[];
  scheduleDate: string;
  practiceDate: string | null;
  slowSongs: string[];
  fastSongs: string[];
  submittedBy: string;
  status: string;
  hasSubstitute: boolean;
  originalSongLeader: string | null;
  originalSongLeaderPicture: string | null;
  role?: string;
}

interface PAWNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

// ─── Helper ─────────────────────────────────
function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('en-US', { month: 'short' }),
    year: d.getFullYear(),
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    full: d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

function timeAgo(dateStr: string) {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Tab Type ───────────────────────────────
type TabKey = 'schedules' | 'my-schedule' | 'notifications';

export default function PraiseWorshipScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('schedules');
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [mySchedules, setMySchedules] = useState<ScheduleItem[]>([]);
  const [notifications, setNotifications] = useState<PAWNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleItem | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const subRole = user?.sub_role || '';
  const ministry = user?.ministry || '';
  const isPAW = ministry === 'Praise And Worship';
  const isSongLeader = subRole === 'Song Leaders';
  const isBackupSinger = subRole === 'Backup Singer';

  const getRoleIcon = () => {
    if (isSongLeader) return 'mic';
    if (isBackupSinger) return 'people';
    return SUB_ROLE_ICONS[subRole] || 'musical-notes';
  };

  const getRoleLabel = () => {
    if (isSongLeader) return 'Song Leader';
    if (isBackupSinger) return 'Backup Singer';
    return subRole || user?.role || 'Member';
  };

  // ─── Data Fetching ──────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [schedRes, myRes, notifRes] = await Promise.all([
        api.getPraiseWorshipSchedules(),
        user?.id ? api.getMyPraiseWorshipSchedule(user.id) : Promise.resolve({ success: true, data: [] }),
        user?.id ? api.getPraiseWorshipNotifications(user.id) : Promise.resolve({ success: true, data: [] }),
      ]);

      if (schedRes.success) setSchedules(schedRes.data || []);
      if (myRes.success) setMySchedules(myRes.data || []);
      if (notifRes.success) setNotifications(notifRes.data || []);
    } catch (e) {
      console.error('Error fetching P&W data:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // ─── Render Tab Bar ─────────────────────────
  const renderTabBar = () => (
    <View style={styles.tabBar}>
      {[
        { key: 'schedules' as TabKey, label: 'Lineups', icon: 'calendar' },
        { key: 'my-schedule' as TabKey, label: 'My Schedule', icon: 'person' },
        { key: 'notifications' as TabKey, label: 'Alerts', icon: 'notifications', badge: unreadCount },
      ].map(tab => (
        <TouchableOpacity
          key={tab.key}
          style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          onPress={() => setActiveTab(tab.key)}
          activeOpacity={0.7}
        >
          <View style={styles.tabInner}>
            <Ionicons
              name={(activeTab === tab.key ? tab.icon : `${tab.icon}-outline`) as any}
              size={18}
              color={activeTab === tab.key ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
            {tab.badge && tab.badge > 0 ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{tab.badge > 9 ? '9+' : tab.badge}</Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  // ─── Schedule Card ──────────────────────────
  const renderScheduleCard = (item: ScheduleItem, showRole = false) => {
    const date = formatDate(item.scheduleDate);
    const songCount = (item.slowSongs?.length || 0) + (item.fastSongs?.length || 0);

    return (
      <TouchableOpacity
        key={item.scheduleId}
        activeOpacity={0.85}
        onPress={() => { setSelectedSchedule(item); setDetailVisible(true); }}
      >
        <Card style={styles.scheduleCard}>
          {/* Date Header */}
          <LinearGradient
            colors={['rgba(201,152,11,0.18)', 'rgba(201,152,11,0.04)']}
            style={styles.schedDateHeader}
          >
            <View style={styles.schedDateLeft}>
              <Text style={styles.schedDateDay}>{date.day}</Text>
              <View>
                <Text style={styles.schedDateMonth}>{date.month} {date.year}</Text>
                <Text style={styles.schedDateWeekday}>{date.weekday}</Text>
              </View>
            </View>
            {showRole && item.role && (
              <View style={styles.schedRoleBadge}>
                <Text style={styles.schedRoleBadgeText}>{item.role}</Text>
              </View>
            )}
            {item.hasSubstitute && (
              <View style={styles.subBadge}>
                <Ionicons name="swap-horizontal" size={12} color={Colors.warning} />
                <Text style={styles.subBadgeText}>Sub</Text>
              </View>
            )}
          </LinearGradient>

          {/* Song Leader */}
          <View style={styles.schedBody}>
            <View style={styles.leaderRow}>
              <View style={styles.avatarCircle}>
                <Ionicons name="mic" size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.leaderLabel}>Song Leader</Text>
                <Text style={styles.leaderName}>{item.songLeader}</Text>
              </View>
            </View>

            {/* Original Leader (if substituted) */}
            {item.hasSubstitute && item.originalSongLeader && (
              <View style={styles.originalRow}>
                <Ionicons name="arrow-undo" size={12} color={Colors.textMuted} />
                <Text style={styles.originalText}>Originally: {item.originalSongLeader}</Text>
              </View>
            )}

            {/* Backup Singers */}
            {item.backupSingers.length > 0 && (
              <View style={styles.backupsRow}>
                <Ionicons name="people" size={14} color={Colors.primaryDark} />
                <View style={styles.backupChips}>
                  {item.backupSingers.map((name, idx) => (
                    <View key={idx} style={styles.backupChip}>
                      <Text style={styles.backupChipText}>{name.split(' ')[0]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Meta Row */}
            <View style={styles.metaRow}>
              {item.practiceDate && (
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={13} color={Colors.textMuted} />
                  <Text style={styles.metaText}>Practice: {formatDate(item.practiceDate).full}</Text>
                </View>
              )}
              <View style={styles.metaItem}>
                <Ionicons name="musical-notes-outline" size={13} color={Colors.textMuted} />
                <Text style={styles.metaText}>{songCount} song{songCount !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  // ─── Detail Modal ───────────────────────────
  const renderDetailModal = () => {
    if (!selectedSchedule) return null;
    const s = selectedSchedule;
    const date = formatDate(s.scheduleDate);

    return (
      <Modal
        visible={detailVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <LinearGradient
              colors={['rgba(201,152,11,0.2)', Colors.card]}
              style={styles.modalHeader}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Schedule Details</Text>
                <Text style={styles.modalDate}>{date.weekday}, {date.month} {date.day}, {date.year}</Text>
              </View>
              <TouchableOpacity onPress={() => setDetailVisible(false)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </LinearGradient>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Song Leader Section */}
              <View style={styles.detailSection}>
                <View style={styles.detailSectionHeader}>
                  <Ionicons name="mic" size={16} color={Colors.primary} />
                  <Text style={styles.detailSectionTitle}>Song Leader</Text>
                </View>
                <View style={styles.detailPersonRow}>
                  <View style={styles.detailAvatar}>
                    <Ionicons name="person" size={20} color={Colors.primary} />
                  </View>
                  <Text style={styles.detailPersonName}>{s.songLeader}</Text>
                </View>
                {s.hasSubstitute && s.originalSongLeader && (
                  <View style={styles.detailSubNote}>
                    <Ionicons name="swap-horizontal" size={14} color={Colors.warning} />
                    <Text style={styles.detailSubText}>
                      Substituting for {s.originalSongLeader}
                    </Text>
                  </View>
                )}
              </View>

              {/* Backup Singers */}
              {s.backupSingers.length > 0 && (
                <View style={styles.detailSection}>
                  <View style={styles.detailSectionHeader}>
                    <Ionicons name="people" size={16} color={Colors.primary} />
                    <Text style={styles.detailSectionTitle}>Backup Singers</Text>
                  </View>
                  {s.backupSingers.map((name, i) => (
                    <View key={i} style={styles.detailPersonRow}>
                      <View style={[styles.detailAvatar, { backgroundColor: Colors.infoMuted }]}>
                        <Ionicons name="person" size={16} color={Colors.info} />
                      </View>
                      <Text style={styles.detailPersonName}>{name}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Practice Date */}
              {s.practiceDate && (
                <View style={styles.detailSection}>
                  <View style={styles.detailSectionHeader}>
                    <Ionicons name="time" size={16} color={Colors.primary} />
                    <Text style={styles.detailSectionTitle}>Practice</Text>
                  </View>
                  <Text style={styles.detailMetaValue}>{formatDate(s.practiceDate).full}</Text>
                </View>
              )}

              {/* Songs */}
              {(s.slowSongs.length > 0 || s.fastSongs.length > 0) && (
                <View style={styles.detailSection}>
                  <View style={styles.detailSectionHeader}>
                    <Ionicons name="musical-notes" size={16} color={Colors.primary} />
                    <Text style={styles.detailSectionTitle}>Song List</Text>
                  </View>

                  {s.slowSongs.length > 0 && (
                    <>
                      <Text style={styles.songCategoryLabel}>🎵 Slow Songs</Text>
                      {s.slowSongs.map((song, i) => {
                        const parts = song.split('||');
                        const title = parts[0] || song;
                        const link = parts[1] || '';
                        return (
                          <View key={`slow-${i}`} style={styles.songRow}>
                            <Text style={styles.songNumber}>{i + 1}</Text>
                            <Text style={styles.songTitle}>{title}</Text>
                            {link ? (
                              <TouchableOpacity onPress={() => Linking.openURL(link)}>
                                <Ionicons name="play-circle" size={22} color={Colors.danger} />
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      })}
                    </>
                  )}

                  {s.fastSongs.length > 0 && (
                    <>
                      <Text style={[styles.songCategoryLabel, { marginTop: Spacing.md }]}>🎶 Fast Songs</Text>
                      {s.fastSongs.map((song, i) => {
                        const parts = song.split('||');
                        const title = parts[0] || song;
                        const link = parts[1] || '';
                        return (
                          <View key={`fast-${i}`} style={styles.songRow}>
                            <Text style={styles.songNumber}>{i + 1}</Text>
                            <Text style={styles.songTitle}>{title}</Text>
                            {link ? (
                              <TouchableOpacity onPress={() => Linking.openURL(link)}>
                                <Ionicons name="play-circle" size={22} color={Colors.danger} />
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      })}
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // ─── Schedules Tab ──────────────────────────
  const renderSchedulesTab = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading lineups...</Text>
        </View>
      );
    }

    if (schedules.length === 0) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="calendar-outline" size={48} color={Colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>No Lineups Yet</Text>
          <Text style={styles.emptyDesc}>Schedule lineups will appear here once assigned.</Text>
        </View>
      );
    }

    return (
      <View style={styles.schedulesList}>
        {schedules.map(item => renderScheduleCard(item))}
      </View>
    );
  };

  // ─── My Schedule Tab ────────────────────────
  const renderMyScheduleTab = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      );
    }

    if (mySchedules.length === 0) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="person-outline" size={48} color={Colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>No Upcoming Assignments</Text>
          <Text style={styles.emptyDesc}>Your upcoming schedule assignments will appear here.</Text>
        </View>
      );
    }

    return (
      <View style={styles.schedulesList}>
        {mySchedules.map(item => renderScheduleCard(item, true))}
      </View>
    );
  };

  // ─── Notifications Tab ──────────────────────
  const renderNotificationsTab = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      );
    }

    if (notifications.length === 0) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="notifications-outline" size={48} color={Colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>No Notifications</Text>
          <Text style={styles.emptyDesc}>Lineup alerts and updates will appear here.</Text>
        </View>
      );
    }

    return (
      <View style={styles.notificationsList}>
        {notifications.map(notif => (
          <Card key={notif.id} style={[styles.notifCard, !notif.is_read && styles.notifUnread]}>
            <View style={styles.notifRow}>
              <View style={[styles.notifIcon, !notif.is_read && styles.notifIconUnread]}>
                <Ionicons
                  name={notif.type === 'substitute' ? 'swap-horizontal' : notif.type === 'lineup' ? 'musical-notes' : 'notifications'}
                  size={18}
                  color={!notif.is_read ? Colors.primary : Colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.notifTitle, !notif.is_read && styles.notifTitleUnread]}>
                  {notif.title}
                </Text>
                <Text style={styles.notifMessage} numberOfLines={2}>{notif.message}</Text>
                <Text style={styles.notifTime}>{timeAgo(notif.created_at)}</Text>
              </View>
            </View>
          </Card>
        ))}
      </View>
    );
  };

  // ─── Main Render ────────────────────────────
  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
        }
      >
        {/* Header */}
        <LinearGradient
          colors={['rgba(201,152,11,0.15)', 'rgba(201,152,11,0.03)', Colors.card]}
          style={styles.header}
        >
          <View style={styles.headerTop}>
            <Ionicons name="musical-notes" size={26} color={Colors.primary} />
            <Text style={styles.headerTitle}>Praise & Worship</Text>
          </View>
          <View style={styles.roleBadge}>
            <Ionicons name={getRoleIcon() as any} size={14} color={Colors.primary} />
            <Text style={styles.roleText}>{getRoleLabel()}</Text>
            {isPAW && <View style={styles.roleDot} />}
          </View>
        </LinearGradient>

        {/* Tab Bar */}
        {renderTabBar()}

        {/* Tab Content */}
        {activeTab === 'schedules' && renderSchedulesTab()}
        {activeTab === 'my-schedule' && renderMyScheduleTab()}
        {activeTab === 'notifications' && renderNotificationsTab()}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Detail Modal */}
      {renderDetailModal()}
    </View>
  );
}

// ============================================
// STYLES — Dark navy + gold matching web design
// ============================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  // Header
  header: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(201,152,11,0.15)',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.xxl,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primaryMuted,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  roleText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '600' },
  roleDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: Colors.success,
    marginLeft: Spacing.xs,
  },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xs,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Colors.primaryMuted,
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  tabText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  tabTextActive: {
    color: Colors.primary,
  },
  tabBadge: {
    backgroundColor: Colors.danger,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },

  // Schedule Cards
  schedulesList: { gap: Spacing.md },
  scheduleCard: { padding: 0, overflow: 'hidden' },
  schedDateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(201,152,11,0.1)',
  },
  schedDateLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  schedDateDay: {
    color: Colors.primary,
    fontSize: FontSize.xxl,
    fontWeight: '800',
  },
  schedDateMonth: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  schedDateWeekday: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },
  schedRoleBadge: {
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  schedRoleBadgeText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  subBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.warningMuted,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  subBadgeText: {
    color: Colors.warning,
    fontSize: 10,
    fontWeight: '600',
  },

  schedBody: { padding: Spacing.lg },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primaryDark,
  },
  leaderLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },
  leaderName: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  originalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
    paddingLeft: 48,
  },
  originalText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontStyle: 'italic',
  },
  backupsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  backupChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    flex: 1,
  },
  backupChip: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  backupChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.lg,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },

  // Detail Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: BorderRadius.xxl,
    borderTopRightRadius: BorderRadius.xxl,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderTopLeftRadius: BorderRadius.xxl,
    borderTopRightRadius: BorderRadius.xxl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  modalTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  modalDate: {
    color: Colors.primaryDark,
    fontSize: FontSize.sm,
    marginTop: 2,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { padding: Spacing.xl },

  detailSection: {
    marginBottom: Spacing.xl,
  },
  detailSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  detailSectionTitle: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  detailAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPersonName: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  detailSubNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingLeft: 48,
    marginTop: Spacing.xs,
  },
  detailSubText: {
    color: Colors.warning,
    fontSize: FontSize.xs,
    fontStyle: 'italic',
  },
  detailMetaValue: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },

  // Songs in Detail
  songCategoryLabel: {
    color: Colors.primaryDark,
    fontSize: FontSize.sm,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  songNumber: {
    color: Colors.primaryDark,
    fontSize: FontSize.sm,
    fontWeight: '700',
    width: 20,
  },
  songTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    flex: 1,
  },

  // Notifications
  notificationsList: { gap: Spacing.sm },
  notifCard: { padding: Spacing.md },
  notifUnread: {
    borderColor: 'rgba(201,152,11,0.3)',
    backgroundColor: 'rgba(201,152,11,0.05)',
  },
  notifRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  notifIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifIconUnread: {
    backgroundColor: Colors.primaryMuted,
  },
  notifTitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '500',
    marginBottom: 2,
  },
  notifTitleUnread: {
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  notifMessage: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  notifTime: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },

  // Empty / Loading
  centered: {
    paddingVertical: Spacing.massive,
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginTop: Spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.massive,
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  emptyDesc: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
