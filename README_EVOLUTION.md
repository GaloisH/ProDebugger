# ProDebugger：从最初版本到当前版本

本文记录架构、解析、检索和诊断协议的变化，以及实验结果的保存方式。说明依据 Git 历史、当前实现和留存的实验日志；功能实现与诊断准确率分开描述。

## 版本范围

- `e0f1a41`：仓库最初公开版本，包含类型化轨迹编译、查询和 reasoner 协议，以及四阶段实验和旧工作台。
- `fa90b81`：将 DSL debugger 迁入独立的 `prodebugger/` 包。
- `208031b`：本次连续后端改动前的 `main`。此前已经合并新的只读工作台、轨迹/事实/实体/依赖图和实时运行展示。
- `yy_branch`：在上述基础上提交本轮解析审核、SQL TRACE、manager、语义表达、截断恢复及实验记录。

下文“原方案”主要指 `208031b` 中的实验后端。此前工作台的提交属于已有 Git 历史；本轮没有为新协议重新设计前端。

## 一览

| 环节 | 原方案 | 当前方案 |
|---|---|---|
| task/query、observation 解析 | 领域规则抽取；未识别语义可能未被明确标记 | 完整模板审核，不能完整解析时调用 LLM，仍有缺口则显式保留 unknown |
| 解析缺口 | 容易与缺失状态、约束或记忆混淆 | 记录覆盖情况、来源和残余文本，避免将缺口作为 agent 错误证据 |
| TRACE 上下文 | ROUTE 锚点周围固定长度 window | 锚点证据与分配的原文片段，加一次由调查 agent 编写的 SQL 查询 |
| 查询单位 | 连续步骤原文 | 实体、状态、动作、事实来源、特定原文语句和目标状态 |
| 调查分配 | 主要按 ROUTE case/window 发起 | manager 先汇总证据，分配少量有区分作用的调查并制定条件规则 |
| TRACE 输出 | 每个 window 可提出多个不同步骤 | 每个调查最多一个不同 step，可保留该 step 的模块备选及 uncertain |
| SUBMIT | 可选候选，也可输出 uncertain | 有候选时必须选择现有候选；没有候选则跳过，记录 no_candidate |
| 根因角色 | 缺少明确区分 | TRACE 可表示“错误成立但不是当前问题根因”；满足条件才披露给 SUBMIT |
| mental 模块表达 | 多数内容主要作为原文包装事实 | 独立语句卡片，表达否定、模态、限定、显式关系和可绑定指代 |
| 语义批处理 | 后续初版批量抽取截断后仅保留前缀 | 紧凑响应；截断时保留已完成项，只补齐缺失项，有限恢复 |
| 实验 | 固定小样本及本地日志 | 可配置任务数/worker，完整请求日志、独立离线评估和可校验归档 |

## 1. 程序化解析增加完整性审核

主要实现：[`template_parser.py`](prodebugger/template_parser.py)、[`parse_audit.py`](prodebugger/parse_audit.py)、领域 profiles 和 [`semantic_scope.py`](core/semantic_scope.py)。

这里的 task/query 指轨迹最初的自然语言任务，和 TRACE 编写的 SQL 是两种不同输入。

1. 先用领域模板处理有明确语法的 task 和 observation。只有完整匹配、完整消费文本并通过类型校验的结果才直接接受。
2. 对未知子句、模糊指代、否定范围或不完整抽取使用 LLM backoff。`it`、`nothing` 等词需要检查语义范围，但不再一律触发昂贵调用：模板能完整解释的固定反馈仍走程序化解析。
3. 对 LLM 返回的关系、实体绑定、类型、精确原文 span 和残余覆盖继续验证。解析器不能凭后续结果反向补写当时的观察。
4. 失败和未解释内容进入 `parse_audit.jsonl`、`audited_parse.json`；离线编译不会把未执行的 LLM 解析伪装成成功。

在 ALFWorld 中补充了固定动作反馈、物体枚举、局部可明确绑定的代词和无效果反馈；在 WebShop 中补充了商品标题/价格元组、动态属性、可用选项与已选择属性的区别。扫描范围包括当前支持的 ALFWorld/WebShop 语料，不仅是最初 10 个任务。

