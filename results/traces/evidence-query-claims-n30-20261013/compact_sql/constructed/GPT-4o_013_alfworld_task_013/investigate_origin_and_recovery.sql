-- Purpose: Trace the object-substitution decision and check both the next-step correction and later recurrence.
/* Search entity-specific history before the anchor and later recovery; never retrieve whole steps. */
WITH evidence AS (
  /* Inspect the memory evidence for 'soapbottle' in original steps 1-17. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('soapbottle', 'memory', 1, 17)
  UNION BY NAME
  /* Inspect the reflection evidence for 'soapbottle' in original steps 1-17. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('soapbottle', 'reflection', 1, 17)
  UNION BY NAME
  /* Inspect the plan evidence for 'soapbottle' in original steps 1-17. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('soapbottle', 'plan', 1, 17)
  UNION BY NAME
  /* Inspect the observation evidence for 'soapbottle 1' in original steps 1-30. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('soapbottle 1', 'observation', 1, 30)
  UNION BY NAME
  /* Inspect the action evidence for 'soapbottle 1' in original steps 1-30. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('soapbottle 1', 'action', 1, 30)
  UNION BY NAME
  /* Inspect the observation evidence for 'spraybottle' in original steps 1-30. */
  SELECT
  step, module, text, source_id, start, end, fid, source_kind, parse_status
  FROM SEARCH_TEXT('spraybottle', 'observation', 1, 30)
  UNION BY NAME
  /* Track the disputed entity; parsed claims and derived checks remain unverified. */
  SELECT
  step, 'parsed_fact' AS module, span AS text, fid, source_kind, parse_status, rel, args, slot, side, value, value_type, assertion_time, claim_scope, claim_polarity
  FROM TRACK_ENTITY('portable:soapbottle_1', 1, 30)
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
