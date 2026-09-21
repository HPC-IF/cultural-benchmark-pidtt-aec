#!/usr/bin/env python3
"""conicet-api.py — Backend API para PIDTT-AEC (CITECCA cluster).
Reconstruido 2026-09-14. Endpoints: /auth/*, /stats, /subjects, /search, /detail, /generate-qa, /related.
"""
import hashlib, json, math, os, re, secrets, sqlite3, threading, time, unicodedata
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import urllib.request

import auth

# --- Config ---
DATA_DIR = "/mnt/shared/conicet-data"
LLM_URL = "http://192.168.1.68:8005/v1/chat/completions"
LLM_MODEL = "citecca-agent"
HOST = "0.0.0.0"
PORT = 8900
PER_PAGE = 20
MAX_TOKENS = 6000
QA_TIMEOUT = 16 * 60  # 16 min

# --- Metadata cache ---
_metadata = None
_subjects_cache = None
_embeddings_index = None
_embeddings_lock = threading.Lock()
QAJOBS = {}
QAJOBS_lock = threading.Lock()

def _norm_doc(d):
    """Normalize a metadata doc to include 'id' and 'dois' fields for the frontend."""
    nd = dict(d)
    if "id" not in nd:
        nd["id"] = nd.get("item_id") or nd.get("identifier", "").split("/")[-1]
    if "dois" not in nd:
        # Derive DOI from handle (e.g., http://hdl.handle.net/11336/12345)
        handle = nd.get("handle", "")
        if handle:
            nd["dois"] = [handle]
        else:
            nd["dois"] = []
    return nd

