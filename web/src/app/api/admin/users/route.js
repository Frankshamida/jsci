import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { ROLES, ASSIGNABLE_ROLES, getUserRoles } from '@/lib/permissions';
import { arrangeRoles, canHoldEventPermissions, getAddableRoles, getRoleChangeEffects, getRoleRemovalEffects, roleDetailsFor, roleSetupError } from '@/lib/userRoles';
import { formatAccountName, formatPersonName } from '@/lib/eventFormat';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What the User Management table needs of an account, after any change.
const USER_COLUMNS = 'id, member_id, firstname, lastname, email, ministry, sub_role, role, additional_roles, status, is_active, allowed_event_types, profile_picture';

const roleRejected = (role) => NextResponse.json(
  { success: false, message: `"${role}" is not a role. Choose one of: ${ASSIGNABLE_ROLES.join(', ')}.` },
  { status: 400 },
);

const notVerified = () => NextResponse.json(
  { success: false, message: 'Verify this user before changing their roles.' },
  { status: 409 },
);

// Giving a role that brings details of its own (Ministry Member, Pastor)
// takes those details in the same request: the ministry roles / pastor titles
// are checked here and saved with the role, or nothing is saved.
// @returns {{ error: string } | { details: object }}
const roleSetup = (current, nextRoles, updates) => {
  const sent = updates.ministry !== undefined || updates.sub_role !== undefined;
  const ministry = updates.ministry !== undefined ? updates.ministry : current.ministry;
  const subRole = updates.sub_role !== undefined ? updates.sub_role : current.sub_role;
  const error = roleSetupError(current, nextRoles, ministry, subRole);
  if (error) return { error };
  return { details: sent ? roleDetailsFor(nextRoles, ministry, subRole) : {} };
};

const notifyRoles = async (userId, message) => {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    title: '🔔 Your Role Has Been Updated',
    message: `${message} Some features and permissions may have changed accordingly.`,
    type: 'info',
    link: 'my-profile',
  });
  if (error) console.error('Failed to send role-change notification:', error.message);
};

// GET - Fetch all users (Admin, Super Admin) or get event permissions for a specific user
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Lightweight endpoint: any user can check their own event permissions.
    // It also hands back their roles and ministry, so a dashboard opened from
    // an old session catches up with changes made since it signed in.
    if (action === 'get-event-permissions') {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ success: false, message: 'userId required' }, { status: 400 });
      const { data, error } = await supabase.from('users')
        .select('allowed_event_types, role, additional_roles, ministry, sub_role, status, default_dashboard')
        .eq('id', userId).single();
      if (error) throw error;
      const { allowed_event_types: allowedEventTypes, ...account } = data || {};
      return NextResponse.json({ success: true, allowed_event_types: allowedEventTypes || [], account });
    }

    const role = searchParams.get('role');
    const ministry = searchParams.get('ministry');
    const status = searchParams.get('status');

    let query = supabase.from('users')
      .select('id, member_id, firstname, lastname, email, birthdate, ministry, sub_role, role, additional_roles, status, is_active, last_login, created_at, allowed_event_types, profile_picture')
      .order('created_at', { ascending: false });

    const subRole = searchParams.get('sub_role');
    if (subRole) query = query.eq('sub_role', subRole);

    if (role) query = query.eq('role', role);
    if (ministry) query = query.eq('ministry', ministry);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create user (Admin)
