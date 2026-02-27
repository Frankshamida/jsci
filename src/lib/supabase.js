import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

let supabase;

try {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} catch (error) {
  console.warn('⚠️ Supabase client initialization failed. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  supabase = null;
}

export { supabase };
