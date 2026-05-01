import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Default Terms & Conditions content (used when table doesn't exist yet)
const DEFAULT_TERMS = `<h2>Terms and Conditions</h2>
<p><strong>Last Updated:</strong> March 6, 2026</p>

<h3>1. Acceptance of Terms</h3>
<p>By creating an account and using the SanctuaryHub platform, you agree to be bound by these Terms and Conditions. If you do not agree, please do not create an account.</p>

<h3>2. Account Registration</h3>
<p>You must provide accurate and complete information when creating your account. You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account.</p>

<h3>3. User Conduct</h3>
<p>As a member of the SanctuaryHub community, you agree to:</p>
<ul>
  <li>Treat all members with respect and kindness</li>
  <li>Not post or share content that is offensive, hateful, or inappropriate</li>
  <li>Not use the platform for any unlawful purposes</li>
  <li>Not attempt to access other users' accounts or private information</li>
  <li>Follow the guidelines set by church leadership</li>
</ul>

<h3>4. Community Guidelines</h3>
<p>The Community Hub and messaging features are intended for fellowship, encouragement, and ministry-related discussions. Content that promotes harassment, discrimination, or false teachings will be removed and may result in account suspension.</p>

<h3>5. Privacy & Data</h3>
<p>We respect your privacy. Your personal information (name, email, birthdate) is stored securely and used only for platform functionality. We do not sell or share your data with third parties. Profile information you choose to share within the community is visible to other verified members.</p>

<h3>6. Content Ownership</h3>
<p>Content you post (community posts, comments, messages) remains yours, but you grant SanctuaryHub a non-exclusive license to display it within the platform. Church leadership reserves the right to moderate or remove content that violates these terms.</p>

<h3>7. Account Verification</h3>
<p>New accounts require verification by church administrators before full platform access is granted. Guest accounts have limited access to certain features.</p>

<h3>8. Age Requirement</h3>
<p>You must be at least 13 years old to create an account on this platform. Users under 18 should have parental consent.</p>

<h3>9. Modifications</h3>
<p>SanctuaryHub reserves the right to modify these Terms and Conditions at any time. Continued use of the platform after changes constitutes acceptance of the updated terms.</p>

<h3>10. Termination</h3>
<p>SanctuaryHub reserves the right to suspend or terminate accounts that violate these terms or disrupt the community.</p>

<h3>11. Contact</h3>
<p>For questions regarding these terms, please contact church administration through the platform or during church services.</p>`;

// GET - Fetch Terms & Conditions (public)
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('terms_conditions')
      .select('*')
      .order('id', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // Table might not exist yet or no rows - return default content
      console.warn('Terms fetch warning:', error.message);
      return NextResponse.json({
        success: true,
        data: {
          content: DEFAULT_TERMS,
          updated_at: null,
          updated_by: 'System',
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        content: data.content || DEFAULT_TERMS,
        updated_at: data.updated_at,
        updated_by: data.updated_by,
      },
    });
  } catch (error) {
    // Even on unexpected errors, return default content instead of 500
    console.error('Terms fetch error:', error.message);
    return NextResponse.json({
      success: true,
      data: {
        content: DEFAULT_TERMS,
        updated_at: null,
        updated_by: 'System',
      },
    });
  }
}

// PUT - Update Terms & Conditions (Super Admin / Admin only)
export async function PUT(request) {
  try {
    const { content, updatedBy } = await request.json();

    if (!content) {
      return NextResponse.json(
        { success: false, message: 'Content is required' },
        { status: 400 }
      );
    }

    // Try to get the latest record
    const { data: existing, error: fetchError } = await supabase
      .from('terms_conditions')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
      .single();

    if (fetchError && fetchError.code === '42P01') {
      // Table doesn't exist
      return NextResponse.json(
        { success: false, message: 'Terms & Conditions table not found. Please run the migration SQL first (migration_v14_terms_conditions.sql).' },
        { status: 500 }
      );
    }

    let result;
    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('terms_conditions')
        .update({
          content,
          updated_by: updatedBy || 'Admin',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('terms_conditions')
        .insert({
          content,
          updated_by: updatedBy || 'Admin',
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Terms & Conditions updated successfully',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
