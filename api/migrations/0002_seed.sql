-- =====================================================================
-- Starter data — the real thing, not a demo.
--
-- Your organisation, your account, your Harbour Health board with the work
-- that was on the monday.com board, and the internal renewals board.
--
-- What is deliberately NOT here: invented clients, invented colleagues,
-- sample time entries and sample to-dos. This runs on your production
-- database on the first deploy, and a system that arrives full of fiction
-- is a system whose first hour is spent deleting things. Add people on the
-- People screen and clients on the Clients screen — both take a minute.
--
-- If you do want a populated system to look at, there is a full sample set
-- at seed/demo-data.sql. It is not a migration and never runs by itself.
-- =====================================================================

insert into organisation (id, name) values
  ('00000000-0000-4000-8000-000000000001', 'Health Web Group');

insert into site (id, organisation_id, name, address) values
  ('11111111-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Office', null),
  ('11111111-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Remote', null);

-- The owner account.
--
-- This must match BOOTSTRAP_ADMIN_EMAIL in wrangler.toml, and it must be the
-- address Cloudflare Access lets through, or the first sign-in creates a
-- second account as an ordinary member and nobody is an administrator.
insert into app_user (id, organisation_id, email, full_name, job_title, site_id, role) values
  ('22222222-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'info@harbourhealthgroup.com', 'Account Owner', 'Director',
   '11111111-0000-4000-8000-000000000001', 'ADMIN');

-- ----------------------------------------------------------------- client

insert into client (id, organisation_id, name, code, status, colour,
                    contact_name, contact_email, website, address, started_on, notes) values
  ('88888888-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
   'Harbour Health','HH','ACTIVE','teal', null, null, null, 'Ireland', '2026-01-05',
   'Set-up and operations programme.');

insert into workspace (id, organisation_id, name, description, colour, sort_order) values
  ('33333333-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
   'Client work','Delivery work, one board per client','teal',0),
  ('33333333-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',
   'Internal','Our own business: admin, renewals, hiring','amber',1);

-- ========================= BOARD: Harbour Health ========================
-- The same columns and the same work as the monday.com board.

insert into board (id, workspace_id, client_id, name, description, template, sensitivity, sort_order, created_by) values
  ('44444444-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000001',
   '88888888-0000-4000-8000-000000000001','Harbour Health','Set-up and operations programme',
   'PROJECTS','INTERNAL',0,'22222222-0000-4000-8000-000000000001');

insert into board_group (id, board_id, title, colour, sort_order) values
  ('55555555-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001','To-Do','blue',0),
  ('55555555-0000-4000-8000-000000000002','44444444-0000-4000-8000-000000000001','Completed','green',1);

insert into board_column (id, board_id, title, type, settings, sort_order, width) values
  ('66666666-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001','Owner','PEOPLE','{}',0,110),
  ('66666666-0000-4000-8000-000000000002','44444444-0000-4000-8000-000000000001','Status','STATUS',
   '{"labels":[{"id":"not_started","label":"Not Started","colour":"grey"},{"id":"working","label":"Working on it","colour":"amber"},{"id":"blocked","label":"Stuck","colour":"red"},{"id":"review","label":"In review","colour":"violet"},{"id":"done","label":"Done","colour":"green"}]}',1,150),
  ('66666666-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000001','Due date','DATE','{}',2,130),
  ('66666666-0000-4000-8000-000000000004','44444444-0000-4000-8000-000000000001','Timeline','TIMELINE','{}',3,190),
  ('66666666-0000-4000-8000-000000000005','44444444-0000-4000-8000-000000000001','Priority','STATUS',
   '{"labels":[{"id":"low","label":"Low","colour":"grey"},{"id":"medium","label":"Medium","colour":"blue"},{"id":"high","label":"High","colour":"amber"},{"id":"critical","label":"Critical","colour":"red"}]}',4,120);

