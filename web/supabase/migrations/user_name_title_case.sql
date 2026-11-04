-- ============================================================
-- Names in Title Case
-- Run this in the Supabase SQL editor. Safe to re-run. Deploy order does not
-- matter.
--
-- The app now saves every name the way it should read ("frank DwEEZel gomez"
-- -> "Frank Dweezel Gomez"). This fixes the accounts saved before that:
-- users.firstname and users.lastname, by the same rule as formatPersonName in
-- lib/eventFormat.js -
--   * every word capitalised, the rest lowercase
--   * also after - ' . : Anne-Marie, O'Brien, J.R.
--   * Filipino particles in the middle stay lowercase: Juan dela Cruz
--   * a suffix at the end stays in capitals: Juan Cruz III
-- The old spellings go into users_name_backup first.
-- ============================================================

-- The rule, as a temporary function (gone when this session ends).
-- continues = this is a last name, so it carries on from the first name.
create or replace function pg_temp.format_person_name(raw text, continues boolean)
returns text language plpgsql immutable as $$
declare
  words text[];
  word text;
  result text[] := '{}';
  built text;
  ch text;
  cap_next boolean;
  n int;
begin
  if raw is null then return null; end if;
  raw := btrim(regexp_replace(raw, '\s+', ' ', 'g'));
  if raw = '' then return raw; end if;
  words := string_to_array(lower(raw), ' ');
  n := array_length(words, 1);
  for i in 1..n loop
    word := words[i];
    if (i > 1 or continues) and i < n
       and word = any (array['de','del','dela','delos','delas','da','di','van','von','y','la','las','los','san','santa']) then
      result := result || word;
    elsif (i > 1 or continues) and i = n
       and word = any (array['ii','iii','iv','vi','vii','viii','ix']) then
      result := result || upper(word);
    else
      built := '';
      cap_next := true;
      for j in 1..char_length(word) loop
        ch := substr(word, j, 1);
        built := built || case when cap_next then upper(ch) else ch end;
        cap_next := ch in ('-', '''', '.');
      end loop;
      result := result || built;
    end if;
  end loop;
  return array_to_string(result, ' ');
end $$;

-- Preview (optional): run the function above together with this select to
-- see every name that would change, before running the rest.
-- select member_id, firstname, lastname,
--        pg_temp.format_person_name(firstname, false) as new_firstname,
--        pg_temp.format_person_name(lastname, true)  as new_lastname
-- from users
-- where firstname is distinct from pg_temp.format_person_name(firstname, false)
--    or lastname  is distinct from pg_temp.format_person_name(lastname, true)
-- order by member_id;

begin;

-- RLS on with no policy: only the service-role client can read it.
create table if not exists users_name_backup (
  user_id uuid primary key,
  firstname text,
  lastname text,
  backed_up_at timestamptz default now()
);
alter table users_name_backup enable row level security;

-- Re-running keeps the first snapshot.
insert into users_name_backup (user_id, firstname, lastname)
select id, firstname, lastname from users
where firstname is distinct from pg_temp.format_person_name(firstname, false)
   or lastname  is distinct from pg_temp.format_person_name(lastname, true)
on conflict (user_id) do nothing;

update users
set firstname = pg_temp.format_person_name(firstname, false),
    lastname  = pg_temp.format_person_name(lastname, true)
where firstname is distinct from pg_temp.format_person_name(firstname, false)
   or lastname  is distinct from pg_temp.format_person_name(lastname, true);

commit;

-- ---- To undo ----
-- update users u set firstname = b.firstname, lastname = b.lastname
--   from users_name_backup b where b.user_id = u.id;
