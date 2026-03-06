// ============================================
// JSCI Mobile — TypeScript Type Definitions
// ============================================

export interface User {
  id: string;
  memberId?: string;
  firstname: string;
  lastname: string;
  email: string;
  birthdate?: string | null;
  ministry?: string | null;
  sub_role?: string | null;
  role: UserRole;
  status: 'Verified' | 'Unverified';
  isActive: boolean;
  isGoogleUser?: boolean;
  hasPassword?: boolean;
  phone?: string | null;
  profile_picture?: string | null;
  life_verse?: string | null;
  allowed_event_types?: string[];
}

export type UserRole = 'Guest' | 'Member' | 'Song Leader' | 'Leader' | 'Pastor' | 'Admin' | 'Super Admin';

export interface Event {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  end_date?: string;
  location?: string;
  image_url?: string;
  created_by?: string;
  is_active: boolean;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  author?: string;
  author_name?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  is_pinned: boolean;
  is_active: boolean;
  created_at: string;
}

export interface CommunityPost {
  id: string;
  author_id: string;
  author_name: string;
  content: string;
  image_url?: string;
  is_pinned: boolean;
  is_active: boolean;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  author_picture?: string | null;
  created_at: string;
}

export interface PostComment {
  id: string;
  post_id: string;
  author_id: string;
  author_name: string;
  content: string;
  author_picture?: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  sender_name?: string;
  recipient_name?: string;
  subject?: string;
  content: string;
  is_read: boolean;
  is_broadcast: boolean;
  broadcast_target?: string;
  created_at: string;
  users?: { firstname: string; lastname: string };
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  link?: string;
  created_at: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface PermissionOverride {
  role: string;
  feature_key: string;
  enabled: boolean;
}
