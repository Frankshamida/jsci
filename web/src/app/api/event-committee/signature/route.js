import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isCommitteeMember, isEventManager } from '@/lib/eventCommittee';

export const dynamic = 'force-dynamic';

// Somebody's own signature: the printed name, and the mark that goes above it.
//
// Every route here acts on the CALLER and nobody else. There is no userId
// parameter to pass, deliberately - a signature that one account can set on
// another is not a signature, it is a forgery with an audit trail. An Admin
// who needs somebody else's signature on a document has to ask them for it,
// which is the same rule as on paper.

const COLUMNS = 'id, firstname, lastname, signature_url, signature_path, signature_name, signature_updated_at';
const BUCKET = 'profile';
const FOLDER = 'signatures';

function migrationMissing(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('signature_url') || text.includes('signature_name') || text.includes('signature_path');
}

const NEEDS_MIGRATION = () => NextResponse.json({
  success: false,
  code: 'NEEDS_MIGRATION',
  message: 'The signature columns are not in the database yet. Run supabase/migrations/e_signature.sql in the Supabase SQL editor.',
}, { status: 503 });

// Anyone who can open this dashboard may set their own signature. It is not an
// Admin power - a committee member on a door hands over receipts too.
async function requireCommittee(actorId) {
  const actor = await findEventActor(actorId);
  if (!actor) return null;
  return (isEventManager(actor) || isCommitteeMember(actor)) ? actor : null;
}

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// GET ?actorId=..  -> the caller's own signature
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireCommittee(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied.' }, { status: 403 });

    const { data, error } = await supabase.from('users').select(COLUMNS).eq('id', actor.id).single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      data: {
        signatureUrl: data.signature_url || '',
        signaturePath: data.signature_path || '',
        // Falls back to the name the account was registered under, so the
        // field opens with something sensible in it rather than empty.
        signatureName: data.signature_name || `${data.firstname || ''} ${data.lastname || ''}`.trim(),
        // Whether a name has actually been CHOSEN, as opposed to guessed at
        // from the account. The screen uses this to know if step one is done.
        hasName: !!data.signature_name,
        updatedAt: data.signature_updated_at || null,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT { actorId, signatureName?, signatureUrl?, signaturePath? }
//
// The name can be saved on its own - that is step one, and it is worth keeping
// before anybody has drawn anything. A signature without a name cannot be
// saved: a mark with no printed name under it is not a signature block, and
// nobody reading the document would know whose mark it is.
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await requireCommittee(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied.' }, { status: 403 });

    const update = { signature_updated_at: new Date().toISOString() };

    if (body.signatureName !== undefined) {
      const name = clean(body.signatureName);
      if (!name) return NextResponse.json({ success: false, message: 'Enter the full name to print under the signature.' }, { status: 400 });
      if (name.length > 120) return NextResponse.json({ success: false, message: 'That name is too long for a signature line.' }, { status: 400 });
      update.signature_name = name;
    }

    if (body.signatureUrl !== undefined) {
      const url = clean(body.signatureUrl);
      if (url) {
        const { data: existing } = await supabase
          .from('users').select('signature_name').eq('id', actor.id).single();
        const name = clean(body.signatureName) || existing?.signature_name;
        if (!name) {
          return NextResponse.json({
            success: false,
            message: 'Set the printed name first — a signature with no name under it says nothing about who signed.',
          }, { status: 400 });
        }
      }
      update.signature_url = url;
      update.signature_path = clean(body.signaturePath);
    }

    const { data, error } = await supabase
      .from('users').update(update).eq('id', actor.id).select(COLUMNS).single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      data: {
        signatureUrl: data.signature_url || '',
        signaturePath: data.signature_path || '',
        signatureName: data.signature_name || '',
        hasName: !!data.signature_name,
        updatedAt: data.signature_updated_at || null,
      },
      message: body.signatureUrl !== undefined ? 'Signature saved' : 'Printed name saved',
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?actorId=..  -> remove the mark, keep the printed name
//
// The name is left alone on purpose: somebody clearing a signature is almost
// always about to draw a better one, and making them type their name again to
// do it is a small insult.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireCommittee(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied.' }, { status: 403 });

    const { data: existing } = await supabase
      .from('users').select('signature_path').eq('id', actor.id).single();

    const { error } = await supabase
      .from('users')
      .update({ signature_url: null, signature_path: null, signature_updated_at: new Date().toISOString() })
      .eq('id', actor.id);
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    // Best effort. A file left in the bucket is a few kilobytes; a failed
    // delete that blocked the change would leave a signature the person has
    // said they no longer want still attached to their account.
    if (existing?.signature_path?.startsWith(`${FOLDER}/`)) {
      try { await supabase.storage.from(BUCKET).remove([existing.signature_path]); } catch { /* non-fatal */ }
    }

    return NextResponse.json({ success: true, message: 'Signature removed' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
