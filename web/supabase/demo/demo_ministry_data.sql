-- ============================================================
-- DEMO DATA - ministry attendance and Sunday lineups, Aug to Nov 2026
--
--   So the Pastor's Home, Joyful Cares and the reports show real-looking
--   numbers. For every Sunday from Aug 2 to Nov 22, 2026:
--
--   schedules       a lineup: song leader, 3 backup singers, the musicians
--                   (by instrument), the dancers, 2 slow and 3 fast songs,
--                   practice the Saturday before at 3:00 PM
--   attendance      Sunday check-ins for every ministry member (every
--                   ministry - ushers too, once anyone has that role) and the
--                   five pastors, and practice check-ins for the lineup
--   lineup_excuses  a few excuses, with reasons
--
--   And coming up (asked for on 2026-11-27, as real, published events):
--
--   events             Christmas Outreach (Dec 12), Youth Christmas Night
--                      (Dec 18), Christmas Eve Service (Dec 24), Watch Night
--                      Service (Dec 31) - PUBLISHED: on the public home page
--                      and in members' Events, open for registration
--   event_registrations 146 and 52 sign-ups for the first two (names only:
--                      no email or mobile, so nobody is ever messaged)
--   ministry_meetings  Praise & Worship planning (Dec 3), Media setup (Dec 5):
--                      their ministries' members see them. No RSVPs are made
--                      for anybody.
--
--   A realistic mix, the same every time it is run: most members are
--   faithful; two stopped coming after Oct 25 (Joyful Cares: needs a
--   follow-up, and they miss their lineup duties); one comes about half as
--   often since October (watch); one sent three excuses in November (watch);
--   one comes now and then.
--
--   Lineups and check-ins only in the past: nothing for Nov 29 or later. A
--   lineup for a coming Sunday is a real assignment to the people on it
--   (their ministry app shows it).
--
--   Every row it adds says 'Demo data (Nov 2026)' (attendance.notes,
--   schedules.submitted_by, lineup_excuses.admin_note, and the sign-ups'
--   added_by), or has one of the fixed ids de300000-0000-4000-8000-... (the
--   events and the meetings; their sign-ups go with them), and
--   demo_ministry_data_remove.sql takes exactly those away again.
--   Nothing already there is changed: a day someone already checked in, or
--   a Sunday that already has a lineup, is left as it is. Safe to run twice.
--
-- Run it in the Supabase SQL editor (one block: all of it or none of it).
-- ============================================================

DO $$
DECLARE
  tag CONSTANT text := 'Demo data (Nov 2026)';
  first_sunday CONSTANT date := DATE '2026-08-02';
  last_sunday CONSTANT date := DATE '2026-11-22';
  drift_after CONSTANT date := DATE '2026-10-25';   -- the two who stopped coming
  slip_after CONSTANT date := DATE '2026-09-27';    -- the one who comes half as often
  instruments CONSTANT text[] := ARRAY['Keyboard', 'Guitarist', 'Drummer', 'Bass'];
  slow_titles CONSTANT text[] := ARRAY['Goodness of God', 'Way Maker', 'Living Hope', 'Build My Life', 'What a Beautiful Name',
    'Great Are You Lord', 'Holy Spirit', 'King of Kings', 'The Blessing', '10,000 Reasons', 'Here I Am to Worship', 'Amazing Grace (My Chains Are Gone)'];
  fast_titles CONSTANT text[] := ARRAY['This Is Amazing Grace', 'Raise a Hallelujah', 'Glorious Day', 'Happy Day', 'Shout to the Lord',
    'Who You Say I Am', 'Graves into Gardens', 'Forever', 'Champion', 'Days of Elijah', 'Our God', 'Mighty to Save', 'Celebrate Jesus',
    'Blessed Be Your Name', 'Indescribable'];
  reasons CONSTANT text[] := ARRAY['Overtime at work, I cannot get off in time.', 'Family emergency in the province, I have to travel.',
    'Sick with fever since Friday.', 'Out of town for my cousin''s wedding.'];
  leaders text[];
  singers text[];
  players text[];
  dancers text[];
  n_sundays int;
  d date;
  i int;
  k int;
  lead text;
  backups text[];
  band jsonb;
  steps date[];
  slow jsonb;
  fast jsonb;
  m record;
  roll int;
  here boolean;
  on_lineup boolean;
  made_lineups int := 0;
  made_checkins int := 0;
  made_excuses int := 0;
