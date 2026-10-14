-- Purpose: Test whether step 11's “less critical attributes” decision rests on an unsupported earlier no-match assessment, versus a defensible exploratory broadening after genuinely unproductive results; compare its strongest rival with original search actions and page feedback.
WITH mental_claims /* Discover result-assessment and decision-basis clauses in all mental modules through step 11; this searches for an earlier origin rather than presuming step 10. */ AS (
  SELECT
  *
  FROM FIND_CLAIMS(('result_assessment', 'decision_basis'), 'memory', 1, 11)
  UNION ALL BY NAME
  SELECT
  *
  FROM FIND_CLAIMS(('result_assessment', 'decision_basis'), 'reflection', 1, 11)
  UNION ALL BY NAME
  SELECT
  *
  FROM FIND_CLAIMS(('result_assessment', 'decision_basis'), 'plan', 1, 11)
), concrete_claims /* Find concrete variants of the disputed no-relevant-results and flexibility rationale across prior mental modules. */ AS (
  SELECT
  *
  FROM SEARCH_TEXT('relevant products', ('memory', 'reflection'), 1, 11)
  UNION ALL BY NAME
  SELECT
  *
  FROM SEARCH_TEXT('matching results', 'reflection', 1, 11)
  UNION ALL BY NAME
  SELECT
  *
  FROM SEARCH_TEXT(('lack of progress', 'less critical', 'trade-offs'), 'plan', 1, 11)
), peer_context /* Retrieve peer-module wording at discovered claim steps to distinguish a qualified report from a broad unsupported conclusion. */ AS (
  SELECT
  *
  FROM SEARCH_TEXT('criteria', ('memory', 'reflection', 'plan'), 1, 11)
  WHERE
    step IN (
      SELECT
      step
      FROM mental_claims
      UNION BY NAME
      SELECT
      step
      FROM concrete_claims
    )
), search_actions /* Track every original search action in the task range to compare full-criteria and broad queries, including later restoration. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('search', 1, 30)
), page_feedback /* Inspect original result-page excerpts following early searches; listing snippets can show query yield but not a complete attribute match. */ AS (
  SELECT
  *
  FROM SEARCH_TEXT(('Page 1', 'Total results', 'B09GL561XH'), 'observation', 1, 11)
)
/* Combine claim discovery, same-step context, action sequence and page feedback without treating absent terms as proof. */
SELECT
step, module, text, source_kind
FROM mental_claims
UNION ALL BY NAME
SELECT
step, module, text, source_kind
FROM concrete_claims
UNION ALL BY NAME
SELECT
step, module, text, source_kind
FROM peer_context
UNION ALL BY NAME
SELECT
*
FROM search_actions
UNION ALL BY NAME
SELECT
step, module, text, source_kind
FROM page_feedback
ORDER BY
  step,
  module;
