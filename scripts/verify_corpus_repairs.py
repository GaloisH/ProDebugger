"""Compare fixed corpus records with the original source-audit counterexamples.

This cross-check uses the old examples, not the new detector's hit count. Stable
source identity and exact propositions matter; regenerated Fact IDs do not.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.record_bridge import read_json, write_json


def compare(before, after):
    old_inventory = read_json(before / 'inventory.json')
    new_inventory = read_json(after / 'inventory.json')
    old_rows = {r['trajectory_id']: r for r in old_inventory['trajectories']}
    new_rows = {r['trajectory_id']: r for r in new_inventory['trajectories']}
    assert set(old_rows) == set(new_rows), 'corpus coverage changed'
    assert new_inventory['summary']['errors'] == 0
    records = {}
    for tid, row in old_rows.items():
        if row['status'] != 'compiled':
            assert new_rows[tid]['status'] == row['status']
            continue
        old_source = read_json(before / tid / 'input.json')
        new_source = read_json(after / tid / 'input.json')
        assert all(old_source[k] == new_source[k] for k in ('trajectory_id', 'task_type', 'task'))
        # Module segmentation may be one of the repairs. Require identical raw
        # input/agent messages, while allowing their parsed parts to improve.
        def raw_steps(source):
            return [{k: s[k] for k in ('t', 'env_text', 'agent_text', 'admissible')} for s in source['steps']]
        assert raw_steps(old_source) == raw_steps(new_source), ('raw source changed', tid)
        record = read_json(after / tid / 'record.json')
        assert all(record['invariants'].values()), tid
        records[tid] = record

    def matches(tid, old):
        record = records[tid]
        rows = [f for f in record['facts'] if all(f[k] == old[k] for k in ('t', 'slot', 'rel', 'args'))]
        if old['slot'] == 'mem':
            # One memory may recall the same location at multiple times. Match
            # the audited source assertion, not every claim about that entity.
            span = ' '.join(old['span'].lower().split())
            rows = [f for f in rows if span in ' '.join(f['span'].lower().split())]
        return [{'fact': f, 'verdict': record['native_verdicts'][str(f['fid'])],
                 'scope': record.get('claim_scopes', {}).get(str(f['fid']))} for f in rows]

    counts, comparisons, failures = {}, [], []
    for case in read_json(before / 'source_counterexamples.json')['findings']:
        tid, category = case['trajectory_id'], case['category']
        rows = matches(tid, case['fact'])
        if category == 'substring_invented_selection':
            status = 'removed_false_fact' if not rows else 'failed'
        else:
            outcomes = {row['verdict']['value'] for row in rows}
            status = ('failed' if 'viol' in outcomes else 'supported' if outcomes == {'sat'}
                      else 'unknown' if rows else 'not_asserted_as_state')
        counts.setdefault(category, Counter())[status] += 1
        item = {'trajectory_id': tid, 'step': case['step'], 'category': category,
                'old_fid': case['fid'], 'old_verdict': case['native_verdict'],
                'status': status, 'new_matches': rows}
        comparisons.append(item)
        if status == 'failed':
            failures.append(item)

    manual = []
    for case in read_json(before / 'manual_review.json')['cases']:
        tid = case['trajectory_id']
        rows = matches(tid, case['parsed_fact'])
        outcomes = {row['verdict']['value'] for row in rows}
        status = ('failed' if 'viol' in outcomes else 'supported' if outcomes == {'sat'}
                  else 'unknown' if rows else 'removed_false_fact')
        item = {'id': case['id'], 'trajectory_id': tid, 'step': case['step'],
                'category': case['category'], 'original_quote': case['source_quote'],
                'review': case['review'], 'status': status, 'new_matches': rows}
        manual.append(item)
        if status == 'failed':
            failures.append(item)
    summary = {'same_source_trajectories': len(records),
               'steps': new_inventory['summary']['supported_steps'],
               'counterexamples': {k: dict(v) for k, v in counts.items()},
               'manual_examples': dict(Counter(x['status'] for x in manual)),
               'failed_repairs': len(failures),
               'parse_units_before': old_inventory['summary']['final_parse_status'],
               'parse_units_after': new_inventory['summary']['final_parse_status'],
               'native_verdicts_before': old_inventory['summary']['native_verdicts'],
               'native_verdicts_after': new_inventory['summary']['native_verdicts'],
               'model_calls': 0, 'labels_read': False}
    write_json(after / 'repair_verification.json', {'summary': summary, 'comparisons': comparisons,
                                                  'manual_examples': manual, 'failures': failures})
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if failures:
        raise AssertionError(f'{len(failures)} old counterexamples still produce the disputed verdict/fact')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, default=Path('artifacts/analysis/corpus-parsing-audit-20261013'))
    parser.add_argument('--after', type=Path, default=Path('artifacts/analysis/corpus-parsing-fixed-20261013'))
    args = parser.parse_args()
    compare(args.before, args.after)
