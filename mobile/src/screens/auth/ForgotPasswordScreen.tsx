// ============================================
// JSCI Mobile — Forgot Password Screen
// ============================================

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  TouchableOpacity, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize } from '../../theme';
import { Input, Button } from '../../components';
import api from '../../services/api';
import Toast from 'react-native-toast-message';

interface ForgotPasswordScreenProps {
  navigation: any;
}

type Step = 'email' | 'otp' | 'reset';

export default function ForgotPasswordScreen({ navigation }: ForgotPasswordScreenProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [serverOtp, setServerOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!email.trim()) {
      Toast.show({ type: 'error', text1: 'Required', text2: 'Please enter your email address' });
      return;
    }
    setLoading(true);
    try {
      const res = await api.sendOtp(email.trim().toLowerCase());
      if (res.success && res.data) {
        setServerOtp((res.data as any).otp || (res as any).otp || '');
        Toast.show({ type: 'success', text1: 'OTP Sent', text2: 'Check the console or email for your OTP code' });
        setStep('otp');
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: res.message || 'Failed to send OTP' });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim()) {
      Toast.show({ type: 'error', text1: 'Required', text2: 'Please enter the OTP code' });
      return;
    }
    setLoading(true);
    try {
      const res = await api.verifyOtp(email.trim().toLowerCase(), otp.trim());
      if (res.success) {
        Toast.show({ type: 'success', text1: 'Verified', text2: 'OTP verified! Set your new password.' });
        setStep('reset');
      } else {
        Toast.show({ type: 'error', text1: 'Invalid OTP', text2: res.message || 'OTP verification failed' });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 8) {
      Toast.show({ type: 'error', text1: 'Weak Password', text2: 'Password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      Toast.show({ type: 'error', text1: 'Mismatch', text2: 'Passwords do not match' });
      return;
    }
    setLoading(true);
    try {
      const res = await api.resetPassword(email.trim().toLowerCase(), newPassword);
      if (res.success) {
        Toast.show({ type: 'success', text1: 'Password Reset!', text2: 'You can now sign in with your new password.' });
        navigation.navigate('Login');
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: res.message || 'Failed to reset password' });
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setLoading(false);
    }
  };

  const stepConfig = {
    email: { icon: 'mail-outline' as const, title: 'Forgot Password', subtitle: 'Enter your email to receive a verification code' },
    otp: { icon: 'keypad-outline' as const, title: 'Verify OTP', subtitle: 'Enter the 6-digit code sent to your email' },
    reset: { icon: 'lock-open-outline' as const, title: 'New Password', subtitle: 'Create a strong new password for your account' },
  };

  const cfg = stepConfig[step];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <TouchableOpacity onPress={() => step === 'email' ? navigation.goBack() : setStep(step === 'reset' ? 'otp' : 'email')} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>

          {/* Step Indicator */}
          <View style={styles.steps}>
            {(['email', 'otp', 'reset'] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                <View style={[styles.stepDot, (step === s || (['otp', 'reset'].includes(step) && i === 0) || (step === 'reset' && i === 1)) && styles.stepDotActive]} />
                {i < 2 && <View style={[styles.stepLine, ((['otp', 'reset'].includes(step) && i === 0) || (step === 'reset' && i === 1)) && styles.stepLineActive]} />}
              </React.Fragment>
            ))}
          </View>

          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name={cfg.icon} size={28} color={Colors.primary} />
            </View>
            <Text style={styles.title}>{cfg.title}</Text>
            <Text style={styles.subtitle}>{cfg.subtitle}</Text>
          </View>

          {step === 'email' && (
            <>
              <Input label="Email Address" icon="mail-outline" placeholder="Enter your email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              <Button title="Send OTP Code" onPress={handleSendOtp} loading={loading} icon="send-outline" size="lg" />
            </>
          )}

          {step === 'otp' && (
            <>
              <Input label="OTP Code" icon="keypad-outline" placeholder="Enter 6-digit OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} />
              <Button title="Verify OTP" onPress={handleVerifyOtp} loading={loading} icon="checkmark-circle-outline" size="lg" />
              <TouchableOpacity onPress={handleSendOtp} style={styles.resendBtn}>
                <Text style={styles.resendText}>Didn&apos;t receive it? Resend OTP</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'reset' && (
            <>
              <Input label="New Password" icon="lock-closed-outline" placeholder="At least 8 characters" value={newPassword} onChangeText={setNewPassword} isPassword />
              <Input label="Confirm Password" icon="shield-checkmark-outline" placeholder="Re-enter new password" value={confirmPassword} onChangeText={setConfirmPassword} isPassword />
              <Button title="Reset Password" onPress={handleResetPassword} loading={loading} icon="refresh-outline" size="lg" />
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: Spacing.xxl, paddingBottom: Spacing.xxxl },
  backBtn: {
    marginTop: Platform.OS === 'ios' ? 56 : 44,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  stepDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: Colors.cardBorder,
  },
  stepDotActive: {
    backgroundColor: Colors.primary,
  },
  stepLine: {
    width: 40, height: 2,
    backgroundColor: Colors.cardBorder,
    marginHorizontal: Spacing.xs,
  },
  stepLineActive: {
    backgroundColor: Colors.primary,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  title: { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: '700' },
  subtitle: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: Spacing.xs, textAlign: 'center' },
  resendBtn: { alignItems: 'center', marginTop: Spacing.xl },
  resendText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
});
