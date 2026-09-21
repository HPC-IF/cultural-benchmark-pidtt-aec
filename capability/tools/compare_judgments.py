#!/usr/bin/env python3
"""compare_judgments.py — T6 analyze_judge_reliability (executable core).

Input: JSONL of judgments: {"item_id","layer":"community|expert|llm_judge","rater_id","rating","scale":"ord_5|bin","escalated":bool,"community_id"}
Output: JSON report to stdout (agreement metrics, divergence, escalation rate, findings).
No pairwise statistics beyond observed agreement + proportion; small-sample, honest output.
"""
import json, sys
from collections import defaultdict

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
    by_item = defaultdict(dict)
    raters = defaultdict(set)
    for r in rows:
        key = (r.get('layer'), r.get('rater_id'))
        by_item[r['item_id']][key] = r
        raters[key].add(r['item_id'])
    overlap = defaultdict(list)   # (l1,l2) -> list of agreement bools
    for item, js in by_item.items():
        for k1, j1 in js.items():
            for k2, j2 in js.items():
                if k1 < k2:
                    overlap[(k1[0], k2[0])].append(j1['rating'] == j2['rating'])
    out = {"total_judgments": len(rows), "items": len(by_item)}
    out["pairwise_agreement"] = {}
    for (a, b), vals in overlap.items():
        out["pairwise_agreement"][f"{a}_vs_{b}"] = {
            "n_pairs": len(vals),
            "exact_agreement": round(sum(vals) / len(vals), 3) if vals else None,
        }
    esc = [r for r in rows if r.get('escalated')]
    out["escalation_rate"] = round(len(esc) / len(rows), 3) if rows else None
    llm_items = {i: j for i, j in by_item.items() if any(k[0] == 'llm_judge' for k in j)}
    out["llm_judge_items"] = len(llm_items)
    # judge divergence: item where llm_judge rating differs from every human rating
    div = 0
    for item, js in by_item.items():
        lj = [j['rating'] for k, j in js.items() if k[0] == 'llm_judge']
        hu = [j['rating'] for k, j in js.items() if k[0] in ('community', 'expert')]
        if lj and hu and all(l != h for l in lj for h in hu):
            div += 1
    out["judge_full_divergence_items"] = div
    print(json.dumps(out, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    main()