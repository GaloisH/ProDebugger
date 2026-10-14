# Qwen3-8B_011_chat_b000_t00_e11-1cc61441：简化 SQL

从原运行转换并离线验证的查询视图，不是新的模型运行。JSON 行仅省略 NULL 键；原始模型响应及诊断结论保留在上层归档。

- [fit_conflict_trace.sql](fit_conflict_trace.sql)：4278 → 3236 字符，134 行；[完整返回](fit_conflict_trace.result.json)。