def _load_metadata():
    global _metadata
    if _metadata is not None:
        return _metadata
    meta = []
    mpath = os.path.join(DATA_DIR, "metadata.jsonl")
    if not os.path.exists(mpath):
        _metadata = []
        return _metadata
    with open(mpath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    meta.append(_norm_doc(json.loads(line)))
                except:
                    pass
    _metadata = meta
    return _metadata

def _load_subjects():
    global _subjects_cache
    if _subjects_cache is not None:
        return _subjects_cache
    counts = {}
    for doc in _load_metadata():
        for s in doc.get("subjects", []):
            counts[s] = counts.get(s, 0) + 1
    _subjects_cache = [{"name": k, "count": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]
    return _subjects_cache

def _load_embeddings():
    global _embeddings_index
    with _embeddings_lock:
        if _embeddings_index is not None:
            return _embeddings_index
        index = {}
        epath = os.path.join(DATA_DIR, "embeddings.jsonl")
        if os.path.exists(epath):
            with open(epath, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            e = json.loads(line)
                            index[e["id"]] = e["embedding"]
                        except:
                            pass
        _embeddings_index = index
        return _embeddings_index

def _cosine_sim(a, b):
    dot = sum(x*y for x, y in zip(a, b))
    na = math.sqrt(sum(x*x for x in a))
    nb = math.sqrt(sum(x*x for x in b))
    if na == 0 or nb == 0:
        return 0
    return dot / (na * nb)

def _nfkc(s):
    if not s:
        return ""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()

STOP_ES = {
    "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "que", "del",
    "en", "y", "a", "con", "por", "para", "es", "como", "su", "se", "no",
    "lo", "al", "más", "pero", "le", "ya", "o", "fue", "este", "esta", "sin",
    "sobre", "también", "me", "hasta", "hay", "quien", "desde", "todo",
    "nos", "durante", "todos", "les", "ni", "contra", "otros", "ese",
    "eso", "ante", "ellos", "cual", "fueron", "entre", "cada", "uno",
    "bien", "poco", "ella", "otro", "después", "otra", "hace", "puede",
    "casi", "era", "son", "tan", "mucho", "donde", "sido", "pueden",
    "tiene", "han", "ser", "está", "yo", "allí", "ahí", "decir",
    "porque", "cómo", "sí", "tengo", "tú", "él",
}

def _cov_words(s):
    """Extract content words (>3 letters, non-stop) for Jaccard dedup."""
    words = set()
    for w in re.findall(r'[a-záéíóúñ]+', (s or '').lower()):
        if len(w) > 3 and w not in STOP_ES:
            words.add(w)
    return words

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print("[{}] {}".format(time.strftime("%H:%M:%S"), args[0]), flush=True)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._json({"ok": True})

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        one = lambda k, d="": q.get(k, [d])[0]

        # Public routes
        if u.path == "/health":
            return self._json({"ok": True})
        if u.path.startswith("/auth/"):
            if u.path == "/auth/me":
                return auth.handle_me(self)
            return self._json({"error": "not found"}, 404)

        # Protected routes
        username = auth.require_auth(self)
        if not username:
            return

        try:
            if u.path == "/stats":
                return self._handle_stats()
            if u.path == "/subjects":
                return self._handle_subjects(one("limit", "0"))
            if u.path == "/search":
                return self._handle_search(q)
            if u.path == "/detail":
                return self._handle_detail(one("id"))
            if u.path == "/generate-qa/status":
                return self._handle_qa_status(one("job_id"))
            if u.path == "/related":
                return self._handle_related_get(q)
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 500)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.startswith("/auth/"):
            if u.path == "/auth/login":
                return auth.handle_login(self)
            if u.path == "/auth/logout":
                return auth.handle_logout(self)
            return self._json({"error": "not found"}, 404)

        username = auth.require_auth(self)
        if not username:
            return

        try:
            if u.path == "/generate-qa":
                return self._handle_generate_qa()
            if u.path == "/related":
                return self._handle_related_post()
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 500)

    def _handle_stats(self):
        meta = _load_metadata()
        oa = sum(1 for d in meta if d.get("open_access"))
        years = [int(d["date"][:4]) for d in meta if d.get("date") and d["date"][:4].isdigit()]
        return self._json({
            "total": len(meta),
            "open_access": oa,
            "year_min": min(years) if years else None,
            "year_max": max(years) if years else None,
        })

    def _handle_subjects(self, limit_str):
        limit = int(limit_str) if limit_str.isdigit() else 0
        subs = _load_subjects()
        if limit > 0:
            subs = subs[:limit]
        return self._json({"subjects": subs})

    def _handle_search(self, q):
        one = lambda k, d="": q.get(k, [d])[0]
        page = int(one("page", "1"))
        if page < 1:
            page = 1
        per_page = PER_PAGE

        query = one("q").strip().lower()
        author = one("author").strip().lower()
        year_from = one("year_from")
        year_to = one("year_to")
        oa_only = one("oa") == "1"
        subject = one("subject")
        sort = one("sort", "relevance")

        results = _load_metadata()

        # Filters
        if query:
            ql = query.lower()
            results = [d for d in results if ql in (d.get("title") or "").lower() or ql in (d.get("description") or "").lower() or ql in (", ".join(d.get("creators") or [])).lower()]
        if author:
            al = author.lower()
            results = [d for d in results if al in (", ".join(d.get("creators") or [])).lower()]
        if year_from:
            yf = int(year_from)
            results = [d for d in results if d.get("date") and d["date"][:4].isdigit() and int(d["date"][:4]) >= yf]
        if year_to:
            yt = int(year_to)
            results = [d for d in results if d.get("date") and d["date"][:4].isdigit() and int(d["date"][:4]) <= yt]
        if oa_only:
            results = [d for d in results if d.get("open_access")]
        if subject:
            results = [d for d in results if subject in (d.get("subjects") or [])]

        total = len(results)

        if sort == "new":
            results.sort(key=lambda d: d.get("date", ""), reverse=True)

        start = (page - 1) * per_page
        end = start + per_page
        page_results = results[start:end]

        return self._json({
            "results": page_results,
            "total": total,
            "page": page,
            "per_page": per_page,
            "took_ms": 0,
        })

    def _handle_detail(self, doc_id):
        if not doc_id:
            return self._json({"error": "id requerido"}, 400)
        for d in _load_metadata():
            if d["id"] == doc_id:
                return self._json(d)
        return self._json({"error": "no encontrado"}, 404)

    def _handle_qa_status(self, job_id):
        if not job_id:
            return self._json({"error": "job_id requerido"}, 400)
        with QAJOBS_lock:
            job = QAJOBS.get(job_id)
        if not job:
            return self._json({"error": "job no encontrado"}, 404)
        return self._json(job)

    def _handle_generate_qa(self):
        clen = int(self.headers.get("Content-Length") or 0)
        if clen <= 0 or clen > 50000:
            return self._json({"error": "body invalido"}, 400)
        body = json.loads(self.rfile.read(clen).decode())

        job_id = secrets.token_hex(16)
        now = time.time()
        with QAJOBS_lock:
            QAJOBS[job_id] = {"phase": "resolving", "detail": "Preparando...", "pct": 0, "elapsed_s": 0, "done": False}

        t = threading.Thread(target=_qa_worker, args=(job_id, body), daemon=True)
        t.start()
        return self._json({"job_id": job_id})

    def _handle_related_get(self, q):
        one = lambda k, d="": q.get(k, [d])[0]
        ids = q.get("ids", [])
        if isinstance(ids, str):
            ids = [ids]
        limit = int(one("limit", "10"))
        return self._do_related(ids, limit)

    def _handle_related_post(self):
        clen = int(self.headers.get("Content-Length") or 0)
        if clen <= 0 or clen > 50000:
            return self._json({"error": "body invalido"}, 400)
        body = json.loads(self.rfile.read(clen).decode())
        ids = body.get("ids", [])
        limit = int(body.get("limit", 10))
        return self._do_related(ids, limit)

    def _do_related(self, ids, limit):
        index = _load_embeddings()
        if not index:
            return self._json({"results": [], "requested": len(ids), "index_size": 0, "took_ms": 0})

        # Get query vectors
        qvecs = []
        for i in ids:
            if i in index:
                qvecs.append(index[i])
        if not qvecs:
            return self._json({"results": [], "requested": len(ids), "index_size": len(index), "took_ms": 0})

        # Average query vector
        avg = [sum(v[i] for v in qvecs) / len(qvecs) for i in range(len(qvecs[0]))]

        # Compute similarities
        sims = []
        for did, vec in index.items():
            if did not in ids:
                sim = _cosine_sim(avg, vec)
                sims.append((did, sim))
        sims.sort(key=lambda x: -x[1])
        top = sims[:limit]

        # Fetch metadata
        meta_map = {d["id"]: d for d in _load_metadata()}
        results = []
        for did, sim in top:
            m = meta_map.get(did, {})
            results.append({
                "id": did,
                "title": m.get("title", ""),
                "creators": m.get("creators", ""),
                "date": m.get("date", ""),
                "open_access": m.get("open_access", False),
                "similarity": round(sim, 4),
            })

        return self._json({
            "results": results,
            "requested": len(ids),
            "index_size": len(index),
            "took_ms": 0,
        })

def _qa_worker(job_id, body):
    try:
        with QAJOBS_lock:
            QAJOBS[job_id]["phase"] = "resolving"
            QAJOBS[job_id]["detail"] = "Preparando la generación..."
            QAJOBS[job_id]["pct"] = 1

        ids = body.get("ids", [])
        filters = body.get("filters", {})
        get_all = body.get("all", False)
        
        # Opciones de configuración del frontend
        requested_axes = body.get("axes", [])
        requested_qa_types = body.get("qa_types", ["open-ended"])
        if not isinstance(requested_qa_types, list) or len(requested_qa_types) == 0:
            requested_qa_types = ["open-ended"]
        # Validar tipos
        valid_types = {"open-ended", "mcq", "scenario"}
        requested_qa_types = [t for t in requested_qa_types if t in valid_types]
        if not requested_qa_types:
            requested_qa_types = ["open-ended"]

        if get_all:
            # Filter metadata
            docs = _load_metadata()
            if filters:
                q = filters.get("q", "").strip().lower()
                author = filters.get("author", "").strip().lower()
                year_from = filters.get("year_from", "")
                year_to = filters.get("year_to", "")
                oa_only = filters.get("oa") == "1"
                subject = filters.get("subject", "")
                if q:
                    docs = [d for d in docs if q in (d.get("title") or "").lower() or q in (d.get("description") or "").lower()]
                if author:
                    docs = [d for d in docs if author in (d.get("creators") or "").lower()]
                if year_from:
                    docs = [d for d in docs if d.get("date") and d["date"][:4].isdigit() and int(d["date"][:4]) >= int(year_from)]
                if year_to:
                    docs = [d for d in docs if d.get("date") and d["date"][:4].isdigit() and int(d["date"][:4]) <= int(year_to)]
                if oa_only:
                    docs = [d for d in docs if d.get("open_access")]
                if subject:
                    docs = [d for d in docs if subject in (d.get("subjects") or [])]
            ids = [d["id"] for d in docs]

        if not ids:
            with QAJOBS_lock:
                QAJOBS[job_id] = {"phase": "error", "detail": "No hay fuentes seleccionadas", "pct": 0, "elapsed_s": 0, "done": True, "error": "No hay fuentes seleccionadas"}
            return

        # Fetch abstracts
        meta_map = {d["id"]: d for d in _load_metadata()}
        articles = []
        for i in ids:
            m = meta_map.get(i)
            if m:
                articles.append({
                    "id": m["id"],
                    "title": m.get("title", ""),
                    "creators": m.get("creators", ""),
                    "date": m.get("date", ""),
                    "description": m.get("description", ""),
                    "subjects": m.get("subjects", []),
                })

        with QAJOBS_lock:
            QAJOBS[job_id]["phase"] = "llm"
            QAJOBS[job_id]["detail"] = "Generando preguntas para {} artículos...".format(len(articles))
            QAJOBS[job_id]["pct"] = 10

        # Build prompt — v16: format-aware, strict
        prompt_parts = []
        prompt_parts.append("Creá 5 preguntas de benchmark cultural.")
        prompt_parts.append("")
        prompt_parts.append(f"TIPO SOLICITADO: {', '.join(requested_qa_types)}")
        prompt_parts.append("")
        prompt_parts.append("REGLAS:")
        prompt_parts.append("1. Pregunta = ESCENARIO (museo, aula, debate)")
        prompt_parts.append("2. NUNCA mencionar el paper ni el autor")
        prompt_parts.append("3. Respuesta = síntesis propia (2-4 oraciones)")
        prompt_parts.append("")

        if requested_qa_types == ["mcq"]:
            prompt_parts.append("FORMATO OBLIGATORIO MCQ:")
            prompt_parts.append('{"question":"Q","options":["A) ...","B) ...","C) ...","D) ..."],"correct":"B"}')
            prompt_parts.append("Cada item DEBE tener 'options' (4) y 'correct' (letra).")
            prompt_parts.append("NO incluir 'answer' ni 'scenario' en items MCQ.")
        elif requested_qa_types == ["scenario"]:
            prompt_parts.append("FORMATO OBLIGATORIO SCENARIO:")
            prompt_parts.append('{"scenario":"Contexto...","question":"Q","answer":"R"}')
            prompt_parts.append("Cada item DEBE tener 'scenario', 'question' y 'answer'.")
            prompt_parts.append("NO incluir 'options' ni 'correct' en items SCENARIO.")
        else:
            prompt_parts.append("FORMATO OBLIGATORIO OPEN-ENDED:")
            prompt_parts.append('{"question":"Q","answer":"R"}')
            prompt_parts.append("Cada item DEBE tener 'question' y 'answer'.")
            prompt_parts.append("NO incluir 'options', 'correct' ni 'scenario' en items OPEN-ENDED.")

        prompt_parts.append("")
        prompt_parts.append("EJEMPLO OPEN: {'question':'Un museo prepara exposicion... Que argumento deberia presentar?','answer':'Deberia argumentar que...'}")
        prompt_parts.append("EJEMPLO MCQ: {'question':'Que deberia senalar un alumno critico?','options':['A) Nada','B) Que fue copia','C) Que no tuvo influencia','D) Que fue pura ilustracion'],'correct':'B'}")
        prompt_parts.append("")
        prompt_parts.append("ARRAY JSON:")
        prompt_parts.append('{"qa": [{"n":1,"question":"...","answer":"...","options":null,"correct":null,"article_ids":["id1"],"cultural_axis":"escenario|critica|adaptacion|dato|razonamiento|valores","cite":"extracto literal (opcional)","contextual_background":"...","expected_response_characteristics":["...","..."],"common_failure_modes":["...","..."],"evaluator_disagreement_note":"...","scoring_rubric":"binary|3_niveles|5_likert"}, ...]}')
        prompt_parts.append("")

# Cross-paper: activar automáticamente cuando hay múltiples papers
        cross_paper = len(articles) > 1

        # Ejes solicitados
        if requested_axes:
            prompt_parts.append("")
            prompt_parts.append("EJES SOLICITADOS: {}. Usá SOLO estos ejes, distribuílos en el batch.".format(", ".join(requested_axes)))
        else:
            prompt_parts.append("")
            prompt_parts.append("EJES: escenario, critica, adaptacion, dato, razonamiento, valores. Mínimo 2 distintos.")

        if cross_paper and len(articles) > 1:
            prompt_parts.append("")
            prompt_parts.append("CROSS-PAPER: Al menos 1 ítem debe comparar entre papers.")

        prompt = "\n".join(prompt_parts)

        with QAJOBS_lock:
            QAJOBS[job_id]["pct"] = 20
            QAJOBS[job_id]["detail"] = "Enviando al modelo..."

        # Call LLM
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": "Eres riguroso. No inventas. Devuelve SOLO JSON valido."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2,
            "max_tokens": MAX_TOKENS,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        req = urllib.request.Request(LLM_URL, data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=280) as r:
            llm = json.loads(r.read())

        content = llm["choices"][0]["message"]["content"]

        with QAJOBS_lock:
            QAJOBS[job_id]["phase"] = "lint"
            QAJOBS[job_id]["pct"] = 80
            QAJOBS[job_id]["detail"] = "Validando respuestas..."

        # Parse JSON
        m = re.search(r"\{.*\}", content, re.DOTALL)
        qa_data = {"qa": []}
        if m:
            try:
                qa_data = json.loads(m.group(0))
            except Exception as e:
                print(f"[QA] JSON parse error: {e}")
                print(f"[QA] Content: {content[:500]}")
        else:
            print(f"[QA] No JSON found in response")
            print(f"[QA] Content: {content[:500]}")

        # Lint
        flags = []
        axis_counts = {}
        for item in qa_data.get("qa", []):
            axis = item.get("cultural_axis", "cultural_fact")
            axis_counts[axis] = axis_counts.get(axis, 0) + 1
            cite = item.get("cite", "")
            if cite:
                cite_lower = cite.lower()
                found = False
                for a in articles:
                    desc = (a.get("description") or "").lower()
                    if cite_lower in desc:
                        found = True
                        break
                if not found and len(cite) > 15:
                    flags.append({"n": item.get("n"), "flag": "cita_no_verificable", "detail": "La cita no aparece literalmente en los resumenes"})
            # No flag si falta cite — en escenarios situados no siempre hay extracto textual relevante
            # Check knowledge specificity
            if item.get("cultural_axis") == "dato":
                answer = (item.get("answer") or "").strip()
                words = answer.split()
                if len(words) < 12:
                    flags.append({"n": item.get("n"), "flag": "knowledge_vago", "detail": "La respuesta de knowledge es muy corta ({} palabras). Mínimo 1 frase completa.".format(len(words))})
            # Cultural benchmark field checks
            if not item.get("cultural_axis"):
                flags.append({"n": item.get("n"), "flag": "falta_cultural_axis", "detail": "Falta cultural_axis"})
            elif item.get("cultural_axis") not in ("escenario", "critica", "adaptacion", "dato", "razonamiento", "valores"):
                flags.append({"n": item.get("n"), "flag": "cultural_axis_invalido", "detail": "cultural_axis no es un valor valido"})
            if not item.get("contextual_background") or len(str(item.get("contextual_background","")).strip()) < 20:
                flags.append({"n": item.get("n"), "flag": "falta_context", "detail": "Falta contextual_background o es muy corta"})
            if not item.get("expected_response_characteristics") or len(item.get("expected_response_characteristics",[])) < 2:
                flags.append({"n": item.get("n"), "flag": "falta_expected_characteristics", "detail": "Faltan expected_response_characteristics (min 2)"})
            if not item.get("common_failure_modes") or len(item.get("common_failure_modes",[])) < 2:
                flags.append({"n": item.get("n"), "flag": "falta_failure_modes", "detail": "Faltan common_failure_modes (min 2)"})
            if not item.get("scoring_rubric"):
                flags.append({"n": item.get("n"), "flag": "falta_scoring_rubric", "detail": "Falta scoring_rubric"})

        # Check cross-paper
        cross_paper_count = sum(1 for item in qa_data.get("qa", []) if len(item.get("article_ids", [])) > 1)
        if len(articles) > 1 and cross_paper_count < 2:
            flags.append({"n": 0, "flag": "falta_cross_paper", "detail": "Con múltiples papers, al menos 2 ítems deben comparar entre 2+ papers (tenés {})".format(cross_paper_count)})
        # Check critical specificity
        for item in qa_data.get("qa", []):
            if item.get("cultural_axis") == "critica":
                answer_lower = (item.get("answer") or "").lower()
                if "limitaciones" in answer_lower and "validación" in answer_lower and len(answer_lower) < 100:
                    flags.append({"n": item.get("n"), "flag": "critical_vago", "detail": "La limitación crítica es muy vaga (solo 'limitaciones de validación'). Ser más específico."})
                if "contribución inicial" in answer_lower or "estudio exploratorio" in answer_lower:
                    flags.append({"n": item.get("n"), "flag": "critical_vago", "detail": "Alcance ('contribución inicial') no es limitación metodológica"})
        # Forzar separación de formatos según tipos solicitados
        for item in qa_data.get("qa", []):
            has_options = bool(item.get("options"))
            has_scenario = bool(item.get("scenario"))
            has_answer = bool(item.get("answer"))
            
            if requested_qa_types == ["open-ended"]:
                item.pop("options", None)
                item.pop("correct", None)
                item.pop("scenario", None)
                if not has_answer:
                    flags.append({"n": item.get("n"), "flag": "falta_answer", "detail": "Item open-ended sin answer"})
            elif requested_qa_types == ["mcq"]:
                item.pop("answer", None)
                item.pop("scenario", None)
                if not has_options:
                    flags.append({"n": item.get("n"), "flag": "mcq_sin_options", "detail": "Item MCQ sin options"})
                if not item.get("correct"):
                    flags.append({"n": item.get("n"), "flag": "mcq_sin_correct", "detail": "Item MCQ sin correct"})
            elif requested_qa_types == ["scenario"]:
                item.pop("options", None)
                item.pop("correct", None)
                if not has_scenario:
                    flags.append({"n": item.get("n"), "flag": "scenario_sin_scenario", "detail": "Item scenario sin campo scenario"})
            else:
                if has_options and has_scenario:
                    flags.append({"n": item.get("n"), "flag": "formato_mixto", "detail": "Item tiene options Y scenario - elegir uno"})

        # Check axis mix
        if len(axis_counts) < 2:
            flags.append({"n": 0, "flag": "mezcla_ejes", "detail": "El batch debe incluir multiples ejes (knowledge, reasoning, critical, adaptation, interaction, safety)"})
        # Dedup check
        questions = [(item.get("n"), _cov_words(item.get("question", ""))) for item in qa_data.get("qa", [])]
        for i, (n1, w1) in enumerate(questions):
            for n2, w2 in questions[i+1:]:
                if w1 and w2:
                    jaccard = len(w1 & w2) / len(w1 | w2) if (w1 | w2) else 0
                    if jaccard > 0.5:
                        flags.append({"n": n1, "flag": "solapamiento", "detail": "P{} y P{} comparten >50% de palabras (Jaccard={:.2f})".format(n1, n2, jaccard)})
                        flags.append({"n": n2, "flag": "solapamiento", "detail": "P{} y P{} comparten >50% de palabras (Jaccard={:.2f})".format(n1, n2, jaccard)})

        result = {
            "qa": qa_data.get("qa", []),
            "used_articles": [
                {
                    "id": a["id"],
                    "title": a.get("title", "")[:120],
                    "creators": ", ".join(a.get("creators", [])[:2]) if isinstance(a.get("creators"), list) else str(a.get("creators", ""))[:60],
                    "date": a.get("date", ""),
                    "pdf": next((b.get("url", "") for b in a.get("bitstreams", []) if b.get("format", "").lower() == "pdf"), ""),
                    "handle": a.get("handle", ""),
                }
                for a in articles
            ],
            "with_abstract": len(articles),
            "requested": len(ids),
            "fulltext_count": 0,
            "took_ms": 0,
            "lint": {"flags": flags, "note": "{} flags".format(len(flags)), "axis_mix": axis_counts},
        }

        with QAJOBS_lock:
            QAJOBS[job_id] = {"phase": "done", "detail": "Completado", "pct": 100, "elapsed_s": 0, "done": True, "result": result}

    except Exception as e:
        with QAJOBS_lock:
            QAJOBS[job_id] = {"phase": "error", "detail": str(e), "pct": 0, "elapsed_s": 0, "done": True, "error": str(e)}

def main():
    auth.init_db()
    # Seed default users
    for un, dn in [("mdenham", "Mónica Denham"), ("mbasti", "Marian Basti")]:
        if not auth.get_user(un):
            auth.create_user(un, "anasa1463", dn)
            print("[auth] created user {}".format(un), flush=True)

    # Preload metadata in background
    threading.Thread(target=_load_metadata, daemon=True).start()

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("[conicet-api] listening on {}:{}".format(HOST, PORT), flush=True)
    server.serve_forever()

if __name__ == "__main__":
    main()