编译和证据判断也区分了“状态未知”和“状态为否”、选择与可用、观察反馈与 agent 自述、已记录选择与实际任务完成。缺少已解析约束，不等于 agent 本身忽略了该约束。相关实现见 [`evidence_quality.py`](prodebugger/evidence_quality.py)、[`criterion.py`](core/criterion.py)、[`intention_validation.py`](core/intention_validation.py)。

## 2. 固定 window 改为一次元素 SQL 查询

原 TRACE 默认接收 `[max(1,t-W+1),t]` 的连续原文，`W=5`。这会限制早期根因的可见性，也容易把“查证”变成大段日志重放。

当前每个调查的流程是：

```text
ROUTE 锚点证据 + manager 分配的可见原文
    → agent 编写一次带英文注释的 SQL
    → 查询结果 + 原始证据
    → assess 给出一个 step 的候选判断
```

SQL 支持 `SELECT`、`WHERE`、CTE、JOIN、UNION、排序和显式 LIMIT。函数包括：

| 用途 | 函数 |
|---|---|
| 找到或追踪具体实体 | `FIND_ENTITY`、`ABOUT`、`TRACK_ENTITY` |
| 追踪状态、动作 | `TRACK_STATE`、`STATE_AT`、`TRACK_ACTION` |
| 追踪事实依赖与版本 | `TRACE_FACT`、`VERSIONS` |
| 核对特定来源、词句 | `SOURCE`、`SEARCH_TEXT` |
| 按语句主题发现 mental 证据 | `FIND_CLAIMS` |
| 检查目标与覆盖 | `GOAL_STATUS`、`COVERAGE` |

完整函数签名和真实语料例子见 [`query_dsl.md`](prodebugger/prompts/query_dsl.md)；执行器见 [`query_dsl.py`](prodebugger/query_dsl.py)。

查询默认覆盖整条轨迹的元素，包括锚点之前的日志。禁止直接访问整步/整模块表或 `RAW_STEP`；不能用泛化搜索词绕过元素检索。原文片段保留明确来源和长度限制，语句卡片只来自最终 SELECT 实际返回的内容。被 WHERE/LIMIT 排除的行不能进入卡片。

已移除检索总行数、总字节数、函数总数等共享预算；仍保留单片段长度、显式 SQL 范围/深度、只读限制和 SQL 执行时限。API 每次输出长度、运行调用上限是另一层配置，没有宣称供应商支持无限输出。

执行器为独立 UNION 分支提供有限恢复，并明确输出失败函数、跳过分支及参数修正；不能将失败分支当成“没有匹配”。未知函数和禁止的完整日志访问仍拒绝执行。恢复不额外给 agent 一次 SQL 机会。

旧 `window_id`、`window` 字段继续用于兼容，`lo=hi=issue_step` 仅表示锚点，不再表示检索 window。

## 3. manager 分配调查，并说明如何使用调查结果

主要实现：[`trace_manager.py`](prodebugger/trace_manager.py)、[`manager.md`](prodebugger/prompts/manager.md)。

manager 可见完整动作/观察时间线、全部 ROUTE 锚点的 mental 模块、被引用的事实及解析警告，也收到 SQL 语法、原始步骤范围和关系名。它没有自动看到所有非锚点的 memory/reflection/plan；那些内容仍需调查 agent 检索。

manager 默认分配一个调查；第二个或更多调查需要不同且会改变因果判断的问题。每个分配记录调查问题、搜索目标、精确原文、支持/反驳/未知的判据。它还提前写出跨调查的条件规则，例如某个前提若成立、若被反驳、若仍未知，应如何影响最终根因比较。

计划存入 `manager_plan.json`，不能看完查询结果再改写。manager 的原文引用必须是可见来源中的连续精确子串。计划和条件规则直接进入 SUBMIT。

提示词明确要求向前追踪断言起源、区分断言提及的历史事件和断言自身出现时间，并检查后续依赖和纠正。加入真实来源的分配/查询例子；调查目标是起点，不是白名单。agent 可在同一次 SQL 中收集同一步其他模块、独立反馈和竞争机制的证据。

结构校验通过只说明计划合法，不保证调查问题足够好，也不保证条件规则的因果判断正确。

## 4. TRACE 与 SUBMIT 的责任边界

