// /id/<code>: what scanning a church ID's QR code shows. For ushers at the
// door: the photo, the name, the role, and whether the ID is valid. Nothing
// private (no e-mail, birthday, phone or emergency contact). A card reported
// lost has a new code, so its old QR lands on "not valid".

import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles } from '@/lib/permissions';
import { MINISTRY_ROLES, describeMinistry, parseMinistryCards, parsePastorTitles } from '@/lib/userRoles';
import { ID_CARD_TITLE, MINISTRIES, ID_MINISTRY_FOR_ROLE, idDate } from '@/lib/churchIdCard';
import './idCheck.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ID check · Joyful Sound Church', robots: { index: false, follow: false } };

const COLS = 'firstname, lastname, role, additional_roles, ministry, sub_role, member_id, profile_picture, status, is_active, id_valid_until';

async function findCard(code) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(code || '')) return null;
  for (const cols of [`${COLS}, name_prefix`, COLS]) {
    const { data, error } = await supabaseAdmin.from('users').select(cols).eq('id_code', code).maybeSingle();
    if (error) { if (error.code === '42703') continue; return null; }
    return data;
  }
  return null;
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function IdCheckPage({ params }) {
  const user = await findCard(params?.code);
  if (!user) {
    return (
      <main className="idc-page"><div className="idc-box">
        <div className="idc-state bad"><span className="idc-dot" /> Not a valid ID</div>
        <h1>This ID could not be found</h1>
        <p className="idc-sub">The card may have been reported lost and replaced. Please ask the person for their current ID, or check with the church office.</p>
      </div></main>
    );
  }

  const roles = getUserRoles(user);
  const name = [user.name_prefix, user.firstname, user.lastname].filter(Boolean).join(' ');
  const { cards } = parseMinistryCards(user.ministry, user.sub_role);
  let kind = 'member';
  let line = 'Member of Joyful Sound Church International';
  if (roles.includes('Pastor')) {
    kind = 'pastor';
    line = parsePastorTitles(user.sub_role)[0] || 'Pastor';
  } else if (cards.length && roles.some((r) => ['Ministry Member', 'Song Leader', 'Leader'].includes(r))) {
    kind = 'ministry';
    const first = cards[0];
    const group = describeMinistry(user.ministry, user.sub_role).find((g) => g.key === first.key);
    const ministry = MINISTRIES[ID_MINISTRY_FOR_ROLE[first.key]]?.ministry_name || MINISTRY_ROLES.find((m) => m.key === first.key)?.title;
    line = [ministry, (group?.chips || []).join(' · ')].filter(Boolean).join(' · ');
  }
  const expired = user.id_valid_until && user.id_valid_until < today();
  const valid = user.is_active !== false && user.status === 'Verified' && !expired;
  const initials = `${user.firstname?.[0] || ''}${user.lastname?.[0] || ''}`.toUpperCase();

  return (
    <main className="idc-page"><div className="idc-box">
      <div className={`idc-state ${valid ? 'ok' : 'bad'}`}><span className="idc-dot" /> {valid ? 'Valid ID' : expired ? 'This ID has expired' : 'Not a valid ID'}</div>
      <div className="idc-photo">
        {user.profile_picture
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={user.profile_picture} alt="" referrerPolicy="no-referrer" />
          : <span>{initials}</span>}
      </div>
      <h1>{name}</h1>
      <p className="idc-sub">{line}</p>
      <dl className="idc-facts">
        <div><dt>Card</dt><dd>{ID_CARD_TITLE[kind]}</dd></div>
        {user.member_id && <div><dt>ID no.</dt><dd>{user.member_id}</dd></div>}
        {user.id_valid_until && <div><dt>Valid until</dt><dd>{idDate(user.id_valid_until, 'month')}</dd></div>}
      </dl>
      <p className="idc-foot">Joyful Sound Church International · Cebu City</p>
    </div></main>
  );
}
