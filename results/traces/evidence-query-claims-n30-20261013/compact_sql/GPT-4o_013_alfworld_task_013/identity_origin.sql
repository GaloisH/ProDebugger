-- Purpose: test whether soapbottle-as-spraybottle originated before step 14 or only became operative then, against the strongest rival of tentative exploration followed by independent search; compare object feedback and later correction/reliance.
WITH memories /* Search the disputed item identity in memories across steps 1-14 to locate any earlier premise, not just the suggested step 13. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('soapbottle', 'spraybottle'), 'memory', 1, 14)
), mental_claims /* Find earlier hypothesis, decision-basis, and state clauses across reflection and plan, retaining only text tied to either required or candidate item. */ AS (
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('hypothesis', 'decision_basis', 'state'), 'reflection', 1, 14)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('hypothesis', 'decision_basis', 'state'), 'plan', 1, 14)
), peer_text /* Retrieve same-step peer plans/reflections mentioning the object so tentative wording can be compared with intended action. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('soapbottle', 'spraybottle'), ('reflection', 'plan'), 1, 14)
), object_observations /* Check original observations for the item's actual described identity and immediate take/put feedback. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('soapbottle', 'spraybottle'), 'observation', 1, 30)
), object_actions /* Track actual take and put actions involving soapbottle, distinguishing attempted behavior from its observation feedback. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION(('take', 'put'), 1, 30)
  WHERE
    LOWER(CAST(args AS TEXT)) LIKE '%soapbottle_1%'
), later_mind /* Search post-anchor mental text for explicit correction or continued task-item reliance through the available trajectory. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('soapbottle', 'spraybottle'), 'memory', 15, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('soapbottle', 'spraybottle'), 'reflection', 15, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('soapbottle', 'spraybottle'), 'plan', 15, 30)
)
/* Combine targeted origin, peer, independent action/effect, and recovery evidence; item wording is a retrieval cue, not proof by itself. */
SELECT
*
FROM memories
UNION ALL BY NAME
SELECT
*
FROM mental_claims
WHERE
  LOWER(text) LIKE '%soapbottle%' OR LOWER(text) LIKE '%spraybottle%'
UNION ALL BY NAME
SELECT
*
FROM peer_text
UNION ALL BY NAME
SELECT
*
FROM object_observations
UNION ALL BY NAME
SELECT
*
FROM object_actions
UNION ALL BY NAME
SELECT
*
FROM later_mind
ORDER BY
  step,
  module;