TRACE 仍允许 `error`、`uncertain` 或空候选；一个调查只能返回一个不同 step，可有同一步不同模块候选。候选中的 `is_root_cause` 区分“已确认错误”和“它是否构成当前问题的根因”。

只有至少两个独立调查提供不同具体 step、且为明确 error 并有已知根因布尔判断时，SUBMIT 才获得相应根因角色信息。单调查，或 uncertain 与另一个非根因判断的组合，不触发披露。

SUBMIT 从已有候选中选择一个具体结果，不能输出 uncertain，也不能凭空产生新的 step/module。可在模块允许范围内校正错误类别。若 TRACE 没有候选，记录 `no_candidate` 并跳过 SUBMIT；协议失败作为错误记录，不用伪造诊断掩盖。

当前 runner 仍可能在 ROUTE 阶段提前以 uncertain 结束。这类任务没有进入 SUBMIT，汇总按未给出诊断保留，不将其计为成功，也不混同于 SUBMIT 输出 uncertain。

`assess` 的结果外壳和单步约束保持稳定。manager 信息通过已有 handoff 扩展传递；随后新增的语句卡片不直接改变 TRACE→SUBMIT 的候选格式或查询证据字段。实现见 [`query_trace.py`](prodebugger/query_trace.py)、[`window_trace.py`](prodebugger/window_trace.py)、[`direct_submit.py`](prodebugger/direct_submit.py)。

## 5. 从原文包装扩展到可审查的语句表达

此前出现过“9/10 标注关键原文已经送达，但只有 1/10 进入 TRACE 候选池”。这说明检索可见性不足以证明模型注意、理解或选中了关键机制。后续一轮更出现 9/10 可见、0/10 入池，不能将问题都归给 SUBMIT。

[`claim_parser.py`](prodebugger/claim_parser.py) 将 memory、reflection、plan 中的语句组织为独立卡片，保留：

- 来源 step/module、精确 quote 与字符范围；
- 主题、肯定/否定、断言/假设/意图/条件等模态及限定词；
- 有明确原文线索的理由、条件、预期结果关系；
- 能从同一步、同模块、已可见较早句段中精确绑定的指代；
- 未解析部分、部分可见句段和校验错误。

卡片描述“agent 说了什么”，不是已证实的世界事实，更不是故障或根因判决。`FIND_CLAIMS` 的主题命中是词汇发现提示，不是完整的语义搜索。

少量严格整句模板先解析；其余可见复杂句段去重后合并调用。跨句指代与其他复杂解释在同一批次完成。缓存包含可见指代上下文，不能把较宽检索中找到的先行词泄漏给后续更窄的检索。

未提取出 typed memory claim 时使用 `memory_unparsed`，不再用 `recalled_nothing` 暗示 agent 忘记了一切。部分可见语句不会自动扩展为未查询的完整段落。

## 6. 批量解析截断的修复

初版批处理可能一次请求约 270 个句段，并重复生成较长字段和原文。在此前 10 任务实验中，10 个批次有 6 个 JSON 中途断开；程序当时只保留完整前缀，其余长期未解析。历史日志未保存结束原因，因此不能追溯确定供应商的精确终止原因。

当前修复包括：

1. 用整数来源索引、紧凑数组和省略空字段的内部格式减少输出，展开后继续执行原有精确来源校验。
2. 默认一次调用。若响应断开或返回长度终止信号，保留已完成条目，只把缺失条目分成较小批次补齐。
3. 恢复最多分裂两层；单个超大句段不盲目重复。仍失败时保留明确缺失计数和未解析来源。
4. 记录 `finish_reason`、原生结束原因、响应 ID 和供应商提供的 reasoning token 数。完整响应日志支持崩溃后恢复，避免重复请求已经完成的调用。
5. 无效语义、非原文引用和普通供应商异常不会触发无界修复循环；SQL 和源证据范围保持不变。

真实 API 小规模验证中，A006 从 158/270 条提升到 270/270，A047 从 179/269 条提升到 269/269；两批各一次调用，均无截断，输出字符分别减少 29.3%、33.0%。另有六个历史截断前缀的离线恢复检查及 98 项回归测试。

