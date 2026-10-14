-- Purpose: test whether step 6's repeated desk examination or step 22's promoted desklamp premise better explains the failed pen-under-lamp relation, against the rival that desk 1 was independently supported; trace origin, action feedback, reliance, and correction.
WITH memories /* Search memory for the desk/lamp/pen premises across the full trajectory so an earlier origin is not missed. */ AS (
  SELECT
  step, module, text, source_id, start, end
  FROM SEARCH_TEXT(('desklamp', 'pen', 'desk 1'), 'memory', 1, 30)
), reflections /* Retrieve reflection claims about the same entities and placement to compare tentative hypotheses with later decision reliance. */ AS (
  SELECT
  step, module, text, source_id, start, end
  FROM SEARCH_TEXT(('desklamp', 'pen', 'desk 1', 'under'), 'reflection', 1, 30)
), plans /* Retrieve desk/lamp/pen plans over all steps, including later plans that could show reliance or effective correction. */ AS (
  SELECT
  step, module, text, source_id, start, end
  FROM SEARCH_TEXT(('desklamp', 'pen', 'desk 1', 'under'), 'plan', 1, 30)
), claim_clauses /* Discover hypothesis and decision-basis clauses in each mental module, retaining qualifying clauses that use different wording. */ AS (
  SELECT
  step, module, text, source_id, start, end
  FROM FIND_CLAIMS(('hypothesis', 'decision_basis'), 'memory', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_id, start, end
  FROM FIND_CLAIMS(('hypothesis', 'decision_basis'), 'reflection', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_id, start, end
  FROM FIND_CLAIMS(('hypothesis', 'expected_gain'), 'plan', 1, 30)
), observations /* Retrieve original observation excerpts about the pen, lamp, desk, and shelf to test mental premises independently. */ AS (
  SELECT
  step, module, text, source_id, start, end
  FROM SEARCH_TEXT(('pen', 'desklamp', 'desk 1', 'shelf 1'), 'observation', 1, 30)
), looks /* Track original examine/look actions and their immediate observation sequence; action facts distinguish repetition from a memory of repetition. */ AS (
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION('look', 1, 30)
), movement /* Track actual navigation and pen-placement/pickup actions to test whether the shelf discovery or desk move changed conditions or achieved the relation. */ AS (
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION(('go', 'take', 'put'), 1, 30)
)
/* Return targeted source excerpts and action elements, preserving step/module for comparison; mental searches cover origin and subsequent recovery. */
SELECT
*
FROM memories
UNION ALL BY NAME
SELECT
*
FROM reflections
UNION ALL BY NAME
SELECT
*
FROM plans
UNION ALL BY NAME
SELECT
*
FROM claim_clauses
UNION ALL BY NAME
SELECT
*
FROM observations
UNION ALL BY NAME
SELECT
step, module, text
FROM looks
UNION ALL BY NAME
SELECT
step, module, text
FROM movement
ORDER BY
  step,
  module;
