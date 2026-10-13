# 清洁条件被放置完成条件替代

人工构造的 debugger 示范。决策为手工编写，工具返回为真实离线执行；不计入 30 任务实测成绩。

原任务：put a clean ladle in diningtable.

来源：`GPT-4o_019_alfworld_task_019`；原始归档 `GPT-4o_019_alfworld_task_019.tar.gz` 的 SHA-256：`fe6e11091335331edab4af0173c2e5e7b5010715c7a49931cd76d901b2a1b517`。

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
  "fid": 167,
  "scope": {
    "mode": "global"
  }
}
```

### 3. ROUTE — view

Compare the anchor with its observation, related modules and parse audit before declaring a hypothesis.

```json
{
  "spec": "local_audits | steps:10:10 | detail:full",
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
      "issue_step": 10,
      "issue_fids": [
        167
      ],
      "goal_links": [
        "req:ladle_in_diningtable"
      ],
      "hypothesis": "Does the later completion claim follow from treating placement as sufficient, or was cleanliness already established? Search backward for the cleanliness obligation and compare pickup, placement and subsequent verification before blaming the first pickup."
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
-- Purpose: Separate placement success from cleanliness verification and locate the decision that collapsed the two requirements.
-- Search entity-specific history before the anchor and later recovery; never retrieve whole steps.
WITH evidence AS (
-- Inspect the plan evidence for 'clean' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','plan',1,10)
UNION
-- Inspect the plan evidence for 'complete the task' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('complete the task','plan',1,10)
UNION
-- Inspect the reflection evidence for 'clean' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','reflection',1,10)
UNION
-- Inspect the action evidence for 'ladle 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('ladle 1','action',1,30)
UNION
-- Inspect the observation evidence for 'ladle 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('ladle 1','observation',1,30)
UNION
-- Inspect the observation evidence for 'clean' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','observation',1,30)
UNION
-- Inspect the memory evidence for 'clean' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','memory',1,10)
UNION
-- Track the disputed entity; parsed claims and derived checks remain unverified.
SELECT step,'parsed_fact' AS module,span AS text,NULL AS source_id,
       NULL AS start,NULL AS end,fid,source_kind,parse_status,
       rel,args,slot,side,value,value_type,assertion_time,claim_scope,claim_polarity
FROM TRACK_ENTITY('portable:ladle_1',1,30)
)
-- Deduplicate overlapping excerpts while retaining exact source offsets.
SELECT DISTINCT * FROM evidence ORDER BY step,module,start,fid;
```

真实离线查询返回 52 行，无报错、无截断。全部结果见 [query_result.json](query_result.json)。

### 7. TRACE_ASSESS — assess

Compare the observed evidence, strongest alternative interpretation and causal timing. Submit one original step; same-step module alternatives are retained when material.

完整输入与返回见 [trace_assessment.json](trace_assessment.json) 和 [events.jsonl](events.jsonl)。

### 8. SUBMIT — authored JSON response

Under evidence_supported, the selected step-9 plan explicitly predicts full task completion from location alone after step 7 had identified a cleanliness check. Original action 9 places the ladle and the step-10 anchor proceeds from completion. Under evidence_unknown, the actual cleanliness of the ladle and unique cause of ultimate failure remain unresolved. This diagnosis concerns the unsupported sufficiency premise, not a fabricated dirty state.

## 查询证据与判断

**Step 7 / plan**

> I should examine the ladles to determine which one is clean.

Earlier planning explicitly identifies the cleanliness check as necessary; the requirement was not an invention of the parser.

**Step 7 / action**

> take ladle 1 from countertop 1

Pickup is not an examination, but could have been preparatory. This alone is not enough to identify the root cause.

**Step 9 / plan**

> This action will complete the task by placing the ladle in the correct location.

The later plan makes a full completion prediction based solely on placement, which is more diagnostic than the earlier pickup.

**Step 9 / action**

> move ladle 1 to diningtable 1

The plan is followed by a placement action; no cleanliness property is established by this action string.

## 最终示范输出

`9 / plan / constraint_ignorance`

Under evidence_supported, the selected step-9 plan explicitly predicts full task completion from location alone after step 7 had identified a cleanliness check. Original action 9 places the ladle and the step-10 anchor proceeds from completion. Under evidence_unknown, the actual cleanliness of the ladle and unique cause of ultimate failure remain unresolved. This diagnosis concerns the unsupported sufficiency premise, not a fabricated dirty state.

修复建议：Keep cleanliness and destination as separate requirements. Establish cleanliness through applicable source-backed inspection or cleaning, then place the ladle and verify the destination.

证据边界：The recorded sources do not establish whether ladle 1 was actually dirty. The example diagnoses treating placement as sufficient for a clean-object goal; it does not certify the unique cause of the final task outcome. Earlier acquisition can be a reasonable preparatory action.

原始 observation(t) 先于 action(t)，action(t) 的反馈通常位于 observation(t+1)。没有新建环境反馈、供应商请求 ID、模型耗时或 token 统计。

阶段输入：[MAP](goal_map.json)、[manager](manager_input.json)、[TRACE](trace_input.json)、[SUBMIT](submit_input.json)。

完整交接：[manager 计划](manager_plan.json)、[TRACE 结果](trace_assessment.json)、[SUBMIT 答案](submit_answer.json)、[结构校验](validation.json)、[来源说明](provenance.json)。
