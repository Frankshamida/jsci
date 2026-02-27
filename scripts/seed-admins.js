/**
 * Seed Script: Create Admin & Super Admin Accounts
 * Run with: node scripts/seed-admins.js
 *
 * This creates two verified accounts in your Supabase users table.
 * Change the credentials below before running if you want custom ones.
 */

const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

// ============================================================
// SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = 'https://okgootzwaklvzywtbwub.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZ29vdHp3YWtsdnp5d3Rid3ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNzUxNjEsImV4cCI6MjA4Nzc1MTE2MX0.k0N5q6Xbc5UKyQwBqVkM5vATA0Lvg1dzYJxxh4NRIF8';

// ============================================================
// ACCOUNTS TO CREATE — Change these credentials as needed!
// ============================================================
const ACCOUNTS = [
  {
    firstname: 'Admin',
    lastname: 'JSCI',
    username: 'jsci_admin',
    password: 'Admin@123!',
    role: 'Admin',
    ministry: 'Media',
    security_question: 'What is the name of your church?',
    security_answer: 'joyful sound',
  },
  {
    firstname: 'Super',
    lastname: 'Admin',
    username: 'jsci_superadmin',
    password: 'SuperAdmin@123!',
    role: 'Super Admin',
    ministry: 'Media',
    security_question: 'What is the name of your church?',
    security_answer: 'joyful sound',
  },
];

// ============================================================
// MAIN
// ============================================================
async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log('\n🚀 JSCI Admin Seeder');
  console.log('════════════════════════════════════\n');

  for (const account of ACCOUNTS) {
    process.stdout.write(`⏳ Creating [${account.role}] → ${account.username} ... `);

    // Check if username already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', account.username)
      .single();

    if (existing) {
      console.log(`⚠️  SKIPPED — username "${account.username}" already exists`);
      continue;
    }

    // Hash password and security answer
    const hashedPassword = await bcrypt.hash(account.password, 12);
    const hashedAnswer = await bcrypt.hash(account.security_answer.trim().toLowerCase(), 12);

    const { data, error } = await supabase
      .from('users')
      .insert({
        firstname: account.firstname,
        lastname: account.lastname,
        username: account.username,
        password: hashedPassword,
        role: account.role,
        ministry: account.ministry,
        security_question: account.security_question,
        security_answer: hashedAnswer,
        status: 'Verified',
        is_active: true,
      })
      .select('id, member_id, username, role, status')
      .single();

    if (error) {
      console.log(`❌ FAILED — ${error.message}`);
    } else {
      console.log(`✅ CREATED`);
      console.log(`   Member ID : ${data.member_id || 'auto-generated'}`);
      console.log(`   Role      : ${data.role}`);
      console.log(`   Status    : ${data.status}`);
    }
    console.log('');
  }

  console.log('════════════════════════════════════');
  console.log('📋 Login Credentials Summary:\n');
  for (const account of ACCOUNTS) {
    console.log(`  [${account.role}]`);
    console.log(`    Username : ${account.username}`);
    console.log(`    Password : ${account.password}`);
    console.log('');
  }
  console.log('⚠️  Keep these credentials safe and change passwords after first login!\n');
}

main().catch(console.error);
