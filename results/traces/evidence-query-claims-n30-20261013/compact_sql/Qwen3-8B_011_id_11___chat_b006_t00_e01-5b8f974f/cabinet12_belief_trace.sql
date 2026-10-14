-- Purpose: test whether the step-25 claim that cabinets 1–12 were checked caused cabinet 12 to be skipped, versus an independent exploration rationale or evidence it was checked.
WITH claims AS (
  /* Search the full backward interval for variants of cabinet-12 checked/empty history, retaining source quotes and candidate origin steps. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('cabinet 12', 'cabinets 1-12', 'no apple'), 'memory', 1, 25)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('decision_basis', 'reflection', 1, 25)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('verification', 'plan', 1, 25)
), peers AS (
  /* Compare memory, reflection and plan language about cabinet 12 and unexplored locations at each discovered claim step. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('cabinet 12', 'unexplored'), ('reflection', 'plan'), 1, 25)
), action_evidence AS (
  /* Retrieve original cabinet arrival/movement actions and all recorded opening attempts through the decision, distinguishing reaching from opening. */
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION(('go', 'open_action'), 1, 25)
), observation_evidence AS (
  /* Check original feedback mentioning cabinet 12 and its open/closed contents across the full interval. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('cabinet 12', 'cabinet 12 is closed'), 'observation', 1, 25)
), aftermath AS (
  /* Test the table choice's feedback and later mental/action evidence through step 30 for reliance, correction, return, or changed search rationale. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('diningtable', 'observation', 25, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('cabinet 12', ('memory', 'reflection', 'plan', 'action'), 26, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('apple', 'reflection', 26, 30)
)
/* Compare provenance-bearing mental claims, independent actions/feedback, and later follow-up without treating missing matches as proof of absence. */
SELECT
*
FROM claims
UNION ALL BY NAME
SELECT
*
FROM peers
UNION ALL BY NAME
SELECT
*
FROM action_evidence
UNION ALL BY NAME
SELECT
*
FROM observation_evidence
UNION ALL BY NAME
SELECT
*
FROM aftermath
ORDER BY
  step,
  module;
