// ============================================
// JSCI Mobile — Profile Screen
// ============================================

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, BorderRadius, FontSize } from '../../theme';
import { Card, Button, Input } from '../../components';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import Toast from 'react-native-toast-message';

export default function ProfileScreen() {
  const { user, logout, updateUser } = useAuth();

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [firstname, setFirstname] = useState(user?.firstname || '');
  const [lastname, setLastname] = useState(user?.lastname || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);

  // Password change
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const res = await api.updateProfile({ email: user.email, firstname, lastname });
      if (res.success) {
        updateUser({ ...user, firstname, lastname });
        setEditing(false);
        Toast.show({ type: 'success', text1: 'Saved!', text2: 'Profile updated.' });
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: res.message });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Passwords do not match.' });
      return;
    }
    if (newPassword.length < 6) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Password must be at least 6 characters.' });
      return;
    }
    if (!user?.id) return;
    setChangingPassword(true);
    try {
      const res = await api.updatePassword(user.id, currentPassword, newPassword);
      if (res.success) {
        setShowPassword(false);
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        Toast.show({ type: 'success', text1: 'Updated!', text2: 'Password changed.' });
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: res.message });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  const getInitials = () => {
    return ((user?.firstname?.[0] || '') + (user?.lastname?.[0] || '')).toUpperCase();
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'super-admin': return Colors.danger;
      case 'admin': return Colors.warning;
      case 'pastor': return '#a78bfa';
      case 'leader': return Colors.info;
      case 'member': return Colors.success;
      default: return Colors.textMuted;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Profile Header */}
      <LinearGradient colors={[Colors.primary + '30', Colors.background]} style={styles.headerGradient}>
        <View style={styles.avatarContainer}>
          {user?.profile_picture ? (
            <Image source={{ uri: user.profile_picture }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{getInitials()}</Text>
            </View>
          )}
        </View>
        <Text style={styles.userName}>{user?.firstname} {user?.lastname}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
        {user?.role && (
          <View style={[styles.roleBadge, { backgroundColor: getRoleBadgeColor(user.role) + '20' }]}>
            <Text style={[styles.roleText, { color: getRoleBadgeColor(user.role) }]}>
              {user.role.replace('-', ' ').toUpperCase()}
            </Text>
          </View>
        )}
      </LinearGradient>

      {/* Profile Info / Edit */}
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          {!editing && (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Ionicons name="pencil" size={20} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {editing ? (
          <>
            <Input label="First Name" value={firstname} onChangeText={setFirstname} icon="person-outline" />
            <Input label="Last Name" value={lastname} onChangeText={setLastname} icon="person-outline" />
            <Input label="Phone" value={phone} onChangeText={setPhone} icon="call-outline" keyboardType="phone-pad" />
            <View style={styles.editActions}>
              <Button title="Cancel" variant="outline" onPress={() => { setEditing(false); setFirstname(user?.firstname || ''); setLastname(user?.lastname || ''); setPhone(user?.phone || ''); }} style={{ flex: 1 }} />
              <Button title={saving ? 'Saving...' : 'Save'} onPress={handleSaveProfile} disabled={saving} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <View style={styles.infoList}>
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={18} color={Colors.textMuted} />
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{user?.firstname} {user?.lastname}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="mail-outline" size={18} color={Colors.textMuted} />
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{user?.email}</Text>
            </View>
            {user?.phone && (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={18} color={Colors.textMuted} />
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{user.phone}</Text>
              </View>
            )}
            {user?.ministry && (
              <View style={styles.infoRow}>
                <Ionicons name="people-outline" size={18} color={Colors.textMuted} />
                <Text style={styles.infoLabel}>Ministry</Text>
                <Text style={styles.infoValue}>{user.ministry}</Text>
              </View>
            )}
          </View>
        )}
      </Card>

      {/* Password Change */}
      <Card style={styles.section}>
        <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowPassword(!showPassword)}>
          <Text style={styles.sectionTitle}>Change Password</Text>
          <Ionicons name={showPassword ? 'chevron-up' : 'chevron-down'} size={22} color={Colors.textMuted} />
        </TouchableOpacity>

        {showPassword && (
          <>
            <Input label="Current Password" value={currentPassword} onChangeText={setCurrentPassword} icon="lock-closed-outline" secureTextEntry />
            <Input label="New Password" value={newPassword} onChangeText={setNewPassword} icon="key-outline" secureTextEntry />
            <Input label="Confirm New Password" value={confirmPassword} onChangeText={setConfirmPassword} icon="key-outline" secureTextEntry />
            <Button title={changingPassword ? 'Updating...' : 'Update Password'} onPress={handleChangePassword} disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} />
          </>
        )}
      </Card>

      {/* Logout */}
      <Button title="Sign Out" variant="danger" onPress={handleLogout} icon="log-out-outline" style={styles.logoutBtn} />

      {/* App Version */}
      <Text style={styles.version}>JSCI Mobile v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: Spacing.massive },

  headerGradient: { alignItems: 'center', paddingTop: Spacing.xxl, paddingBottom: Spacing.xl },
  avatarContainer: { marginBottom: Spacing.lg },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: Colors.primary },
  avatarPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.primaryMuted, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: Colors.primary,
  },
  avatarInitials: { color: Colors.primary, fontSize: 32, fontWeight: '800' },
  userName: { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: '800', marginBottom: 4 },
  userEmail: { color: Colors.textMuted, fontSize: FontSize.md, marginBottom: Spacing.sm },
  roleBadge: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  roleText: { fontWeight: '800', fontSize: FontSize.xs, letterSpacing: 1 },

  section: { marginHorizontal: Spacing.lg, marginTop: Spacing.lg, padding: Spacing.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: '700' },

  infoList: { gap: Spacing.lg },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  infoLabel: { color: Colors.textMuted, fontSize: FontSize.sm, width: 70, marginLeft: Spacing.sm },
  infoValue: { color: Colors.textPrimary, fontSize: FontSize.md, flex: 1, fontWeight: '500' },

  editActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },

  logoutBtn: { marginHorizontal: Spacing.lg, marginTop: Spacing.xxl },

  version: { color: Colors.textMuted, fontSize: FontSize.xs, textAlign: 'center', marginTop: Spacing.xl },
});