BEGIN
  -- ---- Who: the ministry members (as Joyful Cares counts them), by part ----
  CREATE TEMP TABLE demo_members ON COMMIT DROP AS
  SELECT u.id,
         trim(u.firstname || ' ' || u.lastname) AS name,
         coalesce(u.sub_role, '') AS sub_role,
         coalesce(u.ministry, '') AS ministry,
         row_number() OVER (ORDER BY md5(u.id::text)) AS rank
    FROM users u
   WHERE u.is_active IS NOT FALSE
     AND (u.role IN ('Ministry Member', 'Member', 'Song Leader', 'Leader')
          OR coalesce(u.additional_roles, '{}') && ARRAY['Ministry Member', 'Member', 'Song Leader', 'Leader'])
     AND (u.ministry IS NOT NULL OR u.sub_role IS NOT NULL)
     AND (u.firstname || ' ' || u.lastname) NOT ILIKE '%church%';

  ALTER TABLE demo_members ADD COLUMN profile text;
  UPDATE demo_members SET profile = CASE rank
      WHEN 1 THEN 'drifting' WHEN 2 THEN 'drifting' WHEN 3 THEN 'slipping'
      WHEN 4 THEN 'excuses' WHEN 5 THEN 'occasional' ELSE 'faithful' END;

  SELECT array_agg(name ORDER BY name) INTO leaders FROM demo_members WHERE sub_role ILIKE '%Song Leader%';
  SELECT array_agg(name ORDER BY name) INTO players FROM demo_members
   WHERE sub_role ~* '(Instrumentalist|Keyboard|Guitarist|Bass|Drummer|Music Director)';
  -- Backup singers who do not also play: one person, one part on a Sunday.
  SELECT array_agg(name ORDER BY name) INTO singers FROM demo_members
   WHERE sub_role ILIKE '%Backup Singer%' AND name <> ALL (coalesce(players, '{}'));
  SELECT array_agg(name ORDER BY name) INTO dancers FROM demo_members WHERE sub_role ILIKE '%Dancer%' OR ministry = 'Dancers';
  IF leaders IS NULL THEN leaders := singers; END IF;

  SELECT array_agg(s::date ORDER BY s) INTO steps
    FROM generate_series(first_sunday, last_sunday, interval '7 days') s;
  n_sundays := coalesce(array_length(steps, 1), 0);

  -- ---- The lineups ----
  CREATE TEMP TABLE demo_lineups (day date PRIMARY KEY, names text[]) ON COMMIT DROP;
  FOR i IN 1 .. n_sundays LOOP
    d := steps[i]::date;
    IF leaders IS NULL THEN EXIT; END IF;
    lead := leaders[(i - 1) % array_length(leaders, 1) + 1];

    backups := '{}';
    IF singers IS NOT NULL THEN
      k := 0;
      WHILE array_length(backups, 1) IS DISTINCT FROM 3 AND k < array_length(singers, 1) LOOP
        IF singers[((i - 1) * 3 + k) % array_length(singers, 1) + 1] <> lead THEN
          backups := backups || singers[((i - 1) * 3 + k) % array_length(singers, 1) + 1];
        END IF;
        k := k + 1;
      END LOOP;
    END IF;

    -- Each player keeps an instrument; whoever leads songs that day does not
    -- play, and every third Sunday one player has the week off.
    SELECT coalesce(jsonb_object_agg(instrument, names), '{}'::jsonb) INTO band
      FROM (SELECT instruments[(p.idx - 1) % 4 + 1] AS instrument, jsonb_agg(p.name) AS names
              FROM unnest(coalesce(players, '{}')) WITH ORDINALITY AS p(name, idx)
             WHERE p.name <> lead AND NOT (i % 3 = 0 AND p.idx = (i / 3) % greatest(array_length(players, 1), 1) + 1)
             GROUP BY 1) b;

    SELECT jsonb_agg(jsonb_build_object('title', slow_titles[((i - 1) * 2 + j) % array_length(slow_titles, 1) + 1], 'link', '', 'instructions', ''))
      INTO slow FROM generate_series(0, 1) j;
    SELECT jsonb_agg(jsonb_build_object('title', fast_titles[((i - 1) * 3 + j) % array_length(fast_titles, 1) + 1], 'link', '', 'instructions', ''))
      INTO fast FROM generate_series(0, 2) j;

    IF NOT EXISTS (SELECT 1 FROM schedules s WHERE s.schedule_date = d) THEN
      INSERT INTO schedules (song_leader, backup_singers, schedule_date, practice_date, practice_time,
                             slow_songs, fast_songs, submitted_by, status, musicians, dancers)
      VALUES (lead, to_jsonb(backups), d, d - 1, '15:00', slow, fast, tag, 'Active', band,
              CASE WHEN dancers IS NULL THEN '{}'::text[]
                   WHEN i % 4 = 0 AND array_length(dancers, 1) > 1 THEN dancers[1:array_length(dancers, 1) - 1]
                   ELSE dancers END);
      made_lineups := made_lineups + 1;
      INSERT INTO demo_lineups VALUES (d, ARRAY[lead] || backups
        || ARRAY(SELECT jsonb_array_elements_text(v) FROM jsonb_each(band) e(k2, v))
        || CASE WHEN i % 4 = 0 AND array_length(dancers, 1) > 1 THEN dancers[1:array_length(dancers, 1) - 1] ELSE coalesce(dancers, '{}') END);
    END IF;
  END LOOP;

  -- ---- Sunday check-ins, and practice check-ins for the lineup ----
  FOR m IN SELECT * FROM demo_members LOOP
    FOR i IN 1 .. n_sundays LOOP
      d := steps[i]::date;
      roll := abs(hashtext(m.id::text || d::text)) % 100;
      on_lineup := EXISTS (SELECT 1 FROM demo_lineups l WHERE l.day = d AND m.name = ANY (l.names));
      here := CASE m.profile
        WHEN 'faithful' THEN on_lineup OR roll < 93
        WHEN 'occasional' THEN on_lineup OR roll < 55
        WHEN 'drifting' THEN d <= drift_after AND (on_lineup OR roll < 90)
        WHEN 'slipping' THEN CASE WHEN d <= slip_after THEN on_lineup OR roll < 95 ELSE roll < 40 END
        WHEN 'excuses' THEN CASE WHEN d >= DATE '2026-11-01' THEN d = DATE '2026-11-08' ELSE on_lineup OR roll < 92 END
        ELSE roll < 90 END;

      IF here AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = m.id AND a.event_date = d) THEN
        INSERT INTO attendance (user_id, event_date, status, notes, created_at)
        VALUES (m.id, d, CASE WHEN roll % 11 = 0 THEN 'Late' ELSE 'Present' END, tag,
                (d + time '08:40' + (roll || ' minutes')::interval) AT TIME ZONE 'Asia/Manila');
        made_checkins := made_checkins + 1;
      END IF;

      -- Practice, the Saturday before, for those on the lineup: the faithful
      -- nearly always come, the others less.
      IF on_lineup AND (m.profile <> 'drifting' OR d <= drift_after)
         AND abs(hashtext(d::text || m.id::text)) % 100 < (CASE m.profile WHEN 'faithful' THEN 97 WHEN 'excuses' THEN 92 WHEN 'occasional' THEN 75 ELSE 65 END)
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = m.id AND a.event_date = d - 1) THEN
        INSERT INTO attendance (user_id, event_date, status, notes, created_at)
        VALUES (m.id, d - 1, 'Present', tag, (d - 1 + time '14:55') AT TIME ZONE 'Asia/Manila');
        made_checkins := made_checkins + 1;
      END IF;

      -- The member who sends excuses: November's three Sundays away.
      IF m.profile = 'excuses' AND d >= DATE '2026-11-01' AND d <> DATE '2026-11-08' THEN
        INSERT INTO lineup_excuses (user_id, user_name, excuse_date, reason, status, role_type, admin_note, reviewed_by, created_at)
        VALUES (m.id, m.name, d, reasons[(i % array_length(reasons, 1)) + 1],
                CASE WHEN d = DATE '2026-11-22' THEN 'Pending' ELSE 'Approved' END,
                CASE WHEN m.sub_role ILIKE '%Dancer%' THEN 'Dancer' WHEN m.sub_role ILIKE '%Song Leader%' THEN 'Song Leader' ELSE 'Backup Singer' END,
                tag, CASE WHEN d = DATE '2026-11-22' THEN NULL ELSE 'Demo data' END,
                (d - 3 + time '19:30') AT TIME ZONE 'Asia/Manila')
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS k = ROW_COUNT;
        made_excuses := made_excuses + k;
      END IF;
    END LOOP;
  END LOOP;

  -- ---- The pastors: at almost every Sunday service ----
  FOR m IN SELECT u.id FROM users u WHERE lower(u.email) IN ('pstr@weldonpior.com', 'pstr@dorothypior.com',
             'pstr@gracelyngambe.com', 'pstr@eldangambe.com', 'pstr@psalmgambe.com') LOOP
    FOR i IN 1 .. n_sundays LOOP
      d := steps[i]::date;
      roll := abs(hashtext(m.id::text || d::text)) % 100;
      IF roll < 95 AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = m.id AND a.event_date = d) THEN
        INSERT INTO attendance (user_id, event_date, status, notes, created_at)
        VALUES (m.id, d, 'Present', tag, (d + time '08:30' + (roll || ' seconds')::interval) AT TIME ZONE 'Asia/Manila');
        made_checkins := made_checkins + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Demo data: % lineups, % check-ins, % excuses (% ministry members, % Sundays).',
    made_lineups, made_checkins, made_excuses, (SELECT count(*) FROM demo_members), n_sundays;
