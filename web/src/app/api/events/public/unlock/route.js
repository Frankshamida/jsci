import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  eventForPublicSlug, registrationForCode, homeEventForCode, displayName, issuePass, unlockAllowed,
  REG_FIELDS,
} from '@/lib/eventAccess';
import { FIRST_LETTERS, lastNameOf, passwordMatchKind, passwordMatches, passwordYear } from '@/lib/eventPublic';
import { isPlausibleUid } from '@/lib/rfid';
import { resolveEventCard } from '@/lib/rfidEventCard';

const fail = (message, status) => NextResponse.json({ success: false, message }, { status });

// Who may open the photos: anyone registered for the event, paid or not yet
// (most attendees pay cash at the desk) - only a cancelled or deleted
// registration is left out. Door check-in keeps its own, stricter list.
const canSeePhotos = (reg) => !!reg && !reg.deleted_at && reg.status !== 'cancelled';

// POST /api/events/public/unlock
//   { slug, code?, password }  -> the password LASTNAME@2026
//   { slug, code?, uid }       -> an RFID card tapped on the reader / phone
//
// Answers with a pass for the photos. `code` is the code from the ID's QR
// (remembered by the browser). It only says who to try first: a password or
// card of ANY settled attendee of this event still opens the photos, so a
// phone or a shared link that once opened someone else's QR does not lock
// everybody else out.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const event = await eventForPublicSlug(body.slug);
    if (!event) return fail('Event not found', 404);
    if (!unlockAllowed(request, event.id)) {
      return fail('Too many tries. Please wait a few minutes and try again.', 429);
    }

    const owner = body.code ? await registrationForCode(event.id, body.code) : null;
    if (body.code && !owner) {
      // Their code, but another event: an attendee only opens the photos of
      // the event they are registered in.
      const home = await homeEventForCode(body.code);
      if (home) {
        return NextResponse.json({
          success: false, redirect: home.slug,
          message: `Your ID is for ${home.event.title}. Open that event to see its photos.`,
        }, { status: 403 });
      }
      // A code nobody holds any more (an old QR, a mistyped link): ignore it
      // and check the password or card against the whole event.
    }
    // The code's holder, unless their registration was cancelled.
    const verifiedOwner = canSeePhotos(owner) ? owner : null;

    let reg = null;

    if (body.uid !== undefined) {
      if (!isPlausibleUid(body.uid)) return fail('That card could not be read. Please tap it again.', 400);
      const found = await resolveEventCard(event.id, body.uid, REG_FIELDS);
      reg = found.registration;
      if (!reg) return fail('This card is not linked to anyone at this event.', 403);
      if (!canSeePhotos(reg)) {
        return fail("This card's registration was cancelled.", 403);
      }
    } else {
      const password = String(body.password || '').trim();
      if (!password) return fail('Enter your password.', 400);
      if (password !== password.toUpperCase()) {
        return fail(`The password is in ALL CAPITAL letters, e.g. DELACRUZ@${passwordYear(event)}.`, 401);
      }
      if (verifiedOwner && passwordMatches(password, verifiedOwner, event)) {
        reg = verifiedOwner;
      } else {
        const { data, error } = await supabaseAdmin
          .from('event_registrations')
          .select(REG_FIELDS)
          .eq('event_id', event.id)
          .neq('status', 'cancelled')
          .is('deleted_at', null);
        if (error) throw error;
        const rows = data || [];
        const kinds = rows.map((r) => ({ r, kind: passwordMatchKind(password, r, event) })).filter((m) => m.kind);
        // The most specific form wins: a first name in the password says who it is.
        const pick = (kind) => kinds.filter((m) => m.kind === kind).map((m) => m.r);
        const byFull = pick('full');
        const byFirst = pick('first4');
        const byLast = pick('last');
        const year = passwordYear(event);

        if (byFull.length > 1) {
          // Same first and last name: only the card can tell them apart.
          return fail('Two attendees share that exact name. Please use your RFID card instead, or ask the registration desk.', 409);
        }
        if (byFull.length === 1) reg = byFull[0];
        else if (byFirst.length === 1) reg = byFirst[0];
        else if (byFirst.length > 1) {
          // Maria and Marian Clara: the first 4 letters are shared too.
          return fail(`More than one attendee matches that. Type your WHOLE first name, then your last name, then @${year} - e.g. JUANITODELACRUZ@${year}.`, 409);
        } else if (byLast.length === 1) reg = byLast[0];
        else if (byLast.length > 1) {
          // A shared family name cannot say who this is - ask for the first name too.
          const last = String(lastNameOf(byLast[0])).toUpperCase();
          const lastKey = last.replace(/[^A-Z]/g, '');
          return NextResponse.json({
            success: false,
            sameLastName: true,
            message: `Seems more than one attendee has the last name ${last}. Please type the first ${FIRST_LETTERS} letters of your first name (all of it if your first name is shorter), then your last name, then @${year} - e.g. JUAN${lastKey}@${year}.`,
          }, { status: 409 });
        }
      }
      if (!reg && owner && !verifiedOwner && passwordMatches(password, owner, event)) {
        return fail('Your registration was cancelled, so the photos cannot be opened.', 403);
      }
      if (!reg) return fail(`Wrong password. It is your LAST NAME in capitals, then @${passwordYear(event)} - e.g. DELACRUZ@${passwordYear(event)}.`, 401);
    }

    return NextResponse.json({
      success: true,
      pass: issuePass(event.id, reg.id),
      name: displayName(reg),
      // Who actually unlocked - the page forgets a QR code that was someone else's.
      code: reg.public_code || null,
    });
  } catch (error) {
    return fail(error.message, 500);
  }
}
