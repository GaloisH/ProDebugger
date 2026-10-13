# 六条构造轨迹汇总

从本轮 30 个任务中选取 6 个，逐步编写 MAP → ROUTE → manager → TRACE 查询 → TRACE 判断 → SUBMIT 的诊断示范。每条保留原始任务、观察和动作，新增的诊断过程标记为人工构造。

6 条共 6 个 investigator、6 次 SQL、322 行返回；SQL 无报错、无部分失败、无截断。SQL 与各阶段校验器实际离线执行，新增模型 API 调用为 0。

| 任务 | 示范选择 | SQL 行数 | 主要证据问题 |
|---|---|---:|---|
| [GPT-4o_019_alfworld_task_019](../../traces/evidence-query-claims-n30-20261013/constructed/GPT-4o_019_alfworld_task_019/README.md) | 9 / plan | 52 | 清洁条件被放置完成条件替代 |
| [GPT-4o_055_alfworld_task_055](../../traces/evidence-query-claims-n30-20261013/constructed/GPT-4o_055_alfworld_task_055/README.md) | 5 / reflection | 47 | 从后续完成断言追到首次明确确认 |
| [GPT-4o_013_alfworld_task_013](../../traces/evidence-query-claims-n30-20261013/constructed/GPT-4o_013_alfworld_task_013/README.md) | 14 / reflection | 38 | 追踪 soapbottle 被当作 spraybottle 的决策 |
| [Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d](../../traces/evidence-query-claims-n30-20261013/constructed/Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d/README.md) | 9 / plan | 44 | 购买决定覆盖了同一步的验证要求 |
| [Qwen3-8B_013_chat_b000_t00_e13-eb20423f](../../traces/evidence-query-claims-n30-20261013/constructed/Qwen3-8B_013_chat_b000_t00_e13-eb20423f/README.md) | 9 / memory | 64 | 颜色近似猜测被升级为购买依据 |
| [Qwen3-8B_010_chat_b000_t00_e10-69d80a84](../../traces/evidence-query-claims-n30-20261013/constructed/Qwen3-8B_010_chat_b000_t00_e10-69d80a84/README.md) | 26 / memory | 77 | 局部颜色误认与后续恢复分开判断 |

每条目录包含完整事件日志、MAP 结果、ROUTE 证据、manager 输入与条件计划、TRACE 输入、带英文注释的 SQL 和全部返回、候选、SUBMIT 输入与答案、原文解释及校验文件。同一步的多个模块候选会逐一比较；单 worker 的根因角色不披露给 SUBMIT。

校验通过的项目：原归档与输入成员 SHA-256、原文引用及偏移一致、引用实际可见、manager/TRACE/SUBMIT schema、查询和计划原样交接、单次查询及单步输出约束。复杂语义条目在离线模式下保持 unresolved，没有编造解析模型调用。

这些是供展示和调试使用的人工示范，作者参考了已有日志及离线分析。结构与引用校验不等于独立的根因正确性认证；没有把六条手工决策计入模型准确率，也没有覆盖原来的 requests、result、压缩归档或评测统计。原 30 任务成绩仍见 [原实验汇总](README.md)。

[全部示范入口](../../traces/evidence-query-claims-n30-20261013/constructed/README.md) · [机器可读汇总](constructed_summary.json) · [手工配置](constructed_specs.json) · [文件校验清单](../../traces/evidence-query-claims-n30-20261013/constructed/manifest.json)
