# Annotated benchmark traces

## Source and licensing

This subset originates from [AgentErrorBench](https://github.com/ulab-uiuc/AgentDebug), introduced in [Where LLM Agents Fail and How They Can Learn From Failures](https://arxiv.org/abs/2509.25370). The upstream project provides a repository-level MIT `LICENSE` and links the dataset; the released [Hugging Face dataset card](https://huggingface.co/datasets/davide221/agenterrorbench) describes the splits and fields but does not declare a separate dataset license in its card metadata. A code license does not by itself establish the rights to redistribute benchmark annotations, third-party environment text, or trajectory contents. This repository has not independently verified data redistribution permission; confirm the applicable dataset and underlying content terms with the upstream maintainers before reusing or redistributing these rows.

Suggested citation for the benchmark paper:

```bibtex
@misc{zhu2025where,
  title         = {Where LLM Agents Fail and How They Can Learn From Failures},
  author        = {Zhu, Kunlun and Liu, Zijia and Li, Bingxuan and Tian, Muxin and Yang, Yingxuan and Zhang, Jiaxun and Han, Pengrui and Xie, Qipeng and Cui, Fuyang and Zhang, Weijia and Ma, Xiaoteng and Yu, Xiaodong and Ramesh, Gowtham and Wu, Jialian and Liu, Zicheng and Lu, Pan and Zou, James and You, Jiaxuan},
  year          = {2025},
  eprint        = {2509.25370},
  archivePrefix = {arXiv}
}
```

The subset is retained in this branch to support the current experiment. This note records the permission status as unresolved; it is not a grant of rights or legal advice.

`train.parquet` contains **105 trajectories: 66 ALFWorld and 39 WebShop**.
It is selected from the supplied 139-row `train.parquet` using
`task_type in {"alfworld", "webshop"}`. The remaining 34 GAIA trajectories are
excluded. All selected row values and their order are preserved; the output is
recompressed with Zstandard and corpus-wide schema metadata is omitted.
The file name retains the source's split name and does not establish a new split.

Each trajectory ID is unique. All 13 fields are present and non-null for this
subset. The trajectories were produced by GPT-4o (48), Qwen3-8B (35), and
Llama3.3-70B-Turbo (22), as recorded in `llm_model`.

## Files

| File | Contents |
| --- | --- |
| [train.parquet](train.parquet?raw=true) | All 105 trajectories and annotations |
| [examples/alfworld.json](examples/alfworld.json) | First included ALFWorld row, with JSON string fields decoded |
| [examples/webshop.json](examples/webshop.json) | First included WebShop row, with JSON string fields decoded |
| [manifest.json](manifest.json) | Selection, counts, column types and source/output SHA-256 hashes |

The examples are complete rows already contained in the Parquet file, not
additional trajectories. They expose `full_trajectory` as an object and
`step_annotations` as an array for easier reading; the Parquet columns retain
their original JSON string representation.

## Schema

| Column | Type | Contents |
| --- | --- | --- |
| `trajectory_id` | string | Unique trajectory identifier |
| `task_type` | string | `alfworld` or `webshop` |
| `llm_model` | string | Source agent model label |
| `critical_failure_step` | int64 | Original reference failure step |
| `critical_failure_module` | string | Original reference failure module label |
| `failure_types` | list of strings | Original failure type labels |
| `failure_reasonings` | list of strings | Original annotation explanations |
| `failure_modules` | list of strings | Original failure module labels |
| `num_steps` | int64 | Source-provided step count, retained as recorded |
| `trajectory_length` | int64 | Source-provided length value, retained as recorded |
| `full_trajectory` | string | JSON object containing `messages` and `metadata` |
| `step_annotations` | string | JSON array of per-step annotations |

The source's count/length fields are not recomputed; in particular,
`trajectory_length` should not be treated as `len(full_trajectory)`.
Module labels are also retained verbatim, including `plan` and `planning`.

## Reading a domain

Install the repository requirements, then run from the repository root:

```python
import json
import pyarrow.parquet as pq

rows = pq.read_table(
    "core/data/train.parquet",
    filters=[("task_type", "=", "webshop")],
).to_pylist()
assert len(rows) == 39
trajectory = json.loads(rows[0]["full_trajectory"])
annotations = json.loads(rows[0]["step_annotations"])
print(rows[0]["trajectory_id"])
print(trajectory["messages"][0]["content"])
```

These files include reference failure annotations for evaluation. The debugger
reads only `trajectory_id`, `task_type`, and `full_trajectory` from Parquet inputs,
keeping reference annotations outside the diagnostic input.
