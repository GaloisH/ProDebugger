-- Purpose: test whether step-20 completion caused later reliance or was corrected, against the rival that placement was verified and later pot handling had another basis.
WITH mem /* Retrieve later pot-related memory claims that may preserve or revise the completion premise. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('pot 1', 'cool', 'complete'), 'memory', 21, 30)
), refl /* Retrieve later reflection claims about pot state, completion, or decision basis. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('pot 1', 'cool'), 'reflection', 21, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('completion', 'state', 'decision_basis'), 'reflection', 21, 30)
), plans /* Retrieve later plans mentioning the pot, cooling requirement, completion, verification, or handling rationale. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('pot 1', 'cool'), 'plan', 21, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('completion', 'verification', 'decision_basis'), 'plan', 21, 30)
), actions /* Retrieve original take/put actions for the same pot; an attempted move is not its feedback. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION(('take', 'put'), 21, 30)
  WHERE
    JSON_EXTRACT(args, '$[0]') = 'portable:pot_1'
), observations /* Retrieve independent later pot observations to distinguish confirmed placement from unknown coolness. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('pot 1', 'cool'), 'observation', 21, 30)
)
/* Compare mental statements, actual actions and feedback in original temporal order. */
SELECT
*
FROM mem
UNION ALL BY NAME
SELECT
*
FROM refl
UNION ALL BY NAME
SELECT
*
FROM plans
UNION ALL BY NAME
SELECT
*
FROM actions
UNION ALL BY NAME
SELECT
*
FROM observations
ORDER BY
  step,
  module;
