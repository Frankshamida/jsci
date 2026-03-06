// ============================================
// JSCI Mobile — API Service
// Connects to the existing Next.js backend
// ============================================

import { ApiResponse, Event, Announcement, CommunityPost, Message, Notification, PostComment, PermissionOverride } from '../types';

// API base URL — uses your Vercel deployment
// For local dev you can switch to: http://172.16.17.28:3000
const API_BASE_URL = 'https://jsci.vercel.app';

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });
      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error(`API Error [${endpoint}]:`, error);
      return { success: false, message: error.message || 'Network error. Please check your connection.' };
    }
  }

  // ============================================
  // AUTH
  // ============================================
  async login(email: string, password: string) {
    return this.request<any>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async signup(data: { firstname: string; lastname: string; birthdate?: string; email: string; password: string }) {
    return this.request<{ memberId: string }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async sendOtp(email: string) {
    return this.request<{ otp: string; firstname: string }>('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verifyOtp(email: string, otp: string) {
    return this.request('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  }

  async resetPassword(email: string, newPassword: string) {
    return this.request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, newPassword }),
    });
  }

  // ============================================
  // EVENTS
  // ============================================
  async getEvents(upcoming = false, limit = 50) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (upcoming) params.append('upcoming', 'true');
    return this.request<Event[]>(`/api/events?${params}`);
  }

  async rsvpEvent(eventId: string, userId: string, status: string) {
    return this.request('/api/events/rsvp', {
      method: 'POST',
      body: JSON.stringify({ eventId, userId, status }),
    });
  }

  // ============================================
  // ANNOUNCEMENTS
  // ============================================
  async getAnnouncements(limit = 50) {
    return this.request<Announcement[]>(`/api/announcements?limit=${limit}`);
  }

  // ============================================
  // COMMUNITY
  // ============================================
  async getCommunityPosts(userId?: string, limit = 50) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (userId) params.append('userId', userId);
    return this.request<CommunityPost[]>(`/api/community?${params}`);
  }

  async createPost(authorId: string, authorName: string, content: string, imageUrl?: string) {
    return this.request('/api/community', {
      method: 'POST',
      body: JSON.stringify({ authorId, authorName, content, imageUrl }),
    });
  }

  async likePost(postId: string, userId: string) {
    return this.request('/api/community/like', {
      method: 'POST',
      body: JSON.stringify({ postId, userId }),
    });
  }

  async getComments(postId: string) {
    return this.request<PostComment[]>(`/api/community/comments?postId=${postId}`);
  }

  async addComment(postId: string, authorId: string, authorName: string, content: string) {
    return this.request('/api/community/comments', {
      method: 'POST',
      body: JSON.stringify({ postId, authorId, authorName, content }),
    });
  }

  // ============================================
  // MESSAGES
  // ============================================
  async getMessages(userId: string, type: 'inbox' | 'sent' | 'broadcast' = 'inbox') {
    return this.request<Message[]>(`/api/messages?userId=${userId}&type=${type}`);
  }

  async sendMessage(senderId: string, receiverId: string, subject: string, content: string) {
    return this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ senderId, receiverId, subject, content }),
    });
  }

  async markMessageRead(id: string) {
    return this.request('/api/messages', {
      method: 'PUT',
      body: JSON.stringify({ id }),
    });
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================
  async getNotifications(userId: string) {
    return this.request<Notification[]>(`/api/notifications?userId=${userId}`);
  }

  async markNotificationRead(id: string) {
    return this.request('/api/notifications', {
      method: 'PUT',
      body: JSON.stringify({ id }),
    });
  }

  async markAllNotificationsRead(userId: string) {
    return this.request('/api/notifications', {
      method: 'PUT',
      body: JSON.stringify({ markAll: true, userId }),
    });
  }

  // ============================================
  // PROFILE
  // ============================================
  async updateProfile(data: { email: string; firstname?: string; lastname?: string; phone?: string; birthdate?: string; life_verse?: string }) {
    return this.request('/api/profile/update', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePassword(email: string, currentPassword: string, newPassword: string) {
    return this.request('/api/profile/update-password', {
      method: 'POST',
      body: JSON.stringify({ email, currentPassword, newPassword }),
    });
  }

  // ============================================
  // PERMISSIONS
  // ============================================
  async getPermissionOverrides() {
    return this.request<PermissionOverride[]>('/api/admin/permissions-control');
  }

  // ============================================
  // SCHEDULES
  // ============================================
  async getSchedules() {
    return this.request<any[]>('/api/schedules');
  }

  // ============================================
  // MEETINGS
  // ============================================
  async getMeetings() {
    return this.request<any[]>('/api/meetings');
  }
}

export const api = new ApiService(API_BASE_URL);
export default api;
