-- =====================================================================
-- Priority, as a real field on an item.
--
-- Why a column on `item` and not just another board column of type
-- STATUS, which is how it was faked before:
--
--   * Every board gets it, free, without anyone having to remember to
--     add a "Priority" column when they create a board. A field that
--     only exists on the boards somebody thought to configure is a field
--     you cannot filter the whole workspace by.
--   * It sorts. A STATUS cell holds JSON in `cell.value`, so ordering by
--     priority across a board meant unpacking JSON per row. An integer
--     sorts in the index.
--   * It means the same thing everywhere. Two boards with their own
--     "Priority" columns had their own label sets, so "High" on one
--     board and "High" on another were unrelated values that happened
--     to share a word.
--
-- Stored as text for readability in the database, constrained by a check
-- so a typo cannot get in, with a companion integer for ordering. NONE is
-- the default and means "nobody has said" — distinct from LOW, which is
-- somebody deciding it can wait.
-- =====================================================================

alter table item add column priority text not null default 'NONE'
  check (priority in ('NONE','LOW','MEDIUM','HIGH','CRITICAL'));

-- Highest first when sorting descending, which is the direction anyone
-- actually wants: the critical work at the top.
alter table item add column priority_rank integer not null default 0;

-- Partial index: the overwhelming majority of rows are NONE/0, and an
-- index over those is dead weight. This one covers exactly the query the
-- board and the dashboard run — "what is prioritised, and where".
create index idx_item_priority
  on item(board_id, priority_rank desc)
  where archived = 0 and priority_rank > 0;

-- Nothing is back-filled. Every existing item is NONE, which is honest:
-- no one has set a priority on them, and guessing one from a status
-- label would put words in the team's mouth.
