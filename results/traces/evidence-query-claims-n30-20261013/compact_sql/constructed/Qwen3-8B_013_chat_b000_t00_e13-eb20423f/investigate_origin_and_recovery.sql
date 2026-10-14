-- Purpose: Separate supported rubber-sole evidence from an unsupported exact-color equivalence used at purchase.
/* Search entity-specific history before the anchor and later recovery; never retrieve whole steps. */
WITH evidence AS (
  /* Inspect the memory evidence for 'brown' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('brown', 'memory', 1, 9)
  UNION BY NAME
  /* Inspect the reflection evidence for 'brown' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('brown', 'reflection', 1, 9)
  UNION BY NAME
  /* Inspect the plan evidence for 'brown' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('brown', 'plan', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'brown' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('brown', 'observation', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'rubber' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('rubber', 'observation', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'Price:' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('Price:', 'observation', 1, 9)
  UNION BY NAME
  /* Inspect the action evidence for 'click[' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('click[', 'action', 1, 9)
  UNION BY NAME
  /* Track the disputed entity; parsed claims and derived checks remain unverified. */
  SELECT
  step, 'parsed_fact' AS module, span AS text, fid, source_kind, parse_status, rel, args, slot, side, value, value_type, assertion_time, claim_scope, claim_polarity
  FROM TRACK_ENTITY('product:b07hp6lvrs', 1, 9)
)
/* Deduplicate overlapping excerpts while retaining exact source offsets. */
SELECT DISTINCT
*
FROM evidence
ORDER BY
  step,
  module,
  start,
  fid;
