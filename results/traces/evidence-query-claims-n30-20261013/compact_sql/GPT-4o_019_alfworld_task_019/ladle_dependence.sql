-- Purpose: Test whether later no-further-action decisions rely on the step-10 completion belief or instead follow cleanliness verification/correction; presence-only checks are the strongest rival explanation.
WITH cessation /* Retrieve later action declarations verbatim to identify the concrete cessation decisions, limited to steps after the anchor. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('No further action is necessary', 'action', 11, 30)
), clean_memory /* Find later memory claims about cleanliness across the full trajectory, including any correction or premise that could precede a cessation decision. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('clean', 'memory', 1, 30)
), clean_reflection /* Find later reflection claims about cleanliness, task completion, or reconsideration across the full trajectory. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('clean', 'reflection', 1, 30)
), clean_plan /* Find later plans mentioning cleanliness, so a renewed cleaning/verification plan can be distinguished from continued reliance on completion. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('clean', 'plan', 1, 30)
), cessation_peers /* Retrieve same-step peer mental-module text at identified cessation decisions, searching the task object to expose differently worded decision bases. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('ladle', ('memory', 'reflection', 'plan'), 11, 30)
  WHERE
    step IN (
      SELECT
      step
      FROM cessation
    )
), examinations /* Retrieve actual later examination/look attempts; these establish what was checked, not that cleanliness was verified. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('look', 11, 30)
), ladle_feedback /* Retrieve later observed ladle feedback independently, including presence-only results or any explicit cleaning outcome. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('ladle 1', 'observation', 11, 30)
), clean_state /* Check recorded clean-state assignments for the same ladle; no assignment would leave cleanliness unknown, not prove dirtiness. */ AS (
  SELECT
  step, 'state' AS module, span AS text, source_kind
  FROM TRACK_STATE('portable:ladle_1', 'has', 1, 30)
  WHERE
    JSON_EXTRACT(args, '$[1]') = 'attribute:clean'
)
/* Compare downstream claims, same-step decision context, actual checks and independent state/feedback evidence. */
SELECT
*
FROM cessation
UNION ALL BY NAME
SELECT
*
FROM clean_memory
UNION ALL BY NAME
SELECT
*
FROM clean_reflection
UNION ALL BY NAME
SELECT
*
FROM clean_plan
UNION ALL BY NAME
SELECT
*
FROM cessation_peers
UNION ALL BY NAME
SELECT
*
FROM examinations
UNION ALL BY NAME
SELECT
*
FROM ladle_feedback
UNION ALL BY NAME
SELECT
*
FROM clean_state
ORDER BY
  step,
  module;
