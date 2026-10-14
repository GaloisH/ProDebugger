-- Purpose: test whether step 7's take-ladle action abandoned clean verification or prepared it, against any earlier cleanliness support and step-10 completion inference.
WITH claims /* Find cleanliness, selection, verification, and completion claims across memory/reflection/plan through step 10 to locate possible origins. */ AS (
  SELECT
  source_id, fid, step, module, text, source_kind
  FROM SEARCH_TEXT('clean', ('memory', 'reflection', 'plan'), 1, 10)
  UNION ALL BY NAME
  SELECT
  source_id, fid, step, module, text, source_kind
  FROM FIND_CLAIMS('verification', 'memory', 1, 10)
  UNION ALL BY NAME
  SELECT
  source_id, fid, step, module, text, source_kind
  FROM FIND_CLAIMS('completion', 'reflection', 1, 10)
), peers /* At discovered claim steps, retrieve peer-module references to ladles to compare reasons, intended preparation, and outcome wording. */ AS (
  SELECT
  source_id, fid, step, module, text, source_kind
  FROM SEARCH_TEXT('ladle', ('memory', 'reflection', 'plan'), 1, 10)
), observations /* Retrieve independent original observations mentioning ladle 1 or cleanliness through the decision and placement feedback. */ AS (
  SELECT
  source_id, fid, step, module, text, source_kind
  FROM SEARCH_TEXT(('ladle 1', 'clean'), 'observation', 1, 10)
), entity_facts /* Track original ladle-1 facts and action/observation provenance to test whether taking it was followed by inspection, cleaning, or placement. */ AS (
  SELECT
  fid, step, rel, slot, side, value, span, source_kind, args
  FROM TRACK_ENTITY('portable:ladle_1', 1, 10)
), clean_state /* Retrieve recorded clean-state assignments for ladle 1; absence is unknown rather than evidence of dirtiness. */ AS (
  SELECT
  fid, step, rel, slot, side, value, span, source_kind, args
  FROM TRACK_STATE('portable:ladle_1', 'clean', 1, 10)
)
/* Compare source claims with peer reasoning, original observation excerpts, action/state facts, and any clean-state support. */
SELECT
*
FROM claims
UNION ALL BY NAME
SELECT
*
FROM peers
WHERE
  step IN (
    SELECT
    step
    FROM claims
  )
UNION ALL BY NAME
SELECT
*
FROM observations
UNION ALL BY NAME
SELECT
fid, step, 'fact' AS module, COALESCE(span, value) AS text, source_kind, rel, args
FROM entity_facts
UNION ALL BY NAME
SELECT
fid, step, 'clean_state' AS module, COALESCE(span, value) AS text, source_kind, rel, args
FROM clean_state
ORDER BY
  step,
  module;
