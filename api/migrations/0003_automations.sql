-- =====================================================================
-- Automations and notifications.
--
-- An automation is one sentence: WHEN something happens, DO something.
-- Both halves are stored as a type plus a small JSON config, which is what
-- lets a new kind of rule be added without another migration.
-- =====================================================================

-- 0001 shipped a placeholder `automation` table with no trigger or action
-- type - a sketch, never written to by any route and never seeded. Replacing
-- it outright is safe precisely because nothing has ever put a row in it; if
-- you have already been running rules, stop and migrate the rows instead.
drop index if exists idx_automation_board;
drop table if exists automation;

create table automation (
  id             text primary key,
  board_id       text not null references board(id) on delete cascade,
  name           text not null,

  -- WHEN
  --   STATUS_BECOMES  {"columnId": "...", "labelId": "done"}
  --   DATE_ARRIVES    {"columnId": "...", "offsetDays": 0}   negative = before
  --   ITEM_CREATED    {}
  trigger_type   text not null
                 check (trigger_type in ('STATUS_BECOMES','DATE_ARRIVES','ITEM_CREATED')),
  trigger_config text not null default '{}',

  -- THEN
  --   MOVE_TO_GROUP   {"groupId": "..."}
  --   SET_STATUS      {"columnId": "...", "labelId": "..."}
  --   ASSIGN_PEOPLE   {"columnId": "...", "userIds": ["..."]}
  --   NOTIFY          {"who": "OWNERS" | "BOARD"}
  action_type    text not null
                 check (action_type in ('MOVE_TO_GROUP','SET_STATUS','ASSIGN_PEOPLE','NOTIFY')),
  action_config  text not null default '{}',

  enabled        integer not null default 1,
  created_by     text references app_user(id) on delete set null,
  created_at     text not null,
  last_run_at    text,
  run_count      integer not null default 0
);

create index idx_automation_board on automation(board_id, enabled);
create index idx_automation_trigger on automation(trigger_type, enabled);

-- =====================================================================
-- Notifications.
--
-- In-app first and always: this table is the record, and email is only ever
-- a copy of it. That way the feature works with no third-party account at
-- all, and nothing is lost if an email fails to send.
-- =====================================================================

create table notification (
  id          text primary key,
  user_id     text not null references app_user(id) on delete cascade,
  kind        text not null,          -- ASSIGNED, DUE_SOON, OVERDUE, COMMENTED, AUTOMATION
  title       text not null,
  body        text,
  board_id    text references board(id) on delete cascade,
  item_id     text references item(id) on delete cascade,
  created_at  text not null,
  read_at     text,
  emailed_at  text
);

-- The unread count is drawn on every screen, so it gets its own index.
create index idx_notification_unread on notification(user_id, read_at, created_at desc);
create index idx_notification_user on notification(user_id, created_at desc);

-- =====================================================================
-- Two rules on the Harbour Health board.
--
-- These are not sample data — they are sensible defaults that do real work
-- from day one: finished items file themselves, and anything with a due
-- date warns whoever owns it three days out. Turn either off from the
-- Rules button on the board if you would rather they did not.
-- =====================================================================

insert into automation
  (id, board_id, name, trigger_type, trigger_config, action_type, action_config,
   enabled, created_by, created_at)
values
  ('99999999-0000-4000-8000-000000000001',
   '44444444-0000-4000-8000-000000000001',
   'When something is Done, file it under Completed',
   'STATUS_BECOMES',
   '{"columnId":"66666666-0000-4000-8000-000000000002","labelId":"done"}',
   'MOVE_TO_GROUP',
   '{"groupId":"55555555-0000-4000-8000-000000000002"}',
   1, '22222222-0000-4000-8000-000000000001', '2026-08-30T09:00:00.000Z'),

  ('99999999-0000-4000-8000-000000000002',
   '44444444-0000-4000-8000-000000000001',
   'Three days before a due date, tell whoever owns it',
   'DATE_ARRIVES',
   '{"columnId":"66666666-0000-4000-8000-000000000003","offsetDays":-3}',
   'NOTIFY',
   '{"who":"OWNERS"}',
   1, '22222222-0000-4000-8000-000000000001', '2026-08-30T09:00:00.000Z');