export async function POST(request) {
  try {
    const body = await request.json();
    const { firstname, lastname, email, password, ministry, sub_role } = body;
    const role = body.role || ROLES.GUEST;

    if (!firstname || !lastname || !email || !password) {
      return NextResponse.json({ success: false, message: 'Required fields missing' }, { status: 400 });
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return NextResponse.json({ success: false, message: 'Please enter a valid email address' }, { status: 400 });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) return roleRejected(role);

    const { data: existing } = await supabase.from('users').select('id').eq('email', email.trim().toLowerCase()).single();
    if (existing) {
      return NextResponse.json({ success: false, message: 'Email already exists' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const { data, error } = await supabase.from('users').insert({
      ...formatAccountName(firstname, lastname),
      email: email.trim().toLowerCase(), password: hashedPassword,
      ...roleDetailsFor(role, ministry, sub_role), role,
      security_question: 'Set by admin', security_answer: 'admin',
      status: 'Verified', is_active: true,
      allowed_event_types: canHoldEventPermissions(role) ? (body.allowed_event_types || []) : [],
    }).select('id, member_id, firstname, lastname, email, ministry, sub_role, role, status, is_active, created_at, allowed_event_types').single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'User created successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update user (Admin, Super Admin)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, action, ...updates } = body;

    if (!id) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    // Handle specific actions
    if (action === 'deactivate') {
      const { error } = await supabase.from('users').update({ is_active: false, status: 'Deactivated' }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'User deactivated' });
    }

    if (action === 'activate') {
      const { error } = await supabase.from('users').update({ is_active: true, status: 'Verified' }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'User activated' });
    }

    if (action === 'verify') {
      const { error } = await supabase.from('users').update({ status: 'Verified' }).eq('id', id);
      if (error) throw error;

      const { error: notifError } = await supabase.from('notifications').insert({
        user_id: id,
        title: '🎉 Your Account Has Been Verified',
        message: "Great news! Your account has been reviewed and verified by our team. You now have full access to all ministry features — welcome aboard!",
        type: 'success',
        link: 'my-profile',
      });
      if (notifError) console.error('Failed to send verification notification:', notifError.message);

      return NextResponse.json({ success: true, message: 'User verified' });
    }

    if (action === 'reset-password') {
      const newPassword = updates.newPassword || 'Password123!';
      const hashed = await bcrypt.hash(newPassword, 12);
      const { error } = await supabase.from('users').update({ password: hashed }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Password reset successfully' });
    }

    // Everything below needs the account as it stands now: a role change
    // clears what no remaining role owns, and details are checked against the roles.
    const { data: current, error: currentError } = await supabase.from('users')
      .select('role, additional_roles, email, status, ministry, sub_role, allowed_event_types').eq('id', id).single();
    if (currentError || !current) return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });

    // Change the main role
    if (action === 'assign-role') {
      const newRole = updates.role;
      if (!ASSIGNABLE_ROLES.includes(newRole)) return roleRejected(newRole);
      if (current.status !== 'Verified') return notVerified();
      if (current.role === newRole) return NextResponse.json({ success: true, message: `Already ${newRole}` });

      // Includes role and additional_roles, arranged so the highest is the main role.
      const effects = getRoleChangeEffects(current, newRole);
      const setup = roleSetup(current, effects.roles, updates);
      if (setup.error) return NextResponse.json({ success: false, message: setup.error }, { status: 400 });
      const { data, error } = await supabase.from('users').update({ ...effects.updates, ...setup.details }).eq('id', id)
        .select(USER_COLUMNS).single();
      if (error) throw error;

      await notifyRoles(id, `Your role has been changed from "${current.role}" to "${newRole}" by an administrator.`);
      return NextResponse.json({ success: true, data, message: `Role updated to ${newRole}` });
    }

    // Add a role on top of the main one
    if (action === 'add-role') {
      const role = updates.role;
      if (!ASSIGNABLE_ROLES.includes(role)) return roleRejected(role);
      if (current.status !== 'Verified') return notVerified();
      if (!getAddableRoles(current).includes(role)) {
        return NextResponse.json({ success: false, message: `"${role}" cannot be added to this account.` }, { status: 400 });
      }
      // Adding deletes nothing. A role higher than the current main role becomes the main role.
      const next = arrangeRoles([...getUserRoles(current), role]);
      const setup = roleSetup(current, [next.role, ...next.additional_roles], updates);
      if (setup.error) return NextResponse.json({ success: false, message: setup.error }, { status: 400 });
      const { data, error } = await supabase.from('users')
        .update({ ...next, ...setup.details }).eq('id', id)
        .select(USER_COLUMNS).single();
      if (error) throw error;

      await notifyRoles(id, `You have been given the "${role}" role by an administrator.`);
      return NextResponse.json({ success: true, data, message: `${role} role added` });
    }

    // Take one of several roles away
    if (action === 'remove-role') {
      const role = updates.role;
      const held = getUserRoles(current);
      if (!held.includes(role) || held.length < 2) {
        return NextResponse.json({ success: false, message: `"${role}" is not one of several roles on this account. Change the main role instead.` }, { status: 400 });
      }
      const { updates: cleared } = getRoleRemovalEffects(current, role);
      const { data, error } = await supabase.from('users').update(cleared).eq('id', id)
        .select(USER_COLUMNS).single();
      if (error) throw error;

      await notifyRoles(id, `Your "${role}" role has been removed by an administrator.`);
      return NextResponse.json({ success: true, data, message: `${role} role removed` });
    }

    if (action === 'update-event-permissions') {
      const types = updates.allowed_event_types || [];
      if (types.length && !canHoldEventPermissions(getUserRoles(current))) {
        return NextResponse.json({ success: false, message: `A ${current.role} cannot be given event permissions.` }, { status: 400 });
      }
      const { error } = await supabase.from('users').update({ allowed_event_types: types }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Event creation permissions updated' });
    }

    // General update
    const updateData = {};
    if (updates.firstname?.trim()) updateData.firstname = formatPersonName(updates.firstname);
    if (updates.lastname?.trim()) updateData.lastname = formatPersonName(updates.lastname, { continues: true });

    if (updates.email !== undefined) {
      const email = String(updates.email || '').trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        return NextResponse.json({ success: false, message: 'Please enter a valid email address' }, { status: 400 });
      }
      if (email !== (current.email || '').toLowerCase()) {
        const { data: taken } = await supabase.from('users').select('id').eq('email', email).neq('id', id).maybeSingle();
        if (taken) return NextResponse.json({ success: false, message: 'Another account already uses this email' }, { status: 409 });
        updateData.email = email;
      }
    }

    const roleChanged = updates.role && updates.role !== current.role;
    let roles = getUserRoles(current);
    if (roleChanged) {
      if (!ASSIGNABLE_ROLES.includes(updates.role)) return roleRejected(updates.role);
      if (current.status !== 'Verified') return notVerified();
      const effects = getRoleChangeEffects(current, updates.role);
      const setupError = roleSetup(current, effects.roles, updates).error;
      if (setupError) return NextResponse.json({ success: false, message: setupError }, { status: 400 });
      Object.assign(updateData, effects.updates);
      roles = effects.roles;
    }

    if (updates.ministry !== undefined || updates.sub_role !== undefined) {
      Object.assign(updateData, roleDetailsFor(
        roles,
        updates.ministry !== undefined ? updates.ministry : current.ministry,
        updates.sub_role !== undefined ? updates.sub_role : current.sub_role,
      ));
    }
    if (updates.status) updateData.status = updates.status;
    if (updates.allowed_event_types !== undefined) {
      updateData.allowed_event_types = canHoldEventPermissions(roles) ? updates.allowed_event_types : [];
    }
    if (Object.keys(updateData).length === 0) return NextResponse.json({ success: true, message: 'Nothing to update' });

    const { data, error } = await supabase.from('users').update(updateData).eq('id', id)
      .select(USER_COLUMNS).single();
    if (error) throw error;

    if (roleChanged) await notifyRoles(id, `Your role has been changed from "${current.role}" to "${updates.role}" by an administrator.`);

    return NextResponse.json({ success: true, data, message: 'User updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Delete user (Super Admin only)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'User permanently deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
