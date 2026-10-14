# 30 任务、30 worker 实验汇总

新增 [SQL 简化结果](sql_simplification.md)与[逐 agent 提示词审查](prompt_cleanup.md)：覆盖全部 30 个任务的 35 条实际查询及 6 条示范查询；仅离线转换核对，下面的原实验成绩保持不变。

运行 `evidence-query-claims-n30-20261013`；模型 `openai/gpt-6-luna-pro`；耗时 844.64 秒。

同目录新增 [6 条逐阶段构造示范汇总](constructed_summary.md)，完整轨迹见 [constructed/](../../traces/evidence-query-claims-n30-20261013/constructed/README.md)。这些示范的决策由人工编写，SQL 返回为真实离线执行；下列数字仍是原 30 条实际运行结果。

状态：{"diagnosed": 24, "no_candidate": 4, "uncertain": 1, "error": 1}。所有 30 个任务都计入分母。

| 指标 | 结果 |
|---|---:|
| step 匹配 | 3/30 |
| step + module 匹配 | 0/30 |
| step + module + 类别匹配 | 0/30 |
| 标注 step + module 进入 TRACE 候选池 | 1/30 |
| 实际 TRACE 输入中标注模块原文可见 | 21/30 |

精确标注匹配不等于因果正确性认证；原文可见不证明模型正确使用。抽样保留此前 10 个任务，其余按种子 42 补充；不属于完全独立的新测试集。

标注模块不在当前候选 schema 内的任务：`[{"trajectory_id": "Qwen3-8B_011_id_11___chat_b006_t00_e01-5b8f974f", "gold_module": "system"}, {"trajectory_id": "GPT-4o_021_alfworld_task_021", "gold_module": "system"}, {"trajectory_id": "Qwen3-8B_024_id_24___chat_b013_t00_e01-5b8f974f", "gold_module": "system"}, {"trajectory_id": "GPT-4o_003_chat_b000_t00_e02-1e119842", "gold_module": "system"}]`。这些任务仍计入完整分母，没有按标注筛掉或替换。

标注候选曾进入 TRACE 池但最终未选中的任务：`[{"trajectory_id": "GPT-4o_014_chat_b000_t00_e13-c39f2c41", "gold_step": 2, "gold_module": "memory", "predicted_step": 12, "predicted_module": "reflection"}]`。

## 运行与故障

- worker 启动间隔：0.083354 秒。
- manager 计划 29 份，调查 35 个，计划校验错误 10 次。
- SQL 35 次，失败 0 次，部分失败 0 次，截断 0 次，成功但空返回 0 次。
- 语义解析实际调用 35 次；截断响应 0 次；补齐请求 0 次；最终缺失条目 0 个。
- 语句卡片覆盖：`{"model_reviewed": 3991, "unresolved": 1969, "template_complete": 36, "partial": 600}`。完整返回不表示全部语义通过校验。
- SQL 离线重放一致：True。交接/根因字段披露检查问题 0 项；来源/查询传递问题 0 项。被拒绝的诊断响应单列在失败任务中。
- 运行期间后端源码指纹保持一致。每个实际请求、响应和完整日志都保存在下列轨迹归档中。

```json
[
  {
    "trajectory_id": "GPT-4o_006_alfworld_task_006",
    "status": "no_candidate",
    "stop_reason": "TRACE completed with no candidates; SUBMIT skipped"
  },
  {
    "trajectory_id": "GPT-4o_012_alfworld_task_012",
    "status": "uncertain",
    "stop_reason": "The complete 30-step timeline and original modules were assessed at the salient points: steps 1–4, 9–11, 15, 21–25, and 26–30, with targeted source reads including the step-1 inventory plan/action, step-4 and step-24 table examinations, step-25 box plan/take action, step-26 box examination, and step-29/30 plan/action. The unresolved subgoal is locating a credit card and then placing it in the coffee table. The trajectory shows extensive but plausible exploration; drawers/cabinets yielded empty observations or watches, the table held a box/statue, and the box was taken and later reported empty. The quoted examine actions at steps 4 and 26 produced no effect, but step 24 later successfully refreshed the table observation and step 27 successfully examined the box, so those effects have counterevidence/recovery. Taking the box at step 25 differs from the plan's literal 'examine' wording, but taking it is a plausible prerequisite to inspect it, and the subsequent examination occurred. The later table re-examination and move to the sidetable are also plausible search actions, not established faults. Step 28's original observation says the box was normal and empty; its extraction gap is a parser limitation, not evidence of agent error. No concrete decision is sufficiently supported as a cause that blocks the necessary subgoal. Terminal state and possible remaining locations are unknown; no failure and no success can be established. Assessed steps are the listed salient steps; other steps were reviewed in the complete timeline but not all original modules were individually inspected."
  },
  {
    "trajectory_id": "GPT-4o_002_alfworld_task_002",
    "status": "error",
    "stop_reason": "direct SUBMIT response rejected: Action formatting/spelling/quoted-vs-bare causes are excluded, even under invalid_action/parameter_error/misalignment. Evaluate semantic choices or use uncertain."
  },
  {
    "trajectory_id": "GPT-4o_021_alfworld_task_021",
    "status": "no_candidate",
    "stop_reason": "TRACE completed with no candidates; SUBMIT skipped"
  },
  {
    "trajectory_id": "GPT-4o_012_chat_b000_t00_e11-1cc61441",
    "status": "no_candidate",
    "stop_reason": "TRACE completed with no candidates; SUBMIT skipped"
  },
  {
    "trajectory_id": "GPT-4o_005_chat_b000_t00_e04-7e3c13ba",
    "status": "no_candidate",
    "stop_reason": "TRACE completed with no candidates; SUBMIT skipped"
  }
]
```

