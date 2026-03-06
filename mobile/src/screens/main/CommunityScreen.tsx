// ============================================
// JSCI Mobile — Community Hub Screen
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card, EmptyState } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { CommunityPost } from '../../types';
import Toast from 'react-native-toast-message';

export default function CommunityScreen() {
  const { user, isFeatureEnabled } = useAuth();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newPost, setNewPost] = useState('');
  const [posting, setPosting] = useState(false);
  const [showCompose, setShowCompose] = useState(false);

  const loadPosts = useCallback(async () => {
    try {
      const res = await api.getCommunityPosts(user?.id, 50);
      if (res.success) setPosts(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const onRefresh = () => { setRefreshing(true); loadPosts(); };

  const handlePost = async () => {
    if (!newPost.trim() || !user) return;
    setPosting(true);
    try {
      const res = await api.createPost(user.id, `${user.firstname} ${user.lastname}`, newPost.trim());
      if (res.success) {
        setNewPost('');
        setShowCompose(false);
        Toast.show({ type: 'success', text1: 'Posted!', text2: 'Your post is live.' });
        loadPosts();
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: res.message });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!user?.id || !isFeatureEnabled('community.like_comment')) return;
    try {
      await api.likePost(postId, user.id);
      loadPosts();
    } catch (e) { /* silent */ }
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

  const getInitials = (name: string) => {
    const parts = name.split(' ');
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  };

  const renderPost = ({ item }: { item: CommunityPost }) => (
    <Card style={styles.postCard}>
      {/* Author Header */}
      <View style={styles.postHeader}>
        <View style={styles.avatar}>
          {item.author_picture ? (
            <Image source={{ uri: item.author_picture }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{getInitials(item.author_name)}</Text>
          )}
        </View>
        <View style={styles.authorInfo}>
          <Text style={styles.authorName}>{item.author_name}</Text>
          <Text style={styles.postTime}>{timeAgo(item.created_at)}</Text>
        </View>
        {item.is_pinned && (
          <View style={styles.pinnedBadge}>
            <Ionicons name="pin" size={12} color={Colors.primary} />
          </View>
        )}
      </View>

      {/* Content */}
      <Text style={styles.postContent}>{item.content}</Text>

      {/* Actions */}
      <View style={styles.postActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleLike(item.id)}>
          <Ionicons name={item.liked ? 'heart' : 'heart-outline'} size={20} color={item.liked ? Colors.danger : Colors.textMuted} />
          <Text style={[styles.actionText, item.liked && { color: Colors.danger }]}>{item.likeCount || ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn}>
          <Ionicons name="chatbubble-outline" size={18} color={Colors.textMuted} />
          <Text style={styles.actionText}>{item.commentCount || ''}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        ListEmptyComponent={loading ? null : <EmptyState icon="chatbubbles-outline" title="No Posts Yet" message="Be the first to share something with the community!" />}
      />

      {/* Compose Button */}
      {isFeatureEnabled('community.create_post') && (
        <>
          {showCompose && (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.composeOverlay}>
              <View style={styles.composeBox}>
                <View style={styles.composeHeader}>
                  <Text style={styles.composeTitle}>Create Post</Text>
                  <TouchableOpacity onPress={() => setShowCompose(false)}>
                    <Ionicons name="close" size={24} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.composeInput}
                  placeholder="What's on your heart today?"
                  placeholderTextColor={Colors.textMuted}
                  value={newPost}
                  onChangeText={setNewPost}
                  multiline
                  maxLength={500}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.composeBtn, (!newPost.trim() || posting) && styles.composeBtnDisabled]}
                  onPress={handlePost}
                  disabled={!newPost.trim() || posting}
                >
                  <Ionicons name="send" size={18} color="#fff" />
                  <Text style={styles.composeBtnText}>{posting ? 'Posting...' : 'Post'}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          )}

          <TouchableOpacity style={styles.fab} onPress={() => setShowCompose(true)} activeOpacity={0.8}>
            <Ionicons name="add" size={28} color="#fff" />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.lg, gap: Spacing.md },

  postCard: { padding: Spacing.lg },
  postHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryMuted, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
  avatarText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  authorInfo: { flex: 1, marginLeft: Spacing.md },
  authorName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '600' },
  postTime: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
  pinnedBadge: {
    backgroundColor: Colors.primaryMuted, padding: Spacing.xs, borderRadius: BorderRadius.full,
  },
  postContent: { color: Colors.textPrimary, fontSize: FontSize.md, lineHeight: 22, marginBottom: Spacing.md },
  postActions: { flexDirection: 'row', gap: Spacing.xxl, borderTopWidth: 1, borderTopColor: Colors.cardBorder, paddingTop: Spacing.md },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  actionText: { color: Colors.textMuted, fontSize: FontSize.sm },

  // FAB
  fab: {
    position: 'absolute', bottom: Spacing.xl, right: Spacing.xl,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    elevation: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },

  // Compose
  composeOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
    flex: 1,
  },
  composeBox: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderTopWidth: 1, borderColor: Colors.cardBorder,
  },
  composeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  composeTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: '700' },
  composeInput: {
    color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 100, maxHeight: 200,
    textAlignVertical: 'top', marginBottom: Spacing.lg, lineHeight: 22,
  },
  composeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, paddingVertical: Spacing.md, borderRadius: BorderRadius.md,
  },
  composeBtnDisabled: { opacity: 0.5 },
  composeBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.md },
});
