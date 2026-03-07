// ============================================
// JSCI Mobile — Lyrics Library Screen
// For Multimedia users (Lyrics / Multimedia sub_role)
// Matching web dashboard dark navy + gold design
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput, Modal, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

// ─── Language Flags ─────────────────────────
const LANGUAGE_FLAGS: Record<string, string> = {
  English: '🇺🇸',
  Tagalog: '🇵🇭',
  Bisaya: '🇵🇭',
  Mixed: '🌍',
};

// ─── Types ──────────────────────────────────
interface LyricsItem {
  id: string;
  title: string;
  artist: string;
  language: string;
  youtube_link: string | null;
  sections: { label: string; content: string }[];
  plain_text: string;
  prepared_by: string | null;
  linked_schedules: string[];
  created_at: string;
}

export default function LyricsLibraryScreen() {
  const { user } = useAuth();
  const [lyrics, setLyrics] = useState<LyricsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('All');
  const [selectedLyrics, setSelectedLyrics] = useState<LyricsItem | null>(null);
  const [viewModalVisible, setViewModalVisible] = useState(false);

  // ─── Data Fetching ──────────────────────────
  const fetchLyrics = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (langFilter && langFilter !== 'All') params.language = langFilter;

      const res = await api.getLyricsLibrary(params);
      if (res.success) setLyrics(res.data || []);
    } catch (e) {
      console.error('Error fetching lyrics:', e);
    } finally {
      setLoading(false);
    }
  }, [search, langFilter]);

  useEffect(() => {
    fetchLyrics();
  }, [fetchLyrics]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLyrics();
    setRefreshing(false);
  }, [fetchLyrics]);

  // ─── View Modal ─────────────────────────────
  const renderViewModal = () => {
    if (!selectedLyrics) return null;
    const item = selectedLyrics;

    return (
      <Modal
        visible={viewModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setViewModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <LinearGradient
              colors={['rgba(201,152,11,0.2)', Colors.card]}
              style={styles.modalHeader}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={2}>{item.title}</Text>
                {item.artist ? <Text style={styles.modalArtist}>{item.artist}</Text> : null}
                <View style={styles.modalMeta}>
                  <Text style={styles.modalLangBadge}>
                    {LANGUAGE_FLAGS[item.language] || '🎵'} {item.language}
                  </Text>
                  {item.youtube_link ? (
                    <TouchableOpacity
                      style={styles.ytBtn}
                      onPress={() => Linking.openURL(item.youtube_link!)}
                    >
                      <Ionicons name="logo-youtube" size={16} color={Colors.danger} />
                      <Text style={styles.ytBtnText}>YouTube</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity onPress={() => setViewModalVisible(false)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </LinearGradient>

            {/* Lyrics Content */}
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {item.sections && item.sections.length > 0 ? (
                item.sections.map((section, idx) => (
                  <View key={idx} style={styles.lyricsSection}>
                    <Text style={styles.lyricsSectionLabel}>[{section.label}]</Text>
                    <Text style={styles.lyricsSectionContent}>{section.content}</Text>
                  </View>
                ))
              ) : item.plain_text ? (
                <Text style={styles.lyricsPlainText}>{item.plain_text}</Text>
              ) : (
                <Text style={styles.lyricsPlainText}>No lyrics content available.</Text>
              )}

              {/* Linked Schedules */}
              {item.linked_schedules && item.linked_schedules.length > 0 && (
                <View style={styles.linkedSection}>
                  <Text style={styles.linkedTitle}>📅 Linked Schedules</Text>
                  <View style={styles.linkedChips}>
                    {item.linked_schedules.map((date, i) => (
                      <View key={i} style={styles.linkedChip}>
                        <Text style={styles.linkedChipText}>{date}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // ─── Lyrics Card ────────────────────────────
  const renderLyricsCard = (item: LyricsItem) => (
    <TouchableOpacity
      key={item.id}
      activeOpacity={0.85}
      onPress={() => { setSelectedLyrics(item); setViewModalVisible(true); }}
    >
      <Card style={styles.lyricsCard}>
        <View style={styles.cardHeader}>
          <View style={styles.langBadge}>
            <Text style={styles.langBadgeText}>
              {LANGUAGE_FLAGS[item.language] || '🎵'} {item.language}
            </Text>
          </View>
          {item.youtube_link ? (
            <TouchableOpacity onPress={() => Linking.openURL(item.youtube_link!)}>
              <Ionicons name="logo-youtube" size={20} color={Colors.danger} />
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        {item.artist ? (
          <Text style={styles.cardArtist} numberOfLines={1}>{item.artist}</Text>
        ) : null}

        {/* Preview */}
        <Text style={styles.cardPreview} numberOfLines={2}>
          {item.sections?.[0]?.content || item.plain_text || 'No preview available'}
        </Text>

        {/* Footer */}
        <View style={styles.cardFooter}>
          {item.prepared_by ? (
            <View style={styles.cardMetaItem}>
              <Ionicons name="person-outline" size={12} color={Colors.textMuted} />
              <Text style={styles.cardMetaText}>{item.prepared_by}</Text>
            </View>
          ) : null}
          <View style={styles.cardMetaItem}>
            <Ionicons name="time-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.cardMetaText}>
              {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        </View>

        {/* Linked Schedule Chips */}
        {item.linked_schedules && item.linked_schedules.length > 0 && (
          <View style={styles.cardLinkedRow}>
            <Ionicons name="link" size={12} color={Colors.primaryDark} />
            {item.linked_schedules.slice(0, 2).map((date, i) => (
              <View key={i} style={styles.cardLinkedChip}>
                <Text style={styles.cardLinkedChipText}>{date}</Text>
              </View>
            ))}
            {item.linked_schedules.length > 2 && (
              <Text style={styles.cardLinkedMore}>+{item.linked_schedules.length - 2}</Text>
            )}
          </View>
        )}
      </Card>
    </TouchableOpacity>
  );

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
            <Ionicons name="document-text" size={26} color={Colors.primary} />
            <Text style={styles.headerTitle}>Lyrics Library</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            Worship song lyrics for upcoming services
          </Text>
        </LinearGradient>

        {/* Search & Filter */}
        <View style={styles.searchRow}>
          <View style={styles.searchInput}>
            <Ionicons name="search" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.searchTextInput}
              placeholder="Search songs..."
              placeholderTextColor={Colors.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Language Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          {['All', 'English', 'Tagalog', 'Bisaya', 'Mixed'].map(lang => (
            <TouchableOpacity
              key={lang}
              style={[styles.filterChip, langFilter === lang && styles.filterChipActive]}
              onPress={() => setLangFilter(lang)}
            >
              <Text style={[styles.filterChipText, langFilter === lang && styles.filterChipTextActive]}>
                {lang !== 'All' ? `${LANGUAGE_FLAGS[lang] || ''} ` : ''}{lang}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Content */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading lyrics...</Text>
          </View>
        ) : lyrics.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="document-text-outline" size={48} color={Colors.primaryDark} />
            </View>
            <Text style={styles.emptyTitle}>No Lyrics Found</Text>
            <Text style={styles.emptyDesc}>
              {search || langFilter !== 'All'
                ? 'Try adjusting your search or filter.'
                : 'Lyrics will appear here once added by the multimedia team.'}
            </Text>
          </View>
        ) : (
          <View style={styles.lyricsGrid}>
            {lyrics.map(item => renderLyricsCard(item))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* View Modal */}
      {renderViewModal()}
    </View>
  );
}

// ============================================
// STYLES
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
    marginBottom: Spacing.sm,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.xxl,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },

  // Search
  searchRow: {
    marginBottom: Spacing.md,
  },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: Spacing.sm,
  },
  searchTextInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    padding: 0,
  },

  // Filter
  filterScroll: {
    marginBottom: Spacing.lg,
  },
  filterChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  filterChipActive: {
    backgroundColor: Colors.primaryMuted,
    borderColor: Colors.primary,
  },
  filterChipText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: Colors.primary,
  },

  // Lyrics Cards
  lyricsGrid: { gap: Spacing.md },
  lyricsCard: {
    padding: Spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  langBadge: {
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  langBadgeText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '600',
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: '700',
    marginBottom: 2,
  },
  cardArtist: {
    color: Colors.primaryDark,
    fontSize: FontSize.sm,
    marginBottom: Spacing.sm,
  },
  cardPreview: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    lineHeight: 18,
    fontStyle: 'italic',
    marginBottom: Spacing.md,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  cardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardMetaText: {
    color: Colors.textMuted,
    fontSize: 10,
  },
  cardLinkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  cardLinkedChip: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  cardLinkedChipText: {
    color: Colors.textSecondary,
    fontSize: 10,
  },
  cardLinkedMore: {
    color: Colors.textMuted,
    fontSize: 10,
  },

  // View Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: BorderRadius.xxl,
    borderTopRightRadius: BorderRadius.xxl,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  modalArtist: {
    color: Colors.primaryDark,
    fontSize: FontSize.sm,
    marginTop: 2,
  },
  modalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  modalLangBadge: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  ytBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.dangerMuted,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
  },
  ytBtnText: {
    color: Colors.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.md,
  },
  modalBody: {
    padding: Spacing.xl,
  },

  // Lyrics Sections
  lyricsSection: {
    marginBottom: Spacing.xl,
  },
  lyricsSectionLabel: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  lyricsSectionContent: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    lineHeight: 24,
  },
  lyricsPlainText: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    lineHeight: 24,
  },

  // Linked Schedules in modal
  linkedSection: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  linkedTitle: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  linkedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  linkedChip: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  linkedChipText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
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
