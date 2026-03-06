// ============================================
// JSCI Mobile — Auth Context
// Manages user session, login/logout, permissions
// ============================================

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User } from '../types';
import api from '../services/api';
import storage from '../services/storage';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  permissionOverrides: Record<string, boolean>;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
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
