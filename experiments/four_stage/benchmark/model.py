"""Model API calls, response recovery, and shared cost accounting."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from openai import OpenAI

from .common import INPUT_USD_PER_M, OUTPUT_USD_PER_M, compact, decode_model_json


PROVIDERS = {
    "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com", "deepseek-flash"),
    "groq": ("GROQ_API_KEY", "https://api.groq.com/openai/v1", None),
}
PRICES_USD_PER_M = {
    ("deepseek", "deepseek-flash"): (INPUT_USD_PER_M, OUTPUT_USD_PER_M),
    ("groq", "qwen/qwen3.8-27b"): (0.80, 4.00),
}


def configure_model(args: argparse.Namespace) -> str:
    """Resolve provider, credentials, model, and budget rates without logging the key."""
    values = dotenv_values(args.env_file)
    provider = args.provider
    if provider == "auto":
        available = [name for name, (key_name, _, _) in PROVIDERS.items()
                     if values.get(key_name) or os.getenv(key_name)]
        if len(available) != 1:
            raise RuntimeError("Set exactly one provider API key, or pass --provider")
        provider = available[0]
    key_name, default_url, default_model = PROVIDERS[provider]
    key = values.get(key_name) or os.getenv(key_name)
    if not key:
        raise RuntimeError(f"{key_name} is absent")
    env_model = values.get("MODEL")
    if env_model and (provider, env_model) not in PRICES_USD_PER_M:
        # A shared .env may hold credentials for several providers. Do not use
        # another provider's model when --provider selects this one explicitly.
        if any((other, env_model) in PRICES_USD_PER_M for other in PROVIDERS
               if other != provider):
            env_model = None
    model = args.model or values.get(f"{provider.upper()}_MODEL") or env_model or default_model
    if not model:
        raise ValueError("No model configured; set MODEL in .env or pass --model")
    prices = PRICES_USD_PER_M.get((provider, model))
    input_price = args.input_usd_per_m
    output_price = args.output_usd_per_m
    if prices is None and (input_price is None or output_price is None):
        raise ValueError("Unknown model price; pass --input-usd-per-m and --output-usd-per-m")
    args.provider = provider
    args.model = model
    args.base_url = args.base_url or default_url
    args.input_usd_per_m = prices[0] if input_price is None else input_price
    args.output_usd_per_m = prices[1] if output_price is None else output_price
    if args.input_usd_per_m < 0 or args.output_usd_per_m < 0:
        raise ValueError("Token prices must be non-negative")
    return key


class BudgetExceeded(RuntimeError):
    pass


class Model:
    def __init__(self, args: argparse.Namespace, run_dir: Path):
        key = configure_model(args)
        self.client = OpenAI(api_key=key, base_url=args.base_url,
                             timeout=180, max_retries=2)
        self.provider = args.provider
        self.name = args.model
        self.effort = args.reasoning_effort
        self.input_usd_per_m = args.input_usd_per_m
        self.output_usd_per_m = args.output_usd_per_m
        self.budget = args.budget_usd
        self.usage_path = run_dir / "api_usage.jsonl"
        self.partials = run_dir / "partials"
        self.spent = sum(json.loads(line)["conservative_usd"]
                         for line in self.usage_path.read_text(encoding="utf-8").splitlines()
                         if line) if self.usage_path.exists() else 0.0

    def ask(self, arm: str, tid: str, phase: str, messages: list[dict],
            *, max_tokens: int, tools: list[dict] | None = None,
            json_mode: bool = False) -> Any:
        payload = {"model": self.name, "messages": messages,
                   "reasoning_effort": self.effort, "max_tokens": max_tokens}
        if self.provider == "groq":
            payload["extra_body"] = {"reasoning_format": "hidden"}
        if tools is not None:
            payload["tools"] = tools
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        # The estimate treats every input byte as a token and every input token
        # as a cache miss. Reserve output before sending the request.
        reserved = (len(compact(payload).encode("utf-8")) * self.input_usd_per_m
                    + max_tokens * self.output_usd_per_m) / 1_000_000
        if self.spent + reserved > self.budget:
            raise BudgetExceeded(f"${self.spent:.4f} spent; next conservative "
                                 f"reservation ${reserved:.4f} exceeds ${self.budget:.2f}")
        response = self.client.chat.completions.create(**payload)
        usage = response.usage
        if usage is None:
            raise RuntimeError("API returned no usage; stopping to preserve the budget")
        charge = (usage.prompt_tokens * self.input_usd_per_m
                  + usage.completion_tokens * self.output_usd_per_m) / 1_000_000
        self.spent += charge
        row = {"time_utc": datetime.now(timezone.utc).isoformat(),
               "arm": arm, "trajectory_id": tid, "phase": phase,
               "provider": self.provider, "model": self.name,
               "reasoning_effort": self.effort,
               "prompt_tokens": usage.prompt_tokens,
               "completion_tokens": usage.completion_tokens,
               "conservative_usd": charge,
               "finish_reason": response.choices[0].finish_reason}
        with self.usage_path.open("a", encoding="utf-8") as stream:
            stream.write(compact(row) + "\n")
        print(f"API {arm} {tid} {phase}: {usage.prompt_tokens}+"
              f"{usage.completion_tokens} tokens; total ${self.spent:.4f}", flush=True)
        return response.choices[0].message

    def ask_json(self, arm: str, tid: str, phase: str, system: str,
                 data: Any, *, max_tokens: int,
                 required_steps: list[int] | None = None) -> dict:
        def valid(value: Any) -> bool:
            if not isinstance(value, dict):
                return False
            if required_steps is None:
                return True
            rows = value.get("steps")
            returned = ([int(row["step"]) for row in rows if isinstance(row, dict)
                         and str(row.get("step", "")).isdecimal()]
                        if isinstance(rows, list) else [])
            return sorted(returned) == sorted(required_steps)

        old_partials = self.partials / arm / tid
        for path in sorted(old_partials.glob(f"{phase}.*.txt"), reverse=True) if old_partials.exists() else []:
            recovered = decode_model_json(path.read_text(encoding="utf-8"))
            if valid(recovered):
                print(f"RECOVERED {arm} {tid} {phase} from {path.name}", flush=True)
                return recovered
        messages = [{"role": "system", "content": system},
                    {"role": "user", "content": compact(data)}]
        for attempt in range(3):
            message = self.ask(arm, tid, f"{phase}_try{attempt}", messages,
                               max_tokens=min(16000, max_tokens + attempt * 4000),
                               json_mode=True)
            content = message.content or ""
            value = decode_model_json(content)
            if value is None:
                path = self.partials / arm / tid / f"{phase}.{attempt}.txt"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
                messages.append({"role": "user", "content":
                                 "The last response was not a complete JSON object. "
                                 "Return the requested object again, with no prose or "
                                 "markdown. The last response ended with: " + content[-1000:]})
                continue
            if valid(value):
                return value
            messages.append({"role": "user", "content":
                             "Return a single JSON object with a steps array "
                             f"containing exactly these steps: {required_steps}." if required_steps
                             else "Return a single JSON object, not an array or scalar."})
        raise RuntimeError(f"{phase} did not return complete JSON after three attempts")
