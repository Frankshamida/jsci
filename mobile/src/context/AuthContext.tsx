// ============================================
// JSCI Mobile — Auth Context
// Manages user session, login/logout, permissions
// ============================================

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User } from '../types';
import api from '../services/api';
import storage from '../services/storage';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

// Supabase config — same as your web app
const SUPABASE_URL = 'https://okgootzwaklvzywtbwub.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZ29vdHp3YWtsdnp5d3Rid3ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNzUxNjEsImV4cCI6MjA4Nzc1MTE2MX0.k0N5q6Xbc5UKyQwBqVkM5vATA0Lvg1dzYJxxh4NRIF8';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  permissionOverrides: Record<string, boolean>;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; message?: string }>;
  signup: (data: { firstname: string; lastname: string; birthdate?: string; email: string; password: string }) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => void;
  refreshPermissions: () => Promise<void>;
  isFeatureEnabled: (featureKey: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissionOverrides, setPermissionOverrides] = useState<Record<string, boolean>>({});

  // Load stored session on app start
  useEffect(() => {
    loadStoredSession();
  }, []);

  const loadStoredSession = async () => {
    try {
      const storedUser = await storage.getUser();
      if (storedUser) {
        setUser(storedUser);
        // Load cached permissions
        const perms = await storage.getPermissions();
        if (perms) setPermissionOverrides(perms);
        // Refresh permissions in background
        loadPermissions();
      }
    } catch (e) {
      console.error('Error loading session:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPermissions = async () => {
    try {
      const res = await api.getPermissionOverrides();
      if (res.success && res.data) {
        const map: Record<string, boolean> = {};
        (res.data as any[]).forEach((row: any) => {
          map[`${row.role}::${row.feature_key}`] = row.enabled;
        });
        setPermissionOverrides(map);
        await storage.savePermissions(map);
      }
    } catch (e) {
      console.error('Error loading permissions:', e);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const res = await api.login(email, password);
      if (res.success && res.data) {
        const userData = res.data as User;
        setUser(userData);
        await storage.saveUser(userData);
        await loadPermissions();
        return { success: true };
      }
      return { success: false, message: res.message || 'Login failed' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Login failed' };
    }
  };

  const signup = async (data: { firstname: string; lastname: string; birthdate?: string; email: string; password: string }) => {
    try {
      const res = await api.signup(data);
      if (res.success) {
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Signup failed' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Signup failed' };
    }
  };

  const loginWithGoogle = async (): Promise<{ success: boolean; message?: string }> => {
    try {
      // Build the Supabase OAuth URL for Google
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'jsci' });
      const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUri)}`;

      // Open browser for Google sign-in
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type !== 'success' || !result.url) {
        return { success: false, message: 'Google sign-in was cancelled' };
      }

      // Parse the tokens from the redirect URL
      const url = result.url;
      // Supabase returns tokens as hash fragment: #access_token=...&refresh_token=...
      const hashPart = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
      if (!hashPart) {
        return { success: false, message: 'No authentication data received' };
      }

      const params = new URLSearchParams(hashPart);
      const accessToken = params.get('access_token');

      if (!accessToken) {
        return { success: false, message: 'Authentication failed — no access token' };
      }

      // Use the access token to get user info from Supabase
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': SUPABASE_ANON_KEY,
        },
      });
      const googleUser = await userRes.json();

      if (!googleUser || !googleUser.email) {
        return { success: false, message: 'Failed to get Google account information' };
      }

      const email = googleUser.email;
      const fullName = googleUser.user_metadata?.full_name || '';
      const nameParts = fullName.split(' ');
      const firstname = nameParts[0] || '';
      const lastname = nameParts.slice(1).join(' ') || '';
      const avatarUrl = googleUser.user_metadata?.avatar_url || googleUser.user_metadata?.picture || null;

      // Call our backend to handle the Google login/signup (find or create user in users table)
      const callbackRes = await api.googleCallback(googleUser.id, email, firstname, lastname, avatarUrl);

      if (callbackRes.success && callbackRes.data) {
        const userData = callbackRes.data as User;
        setUser(userData);
        await storage.saveUser(userData);
        await loadPermissions();
        return { success: true };
      }

      return { success: false, message: callbackRes.message || 'Google sign-in failed' };
    } catch (e: any) {
      console.error('Google login error:', e);
      return { success: false, message: e.message || 'Google sign-in failed' };
    }
  };

  const logout = async () => {
    setUser(null);
    setPermissionOverrides({});
    await storage.clear();
  };

  const updateUser = (userData: Partial<User>) => {
    if (user) {
      const updated = { ...user, ...userData };
      setUser(updated);
      storage.saveUser(updated);
    }
  };

  const refreshPermissions = useCallback(async () => {
    await loadPermissions();
  }, []);

  const isFeatureEnabled = useCallback((featureKey: string): boolean => {
    if (!user || !featureKey) return true;
    if (user.role === 'Super Admin') return true;
    const overrideKey = `${user.role}::${featureKey}`;
    if (overrideKey in permissionOverrides) {
      return permissionOverrides[overrideKey];
    }
    return true; // default enabled
  }, [user, permissionOverrides]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        permissionOverrides,
        login,
        loginWithGoogle,
        signup,
        logout,
        updateUser,
        refreshPermissions,
        isFeatureEnabled,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
