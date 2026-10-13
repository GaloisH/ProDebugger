"""Small read-only progress snapshot; no credentials or model payloads printed."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def lines(path):
    if not path.exists():
        return []
    result = []
    for line in path.read_text().splitlines():
        try:
            result.append(json.loads(line))
        except json.JSONDecodeError:
            break
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    args = parser.parse_args()
    run = args.run
    manifest = read(run / 'manifest.json')
    phases, allocations, statuses = Counter(), {}, {}
    queries, traces = [], []
    for tid in manifest['trajectory_ids']:
        folder = run / tid
        requests = sorted((folder / 'requests').glob('*.json'))
        result = read(folder / 'result.json') if (folder / 'result.json').exists() else None
        phase = 'DONE:' + result['status'] if result else read(requests[-1])['phase'] if requests else 'PARSE'
        phases[phase] += 1
        if result:
            statuses[tid] = result['status']
        if (folder / 'manager_plan.json').exists():
            plan = read(folder / 'manager_plan.json')
            if plan:
                allocations[tid] = len(plan['assignments'])
        queries.extend(lines(folder / 'trace_queries.jsonl'))
        traces.extend(lines(folder / 'window_trace.jsonl'))
    print(json.dumps({'elapsed_s': round((datetime.now(timezone.utc) - datetime.fromisoformat(manifest['created_at'])).total_seconds()),
        'phases': dict(phases), 'allocations': allocations, 'completed': statuses,
        'queries': len(queries), 'query_errors': [(q['candidate_id'], q['error']) for q in queries if q.get('error')],
        'truncated': sum(bool(q.get('truncated')) for q in queries), 'partial': sum(bool(q.get('partial')) for q in queries),
        'trace_results': len(traces), 'earlier_candidates': sum(bool(t['candidates']) and t['candidates'][0]['step'] < t['window']['issue_step'] for t in traces)}, ensure_ascii=False))
