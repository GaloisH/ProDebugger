# 六条逐阶段构造轨迹

基于同一轮 30 条中的 6 条原始任务，手工编写完整诊断示范。原始观察和动作不变；DSL 查询在归档日志上实际离线执行。人工决策标记为 synthetic，不作为模型实测或新增准确率。

每条包含 MAP → ROUTE → manager → TRACE 查询 → TRACE 判断 → SUBMIT，附完整交接 JSON、原文引用、SQL 返回和校验结果。

| 任务 | 示范选择 | 内容 |
|---|---|---|
| [GPT-4o_019_alfworld_task_019](GPT-4o_019_alfworld_task_019/README.md) | 9 / plan | 清洁条件被放置完成条件替代 |
| [GPT-4o_055_alfworld_task_055](GPT-4o_055_alfworld_task_055/README.md) | 5 / reflection | 从后续完成断言追到首次明确确认 |
| [GPT-4o_013_alfworld_task_013](GPT-4o_013_alfworld_task_013/README.md) | 14 / reflection | 追踪 soapbottle 被当作 spraybottle 的决策 |
| [Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d](Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d/README.md) | 9 / plan | 购买决定覆盖了同一步的验证要求 |
| [Qwen3-8B_013_chat_b000_t00_e13-eb20423f](Qwen3-8B_013_chat_b000_t00_e13-eb20423f/README.md) | 9 / memory | 颜色近似猜测被升级为购买依据 |
| [Qwen3-8B_010_chat_b000_t00_e10-69d80a84](Qwen3-8B_010_chat_b000_t00_e10-69d80a84/README.md) | 26 / memory | 局部颜色误认与后续恢复分开判断 |

每条 1 个 investigator、1 次带英文注释的元素查询。SUBMIT 选择 TRACE 已提交的候选并保留证据限制；单 worker 的 is_root_cause 不传入 SUBMIT。解析使用存档审核结果和离线模板，不伪造 LLM backoff。

校验包括：原始归档及成员 SHA-256、精确原文和偏移、引用可见性、manager/TRACE/SUBMIT 协议、查询结果交接、原始文件未变。校验通过只说明这些约束成立，不构成根因的独立真值认证。

在仓库根目录可重建到新目录（不需要 API key）：

```bash
PYTHONHASHSEED=42 .venv/bin/python -B scripts/construct_trace_examples.py --output /tmp/prodebugger-constructed-replay
```

手工配置保存在 `results/summary/evidence-query-claims-n30-20261013/constructed_specs.json`。生成器只读归档，拒绝覆盖已有输出目录。