完整返回条目不代表语义全部正确。校验失败、模态歧义等仍保持 partial/unresolved；这项修复本身不是准确率提升的证明。

## 7. 30 任务实验与详细轨迹

本轮使用 `openai/gpt-6-luna-pro`，30 个任务、30 个轨迹 worker，ALFWorld/WebShop 各 15 个。保留此前 10 个任务，用随机种子 42 从剩余任务中各补 10 个；只按 ID/任务类型抽样。GAIA 没有当前领域 profile，不包含在本轮。保留旧任务意味着这不是完全独立的新测试集。

运行入口仍是 `prodebugger.run_experiment`，线程数由 `--workers` 控制。每个任务记录原始输入、编译记录、解析审核、阶段事件、manager 计划、SQL 与返回结果、TRACE 候选、SUBMIT 输入/响应、实际模型请求/返回消息、用量和最终结果。日志记录供应商实际提供的消息，不宣称包含未返回的内部推理。

- [本轮汇总目录](results/summary/evidence-query-claims-n30-20261013/)：抽样、启动配置、独立评估、查询/协议/解析审计、逐任务表和归档清单。
- [完整轨迹归档目录](results/traces/evidence-query-claims-n30-20261013/)：按任务打包的完整日志，避免将重复的大型请求文件铺满仓库。
- `artifacts/dsl_debugger/evidence-query-claims-n30-20261013/`：本地运行原始目录。

每个归档使用 SHA-256 校验；解包办法和结果指标以汇总目录中的 README 为准。失败任务保留在 30 个任务的分母内，不通过仅重跑失败任务改善表面成绩。ground truth 只用于运行结束后的离线评估，不进入模型上下文或解析规则。

运行中后端源码冻结，报告核对编译指纹。汇总区分 step、step+module、含类别完全匹配、TRACE 候选召回、SQL 错误、解析截断/恢复、协议失败及各阶段用量，避免把“成功输出诊断”当成“诊断正确”。

本轮已完成：24 个 diagnosed、4 个 no_candidate、1 个 ROUTE uncertain、1 个 SUBMIT 校验失败；step 匹配 3/30，step+module 匹配 0/30。35 个 SQL 均成功，35 个语义批次全部一次返回，无截断、无缺失条目。只有 1/30 的标注 step+module 进入 TRACE 候选池，最终未被 SUBMIT 选择。样本中另有 4 个 `system` 模块标注，超出当前候选模块 schema，仍保留在完整分母中。修复改善了响应完整性，尚未表现为定位准确率改善。

## 8. 六条人工构造的诊断示范

在同一轮 30 任务的结果目录中补充了 6 条逐阶段示范，涵盖 MAP、ROUTE、manager 分配和条件规则、单次 DSL 查询、TRACE 单步候选以及 SUBMIT 比较。选择的是原任务日志，观察、动作和归档保持原样；诊断决策由人工重新编写，并在文件中标记来源。

查询和交接实际运行现有离线工具及校验器，保留英文 SQL 注释、精确原文与偏移、解析缺口、同一步模块比较和后续恢复证据。每条使用一个 investigator；单 worker 的根因角色字段按原协议从 SUBMIT 隐藏。没有新增模型调用，也没有修改真实评测结果。

- [六条示范汇总](results/summary/evidence-query-claims-n30-20261013/constructed_summary.md)
- [完整逐阶段轨迹](results/traces/evidence-query-claims-n30-20261013/constructed/README.md)
- [可重复生成脚本](scripts/construct_trace_examples.py)：从已提交归档读取并校验输入，拒绝覆盖已有输出；仅结构校验通过不等于因果判断已获独立真值认证。

## 验证与边界

```bash
.venv/bin/python -B -m unittest discover -s checks -q
```

测试覆盖解析缺口、source scope、DSL 的早期检索/非法访问/分支恢复、manager 分配与根因角色披露、单步 TRACE、SUBMIT 约束、语义批量截断及崩溃恢复。

当前仍存在几个明确边界：领域模板不等于自然语言完整理解；主题检索不是语义全召回；manager/TRACE 的可见材料不等于完整 mental 日志；“更早的前提”与标注的关键失败步骤可能不同；结构正确和引用准确都不能代替因果判断。新前端适配不属于这一轮后端改动。
