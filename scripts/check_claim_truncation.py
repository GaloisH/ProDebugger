"""Reparse archived visible evidence only; no SQL, diagnosis, or labels.

This is a targeted online parser check, not a new trajectory experiment.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.claim_parser import ClaimParser, MENTAL, fragment, source_text
from prodebugger.record_bridge import read_json, write_json
from prodebugger.llm_client import json_lines
from scripts.analyze_trace_candidate_exclusion import assessment_requests


def check(run, output, tid):
    source = read_json(run / tid / 'input.json')
    config = read_json(run / 'manifest.json')['config']
    parser = ClaimParser(source, output / tid, config=config, online=True)
    requests = assessment_requests(run / tid)
    reports = []
    for q in json_lines(run / tid / 'trace_queries.jsonl'):
        p = requests[q['candidate_id']]['payload']
        fragments = [fragment(source, p['source']['step'], m) for m in sorted(MENTAL)
                     if source_text(source, p['source']['step'], m)]
        for e in p.get('manager_assignment', {}).get('evidence', []):
            if e['module'] in MENTAL:
                original = source_text(source, e['step'], e['module'])
                if original.count(e['quote']) == 1:
                    lo = original.index(e['quote'])
                    fragments.append(fragment(source, e['step'], e['module'], lo, lo + len(e['quote'])))
        fragments += q.get('claim_fragments', [])
        start = time.monotonic()
        result = parser.enrich(fragments)
        # Production evidence visibility must stay exactly the same.
        identity = lambda c: (c['source_id'], c['quote'], c['fragment_partial'])
        assert [identity(c) for c in result['cards']] == [identity(c) for c in q['agent_statements']['cards']]
        restored = ClaimParser(source, output / tid, config=config, online=True)
        assert restored.enrich(fragments) == result  # No API client needed on cache hit.
        write_json(output / tid / (q['candidate_id'] + '.json'), result)
        report = {'trajectory_id': tid, 'candidate_id': q['candidate_id'],
                  'wall_seconds': round(time.monotonic() - start, 2),
                  'before': q['agent_statements']['backoff'], 'after': result['backoff'],
                  'source_cards_identical': True, 'restart_result_identical': True,
                  'coverage': dict(Counter(c['coverage'] for c in result['cards'])),
                  'parse_errors': dict(Counter(c['backoff_error'] for c in result['cards'] if c.get('backoff_error'))),
                  'usage': parser.client.snapshot() if parser.client else {}}
        reports.append(report)
        print(json.dumps({k: report[k] for k in ('trajectory_id', 'wall_seconds', 'after', 'coverage')}, ensure_ascii=False), flush=True)
    return reports


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('run', type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--trajectory', required=True, action='append')
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    with ThreadPoolExecutor(max_workers=min(2, len(args.trajectory))) as pool:
        futures = [pool.submit(check, args.run, args.output, tid) for tid in args.trajectory]
        results = [row for future in futures for row in future.result()]
    write_json(args.output / 'summary.json', {'method': __doc__, 'batches': results})
