import json, re, os
base='/home/agent/cultural-benchmark-capability'
arxiv_ids=['2601.15550','2604.03493','2402.09369','2411.00860','2411.10915','2404.05365',
'2608.02996','2608.02949','2406.03368','2406.09948','2410.02677','2309.12053','2503.17485',
'2306.05685','2310.18018','2410.05229']
verified=set(json.load(open(base+'/research/arxiv_verified.json')).keys())
assert verified==set(arxiv_ids), 'id set mismatch'
docs={}
for f in ['SKILL.md','TOOLS.md','EVAL_SUITE.md','RUBRIC.md','EXAMPLE_RUN.md','THREATS.md',
          'IMPLEMENTATION_PLAN.md','RESEARCH_LEDGER.md','README.md']:
    docs[f]=open(os.path.join(base,f)).read()
print('loaded', len(docs), 'docs')
# every arXiv id mentioned anywhere must be in verified set
bad=[]
for f,txt in docs.items():
    for m in re.finditer(r'\d{4}\.\d{4,5}', txt):
        if m.group(0) not in verified: bad.append((f,m.group(0)))
print('unverified arXiv ids found:', bad or 'none')
# no fabricated keywords
import subprocess
r=subprocess.run(['grep','-rnP','correct_answer|invented rater|fabricated result',base,'--include=*.json','--include=*.jsonl','-l'],capture_output=True,text=True)
print('fabrication-keyword scan:', r.stdout.strip() or 'clean')