# 追踪 soapbottle 被当作 spraybottle 的决策

人工构造的 debugger 示范。决策为手工编写，工具返回为真实离线执行；不计入 30 任务实测成绩。

原任务：put a spraybottle in countertop.

来源：`GPT-4o_013_alfworld_task_013`；原始归档 `GPT-4o_013_alfworld_task_013.tar.gz` 的 SHA-256：`1f2686b53c898e63a7607d21826fe6681b6462d535a7303516f518bab258f9a9`。

## 逐阶段轨迹

### 1. MAP — view

Read the verbatim task and its structured requirements. Treat incomplete parsing and unverified attributes as unknown, never as negative environment facts.

```json
{
  "spec": "requirements",
  "scope": {
    "mode": "global"
  }
}
```

### 2. ROUTE — span

Inspect the original anchor module behind the selected Fact.

```json
{
  "fid": 164,
  "scope": {
    "mode": "global"
  }
}
```

### 3. ROUTE — view

Compare the anchor with its observation, related modules and parse audit before declaring a hypothesis.

```json
{
  "spec": "local_audits | steps:17:17 | detail:full",
  "scope": {
    "mode": "global"
  }
}
```

### 4. ROUTE — route_cases

The anchor supplies a hypothesis only. Investigate the earlier decision that could explain it and inspect independent observations plus later correction.

```json
{
  "candidates": [
    {
      "candidate_id": "authored_route",
      "issue_step": 17,
      "issue_fids": [
        164
      ],
      "goal_links": [
        "req:spraybottle_in_countertop"
      ],
      "hypothesis": "Where did the plan to satisfy a spraybottle task with soapbottle 1 become an actionable substitution? Search earlier related modules and test the rival that this was only a temporary hypothesis followed by correction."
    }
  ]
}
```

### 5. MANAGER — plan_trace

One investigator can compare origin, same-step alternatives and later recovery in one query.

完整输入与返回见 [manager_plan.json](manager_plan.json) 和 [events.jsonl](events.jsonl)。

### 6. TRACE_QUERY — query_logs

Use one composed element query for relevant earlier claims, peer modules, actual actions, source observations and recovery. Parsed entity facts are supplementary; source text controls the conclusion.

```sql
-- Purpose: Trace the object-substitution decision and check both the next-step correction and later recurrence.
-- Search entity-specific history before the anchor and later recovery; never retrieve whole steps.
WITH evidence AS (
-- Inspect the memory evidence for 'soapbottle' in original steps 1-17.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('soapbottle','memory',1,17)
UNION
-- Inspect the reflection evidence for 'soapbottle' in original steps 1-17.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('soapbottle','reflection',1,17)
UNION
-- Inspect the plan evidence for 'soapbottle' in original steps 1-17.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('soapbottle','plan',1,17)
UNION
-- Inspect the observation evidence for 'soapbottle 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('soapbottle 1','observation',1,30)
UNION
-- Inspect the action evidence for 'soapbottle 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('soapbottle 1','action',1,30)
UNION
-- Inspect the observation evidence for 'spraybottle' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('spraybottle','observation',1,30)
UNION
-- Track the disputed entity; parsed claims and derived checks remain unverified.
SELECT step,'parsed_fact' AS module,span AS text,NULL AS source_id,
       NULL AS start,NULL AS end,fid,source_kind,parse_status,
       rel,args,slot,side,value,value_type,assertion_time,claim_scope,claim_polarity
FROM TRACK_ENTITY('portable:soapbottle_1',1,30)
)
-- Deduplicate overlapping excerpts while retaining exact source offsets.
SELECT DISTINCT * FROM evidence ORDER BY step,module,start,fid;
```

真实离线查询返回 38 行，无报错、无截断。全部结果见 [query_result.json](query_result.json)。

### 7. TRACE_ASSESS — assess

Compare the observed evidence, strongest alternative interpretation and causal timing. Submit one original step; same-step module alternatives are retained when material.

完整输入与返回见 [trace_assessment.json](trace_assessment.json) 和 [events.jsonl](events.jsonl)。

### 8. SUBMIT — authored JSON response

The evidence_supported rule is met by the exact cabinet observation, the step-14 reflection directive and the actual take action. Reflection is selected over its same-step plan continuation because it supplies the actionable interpretation. The evidence_unknown rule limits causal scope: step 15 corrects the mistake and step 16 later relapses. This is a supported local object-substitution decision, not proof that it is the unique cause of every later failure.

## 查询证据与判断

**Step 14 / observation**

> In it, you see a candle 1, and a soapbottle 1.

The environment names a soapbottle, not a spraybottle.

**Step 14 / reflection**

> I should now focus on taking the soapbottle 1 and placing it on the countertop.

The actionable recommendation goes beyond merely considering a possible equivalence.

**Step 14 / plan**

> which can then be placed on the countertop to complete the task.

The plan adopts the same object substitution as task completion.

**Step 14 / action**

> take soapbottle 1 from cabinet 3

The action follows the recommendation.

**Step 15 / reflection**

> No, I mistakenly picked up a soapbottle instead of a spraybottle.

A real correction is present and must be retained as counterevidence to continuous propagation.

**Step 16 / plan**

> the task requires placing the soapbottle on the countertop

The mistaken task description reappears after the correction, connecting the investigation to the later anchor.

## 最终示范输出

`14 / reflection / outcome_misinterpretation`

The evidence_supported rule is met by the exact cabinet observation, the step-14 reflection directive and the actual take action. Reflection is selected over its same-step plan continuation because it supplies the actionable interpretation. The evidence_unknown rule limits causal scope: step 15 corrects the mistake and step 16 later relapses. This is a supported local object-substitution decision, not proof that it is the unique cause of every later failure.

修复建议：Treat soapbottle and spraybottle as distinct task types unless the environment proves equivalence. Preserve the step-15 correction in later memory and resume searching for a confirmed spraybottle.

证据边界：The step-14 wording includes potential, so the mere hypothesis of object equivalence is not the error. The actionable recommendation adopts the wrong object. Step 15 temporarily corrects the mistake, and step 16 reintroduces it; this prevents a claim of uninterrupted propagation or uniquely established final root cause.

原始 observation(t) 先于 action(t)，action(t) 的反馈通常位于 observation(t+1)。没有新建环境反馈、供应商请求 ID、模型耗时或 token 统计。

阶段输入：[MAP](goal_map.json)、[manager](manager_input.json)、[TRACE](trace_input.json)、[SUBMIT](submit_input.json)。

完整交接：[manager 计划](manager_plan.json)、[TRACE 结果](trace_assessment.json)、[SUBMIT 答案](submit_answer.json)、[结构校验](validation.json)、[来源说明](provenance.json)。
