-- Purpose: test whether the final MCICI purchase premise arose from an earlier unsupported brown-to-r.brown2626 mapping, a late conversion of uncertainty, or independent evidence; compare each with the rival that brown was verified and size/price evidence was sufficient.
WITH target_claims /* Find exact target-color claims across all mental modules and steps 1–9 to locate the premise's origin rather than assume step 4 or 8. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('r.brown2626', ('memory', 'reflection', 'plan'), 1, 9)
), claim_topics /* Discover selection, verification, result assessment, state and decision-basis clauses in each mental module, retaining product/color-related text. */ AS (
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('selection', 'verification', 'result_assessment', 'state', 'decision_basis'), 'memory', 1, 9)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('selection', 'verification', 'result_assessment', 'state', 'decision_basis'), 'reflection', 1, 9)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('selection', 'verification', 'result_assessment', 'state', 'decision_basis'), 'plan', 1, 9)
), brown_mind /* Inspect brown wording in every relevant mental module through step 9; join it to discovered target/topic steps to compare updating and decision reliance. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('brown', ('memory', 'reflection', 'plan'), 1, 9)
), clicks /* Track actual click actions across steps 1–9; memory or plans are not proof that a variant was selected. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('click', 1, 9)
), brown_observations /* Compare original brown observations with those selection attempts to test whether feedback establishes a filter or exact shade mapping. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('brown', 'observation', 1, 9)
), product_evidence /* Retrieve independently worded product-specific source evidence and any product-specific description evidence, without treating listing options as selected values. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B07HP6LVRS', 'rubber outsole', 'slip-resistant'), 'observation', 1, 9)
)
SELECT
*
FROM target_claims
UNION ALL BY NAME
SELECT
*
FROM claim_topics
WHERE
  LOWER(text) LIKE '%brown%' OR LOWER(text) LIKE '%mcici%' OR LOWER(text) LIKE '%b07hp6lvrs%' OR LOWER(text) LIKE '%color%'
UNION ALL BY NAME
SELECT
*
FROM brown_mind
UNION ALL BY NAME
SELECT
*
FROM clicks
UNION ALL BY NAME
SELECT
*
FROM brown_observations
UNION ALL BY NAME
SELECT
*
FROM product_evidence
ORDER BY
  step,
  module;