END $$;

-- ============================================================
-- Coming up: four published events (two with sign-ups) and two meetings.
-- Fixed ids, so a second run adds nothing and the remove script finds them.
-- Times are the Philippines' (+08:00).
-- ============================================================
DO $$
DECLARE
  tag CONSTANT text := 'Demo data (Nov 2026)';
  church CONSTANT text := 'Joyful Sound Church International';
  firsts CONSTANT text[] := ARRAY['Maria', 'Jose', 'Ana', 'Juan', 'Rose', 'Mark', 'Grace', 'John', 'Joy', 'Paul', 'Faith', 'James',
    'Hope', 'Daniel', 'Angel', 'Christian', 'Mary', 'Joshua', 'Kristine', 'Michael', 'Rachelle', 'Kenneth', 'Bea', 'Carlo', 'Liza'];
  lasts CONSTANT text[] := ARRAY['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Villanueva', 'Ramos', 'Aquino', 'Castillo',
    'Flores', 'Torres', 'Navarro', 'Fernandez', 'Lim', 'Tan', 'Gonzales', 'Rivera', 'Abellana', 'Cabahug', 'Ybañez', 'Alcantara', 'Labra'];
  ev record;
  weldon uuid;
  made_events int := 0;
  made_signups int := 0;
  made_meetings int := 0;
  k int;