## 用量

供应商报告的 token；未计算美元成本。

```json
{
  "diagnosis_input_tokens": 51269360,
  "parsing_input_tokens": 722491,
  "claim_parsing_input_tokens": 1847395,
  "diagnosis_output_tokens": 1156958,
  "parsing_output_tokens": 156099,
  "claim_parsing_output_tokens": 572254,
  "diagnosis_model_calls": 371,
  "parsing_model_calls": 29,
  "claim_parsing_model_calls": 35
}
```

## 文件导航

- [summary.json](summary.json)：整体结果、分环境统计、旧 10 任务比较和故障。
- [tasks.csv](tasks.csv)：逐任务结果；[evaluation.md](evaluation.md)：标注比较、最终理由和 SQL。
- [manager_review.txt](manager_review.txt)：分配、查询、候选及 SUBMIT 审计。
- [claim_parsing_review.txt](claim_parsing_review.txt)：语义覆盖、截断与补齐统计。
- [sample.json](sample.json)、[launch.json](launch.json)、[manifest.json](manifest.json)：抽样、启动和配置/源码指纹。
- [trace_archives.json](trace_archives.json)：每个归档及每个文件的字节数、SHA-256；[SHA256SUMS](SHA256SUMS)：压缩包校验。

## 完整轨迹归档

归档包含每个任务全部运行文件：input、canonical record、解析审核、模型 requests/usage/messages、phase_events、tool_calls、manager_plan、trace_queries、window_trace、direct_submit、checkpoint 和 result（以实际执行到达阶段为准）。

