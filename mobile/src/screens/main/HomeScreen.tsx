// ============================================
// JSCI Mobile — Home Screen (Dashboard)
// Pastors carousel + Gatherings + Daily Verse
// ============================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, Dimensions,
  RefreshControl, TouchableOpacity, FlatList, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.55;

const PASTORS = [
  { name: 'Dr. Weldon Pior', title: 'Senior Pastor', photo: 'dr-weldon-pior' },
  { name: 'Dr. Dorothy Pior', title: 'Senior Pastor', photo: 'dr-dorothy-pior' },
  { name: 'Ptr. Gracelyn Gambe', title: 'Associate Pastor', photo: 'ptr-gracelyn-gambe' },
  { name: 'Ptr. Eldan Gambe', title: 'Associate Pastor', photo: 'ptr-eldan-gambe' },
  { name: 'Ptr. Psalm Gambe', title: 'Youth Pastor', photo: 'ptr-psalm-gambe' },
];

const GATHERINGS = [
  { title: 'Sunday Worship Service', desc: 'United in powerful worship and biblical teaching every Sunday', icon: 'musical-notes' },
  { title: 'Pastor Appreciation', desc: 'Honoring our dedicated pastors for their faithful service', icon: 'heart' },
  { title: 'Youth Ministry Event', desc: 'Dynamic youth gatherings filled with fun and fellowship', icon: 'people' },
  { title: 'Community Outreach', desc: 'Extending God\'s love through practical service', icon: 'hand-left' },
  { title: 'Leadership Conference', desc: 'Equipping leaders for effective ministry', icon: 'ribbon' },
  { title: 'Baptism Service', desc: 'Public declaration of faith through water baptism', icon: 'water' },
  { title: 'Friday Bible Study', desc: 'In-depth Bible study for spiritual growth', icon: 'book' },
  { title: 'ISOM Training', desc: 'International School of Ministry for leadership development', icon: 'school' },
];

