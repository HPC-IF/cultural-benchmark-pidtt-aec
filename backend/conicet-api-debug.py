import json, urllib.request, sys, re

API = "http://192.168.1.79:8900"
LLM_URL = "http://192.168.1.68:8005/v1/chat/completions"
LLM_MODEL = "citecca-agent"
MAX_DESC_CHARS = 1200

ids = sys.argv[1:]
print(f"articles: {len(ids)}")

def build_qa_prompt(articles):
    parts = []
    for i, a in enumerate(articles, 1):
        desc = (a.get("desc") or "").strip()[:MAX_DESC_CHARS]
        parts.append(f"[Articulo {i}] ID {a['id']} | {a['title']} | Autores: {a['creators'] or 'n/d'} | {a['date'] or 's/f'}\nResumen: {desc or '(sin resumen)'}")
    context = "\n\n".join(parts)
    return ("Eres un asistente que genera preguntas y respuestas academicas. Genera EXACTAMENTE 5 pares en español. "
            "Solo usa la informacion de los resumos. No inventes. Responde SOLO con JSON valido sin markdown: "
            '{"qa": [{"n": 1, "question": "...", "answer": "...", "article_ids": ["123"]}, ...]}\n\n' + context)

articles = []
for i in ids:
    with urllib.request.urlopen(f"{API}/detail?id={i}", timeout=20) as r:
        d = json.loads(r.read())
    articles.append({"id": d["id"], "title": d["title"], "creators": d["creators"],
                     "date": d["date"], "desc": d.get("description", "")})

prompt = build_qa_prompt(articles)
print(f"prompt chars: {len(prompt)}")

payload = {"model": LLM_MODEL,
    "messages": [{"role":"system","content":"Eres riguroso. No inventas."},
                 {"role":"user","content":prompt}],
    "temperature": 0.2, "max_tokens": 2400}
req = urllib.request.Request(LLM_URL, data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type":"application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=280) as r:
    llm = json.loads(r.read())
content = llm["choices"][0]["message"]["content"]
print(f"\n=== RAW ({len(content)} chars) ===")
print(content[:3000])
print("\n=== usage ===", llm.get("usage"))
m = re.search(r"\{.*\}", content, re.DOTALL)
print("\nregex matched:", bool(m))
if m:
    try:
        json.loads(m.group(0)); print("JSON OK")
    except Exception as e:
        print("JSON FAIL:", e)
        print("...tail of matched:", m.group(0)[-300:])
