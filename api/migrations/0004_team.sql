-- =====================================================================
-- The actual team.
--
-- Three people, and a clear split between doing the work and deciding who
-- may see it:
--
--   Yogesh   ADMIN    everything, including who sees which client
--   Niall    MANAGER  every working power, every client, no access control
--   Daren    MANAGER  the same
--
-- MANAGER is deliberately not a lesser role for getting work done. A
-- manager creates clients, creates projects, adds and edits tasks, runs
-- rules, and sees every client and everyone's work. The single thing it
-- cannot do is change what anybody else is allowed to see — that stays
-- with Yogesh, which is the restriction that was asked for.
--
-- Personal to-dos are private to their owner regardless of role. There is
-- no route that reads another person's list, not even for an administrator.
-- =====================================================================

-- Written so a re-run is harmless: these ids are fixed, and the updates
-- below cover the case where Cloudflare Access already created a person on
-- their first sign-in (which it does, as a MEMBER, from their email alone).

insert or ignore into app_user
  (id, organisation_id, email, full_name, job_title, site_id, role, status, created_at)
values
  ('22222222-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000001',
   'business@healthwebgroup.com', 'Yogesh Ghule', 'Director',
   '11111111-0000-4000-8000-000000000001', 'ADMIN', 'ACTIVE',
   strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  ('22222222-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000001',
   'finance@healthwebgroup.com', 'Niall Kavanagh', 'Finance',
   '11111111-0000-4000-8000-000000000001', 'MANAGER', 'ACTIVE',
   strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  ('22222222-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000001',
   'daren@healthwebgroup.com', 'Daren', 'Delivery',
   '11111111-0000-4000-8000-000000000001', 'MANAGER', 'ACTIVE',
   strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- If Access got there first, the row exists under a different id with the
-- name guessed from the email ("business", "finance") and the role MEMBER.
-- Match on the address, which is the thing that is actually unique.
update app_user
   set full_name = 'Yogesh Ghule', role = 'ADMIN', status = 'ACTIVE',
       job_title = coalesce(job_title, 'Director')
 where lower(email) = 'business@healthwebgroup.com';

update app_user
   set full_name = 'Niall Kavanagh', role = 'MANAGER', status = 'ACTIVE',
       job_title = coalesce(job_title, 'Finance')
 where lower(email) = 'finance@healthwebgroup.com';

update app_user
   set full_name = 'Daren', role = 'MANAGER', status = 'ACTIVE',
       job_title = coalesce(job_title, 'Delivery')
 where lower(email) = 'daren@healthwebgroup.com';

-- The placeholder owner from the first seed. It is on a domain that
-- ALLOWED_EMAIL_DOMAINS no longer admits, so it could not sign in even if
-- left active — but it would still appear in People and in the workload
-- chart as a person who owns nothing and does nothing.
--
-- Retired rather than deleted: it is the created_by on the original boards
-- and items, and deleting it would blank that history for no gain.
update app_user
   set status = 'LEAVER'
 where lower(email) = 'info@harbourhealthgroup.com';