export default function HomeScreen() {
  const { user, isFeatureEnabled } = useAuth();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [pastorIndex, setPastorIndex] = useState(0);
  const [dailyVerse, setDailyVerse] = useState({ verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you.', reference: 'Jeremiah 29:11' });
  const scrollX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setInterval(() => {
      setPastorIndex(i => (i + 1) % PASTORS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const greetings = [
    `Welcome home, ${user?.firstname}!`,
    `It's a joy to see you, ${user?.firstname}!`,
    `Grace and peace to you, ${user?.firstname}!`,
    `May God refresh your heart today, ${user?.firstname}!`,
    `Walk boldly in faith today, ${user?.firstname}!`,
    `You belong here, ${user?.firstname}!`,
  ];
  const greeting = greetings[new Date().getDate() % greetings.length];

  // ─── Role-based Quick Access Buttons ──────
  const userRole = user?.role || 'Guest';
  const userMinistry = user?.ministry || '';
  const userSubRole = user?.sub_role || '';
  const isPraiseAndWorship = userMinistry === 'Praise And Worship';
  const isSongLeader = userRole === 'Song Leader' || userSubRole === 'Song Leaders';
  const isBackupSinger = userSubRole === 'Backup Singer';
  const isInstrumentalist = userSubRole === 'Instrumentalists';
  const isDancer = userSubRole === 'Dancers';
  const isMultimedia = userSubRole === 'Multimedia' || userSubRole === 'Lyrics';
  const isLeaderOrAbove = ['Leader', 'Pastor', 'Admin', 'Super Admin'].includes(userRole);
  const isAdminOrAbove = ['Admin', 'Super Admin'].includes(userRole);
  const isPastor = userRole === 'Pastor' || isAdminOrAbove;

  type QuickAccessItem = {
    label: string;
    icon: string;
    gradient: string[];
    onPress: () => void;
    badge?: string;
  };

  const getQuickAccessItems = (): QuickAccessItem[] => {
    const items: QuickAccessItem[] = [];

    // ── Praise & Worship (for Song Leaders, Backup Singers, Instrumentalists, Dancers, and PAW ministry) ──
    if (isPraiseAndWorship || isSongLeader || isBackupSinger || isInstrumentalist || isDancer) {
      items.push({
        label: 'Praise & Worship',
        icon: 'musical-notes',
        gradient: ['rgba(201,152,11,0.25)', 'rgba(201,152,11,0.08)'],
        onPress: () => navigation.navigate('PraiseWorship'),
        badge: isSongLeader ? 'Song Leader' : isBackupSinger ? 'Backup' : undefined,
      });
    }

    // ── Lyrics Library (for Multimedia users) ──
    if (isMultimedia || isAdminOrAbove) {
      items.push({
        label: 'Lyrics Library',
        icon: 'document-text',
        gradient: ['rgba(23,162,184,0.25)', 'rgba(23,162,184,0.08)'],
        onPress: () => navigation.navigate('LyricsLibrary'),
      });
    }

    // ── Announcements (all logged-in users) ──
    if (isFeatureEnabled('announcements.view')) {
      items.push({
        label: 'Announcements',
        icon: 'megaphone',
        gradient: ['rgba(255,193,7,0.25)', 'rgba(255,193,7,0.08)'],
        onPress: () => navigation.navigate('Announcements'),
      });
    }

    // ── Notifications (all logged-in users) ──
    items.push({
      label: 'Notifications',
      icon: 'notifications',
      gradient: ['rgba(220,53,69,0.25)', 'rgba(220,53,69,0.08)'],
      onPress: () => navigation.navigate('Notifications'),
    });

    // ── Schedules (Members + above with PAW ministry) ──
    if (isPraiseAndWorship || isLeaderOrAbove) {
      items.push({
        label: 'Schedules',
        icon: 'calendar',
        gradient: ['rgba(40,167,69,0.25)', 'rgba(40,167,69,0.08)'],
        onPress: () => navigation.navigate('PraiseWorship'),
      });
    }

    // ── Messages (Members + above) ──
    if (isFeatureEnabled('messages.view')) {
      items.push({
        label: 'Messages',
        icon: 'chatbubbles',
        gradient: ['rgba(23,162,184,0.25)', 'rgba(23,162,184,0.08)'],
        onPress: () => navigation.navigate('MainTabs', { screen: 'Messages' }),
      });
    }

    return items;
  };

  const quickAccessItems = getQuickAccessItems();

  const renderQuickAccess = () => {
    if (quickAccessItems.length === 0) return null;

    return (
      <>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Access</Text>
          <Text style={styles.sectionSubtitle}>
            {isPraiseAndWorship ? 'Your ministry tools' : 'Your dashboard shortcuts'}
          </Text>
        </View>

        <View style={styles.quickAccessGrid}>
          {quickAccessItems.map((item, index) => (
            <TouchableOpacity
              key={index}
              activeOpacity={0.8}
              onPress={item.onPress}
              style={styles.quickAccessItem}
            >
              <LinearGradient
                colors={item.gradient as [string, string]}
                style={styles.quickAccessGradient}
              >
                {item.badge && (
                  <View style={styles.quickAccessBadge}>
                    <Text style={styles.quickAccessBadgeText}>{item.badge}</Text>
                  </View>
                )}
                <View style={styles.quickAccessIconWrap}>
                  <Ionicons name={item.icon as any} size={24} color={Colors.primary} />
                </View>
                <Text style={styles.quickAccessLabel} numberOfLines={2}>{item.label}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </View>
      </>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
    >
      {/* Welcome Card */}
      <LinearGradient
        colors={['rgba(201,152,11,0.12)', 'rgba(201,152,11,0.02)', Colors.card]}
        style={styles.welcomeCard}
      >
        <Text style={styles.welcomeDate}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>
        <Text style={styles.welcomeGreeting}>{greeting}</Text>
        <View style={styles.roleBadge}>
          <Ionicons name="shield-checkmark" size={14} color={Colors.primary} />
          <Text style={styles.roleText}>{user?.role || 'Guest'}</Text>
        </View>
      </LinearGradient>

      {/* Daily Bible Verse */}
      <Card style={styles.verseCard}>
        <View style={styles.verseHeader}>
          <Ionicons name="book" size={18} color={Colors.primary} />
          <Text style={styles.verseLabel}>Verse of the Day</Text>
        </View>
        <Text style={styles.verseText}>&ldquo;{dailyVerse.verse}&rdquo;</Text>
        <Text style={styles.verseRef}>— {dailyVerse.reference}</Text>
      </Card>

      {/* ─── Role-Based Quick Access ─── */}
      {renderQuickAccess()}

      {/* Our Pastors */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>OUR PASTORS</Text>
        <View style={styles.sectionLine} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pastorsScroll}
        pagingEnabled={false}
        snapToInterval={CARD_WIDTH + Spacing.md}
        decelerationRate="fast"
      >
        {PASTORS.map((pastor, i) => (
          <TouchableOpacity key={i} activeOpacity={0.9} style={styles.pastorCard}>
            <LinearGradient
              colors={['rgba(201,152,11,0.15)', 'rgba(201,152,11,0.03)', Colors.card]}
              style={styles.pastorGradient}
            >
              <View style={styles.pastorImageWrap}>
                <View style={styles.pastorImagePlaceholder}>
                  <Ionicons name="person" size={40} color={Colors.primaryDark} />
                </View>
              </View>
              <Text style={styles.pastorName}>{pastor.name}</Text>
              <Text style={styles.pastorTitle}>{pastor.title}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Carousel Dots */}
      <View style={styles.dots}>
        {PASTORS.map((_, i) => (
          <View key={i} style={[styles.dot, pastorIndex === i && styles.dotActive]} />
        ))}
      </View>

      {/* Our Church Family Gatherings */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Our Church Family Gatherings</Text>
        <Text style={styles.sectionSubtitle}>Celebrating fellowship and community</Text>
      </View>

      <View style={styles.gatheringsGrid}>
        {GATHERINGS.map((g, i) => (
          <Card key={i} style={styles.gatheringCard}>
            <View style={styles.gatheringIcon}>
              <Ionicons name={g.icon as any} size={22} color={Colors.primary} />
            </View>
            <Text style={styles.gatheringTitle}>{g.title}</Text>
            <Text style={styles.gatheringDesc}>{g.desc}</Text>
          </Card>
        ))}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  // Welcome
  welcomeCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: 'rgba(201,152,11,0.15)',
  },
  welcomeDate: { color: Colors.textMuted, fontSize: FontSize.xs, marginBottom: Spacing.sm },
  welcomeGreeting: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: '700', lineHeight: 28, marginBottom: Spacing.md },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primaryMuted, alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.full,
  },
  roleText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '600' },

  // Verse
  verseCard: { marginBottom: Spacing.xxl },
  verseHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  verseLabel: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
  verseText: { color: Colors.textPrimary, fontSize: FontSize.md, fontStyle: 'italic', lineHeight: 24, marginBottom: Spacing.sm },
  verseRef: { color: Colors.primaryDark, fontSize: FontSize.sm, fontWeight: '600' },

  // Pastors
  sectionHeader: { marginBottom: Spacing.lg },
  sectionTitle: {
    color: Colors.primary, fontSize: FontSize.lg, fontWeight: '800',
    letterSpacing: 1, textTransform: 'uppercase',
  },
  sectionLine: { width: 40, height: 2, backgroundColor: Colors.primary, marginTop: Spacing.sm, borderRadius: 1 },
  sectionSubtitle: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: Spacing.xs },

  pastorsScroll: { paddingRight: Spacing.lg },
  pastorCard: {
    width: CARD_WIDTH,
    marginRight: Spacing.md,
  },
  pastorGradient: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(201,152,11,0.12)',
  },
  pastorImageWrap: { marginBottom: Spacing.md },
  pastorImagePlaceholder: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primaryDark,
  },
  pastorName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '700', textAlign: 'center' },
  pastorTitle: { color: Colors.primaryDark, fontSize: FontSize.sm, marginTop: Spacing.xs, textAlign: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.lg, marginBottom: Spacing.xxl },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.cardBorder },
  dotActive: { backgroundColor: Colors.primary, width: 20 },

  // Gatherings
  gatheringsGrid: { gap: Spacing.md },
  gatheringCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  gatheringIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  gatheringTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '600', flex: 1 },
  gatheringDesc: { display: 'none' }, // Hidden on mobile for compact view

  // Quick Access
  quickAccessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  quickAccessItem: {
    width: (width - Spacing.lg * 2 - Spacing.md * 2) / 3,
  },
  quickAccessGradient: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 110,
    borderWidth: 1,
    borderColor: 'rgba(201,152,11,0.12)',
  },
  quickAccessIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
    borderWidth: 1.5,
    borderColor: 'rgba(201,152,11,0.2)',
  },
  quickAccessLabel: {
    color: Colors.textPrimary,
    fontSize: FontSize.xs,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 15,
  },
  quickAccessBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
  },
  quickAccessBadgeText: {
    color: Colors.primary,
    fontSize: 8,
    fontWeight: '700',
  },
});
