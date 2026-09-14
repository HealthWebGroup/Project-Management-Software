-- =====================================================================
-- Fold the old "Priority" status column into the real priority field.
--
-- Migration 0005 made priority a field on every item. Boards built from
-- the PROJECTS template — and the seeded board — ALSO had a STATUS column
-- called "Priority", so from 0005 onwards those boards showed two columns
-- with the same heading and different meanings. The template no longer
-- creates one; this deals with the ones already out there.
--
-- The first version of this migration simply deleted the column when it
-- held no data, and left it alone when it did. That was safe but not
-- enough: on a board where the column HAD been used, both columns stayed,
-- which is exactly the case anybody would notice. So instead of choosing
-- between losing the values and keeping the duplicate, this moves the
-- values into the field they now belong in, and then removes the column
-- that is empty as a result.
--
-- Three steps, in order, and each one refuses to guess:
--
--   1. Copy a recognised label onto item.priority - and only where the
--      item's priority is still NONE, so a value somebody has already set
--      in the new field is never overwritten by an older one.
--   2. Recompute priority_rank from priority, for every row.
--   3. Delete the old cells, then the old column - but ONLY for a column
--      where every value was recognised. A column holding a label this
--      migration does not understand keeps both column and data, and
--      somebody can decide what to do with it.
--
-- The recognised ids are the four the template and the seed use.
-- =====================================================================

-- 1 -------------------------------------------------------------------
-- 'critical' -> 'CRITICAL'. The ids and the field's values are the same
-- words, which is why this is an upper() and not a lookup table.

update item
   set priority = (
         select upper(json_extract(c.value, '$.labelId'))
           from cell c
           join board_column bc on bc.id = c.column_id
          where c.item_id = item.id
            and bc.board_id = item.board_id
            and bc.title = 'Priority'
            and bc.type = 'STATUS'
            and lower(json_extract(c.value, '$.labelId'))
                in ('low', 'medium', 'high', 'critical')
          limit 1
       )
 where priority = 'NONE'
   and exists (
         select 1
           from cell c
           join board_column bc on bc.id = c.column_id
          where c.item_id = item.id
            and bc.board_id = item.board_id
            and bc.title = 'Priority'
            and bc.type = 'STATUS'
            and lower(json_extract(c.value, '$.labelId'))
                in ('low', 'medium', 'high', 'critical')
       );

-- 2 -------------------------------------------------------------------
-- Derived from priority, so running it over every row is correct whether
-- or not step 1 touched that row.

update item
   set priority_rank = case priority
                         when 'CRITICAL' then 4
                         when 'HIGH'     then 3
                         when 'MEDIUM'   then 2
                         when 'LOW'      then 1
                         else 0
                       end;

-- 3 -------------------------------------------------------------------
-- The cells first (a column with cells attached is not empty), then the
-- columns that have no cells left. The guard on the first delete is what
-- protects a column holding something unrecognised: if any of its values
-- did not map, none of its cells are removed, so the column survives the
-- second delete too.

delete from cell
 where column_id in (
         select bc.id
           from board_column bc
          where bc.title = 'Priority'
            and bc.type = 'STATUS'
            and not exists (
                  select 1
                    from cell c2
                   where c2.column_id = bc.id
                     and c2.value is not null
                     and trim(c2.value) not in ('', '{}')
                     and lower(coalesce(json_extract(c2.value, '$.labelId'), ''))
                         not in ('low', 'medium', 'high', 'critical')
                )
       );

delete from board_column
 where title = 'Priority'
   and type = 'STATUS'
   and not exists (
         select 1 from cell c where c.column_id = board_column.id
       );