| 归档 | 文件数 | 压缩字节 |
|---|---:|---:|
| [GPT-4o_019_alfworld_task_019.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_019_alfworld_task_019.tar.gz) · [逐阶段构造示范](../../traces/evidence-query-claims-n30-20261013/constructed/GPT-4o_019_alfworld_task_019/README.md) | 43 | 970493 |
| [GPT-4o_006_alfworld_task_006.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_006_alfworld_task_006.tar.gz) | 34 | 915179 |
| [GPT-4o_055_alfworld_task_055.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_055_alfworld_task_055.tar.gz) · [逐阶段构造示范](../../traces/evidence-query-claims-n30-20261013/constructed/GPT-4o_055_alfworld_task_055/README.md) | 42 | 832991 |
| [GPT-4o_047_alfworld_task_047.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_047_alfworld_task_047.tar.gz) | 38 | 867727 |
| [GPT-4o_037_alfworld_task_037.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_037_alfworld_task_037.tar.gz) | 40 | 1215740 |
| [GPT-4o_013_chat_b000_t00_e12-f27d2887.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_013_chat_b000_t00_e12-f27d2887.tar.gz) | 42 | 1043128 |
| [GPT-4o_011_chat_b000_t00_e10-69d80a84.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_011_chat_b000_t00_e10-69d80a84.tar.gz) | 42 | 1206043 |
| [Qwen3-8B_011_chat_b000_t00_e11-1cc61441.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_011_chat_b000_t00_e11-1cc61441.tar.gz) | 44 | 1004182 |
| [GPT-4o_009_chat_b000_t00_e08-6a7bac22.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_009_chat_b000_t00_e08-6a7bac22.tar.gz) | 39 | 1328900 |
| [Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d.tar.gz) · [逐阶段构造示范](../../traces/evidence-query-claims-n30-20261013/constructed/Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d/README.md) | 43 | 769360 |
| [Qwen3-8B_002_id_2___chat_b000_t00_e04-7e3c13ba.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_002_id_2___chat_b000_t00_e04-7e3c13ba.tar.gz) | 40 | 1412197 |
| [GPT-4o_012_alfworld_task_012.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_012_alfworld_task_012.tar.gz) | 35 | 545456 |
| [GPT-4o_002_alfworld_task_002.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_002_alfworld_task_002.tar.gz) | 39 | 1083478 |
| [Qwen3-8B_011_id_11___chat_b006_t00_e01-5b8f974f.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_011_id_11___chat_b006_t00_e01-5b8f974f.tar.gz) | 38 | 800139 |
| [GPT-4o_026_alfworld_task_026.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_026_alfworld_task_026.tar.gz) | 41 | 1016036 |
| [GPT-4o_024_alfworld_task_024.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_024_alfworld_task_024.tar.gz) | 42 | 901692 |
| [GPT-4o_021_alfworld_task_021.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_021_alfworld_task_021.tar.gz) | 39 | 928433 |
| [GPT-4o_013_alfworld_task_013.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_013_alfworld_task_013.tar.gz) · [逐阶段构造示范](../../traces/evidence-query-claims-n30-20261013/constructed/GPT-4o_013_alfworld_task_013/README.md) | 39 | 961042 |
| [Qwen3-8B_024_id_24___chat_b013_t00_e01-5b8f974f.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_024_id_24___chat_b013_t00_e01-5b8f974f.tar.gz) | 42 | 1172456 |
| [GPT-4o_011_alfworld_task_011.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_011_alfworld_task_011.tar.gz) | 39 | 932442 |
| [GPT-4o_012_chat_b000_t00_e11-1cc61441.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_012_chat_b000_t00_e11-1cc61441.tar.gz) | 39 | 904543 |
| [Qwen3-8B_007_chat_b000_t00_e07-d50ae81f.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_007_chat_b000_t00_e07-d50ae81f.tar.gz) | 39 | 1589531 |
| [GPT-4o_005_chat_b000_t00_e04-7e3c13ba.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_005_chat_b000_t00_e04-7e3c13ba.tar.gz) | 37 | 957535 |
| [GPT-4o_003_chat_b000_t00_e02-1e119842.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_003_chat_b000_t00_e02-1e119842.tar.gz) | 44 | 1187793 |
| [Qwen3-8B_013_chat_b000_t00_e13-eb20423f.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_013_chat_b000_t00_e13-eb20423f.tar.gz) · [逐阶段构造示范](../../traces/evidence-query-claims-n30-20261013/constructed/Qwen3-8B_013_chat_b000_t00_e13-eb20423f/README.md) | 49 | 1002012 |
| [GPT-4o_014_chat_b000_t00_e13-c39f2c41.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_014_chat_b000_t00_e13-c39f2c41.tar.gz) | 43 | 1222150 |
| [GPT-4o_015_chat_b000_t00_e14-1d03d2d8.tar.gz](../../traces/evidence-query-claims-n30-20261013/GPT-4o_015_chat_b000_t00_e14-1d03d2d8.tar.gz) | 48 | 1038170 |
| [Llama3.3-70B-Turbo_014_webshop_task_014.tar.gz](../../traces/evidence-query-claims-n30-20261013/Llama3.3-70B-Turbo_014_webshop_task_014.tar.gz) | 46 | 1630599 |
| [Llama3.3-70B-Turbo_017_webshop_task_017.tar.gz](../../traces/evidence-query-claims-n30-20261013/Llama3.3-70B-Turbo_017_webshop_task_017.tar.gz) | 55 | 1422248 |
| [Qwen3-8B_010_chat_b000_t00_e10-69d80a84.tar.gz](../../traces/evidence-query-claims-n30-20261013/Qwen3-8B_010_chat_b000_t00_e10-69d80a84.tar.gz) · [逐阶段构造示范](../../traces/evidence-query-claims-n30-20261013/constructed/Qwen3-8B_010_chat_b000_t00_e10-69d80a84/README.md) | 43 | 1180286 |
| [run-metadata.tar.gz](../../traces/evidence-query-claims-n30-20261013/run-metadata.tar.gz) | 9 | 511442 |

在仓库根目录解包：

```bash
mkdir -p artifacts/dsl_debugger
for archive in results/traces/evidence-query-claims-n30-20261013/*.tar.gz; do
  tar -xzf "$archive" -C artifacts/dsl_debugger
done
```

在本汇总目录运行 `sha256sum -c SHA256SUMS` 可核对归档。只有所选任务的运行证据进入归档；凭据与原始全量数据包不包含在提交中。
