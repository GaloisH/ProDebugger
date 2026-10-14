-- Purpose: Find the earliest explicit full-goal confirmation and distinguish placement evidence from verified cleanliness.
/* Search entity-specific history before the anchor and later recovery; never retrieve whole steps. */
WITH evidence AS (
  /* Inspect the reflection evidence for 'clean' in original steps 1-6. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('clean', 'reflection', 1, 6)
  UNION BY NAME
  /* Inspect the memory evidence for 'completion of the task' in original steps 1-6. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('completion of the task', 'memory', 1, 6)
  UNION BY NAME
  /* Inspect the memory evidence for 'clean' in original steps 1-6. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('clean', 'memory', 1, 6)
  UNION BY NAME
  /* Inspect the plan evidence for 'bowl' in original steps 1-6. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('bowl', 'plan', 1, 6)
  UNION BY NAME
  /* Inspect the action evidence for 'bowl 1' in original steps 1-30. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('bowl 1', 'action', 1, 30)
  UNION BY NAME
  /* Inspect the observation evidence for 'bowl 1' in original steps 1-30. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('bowl 1', 'observation', 1, 30)
  UNION BY NAME
  /* Inspect the observation evidence for 'clean' in original steps 1-30. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('clean', 'observation', 1, 30)
  UNION BY NAME
  /* Track the disputed entity; parsed claims and derived checks remain unverified. */
  SELECT
  step, 'parsed_fact' AS module, span AS text, fid, source_kind, parse_status, rel, args, slot, side, value, value_type, assertion_time, claim_scope, claim_polarity
  FROM TRACK_ENTITY('portable:bowl_1', 1, 30)
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
