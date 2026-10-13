# MAP → ROUTE → TRACE → SUBMIT experiment

Policy: window-candidates-submit/v5-manager-forced-choice. The TRACE manager allocates investigators; each uses one evidence-driven SQL query.

| Trajectory | Status | Original Facts | Candidates | Assessed steps | Tool calls | Model calls |
|---|---|---:|---:|---:|---:|---:|
| GPT-4o_019_alfworld_task_019 | diagnosed | 393 | 25 | 2 | 61 | 14 |
| GPT-4o_006_alfworld_task_006 | no_candidate | 304 | 22 | 0 | 17 | 7 |
| GPT-4o_055_alfworld_task_055 | diagnosed | 290 | 22 | 1 | 61 | 14 |
| GPT-4o_047_alfworld_task_047 | diagnosed | 311 | 8 | 1 | 21 | 10 |
| GPT-4o_037_alfworld_task_037 | diagnosed | 309 | 0 | 1 | 27 | 12 |
| GPT-4o_013_chat_b000_t00_e12-f27d2887 | diagnosed | 718 | 0 | 1 | 73 | 14 |
| GPT-4o_011_chat_b000_t00_e10-69d80a84 | diagnosed | 836 | 0 | 1 | 73 | 14 |
| Qwen3-8B_011_chat_b000_t00_e11-1cc61441 | diagnosed | 685 | 0 | 1 | 52 | 12 |
| GPT-4o_009_chat_b000_t00_e08-6a7bac22 | diagnosed | 804 | 0 | 1 | 23 | 11 |
| Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d | diagnosed | 338 | 0 | 1 | 55 | 11 |
| Qwen3-8B_002_id_2___chat_b000_t00_e04-7e3c13ba | diagnosed | 406 | 0 | 2 | 21 | 11 |
| GPT-4o_012_alfworld_task_012 | uncertain | 274 | 12 | 0 | 97 | 12 |
| GPT-4o_002_alfworld_task_002 | error | 400 | 4 | 1 | 19 | 10 |
| Qwen3-8B_011_id_11___chat_b006_t00_e01-5b8f974f | diagnosed | 341 | 0 | 1 | 19 | 10 |
| GPT-4o_026_alfworld_task_026 | diagnosed | 250 | 38 | 1 | 24 | 13 |
| GPT-4o_024_alfworld_task_024 | diagnosed | 323 | 10 | 2 | 18 | 10 |
| GPT-4o_021_alfworld_task_021 | no_candidate | 301 | 14 | 0 | 64 | 12 |
| GPT-4o_013_alfworld_task_013 | diagnosed | 309 | 8 | 1 | 20 | 11 |
| Qwen3-8B_024_id_24___chat_b013_t00_e01-5b8f974f | diagnosed | 329 | 0 | 1 | 25 | 14 |
| GPT-4o_011_alfworld_task_011 | diagnosed | 240 | 27 | 1 | 22 | 11 |
| GPT-4o_012_chat_b000_t00_e11-1cc61441 | no_candidate | 751 | 0 | 0 | 61 | 12 |
| Qwen3-8B_007_chat_b000_t00_e07-d50ae81f | diagnosed | 899 | 0 | 1 | 27 | 11 |
| GPT-4o_005_chat_b000_t00_e04-7e3c13ba | no_candidate | 867 | 3 | 0 | 39 | 10 |
| GPT-4o_003_chat_b000_t00_e02-1e119842 | diagnosed | 807 | 1 | 1 | 68 | 15 |
| Qwen3-8B_013_chat_b000_t00_e13-eb20423f | diagnosed | 215 | 0 | 1 | 49 | 15 |
| GPT-4o_014_chat_b000_t00_e13-c39f2c41 | diagnosed | 717 | 0 | 2 | 18 | 11 |
| GPT-4o_015_chat_b000_t00_e14-1d03d2d8 | diagnosed | 561 | 0 | 1 | 60 | 15 |
| Llama3.3-70B-Turbo_014_webshop_task_014 | diagnosed | 992 | 0 | 1 | 48 | 17 |
| Llama3.3-70B-Turbo_017_webshop_task_017 | diagnosed | 921 | 0 | 1 | 102 | 21 |
| Qwen3-8B_010_chat_b000_t00_e10-69d80a84 | diagnosed | 833 | 0 | 1 | 31 | 11 |

Rule candidates and accepted protocol results are not accuracy measurements.
Replay calls are recorded separately from live model calls. See each trajectory's result, usage, and tool event log.
