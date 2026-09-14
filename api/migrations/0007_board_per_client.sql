-- =====================================================================
-- Every client gets a board.
--
-- Adding a client now creates one automatically, but clients added before
-- that change have nothing: no board, so no kanban, no timeline and
-- nowhere to type a task. This gives each of them the same starting point
-- a new client gets.
--
-- Only clients with NO board at all. A client that already has one — or
-- five — is left exactly as it is; this is a floor, not a reset.
--
-- Two things worth knowing about how this is written:
--
-- 1. No temporary tables. D1 refuses CREATE TEMPORARY TABLE outright
--    (SQLITE_AUTH), so the workspace is a repeated scalar subquery.
--
-- 2. Ids are derived from the client id rather than random. The board,
--    its groups and its columns are three separate INSERTs that all need
--    to agree on the board's id, and hex(randomblob()) would produce a
--    different one in each statement. Deriving from the client id makes
--    them deterministic, and unique because client ids are unique. They
--    are not uuid-shaped, which is fine: every id in this schema is
--    `text`, and the application treats them as opaque.
--
-- Structure matches the PROJECTS template in api/src/templates.ts as it
-- stands today, minus Priority, which is a real field now (0005/0006). If
-- that template later changes, this file does not: a migration records
-- what happened on the day it ran.
-- =====================================================================

insert into board (id, workspace_id, client_id, name, description, template,
                   sensitivity, sort_order, created_at)
select
  'board-for-' || c.id,
  -- The workspace that holds client work: whichever already holds the most
  -- client boards, falling back to the first. The same rule the API uses.
  (select w.id
     from workspace w
     left join board b2 on b2.workspace_id = w.id and b2.client_id is not null
    where w.organisation_id = c.organisation_id
    group by w.id
    order by count(b2.id) desc, w.sort_order, w.name
    limit 1),
  c.id,
  c.name || ' — projects',
  'Work for ' || c.name || '. Rename or delete this board, or add more.',
  'PROJECTS',
  'INTERNAL',
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from client c
where not exists (select 1 from board b where b.client_id = c.id)
  and exists (select 1 from workspace w where w.organisation_id = c.organisation_id);

-- Groups: To do / In progress / Completed. One statement each, because
-- D1 rejects a compound SELECT with this many UNION ALL terms.
insert into board_group (id, board_id, title, colour, sort_order)
select 'grp-' || c.id || '-0', 'board-for-' || c.id, 'To do', 'blue', 0
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_group bg where bg.id = 'grp-' || c.id || '-0');

insert into board_group (id, board_id, title, colour, sort_order)
select 'grp-' || c.id || '-1', 'board-for-' || c.id, 'In progress', 'amber', 1
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_group bg where bg.id = 'grp-' || c.id || '-1');

insert into board_group (id, board_id, title, colour, sort_order)
select 'grp-' || c.id || '-2', 'board-for-' || c.id, 'Completed', 'green', 2
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_group bg where bg.id = 'grp-' || c.id || '-2');

-- Columns, one statement each for the same reason.
insert into board_column (id, board_id, title, type, settings, sort_order, width)
select 'col-' || c.id || '-0', 'board-for-' || c.id, 'Owner', 'PEOPLE', '{}', 0, 150
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_column bc where bc.id = 'col-' || c.id || '-0');

insert into board_column (id, board_id, title, type, settings, sort_order, width)
select 'col-' || c.id || '-1', 'board-for-' || c.id, 'Status', 'STATUS', '{"labels":[{"id":"not_started","label":"Not started","colour":"grey"},{"id":"working","label":"Working on it","colour":"amber"},{"id":"stuck","label":"Stuck","colour":"red"},{"id":"done","label":"Done","colour":"green"}]}', 1, 160
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_column bc where bc.id = 'col-' || c.id || '-1');

insert into board_column (id, board_id, title, type, settings, sort_order, width)
select 'col-' || c.id || '-2', 'board-for-' || c.id, 'Timeline', 'TIMELINE', '{}', 2, 190
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_column bc where bc.id = 'col-' || c.id || '-2');

insert into board_column (id, board_id, title, type, settings, sort_order, width)
select 'col-' || c.id || '-3', 'board-for-' || c.id, 'Due date', 'DATE', '{}', 3, 140
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_column bc where bc.id = 'col-' || c.id || '-3');

insert into board_column (id, board_id, title, type, settings, sort_order, width)
select 'col-' || c.id || '-4', 'board-for-' || c.id, 'Progress', 'NUMBER', '{"unit":"%","min":0,"max":100,"display":"bar"}', 4, 130
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_column bc where bc.id = 'col-' || c.id || '-4');

insert into board_column (id, board_id, title, type, settings, sort_order, width)
select 'col-' || c.id || '-5', 'board-for-' || c.id, 'Notes', 'LONG_TEXT', '{}', 5, 220
from client c
where exists (select 1 from board b where b.id = 'board-for-' || c.id)
  and not exists (select 1 from board_column bc where bc.id = 'col-' || c.id || '-5');