BEGIN
  FOR ev IN SELECT * FROM (VALUES
    ('de300000-0000-4000-8000-000000000001'::uuid, 'Christmas Outreach 2026',
     'Bring the joy of Christmas to families in our community: food packs for 200 families, a short program for the children and a time of prayer. Volunteers welcome: come early to help pack.',
     timestamptz '2026-12-12 08:00+08', timestamptz '2026-12-12 12:00+08', true, 200, 146),
    ('de300000-0000-4000-8000-000000000002'::uuid, 'Youth Christmas Night',
     'A night of worship, games and a Christmas message for the youth (13 to 25). Bring a friend and a P100 gift for the exchange.',
     timestamptz '2026-12-18 18:00+08', timestamptz '2026-12-18 21:00+08', true, 80, 52),
    ('de300000-0000-4000-8000-000000000003'::uuid, 'Christmas Eve Service',
     'Celebrate the birth of our Savior with carols, the Christmas story and a message from our pastors. Open to everyone: bring your family.',
     timestamptz '2026-12-24 18:00+08', timestamptz '2026-12-24 20:00+08', false, NULL, 0),
    ('de300000-0000-4000-8000-000000000004'::uuid, 'Watch Night Service',
     'End the year in worship and prayer, and welcome 2027 together as a church family.',
     timestamptz '2026-12-31 22:00+08', timestamptz '2027-01-01 00:30+08', false, NULL, 0)
  ) AS t(id, title, description, starts, ends, takes_signups, capacity, signups)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ev.id) THEN
      INSERT INTO events (id, title, description, event_date, end_date, location, is_active, is_published,
                          has_fee, registration_fee, registration_required, max_participants,
                          registration_start_date, registration_deadline,
                          latitude, longitude, loc_country, loc_region, loc_province, loc_city)
      VALUES (ev.id, ev.title, ev.description, ev.starts, ev.ends, church, true, true,
              false, 0, ev.takes_signups, ev.capacity,
              CASE WHEN ev.takes_signups THEN timestamptz '2026-11-01 08:00+08' END,
              CASE WHEN ev.takes_signups THEN ev.starts - interval '2 days' END,
              10.319767311613345, 123.8992883502071, 'Philippines', 'Central Visayas', 'Cebu', 'Cebu City');
      made_events := made_events + 1;

      -- Its sign-ups: names only, spread over November.
      IF ev.signups > 0 THEN
        INSERT INTO event_registrations (event_id, attendee_firstname, attendee_lastname, attendee_name, amount, base_amount,
                                         status, church_name, registration_type, added_by, created_at)
        SELECT ev.id, f, l, f || ' ' || l, 0, 0, 'registered', church, 'single', tag,
               timestamptz '2026-11-01 09:00+08' + (n * interval '3 hours 37 minutes') + (made_events * interval '41 minutes')
          FROM generate_series(1, ev.signups) n,
               -- Different names for each event (made_events moves them along).
               LATERAL (SELECT firsts[(n * 7 + made_events * 3) % array_length(firsts, 1) + 1] AS f,
                               lasts[(n * 11 + n / array_length(firsts, 1) + made_events * 5) % array_length(lasts, 1) + 1] AS l) names;
        GET DIAGNOSTICS k = ROW_COUNT;
        made_signups := made_signups + k;
      END IF;
    END IF;
  END LOOP;

  -- Two ministry meetings, set by Dr. Weldon Pior.
  SELECT id INTO weldon FROM users WHERE lower(email) = 'pstr@weldonpior.com';
  INSERT INTO ministry_meetings (id, title, description, ministry, meeting_date, location, created_by, created_by_name, status)
  VALUES
    ('de300000-0000-4000-8000-000000000101', 'Christmas Services: Worship Planning',
     'Song lineups for the Christmas Eve and Watch Night services, and the practice schedule for December.',
     'Praise And Worship', timestamptz '2026-12-03 19:00+08', 'Church sanctuary', weldon, 'Weldon Pior', 'Scheduled'),
    ('de300000-0000-4000-8000-000000000102', 'Media Team: Christmas Live Stream Setup',
     'Cameras, slides and the live stream for the Christmas services. Bring your laptops.',
     'Media', timestamptz '2026-12-05 14:00+08', 'Media booth', weldon, 'Weldon Pior', 'Scheduled')
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS made_meetings = ROW_COUNT;

  RAISE NOTICE 'Demo data: % events, % sign-ups, % meetings.', made_events, made_signups, made_meetings;
END $$;

-- What was added.
SELECT to_char(event_date, 'YYYY-MM') AS month, count(*) AS check_ins
  FROM attendance WHERE notes = 'Demo data (Nov 2026)' GROUP BY 1 ORDER BY 1;
SELECT e.title, e.event_date AT TIME ZONE 'Asia/Manila' AS starts, e.is_published,
       (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id) AS sign_ups
  FROM events e WHERE e.id::text LIKE 'de300000-%' ORDER BY e.event_date;
