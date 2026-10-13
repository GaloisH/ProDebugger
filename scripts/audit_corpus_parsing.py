"""Recompile every supported corpus trajectory and inventory source/parse risks.

Offline only. Read no benchmark answers, make no model calls. Existing semantic
parse units may be reused only for an identical source and after revalidation.
Flags are review leads, not a measured false-positive rate or agent diagnoses.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pyarrow.parquet as pq
from prodebugger.record_bridge import (
    PROFILES, build_bundle, compiler, digest, plain, read_json, source_versions, write_json,
)
from prodebugger.parse_audit import prepare, _validate_response
from data_io import unpack
from criterion import kappa
from intention_validation import validate_intention


def cache_index(root, output):
    indexed = defaultdict(list)
    skipped = []
    for path in sorted(root.rglob('audited_parse.json')):
        if output.resolve() in path.resolve().parents:
            continue
        source_path = path.with_name('input.json')
        if not source_path.is_file():
            skipped.append(str(path)); continue
        indexed[digest(read_json(source_path))].append((path, read_json(path)))
    return indexed, skipped


def reuse(source, current, candidates):
    """Current complete templates take precedence over all old cache entries."""
    reused, rejected = [], []
    profile = PROFILES[source['task_type']]
    prefix = []
    for key, unit in current['units'].items():
        text = source['task'] if unit['kind'] == 'task' else source['steps'][unit['step'] - 1]['env_text']
        options = []
        if unit['status'] == 'unresolved':
            for path, saved in candidates:
                cached = saved['units'].get(key)
                if not cached or cached['status'] == 'template' or not (cached.get('facts') or cached.get('goals')):
                    continue
                try:
                    answer = {k: cached[k] for k in ('facts', 'goals', 'unresolved')}
                    facts, goals, gaps = _validate_response(answer, unit['kind'], text, profile, prefix, source['task'])
                    options.append((len(gaps), -path.stat().st_mtime, str(path), facts, goals, gaps))
                except (ValueError, KeyError, TypeError, IndexError) as exc:
                    rejected.append({'unit': key, 'path': str(path), 'reason': str(exc)})
        if options:
            _, _, path, facts, goals, gaps = sorted(options, key=lambda o: o[:3])[0]
            unit.update(facts=plain(facts), goals=plain(goals), unresolved=gaps,
                        status='unresolved' if gaps else 'backoff', reused_from=path)
            reused.append({'unit': key, 'path': path, 'status': unit['status']})
        if unit['kind'] == 'observation':
            step = source['steps'][unit['step'] - 1]
            prefix += [text, step['parts'].get('action') or '']
    return reused, rejected


def flags_for(bundle, verdicts):
    record, source = bundle.record, bundle.source
    flags = []
    def add(category, f, **extra):
        flags.append({'category': category, 'step': f.t, 'fid': f.fid,
                      'relation': f.rel, 'span': f.span, 'verdict': verdicts[str(f.fid)], **plain(extra)})
    for f in record.F:
        if f.slot == 'obs' and f.rel == 'has' and any(str(a) == 'attribute:heat' for a in f.args):
            add('heat_hot_ontology_mismatch', f)
        if f.slot == 'obs' and f.rel == 'visible_empty' and f.value is True:
            add('empty_scope_review', f)
        if f.slot == 'mem' and f.rel in {'at', 'in', 'holding', 'chosen'}:
            raw = ' '.join((source['steps'][f.t - 1]['parts'].get('memory') or '').split())
            matches = list(re.finditer(re.escape(f.span), raw, re.I)) if f.span else []
            contexts = [raw[max(0, m.start()-110):m.end()+140] for m in matches]
            if f.rel == 'chosen':
                add('memory_option_as_selection_review', f, contexts=contexts)
                if any((m.start() and raw[m.start()-1].isalnum()) or
                       (m.end() < len(raw) and raw[m.end()].isalnum()) for m in matches):
                    add('memory_value_substring_review', f, contexts=contexts)
            if any(re.search(r'\b(?:not|never|cannot|could|would|should|will|attempt|tried|trying|try|failed|need|want|plan|look|looking|examine|previous|earlier|step)\b', c, re.I) for c in contexts):
                add('memory_scope_modality_history_review', f, contexts=contexts)
            if verdicts[str(f.fid)]['value'] == 'viol':
                earlier = [g for g in record.F if g.t < f.t and g.slot == 'obs'
                           and g.rel == f.rel and g.args == f.args and g.value is True]
                if earlier:
                    add('memory_old_supported_state_vs_current_review', f,
                        earlier_support=[plain(g) for g in earlier[-3:]], contexts=contexts)
        if f.slot == 'plan' and verdicts[str(f.fid)]['value'] == 'viol':
            cites = verdicts[str(f.fid)]['cites']
            refusal = [record.fact(fid) for fid in cites if record.fact(fid).rel == 'admissibility']
            if refusal:
                add('plan_retry_refusal_review', f, refusal=refusal)
        if f.slot == 'act' and verdicts[str(f.fid)]['value'] == 'viol':
            add('plan_action_alignment_review', f,
                plan=source['steps'][f.t-1]['parts'].get('plan'),
                intention=record.intentions.get(str(f.purpose)))
    return flags


def scan(data_dir, output, cache_root):
    output.mkdir(parents=True, exist_ok=True)
    inputs = []
    for path in sorted(data_dir.glob('*.parquet')):
        inputs.extend(pq.read_table(path, columns=['trajectory_id', 'task_type', 'full_trajectory']).to_pylist())
    indexed, skipped = cache_index(cache_root, output)
    trajectories, flags, errors, rejected_caches = [], [], [], []
    types = Counter(row['task_type'] for row in inputs)
    templates, final_status, native, abstractions = Counter(), Counter(), Counter(), Counter()
    for n, row in enumerate(inputs, 1):
        tid = row['trajectory_id']
        if row['task_type'] not in PROFILES:
            messages = json.loads(row['full_trajectory'])['messages']
            trajectories.append({'trajectory_id': tid, 'task_type': row['task_type'],
                                 'status': 'unsupported_adapter', 'raw_messages': len(messages)})
            continue
        try:
            _, task, env, agent, adm = unpack(row)
            source = {'trajectory_id': tid, 'task_type': row['task_type'], 'task': task,
                      'steps': plain(compiler.segment(env, agent, adm))}
            audit = prepare(source, online=False)
            before = Counter(u['status'] for u in audit['units'].values())
            for u in audit['units'].values():
                templates[f"{row['task_type']}/{u['kind']}/{u['status']}"] += 1
            reused, rejected = reuse(source, audit, indexed.get(digest(source), []))
            rejected_caches.extend({'trajectory_id': tid, **r} for r in rejected)
            bundle = build_bundle(source, audited=audit)
            verdicts = {str(f.fid): plain(kappa(bundle.record, f)) for f in bundle.record.F}
            findings = flags_for(bundle, verdicts)
            flags.extend({'trajectory_id': tid, 'task_type': row['task_type'], **f} for f in findings)
            status_counts = Counter(u['status'] for u in audit['units'].values())
            final_status.update(status_counts)
            for f in bundle.record.F:
                native[f"{row['task_type']}/{f.slot}/{verdicts[str(f.fid)]['value']}"] += 1
            abstractions.update(f"{e['rule'] if 'rule' in e else e.get('rule_id')}/{e['state']}" for e in bundle.evaluations)
            folder = output / tid
            write_json(folder / 'input.json', source)
            write_json(folder / 'audited_parse.json', audit)
            write_json(folder / 'record.json', {
                'facts': bundle.record.F, 'goals': bundle.record.goals, 'intentions': bundle.record.intentions,
                'claim_scopes': getattr(bundle.record, 'claim_scopes', {}),
                'native_verdicts': verdicts, 'evaluations': bundle.evaluations,
                'validation': {str(s['t']): validate_intention(bundle.record, s['t']) for s in source['steps']},
                'invariants': compiler.invariants(bundle.record, [compiler.Step(**s) for s in source['steps']]),
            })
            trajectories.append({'trajectory_id': tid, 'task_type': row['task_type'], 'status': 'compiled',
                                 'steps': len(source['steps']), 'facts': len(bundle.record.F),
                                 'before_cache': dict(before), 'parse_status': dict(status_counts),
                                 'reused_cache_units': reused, 'flags': dict(Counter(f['category'] for f in findings)),
                                 'source_digest': digest(source)})
        except Exception as exc:
            import traceback
            errors.append({'trajectory_id': tid, 'error': str(exc), 'traceback': traceback.format_exc()})
            trajectories.append({'trajectory_id': tid, 'task_type': row['task_type'], 'status': 'error'})
        if n % 10 == 0 or n == len(inputs):
            print(json.dumps({'scanned_rows': n, 'total': len(inputs), 'errors': len(errors)}, ensure_ascii=False), flush=True)
    summary = {'database_rows': len(inputs), 'task_types': dict(types),
               'compiled_trajectories': sum(t['status'] == 'compiled' for t in trajectories),
               'supported_steps': sum(t.get('steps', 0) for t in trajectories),
               'unsupported_trajectories': sum(t['status'] == 'unsupported_adapter' for t in trajectories),
               'template_status': dict(templates), 'final_parse_status': dict(final_status),
               'flags': dict(Counter(f['category'] for f in flags)),
               'native_verdicts': dict(native), 'abstract_evaluations': dict(abstractions),
               'errors': len(errors), 'model_calls': 0, 'labels_read': False,
               'reused_units': sum(len(t.get('reused_cache_units', [])) for t in trajectories)}
    write_json(output / 'inventory.json', {'summary': summary, 'trajectories': trajectories,
                                         'errors': errors, 'cache_rejections': rejected_caches,
                                         'cache_missing_source': skipped, 'source_versions': source_versions()})
    write_json(output / 'review_flags.json', flags)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return summary


def summarize(output):
    """Narrow reproducible counterexamples, kept separate from broad review flags."""
    inventory = read_json(output / 'inventory.json')
    findings = []
    module_gaps = []
    for trajectory in inventory['trajectories']:
        if trajectory['status'] != 'compiled':
            continue
        tid = trajectory['trajectory_id']
        source = read_json(output / tid / 'input.json')
        saved = read_json(output / tid / 'record.json')
        facts, verdicts = saved['facts'], saved['native_verdicts']
        by_id = {f['fid']: f for f in facts}
        def add(category, fact, **proof):
            findings.append({'category': category, 'trajectory_id': tid,
                             'step': fact['t'], 'fid': fact['fid'], 'fact': fact,
                             'native_verdict': verdicts[str(fact['fid'])], **proof})
        for f in facts:
            verdict = verdicts[str(f['fid'])]
            if f['slot'] == 'mem' and f['rel'] == 'at' and verdict['value'] == 'viol':
                raw = ' '.join((source['steps'][f['t']-1]['parts'].get('memory') or '').split())
                occurrences = list(re.finditer(re.escape(f['span']), raw, re.I))
                proof = []
                for match in occurrences:
                    anchors = list(re.finditer(r'\b(?:(?:at |in )?step|observation)\s+(\d+)\s*[:,]', raw[:match.start()], re.I))
                    if not anchors:
                        break
                    anchor = anchors[-1]
                    cited_step = int(anchor.group(1))
                    middle = raw[anchor.end():match.start()]
                    # Every occurrence must be explicitly historical, in the
                    # same clause, and supported at exactly its cited step.
                    if (not 1 <= cited_step < f['t'] or len(middle) > 220
                            or re.search(r'[.!?]|\b(?:currently|now)\b', middle, re.I)):
                        break
                    supports = [g for g in facts if g['t'] == cited_step and g['slot'] == 'obs'
                                and g['rel'] == f['rel'] and g['args'] == f['args'] and g['value'] is True]
                    if not supports:
                        break
                    proof.append({'cited_step': cited_step, 'support': supports[0],
                                  'memory_excerpt': raw[anchor.start():match.end()+80],
                                  'original_observation': source['steps'][cited_step-1]['env_text']})
                else:
                    if proof:
                        add('historical_state_compared_as_current', f, proof=proof,
                            interpretation='The historical location claim is supported. Comparing it to the current location cannot establish that this claim is wrong; other claims in the same memory were not certified.')
            if f['slot'] == 'plan' and verdict['value'] == 'viol':
                refusal = [by_id[i] for i in verdict['cites'] if by_id[i]['rel'] == 'admissibility']
                if not refusal:
                    continue
                current = saved['intentions']['int:i' + str(f['t'])]
                earlier = saved['intentions']['int:i' + str(refusal[0]['t'])]
                if current['verb'] is None and current['objects'] is None:
                    assert earlier['verb'] is None and earlier['objects'] is None
                    a = next(g for g in facts if g['t'] == f['t'] and g['slot'] == 'act')
                    b = next(g for g in facts if g['t'] == refusal[0]['t'] and g['slot'] == 'act')
                    different = (a['rel'], a['args'], a['value']) != (b['rel'], b['args'], b['value'])
                    add('unbound_plans_compared_as_identical', f,
                        compared_intentions=[current, earlier], refused_check=refusal[0],
                        current_action=a, earlier_action=b, actual_actions_differ=different,
                        interpretation='None==None is missing extraction, not proof of repeated intent. This VIOL lacks its required premise, even if an independent fault exists in the step.')
            if f['slot'] == 'mem' and f['rel'] == 'chosen' and f['span']:
                raw = ' '.join((source['steps'][f['t']-1]['parts'].get('memory') or '').split())
                occurrences = list(re.finditer(re.escape(f['span']), raw, re.I))
                # Only count when ALL occurrences are strictly parts of words.
                if occurrences and all((m.start() > 0 and raw[m.start()-1].isalnum()) or
                                       (m.end() < len(raw) and raw[m.end()].isalnum()) for m in occurrences):
                    add('substring_invented_selection', f,
                        source_memory=source['steps'][f['t']-1]['parts']['memory'],
                        interpretation='A piece of required/desired was interpreted as the color red. The emitted selection claim has no corresponding color assertion in the memory; its current native verdict is UNK, not VIOL.')
        for step in source['steps']:
            for module, value in step['parts'].items():
                if value and re.search(r'</?(?:memory|reflection|plan|action)>', value):
                    module_gaps.append({'trajectory_id': tid, 'step': step['t'], 'module': module,
                                        'category': 'module_boundary_review', 'source_text': value})
    summary = {}
    for category in sorted({f['category'] for f in findings}):
        selected = [f for f in findings if f['category'] == category]
        summary[category] = {'facts': len(selected),
                             'steps': len({(f['trajectory_id'], f['step']) for f in selected}),
                             'trajectories': len({f['trajectory_id'] for f in selected})}
        if category == 'unbound_plans_compared_as_identical':
            summary[category]['actual_actions_differ'] = sum(f['actual_actions_differ'] for f in selected)
    broad = read_json(output / 'review_flags.json')
    risks = {}
    for category in sorted({f['category'] for f in broad}):
        selected = [f for f in broad if f['category'] == category]
        risks[category] = {'facts': len(selected),
                           'steps': len({(f['trajectory_id'], f['step']) for f in selected}),
                           'trajectories': len({f['trajectory_id'] for f in selected})}
    invariant_failures = []
    for trajectory in inventory['trajectories']:
        if trajectory['status'] == 'compiled':
            values = read_json(output / trajectory['trajectory_id'] / 'record.json')['invariants']
            if not all(values.values()):
                invariant_failures.append({'trajectory_id': trajectory['trajectory_id'], 'invariants': values})
    counts = inventory['summary']
    result = {'method': 'Narrow source-grounded counterexamples and invalid rule premises. '
                        'Counts are facts/steps/trajectories, not independent final LLM diagnoses or an agent error rate. '
                        'Categories overlap. Broad flags require review and cannot be summed as false positives.',
              'summary': summary, 'broad_review_counts': risks, 'findings': findings,
              'module_boundary_review': module_gaps, 'invariant_failures': invariant_failures,
              'limits': [f"No new semantic model calls; {counts['final_parse_status'].get('unresolved', 0)} task/observation units remain unresolved; {counts['reused_units']} cached units were reused after validation.",
                         f"{counts['unsupported_trajectories']} rows have no supported parser and are inventoried, not semantically assessed.",
                         'Observation/task admission is exhaustive over the current complete templates. Memory/plan parsing remains heuristic.',
                         'Historical proof checks only the quoted location claim, not the entire memory or final task outcome.',
                         'Counts concern source/parse rule premises; they do not measure final agent diagnoses.',
                         'A passed structural/source-span invariant does not establish correct linguistic interpretation.']}
    write_json(output / 'source_counterexamples.json', result)
    return {k: v for k, v in result.items() if k not in {'findings', 'module_boundary_review'}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=Path('core/data'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/analysis/corpus-parsing-audit-20261013'))
    parser.add_argument('--cache-root', type=Path, default=Path('artifacts'))
    parser.add_argument('--summarize-only', action='store_true')
    args = parser.parse_args()
    if not args.summarize_only:
        scan(args.data_dir, args.output, args.cache_root)
    print(json.dumps(summarize(args.output), ensure_ascii=False, indent=2))