insert into item (id, board_id, group_id, client_id, title, sort_order, created_by) values
  ('77777777-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','Inventory',0,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000002','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','FSAI Registration',1,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','Equity Contribution',2,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000004','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','Echo Radio Lease',3,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000005','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','Book Düsseldorf Flights',4,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000006','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','HPRA Approval',5,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000007','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','Shipping Container Renovation',6,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000008','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','LEO Grant Application',7,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000009','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','CHL Payment for IT',8,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-00000000000a','44444444-0000-4000-8000-000000000001','55555555-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001','Form UK company',9,'22222222-0000-4000-8000-000000000001');

-- Statuses, due dates and timelines carried over from the monday.com board.
-- The Owner column is deliberately left empty: assign real people once they
-- are added on the People screen.
insert into cell (item_id, column_id, value) values
  ('77777777-0000-4000-8000-000000000001','66666666-0000-4000-8000-000000000002','{"labelId":"working"}'),
  ('77777777-0000-4000-8000-000000000001','66666666-0000-4000-8000-000000000003','{"date":"2026-08-30"}'),
  ('77777777-0000-4000-8000-000000000001','66666666-0000-4000-8000-000000000004','{"start":"2026-08-24","end":"2026-09-04"}'),

  ('77777777-0000-4000-8000-000000000002','66666666-0000-4000-8000-000000000002','{"labelId":"working"}'),
  ('77777777-0000-4000-8000-000000000002','66666666-0000-4000-8000-000000000003','{"date":"2026-08-30"}'),
  ('77777777-0000-4000-8000-000000000002','66666666-0000-4000-8000-000000000004','{"start":"2026-08-17","end":"2026-08-28"}'),
  ('77777777-0000-4000-8000-000000000002','66666666-0000-4000-8000-000000000005','{"labelId":"high"}'),

  ('77777777-0000-4000-8000-000000000003','66666666-0000-4000-8000-000000000002','{"labelId":"working"}'),
  ('77777777-0000-4000-8000-000000000003','66666666-0000-4000-8000-000000000003','{"date":"2026-08-23"}'),
  ('77777777-0000-4000-8000-000000000003','66666666-0000-4000-8000-000000000004','{"start":"2026-08-10","end":"2026-08-23"}'),
  ('77777777-0000-4000-8000-000000000003','66666666-0000-4000-8000-000000000005','{"labelId":"critical"}'),

  ('77777777-0000-4000-8000-000000000004','66666666-0000-4000-8000-000000000002','{"labelId":"not_started"}'),
  ('77777777-0000-4000-8000-000000000004','66666666-0000-4000-8000-000000000004','{"start":"2026-09-01","end":"2026-09-11"}'),

  ('77777777-0000-4000-8000-000000000005','66666666-0000-4000-8000-000000000002','{"labelId":"not_started"}'),
  ('77777777-0000-4000-8000-000000000005','66666666-0000-4000-8000-000000000003','{"date":"2026-09-12"}'),

  ('77777777-0000-4000-8000-000000000006','66666666-0000-4000-8000-000000000002','{"labelId":"not_started"}'),
  ('77777777-0000-4000-8000-000000000006','66666666-0000-4000-8000-000000000004','{"start":"2026-09-07","end":"2026-10-02"}'),
  ('77777777-0000-4000-8000-000000000006','66666666-0000-4000-8000-000000000005','{"labelId":"high"}'),

  ('77777777-0000-4000-8000-000000000007','66666666-0000-4000-8000-000000000002','{"labelId":"not_started"}'),
  ('77777777-0000-4000-8000-000000000007','66666666-0000-4000-8000-000000000004','{"start":"2026-09-14","end":"2026-10-09"}'),

  ('77777777-0000-4000-8000-000000000008','66666666-0000-4000-8000-000000000002','{"labelId":"not_started"}'),
  ('77777777-0000-4000-8000-000000000008','66666666-0000-4000-8000-000000000003','{"date":"2026-09-30"}'),
  ('77777777-0000-4000-8000-000000000008','66666666-0000-4000-8000-000000000004','{"start":"2026-09-21","end":"2026-09-30"}'),

  ('77777777-0000-4000-8000-000000000009','66666666-0000-4000-8000-000000000002','{"labelId":"not_started"}'),

  ('77777777-0000-4000-8000-00000000000a','66666666-0000-4000-8000-000000000002','{"labelId":"not_started"}'),
  ('77777777-0000-4000-8000-00000000000a','66666666-0000-4000-8000-000000000004','{"start":"2026-10-05","end":"2026-10-16"}');

-- ======================== BOARD: Renewals & admin =======================
-- Internal: no client, so everyone on staff sees it. Anything with an expiry
-- date belongs here, which is exactly what the date rules were built for.

insert into board (id, workspace_id, name, description, template, sensitivity, sort_order, created_by) values
  ('44444444-0000-4000-8000-000000000003','33333333-0000-4000-8000-000000000002',
   'Renewals & admin','Anything with an expiry date and a named person responsible',
   'RENEWALS','INTERNAL',0,'22222222-0000-4000-8000-000000000001');

insert into board_group (id, board_id, title, colour, sort_order) values
  ('55555555-0000-4000-8000-000000000021','44444444-0000-4000-8000-000000000003','Domains & hosting','amber',0),
  ('55555555-0000-4000-8000-000000000022','44444444-0000-4000-8000-000000000003','Business admin','blue',1);

insert into board_column (id, board_id, title, type, settings, sort_order, width) values
  ('66666666-0000-4000-8000-000000000021','44444444-0000-4000-8000-000000000003','Responsible','PEOPLE','{}',0,120),
  ('66666666-0000-4000-8000-000000000022','44444444-0000-4000-8000-000000000003','Status','STATUS',
   '{"labels":[{"id":"valid","label":"Valid","colour":"green"},{"id":"due_90","label":"Renewal due","colour":"blue"},{"id":"due_30","label":"Action needed","colour":"amber"},{"id":"expired","label":"Expired","colour":"red"},{"id":"submitted","label":"Submitted","colour":"violet"}]}',1,150),
  ('66666666-0000-4000-8000-000000000023','44444444-0000-4000-8000-000000000003','Category','DROPDOWN',
   '{"options":[{"id":"domain","label":"Domain","colour":"violet"},{"id":"hosting","label":"Hosting","colour":"blue"},{"id":"licence","label":"Licence","colour":"teal"},{"id":"insurance","label":"Insurance","colour":"green"},{"id":"software","label":"Software","colour":"amber"}]}',2,150),
  ('66666666-0000-4000-8000-000000000024','44444444-0000-4000-8000-000000000003','Expiry date','DATE','{}',3,140),
  ('66666666-0000-4000-8000-000000000025','44444444-0000-4000-8000-000000000003','Paid','CHECKBOX','{}',4,110);

insert into item (id, board_id, group_id, title, sort_order, created_by) values
  ('77777777-0000-4000-8000-000000000021','44444444-0000-4000-8000-000000000003','55555555-0000-4000-8000-000000000021','healthwebgroup.com renewal',0,'22222222-0000-4000-8000-000000000001'),
  ('77777777-0000-4000-8000-000000000023','44444444-0000-4000-8000-000000000003','55555555-0000-4000-8000-000000000022','Professional indemnity insurance',1,'22222222-0000-4000-8000-000000000001');

insert into cell (item_id, column_id, value) values
  ('77777777-0000-4000-8000-000000000021','66666666-0000-4000-8000-000000000021','{"userIds":["22222222-0000-4000-8000-000000000001"]}'),
  ('77777777-0000-4000-8000-000000000021','66666666-0000-4000-8000-000000000022','{"labelId":"valid"}'),
  ('77777777-0000-4000-8000-000000000021','66666666-0000-4000-8000-000000000023','{"optionIds":["domain"]}'),

  ('77777777-0000-4000-8000-000000000023','66666666-0000-4000-8000-000000000021','{"userIds":["22222222-0000-4000-8000-000000000001"]}'),
  ('77777777-0000-4000-8000-000000000023','66666666-0000-4000-8000-000000000022','{"labelId":"valid"}'),
  ('77777777-0000-4000-8000-000000000023','66666666-0000-4000-8000-000000000023','{"optionIds":["insurance"]}');
