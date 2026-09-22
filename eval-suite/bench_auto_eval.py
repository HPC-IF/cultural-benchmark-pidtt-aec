#!/usr/bin/env python3
"""bench_auto_eval.py — runner de auto-eval de la capability cultural-benchmark.

Corre los casos de TEST_CASES.jsonl contra el agente local (citecca-agent :8005),
a ciegas (solo request+context, por la regla dura de EVAL_SUITE.md), y los puntúa
con un LLM-judge contra gold_criteria / partial_credit / critical_errors.

Todo stdlib. Output:
  /mnt/shared/benchmark-eval/latest_report.json  (resumen agregado)
  /mnt/shared/benchmark-eval/runs/<ts>.json      (detalle por caso)

Uso:
  python3 bench_auto_eval.py                 # 65 casos (todo)
  python3 bench_auto_eval.py --tracks A,X    # solo tracks
  python3 bench_auto_eval.py --limit 5       # primeros N casos (smoke)
  python3 bench_auto_eval.py --concurrency 2 # default 2 (respeto al LLM compartido)
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

CAP_DIR = "/mnt/shared/benchmark-capability"
CASES = os.path.join(CAP_DIR, "TEST_CASES.jsonl")
OUT_DIR = "/mnt/shared/benchmark-eval"
RUNS_DIR = os.path.join(OUT_DIR, "runs")
LLM_URL = os.environ.get("LLM_URL", "http://192.168.1.68:8005/v1/chat/completions")
MODEL = "citecca-agent"
LLM_TIMEOUT = 300
MAX_TOKENS_AGENT = 4000
MAX_TOKENS_JUDGE = 1400
CONCURRENCY = 2

AGENT_SYSTEM = (
    "Eres un asistente experto en el DISEÑO DE BENCHMARKS CULTURALES para IA "
    "(protocolo 'culturally grounded benchmark design'). Responde SIEMPRE en español. "
    "Reglas duras que debes cumplir sin excepciones:\n"
    "1. NUNCA inventes evidencia cultural, datos, citas, participantes o resultados. "
    "Cada afirmación debe estar etiquetada: LITERATURE FINDING (con cita) / OBSERVED / "
    "PROPOSAL / ASSUMPTION / PLACEHOLDER.\n"
    "2. Nunca trates la nacionalidad como cultura: si una comunidad solo se define por "
    "país, déjalo explícito y exige ejes de variación interna.\n"
    "3. Un constructo vago (ej. 'conciencia cultural') debe descomponerse en "
    "sub-capacidades medibles con comportamientos observables, o rechazarlo pidiendo "
    "aclaración. No produzcas un puntaje único u opaco.\n"
    "4. La trivia cultural solo es válida para el eje 'knowledge'. Para ejes "
    "adaptation/interaction/safety exige tareas situadas con variación aceptable y "
    "comportamiento inaceptable.\n"
    "5. El desacuerdo entre evaluadores (comunidad/expertos/LLM) es SEÑAL, no ruido: "
    "presérvalo (log de disidencia, clusters, abstinencia registrada). La mayoría nunca "
    "es verdad cultural.\n"
    "6. Si el pedido no tiene evidencia suficiente, dilo y produce un scope-down con "
    "claims retenidos vs. claims descartados. Nunca rellenes con 'lo que se sabe "
    "generalmente'.\n"
    "Sé concreto y estructurado (títulos, listas). No uses markdown excesivo."
)

JUDGE_SYSTEM = (
    "Eres un juez de evaluación de un agente de diseño de benchmarks culturales. "
    "Se te da un caso (criterios de oro, crédito parcial, errores críticos), el pedido "
    "que se hizo al agente y la respuesta completa del agente. Puntúa con rigor, en "
    "español, SOLO con JSON válido en este formato exacto:\n"
    '{"scores": {"<criterio>": {"score": 0-4, "why": "<una línea>"}}, '
    '"critical_errors_triggered": ["<criterio del caso, verbatim>"], '
    '"partial_credit_applied": ["<criterio>"], '
    '"overall": 0-4, "verdict": "pass|partial|fail", "notes": "<máx 2 líneas>"}\n'
    "Reglas: un critical error activado ⇒ verdict 'fail' sin importar scores. "
    "Score 4 = cumple el criterio de oro de forma completa y explícita; 3 = cumple con "
    "lagos menores; 2 = credit partial; 1 = intenta pero falla en el núcleo; 0 = no "
    "aplica o es contraproducente. Sé estricto: la persuasión no puntúa, la disciplina "
    "de proceso sí."
)


def llm_call(messages, max_tokens, temperature=0.2, thinking=False):
    # PITFALL Qwen3.8: con prompts largos el modelo entra en modo thinking y se
    # come TODO el max_tokens de completion dejando message.content VACIO.
    # Para el judge (y respuestas cortas) desactivamos el thinking explicitamente.
    payload = {"model": MODEL, "messages": messages,
               "temperature": temperature, "max_tokens": max_tokens}
    if not thinking:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    req = urllib.request.Request(LLM_URL, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
        out = json.loads(r.read().decode("utf-8"))
    return (out.get("choices") or [{}])[0].get("message", {}).get("content", "")


def run_case(case, idx, total):
    t0 = time.time()
    rec = {"case_id": case["case_id"], "track": case.get("track"),
           "difficulty": case.get("difficulty"), "error": None}
    try:
        user = case.get("request", "") + "\n\nContexto: " + (case.get("context") or "")
        agent_out = llm_call(
            [{"role": "system", "content": AGENT_SYSTEM},
             {"role": "user", "content": user}],
            MAX_TOKENS_AGENT, thinking=True)
        if not agent_out.strip():
            # thinking se comio los tokens: reintentar sin thinking
            agent_out = llm_call(
                [{"role": "system", "content": AGENT_SYSTEM},
                 {"role": "user", "content": user}],
                MAX_TOKENS_AGENT, thinking=False)
        rec["agent_chars"] = len(agent_out)
        rec["agent_excerpt"] = agent_out[:600]
        judge_user = (
            f"## Caso (criterios de evaluación)\n"
            f"ID: {case['case_id']} — track {case.get('track')}\n"
            f"CAPACIDADES ESPERADAS:\n" + "\n".join(f"- {c}" for c in case.get("expected_capabilities", [])) + "\n\n"
            f"GOLD CRITERIA (criterios de oro):\n" + "\n".join(f"- {c}" for c in case.get("gold_criteria", [])) + "\n\n"
            f"CREDITO PARCIAL:\n" + "\n".join(f"- {c}" for c in case.get("partial_credit", [])) + "\n\n"
            f"ERRORES CRITICOS (cualquiera ⇒ fail):\n" + "\n".join(f"- {c}" for c in case.get("critical_errors", [])) + "\n\n"
            f"## Pedido que se le hizo al agente (a ciegas, sin los criterios de arriba)\n{user}\n\n"
            f"## Respuesta completa del agente\n{agent_out}\n\n"
            f"Puntúa ahora solo con el JSON."
        )
        judge_raw = llm_call(
            [{"role": "system", "content": JUDGE_SYSTEM},
             {"role": "user", "content": judge_user}],
            MAX_TOKENS_JUDGE, temperature=0.0, thinking=False)
        m = __import__("re").search(r"\{.*\}", judge_raw, __import__("re").DOTALL)
        rec["judge"] = json.loads(m.group(0) if m else judge_raw)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
        rec["error"] = f"{type(e).__name__}: {e}"
    rec["secs"] = round(time.time() - t0, 1)
    print(f"[{idx}/{total}] {case['case_id']} ({case.get('track')}): "
          f"{rec.get('verdict', rec.get('error', '?'))} {rec.get('secs', 0)}s", flush=True)
    return rec


def verdict_of(rec):
    if rec.get("error"):
        return "error"
    j = rec.get("judge") or {}
    v = j.get("verdict")
    if v in ("pass", "partial", "fail"):
        return v
    return "unjudged"


def main():
    tracks_filter = None
    limit = None
    conc = CONCURRENCY
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--tracks":
            tracks_filter = set(args[i + 1].split(","))
            i += 2
        elif args[i] == "--limit":
            limit = int(args[i + 1])
            i += 2
        elif args[i] == "--concurrency":
            conc = int(args[i + 1])
            i += 2
        else:
            i += 1

    cases = [json.loads(l) for l in open(CASES, encoding="utf-8") if l.strip()]
    if tracks_filter:
        cases = [c for c in cases if c.get("track") in tracks_filter]
    if limit:
        cases = cases[:limit]

    os.makedirs(RUNS_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    print(f"corriendo {len(cases)} casos, concurrency {conc}, modelo {MODEL}", flush=True)
    results = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=conc) as ex:
        futs = {ex.submit(run_case, c, i + 1, len(cases)): c for i, c in enumerate(cases)}
        for fut in as_completed(futs):
            results.append(fut.result())

    # ordenar por case_id
    results.sort(key=lambda r: r["case_id"])
    verdicts = [verdict_of(r) for r in results]
    by_track = {}
    for r in results:
        by_track.setdefault(r.get("track", "?"), []).append(verdict_of(r))
    track_summary = {}
    for tr, vs in sorted(by_track.items()):
        track_summary[tr] = {
            "n": len(vs),
            "pass": vs.count("pass"), "partial": vs.count("partial"),
            "fail": vs.count("fail"), "error": vs.count("error"),
            "rate": round(vs.count("pass") / len(vs), 2) if vs else 0,
        }
    cf_total = sum(len((r.get("judge") or {}).get("critical_errors_triggered") or [])
                   for r in results if not r.get("error"))
    report = {
        "ts": ts,
        "model": MODEL,
        "cases_run": len(cases),
        "pass": verdicts.count("pass"),
        "partial": verdicts.count("partial"),
        "fail": verdicts.count("fail"),
        "error": verdicts.count("error"),
        "pass_rate": round(verdicts.count("pass") / len(verdicts), 3) if verdicts else 0,
        "critical_errors_fired": cf_total,
        "by_track": track_summary,
        "secs_total": round(time.time() - t0, 1),
        "cases": results,
    }
    run_path = os.path.join(RUNS_DIR, f"{ts}.json")
    with open(run_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT_DIR, "latest_report.json"), "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in report.items() if k != "cases"}, f,
                  ensure_ascii=False, indent=1)
    # histórico compacto (últimas 30)
    hist_path = os.path.join(OUT_DIR, "history.jsonl")
    with open(hist_path, "a", encoding="utf-8") as f:
        f.write(json.dumps({k: report[k] for k in
                            ("ts", "pass", "partial", "fail", "error",
                             "pass_rate", "critical_errors_fired", "cases_run", "secs_total")},
                           ensure_ascii=False) + "\n")
    print(f"\nDONE: {report['pass']}/{report['cases_run']} pass, "
          f"{report['partial']} partial, {report['fail']} fail, "
          f"{report['error']} error | CF={cf_total} | {report['secs_total']}s")
    print(f"detalle: {run_path}")
    for tr, s in track_summary.items():
        print(f"  track {tr}: {s['pass']}P/{s['partial']}Par/{s['fail']}F/{s['error']}E (rate {s['rate']})")


if __name__ == "__main__":
    main()
