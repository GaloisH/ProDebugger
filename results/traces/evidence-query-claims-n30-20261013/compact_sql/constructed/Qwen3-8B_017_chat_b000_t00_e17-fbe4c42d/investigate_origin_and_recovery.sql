-- Purpose: Check the evidence for required attributes and option selections before an irreversible purchase decision.
/* Search entity-specific history before the anchor and later recovery; never retrieve whole steps. */
WITH evidence AS (
  /* Inspect the memory evidence for 'polyester' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('polyester', 'memory', 1, 9)
  UNION BY NAME
  /* Inspect the plan evidence for 'confirmed' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('confirmed', 'plan', 1, 9)
  UNION BY NAME
  /* Inspect the reflection evidence for 'verification' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('verification', 'reflection', 1, 9)
  UNION BY NAME
  /* Inspect the reflection evidence for 'matches size' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('matches size', 'reflection', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'B09NPML43M' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('B09NPML43M', 'observation', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'polyester' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('polyester', 'observation', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'hand wash' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('hand wash', 'observation', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'b16-blue' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('b16-blue', 'observation', 1, 9)
  UNION BY NAME
  /* Inspect the observation evidence for 'medium' in original steps 1-9. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('medium', 'observation', 1, 9)
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
  FROM TRACK_ENTITY('product:b09npml43m', 1, 9)
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
