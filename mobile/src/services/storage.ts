// ============================================
// JSCI Mobile — Secure Storage Service
// Wraps expo-secure-store for auth persistence
// ============================================

import * as SecureStore from 'expo-secure-store';

const KEYS = {
  USER_DATA: 'jsci_user_data',
  PERMISSIONS: 'jsci_permissions',
} as const;

export const storage = {
  async saveUser(userData: any): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEYS.USER_DATA, JSON.stringify(userData));
    } catch (e) {
      console.error('Failed to save user data:', e);
    }
  },

  async getUser(): Promise<any | null> {
    try {
      const data = await SecureStore.getItemAsync(KEYS.USER_DATA);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Failed to get user data:', e);
      return null;
    }
  },

  async removeUser(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEYS.USER_DATA);
    } catch (e) {
      console.error('Failed to remove user data:', e);
    }
  },

  async savePermissions(permissions: Record<string, boolean>): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEYS.PERMISSIONS, JSON.stringify(permissions));
    } catch (e) {
      console.error('Failed to save permissions:', e);
    }
  },

  async getPermissions(): Promise<Record<string, boolean> | null> {
    try {
      const data = await SecureStore.getItemAsync(KEYS.PERMISSIONS);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Failed to get permissions:', e);
      return null;
    }
  },

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEYS.USER_DATA);
      await SecureStore.deleteItemAsync(KEYS.PERMISSIONS);
    } catch (e) {
      console.error('Failed to clear storage:', e);
    }
  },
};

export default storage;
