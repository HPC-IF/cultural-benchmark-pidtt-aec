import { useEffect, useRef, useState } from 'react';

interface ConicetRecord {
  id: string;
  title: string;
  creators: string;
  subjects: string[];
  date: string;
  open_access: boolean;
  handle: string;
  pdf: string;
  dois: string[];
}

interface SearchResponse {
  total: number;
  page: number;
  per_page: number;
  took_ms: number;
  results: ConicetRecord[];
}

interface Detail {
  id: string;
  title: string;
  creators: string;
  subjects: string[];
  date: string;
  year: number;
  open_access: boolean;
  handle: string;
  pdf: string;
  dois: string[];
  description: string;
}

interface Stats {
  total: number;
  open_access: number;
  year_min: number;
  year_max: number;
  loaded_at: number;
}

interface Subject {
  name: string;
  count: number;
}

interface QA {
  n: number;
  question: string;
  answer?: string;
  cultural_axis: string;
  cite: string;
  cite_fidelity?: number;
  contextual_background?: string;
  expected_response_characteristics?: string[];
  common_failure_modes?: string[];
  evaluator_disagreement_note?: string;
  scoring_rubric?: string;
  article_ids: string[];
  options?: string[];
  correct?: string;
  scenario?: string;
}

interface QAJobState {
  phase: string;
  detail: string;
  pct: number;
  elapsed_s: number;
}

interface QALintFlag {
  n: number;
  flag: string;
  detail: string;
}

interface QALint {
  ok: boolean;
  axis_mix: Record<string, number>;
  flags: QALintFlag[];
  note: string;
}

interface QAResult {
  qa: QA[];
  lint: QALint;
  used_articles: { id: string; title: string; creators: string; date: string; pdf: string; handle: string; fulltext?: boolean }[];
  requested: number;
  with_abstract: number;
  fulltext_count?: number;
  took_ms: number;
  model: string;
}

interface RelatedItem {
  id: string;
  title: string;
  creators: string;
  subjects: string[];
  date: string;
  open_access: boolean;
  handle: string;
  pdf: string;
  dois: string[];
  similarity: number;
}

interface RelatedData {
  results: RelatedItem[];
  requested: number;
  index_size: number;
  waited_s: number;
  took_ms: number;
}

interface LibraryResponse {
  ids: string[];
  total: number;
}

const AXIS_LABEL: Record<string, string> = {
  cultural_fact: 'dato cultural',
  cultural_reasoning: 'razonamiento cultural',
  cultural_critical: 'crítica cultural',
  cultural_adaptation: 'adaptación cultural',
  cultural_interacción: 'interacción cultural',
  cultural_values: 'valores culturales',
};
const AXIS_CLASS: Record<string, string> = {
  cultural_fact: 'axis-cultural-fact',
  cultural_reasoning: 'axis-cultural-reasoning',
  cultural_critical: 'axis-cultural-critical',
  cultural_adaptation: 'axis-cultural-adaptation',
  cultural_interacción: 'axis-cultural-interaction',
  cultural_values: 'axis-cultural-values',
};
const CULTURAL_AXIS_LABELS: Record<string, string> = {
  escenario: 'escenario situado',
  critica: 'crítica cultural',
  adaptacion: 'adaptación cultural',
  dato: 'dato cultural',
  razonamiento: 'razonamiento cultural',
  valores: 'valores culturales',
};
const SCORING_RUBRIC_LABELS: Record<string, string> = {
  binary: 'binario (competente/no competente)',
  '3_niveles': '3 niveles (competente/parcial/incompetente)',
  '5_likert': 'escala 1-5 (estereotípico → culturalmente sensible)',
};

const API_BASE = '/api/conicet';
const TOKEN_KEY = 'pidtt-aec-token';
const USER_KEY = 'pidtt-aec-user';

type AuthUser = { token: string; username: string; display_name: string };

function getAuth(): AuthUser | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    if (token && userRaw) return { token, ...JSON.parse(userRaw) };
  } catch { /* ignore */ }
  return null;
}

function clearAuth() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}

function setAuth(user: AuthUser) {
  try {
    localStorage.setItem(TOKEN_KEY, user.token);
    localStorage.setItem(USER_KEY, JSON.stringify({ username: user.username, display_name: user.display_name }));
  } catch { /* ignore */ }
}
const PER_PAGE = 20;
const RATINGS_KEY = 'pidtt-aec-qa-ratings';

// Etiqueta descriptiva de cada puntuacion (1 = muy mala, 10 = muy buena).
const RATING_LABELS: Record<number, string> = {
  1: 'muy mala', 2: 'muy mala', 3: 'mala', 4: 'mala', 5: 'regular',
  6: 'regular', 7: 'buena', 8: 'buena', 9: 'muy buena', 10: 'muy buena',
};

// Clave estable por P&R: hash de la pregunta (djb2). Si un P&R se regenera
// con la misma pregunta, su puntuacion anterior se conserva.
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'q' + h.toString(16);
}

function QARating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="qa-rating" onMouseLeave={() => setHover(0)}>
      <span className="qa-rating-label">Tu puntuación:</span>
      <div className="qa-rating-pips" role="radiogroup" aria-label="Puntuar de 1 a 10">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${v} — ${RATING_LABELS[v]}`}
            title={`${v} — ${RATING_LABELS[v]}`}
            className={`pip${v <= shown ? ' on' : ''}${v === value ? ' sel' : ''}`}
            onClick={() => onChange(v === value ? 0 : v)}
            onMouseEnter={() => setHover(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <span className={`qa-rating-current${value ? '' : ' muted'}`}>
        {value ? `${value}/10 · ${RATING_LABELS[value]}` : 'sin puntuar'}
      </span>
    </div>
  );
}

function formatNumber(n: number): string {
  return n.toLocaleString('es-AR');
}

function formatDate(date: string): string {
  if (!date) return '';
  const m = date.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return date;
  const year = m[1];
  const month = m[2];
  if (!month) return year;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${months[parseInt(month, 10) - 1] ?? ''} ${year}`.trim();
}

function DetailPanel({
  loading,
  error,
  detail,
  onFilterSubject,
}: {
  loading: boolean;
  error: string | null;
  detail: Detail | null;
  onFilterSubject: (s: string) => void;
}) {
  return (
    <div className="detail-wrap">
      {loading && <div className="empty">Cargando ficha…</div>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {detail && (
        <article className="detail">
          <div className="detail-actions">
            {detail.open_access && (
              <a className="btn btn-primary" href={detail.pdf} target="_blank" rel="noopener noreferrer">
                Descargar PDF
              </a>
            )}
            <a
              className="btn btn-ghost"
              href={detail.handle}
              target="_blank"
              rel="noopener noreferrer"
              title="Abre ri.conicet.gov.ar (solo carga si el repositorio responde)"
            >
              Ver en ri.conicet ↗
            </a>
          </div>

          <h1 className="detail-title">{detail.title}</h1>
          {detail.creators && <p className="detail-creators">{detail.creators}</p>}

          <dl className="detail-meta">
            <div className="detail-meta-item">
              <dt>Fecha</dt>
              <dd>{detail.date ? formatDate(detail.date) : 's/f'}</dd>
            </div>
            <div className="detail-meta-item">
              <dt>Acceso</dt>
              <dd>{detail.open_access ? 'Abierto (PDF disponible)' : 'Restringido'}</dd>
            </div>
            {detail.dois.length > 0 && (
              <div className="detail-meta-item">
                <dt>DOI</dt>
                <dd>
                  {detail.dois.map((d, i) => (
                    <span key={d}>
                      <a href={`https://doi.org/${d}`} target="_blank" rel="noopener noreferrer">
                        {d}
                      </a>
                      {i < detail.dois.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            <div className="detail-meta-item">
              <dt>ID ri.conicet</dt>
              <dd>{detail.id}</dd>
            </div>
          </dl>

          {detail.subjects.length > 0 && (
            <div className="detail-subjects">
              {detail.subjects.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => onFilterSubject(s)} title={`Filtrar por ${s}`}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {detail.description ? (
            <section className="detail-desc">
              <h2>Resumen</h2>
              <p>{detail.description}</p>
            </section>
          ) : (
            <p className="detail-no-desc">Esta publicación no trae resumen en el repositorio.</p>
          )}

          {!detail.open_access && (
            <p className="detail-note">
              Esta publicación no está en acceso abierto en nuestro backup. El botón «Ver en ri.conicet»
              solo carga si el repositorio está disponible (presenta caídas frecuentes).
            </p>
          )}
        </article>
      )}
    </div>
  );
}

function App() {
  // ==== MOVIDOS DENTRO DE APP: estado y efectos de auth (antes estaban a nivel de módulo) ====
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState('');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  useEffect(() => {
    const a = getAuth();
    if (a) {
      apiFetch('/auth/me').then(r => r.ok ? r.json() : Promise.reject()).then(() => setAuthUser(a)).catch(() => { clearAuth(); setAuthUser(null); });
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const r = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: loginUser, password: loginPass }) });
      if (!r.ok) throw new Error('Credenciales inválidas');
      const data = await r.json();
      const u = { token: data.token, username: data.username, display_name: data.display_name };
      setAuth(u);
      setAuthUser(u);
      setLoginPass('');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Error de inicio de sesión');
    }
  };

  const handleLogout = async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearAuth();
    setAuthUser(null);
  }

  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [oaOnly, setOaOnly] = useState(false);
  const [subject, setSubject] = useState('');
  const [sortNew, setSortNew] = useState(false);
  const [page, setPage] = useState(1);

  // Biblioteca de usuario
  const [library, setLibrary] = useState<string[]>([]);
  const [libraryOnly, setLibraryOnly] = useState(false);

  // Tabs: "fuentes" | "generacion"
  const [activeTab, setActiveTab] = useState<'fuentes' | 'generacion'>('fuentes');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const detailReq = useRef(0);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generacion de P&R
  const [qa, setQa] = useState<QAResult | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaPhase, setQaPhase] = useState<QAJobState | null>(null);

  // Configuración de generación de QAs
  const [qaAxes, setQaAxes] = useState<Set<string>>(new Set(['escenario', 'critica', 'razonamiento']));
  const [qaTypes, setQaTypes] = useState<Set<string>>(new Set(['open-ended']));
  const [qaConfigOpen, setQaConfigOpen] = useState(false);
  const qaAxesOptions = [
    { id: 'escenario', label: 'Escenario', color: '#4a90d9' },
    { id: 'critica', label: 'Crítica', color: '#d9534f' },
    { id: 'adaptacion', label: 'Adaptación', color: '#f0ad4e' },
    { id: 'dato', label: 'Dato cultural', color: '#7b68ee' },
    { id: 'razonamiento', label: 'Razonamiento', color: '#5cb85c' },
    { id: 'valores', label: 'Valores', color: '#e83e8c' },
  ];
  const qaTypeOptions = [
    { id: 'open-ended', label: 'Open-ended', icon: '✏️' },
    { id: 'mcq', label: 'MCQ', icon: '☑️' },
    { id: 'scenario', label: 'Scenario', icon: '📋' },
  ];
  const toggleQaType = (t: string) => setQaTypes(prev => {
    const next = new Set(prev);
    if (next.has(t)) {
      if (next.size > 1) next.delete(t);
    } else {
      next.add(t);
    }
    return next;
  });
  const toggleQaAxis = (ax: string) => setQaAxes(prev => {
    const next = new Set(prev);
    if (next.has(ax)) next.delete(ax); else next.add(ax);
    return next;
  });
  const pollRef = useRef<number | undefined>(undefined);
  const qaTimeoutRef = useRef<number | undefined>(undefined);

  // Tema claro/oscuro: persistido en localStorage, respeta prefers-color-scheme
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* noop */ }
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // Papers relacionados (busqueda por embeddings)
  const [related, setRelated] = useState<RelatedData | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);

  // Puntuacion 1-10 por P&R (1 = muy mala, 10 = muy buena). Persistido en
  // localStorage con clave = hash de la pregunta, asi sobrevive recargas y
  // conservaciones de un mismo P&R regenerado.
  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}');
    } catch {
      return {};
    }
  });
  const setRating = (item: QA, v: number) => {
    setRatings((prev) => {
      const next = { ...prev, [hashKey(item.question)]: v };
      if (v === 0) delete next[hashKey(item.question)];
      try { localStorage.setItem(RATINGS_KEY, JSON.stringify(next)); } catch { /* full/private mode */ }
      return next;
    });
  };

  // Colapsables por item (R esperada, Rechazar, Ambigüedad). Clave = `${item.n}-${tipo}`.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Notas libres por P&R. Clave = hash de la pregunta. Persistida en localStorage.
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('pidtt-aec-qa-notes') || '{}');
    } catch {
      return {};
    }
  });
  const saveNote = (key: string, v: string) => {
    setNotes((prev) => {
      const next = { ...prev, [key]: v };
      if (!v) delete next[key];
      try { localStorage.setItem('pidtt-aec-qa-notes', JSON.stringify(next)); } catch { /* full/private mode */ }
      return next;
    });
  };

  async function apiFetch(path: string, options: RequestInit = {}) {
    const auth = getAuth();
    const headers = new Headers(options.headers);
    if (auth) headers.set('Authorization', `Bearer ${auth.token}`);
    if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
    const r = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (r.status === 401 && !path.startsWith('/auth/')) {
      clearAuth();
      setAuthUser(null);
      throw new Error('Sesión expirada');
    }
    return r;
  }

  // ==== Biblioteca: cargar al login y cuando cambia el usuario ====
  const loadLibrary = async () => {
    if (!authUser) { setLibrary([]); return; }
    try {
      const r = await apiFetch('/library');
      const d = await r.json();
      if (r.ok) setLibrary(d.ids || []);
    } catch { setLibrary([]); }
  };

  useEffect(() => {
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  const toggleLibraryItem = async (id: string) => {
    if (!authUser) return;
    const isLib = library.includes(id);
    const action = isLib ? 'remove' : 'add';
    try {
      const r = await apiFetch('/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids: [id] }),
      });
      const d = await r.json();
      if (r.ok) setLibrary(d.ids || []);
    } catch { /* ignore */ }
  };

  const isItemInLibrary = (id: string) => library.includes(id);

  const searchRelated = async () => {
    setRelatedLoading(true);
    setRelatedError(null);
    setRelated(null);
    try {
      const payload: Record<string, unknown> = { ids: library.length > 0 ? library : (data?.results || []).map(r => r.id) };
      const r = await apiFetch('/related', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setRelated(d);
    } catch (e) {
      setRelatedError(e instanceof Error ? e.message : 'Error buscando papers relacionados.');
    } finally {
      setRelatedLoading(false);
    }
  };

  const stopQaPoll = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = undefined; }
    if (qaTimeoutRef.current) { window.clearTimeout(qaTimeoutRef.current); qaTimeoutRef.current = undefined; }
  };

  // Cierre del flujo: SOLO se llama cuando el job termino (done/error/timeout),
  // nunca al salir de generateQa (que retorna apenas arranca el polling).
  const finishQa = (error?: string, result?: QAResult) => {
    stopQaPoll();
    setQaLoading(false);
    setQaPhase(null);
    if (error) setQaError(error);
    if (result) {
      setQa(result);
      requestAnimationFrame(() => {
        document.getElementById('qa-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const generateQa = async () => {
    closeDetail();
    setQaLoading(true);
    setQaError(null);
    setQa(null);
    setQaPhase({ phase: 'resolving', detail: 'Preparando la generación…', pct: 1, elapsed_s: 0 });
    try {
      // Usar biblioteca del usuario como fuentes
      const payload: Record<string, unknown> = {
        library: true,
        axes: [...qaAxes],
        qa_types: [...qaTypes],
      };

      const r = await apiFetch('/generate-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const jobId = d.job_id as string;
      // Polling de estado hasta done (fases reales del backend). generateQa NO
      // espera al job: el cierre lo hace finishQa dentro del propio poll.
      let settled = false;
      const poll = async () => {
        if (settled) return;
        try {
          const sr = await apiFetch(`/generate-qa/status?job_id=${jobId}`);
          const s = await sr.json();
          if (!sr.ok) throw new Error(s.error || `HTTP ${sr.status}`);
          setQaPhase({ phase: s.phase, detail: s.detail || '', pct: s.pct || 0, elapsed_s: s.elapsed_s || 0 });
          if (s.done) {
            settled = true;
            if (s.phase === 'error') finishQa(s.error || 'Error en la generación.');
            else finishQa(undefined, s.result as QAResult);
          }
        } catch (e) {
          if (settled) return;
          settled = true;
          finishQa(e instanceof Error ? e.message : 'Error consultando el progreso.');
        }
      };
      await poll();
      pollRef.current = window.setInterval(poll, 2000);
      qaTimeoutRef.current = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          finishQa('Tiempo de espera agotado (16 min). El job pudo seguir corriendo: probá de nuevo.');
        }
      }, 16 * 60 * 1000);
    } catch (e) {
      finishQa(e instanceof Error ? e.message : 'Error generando las preguntas y respuestas.');
    }
  };

  const requestId = useRef(0);
  const debounceRef = useRef<number | undefined>(undefined);

  // detener el polling de generacion al desmontar
  useEffect(() => () => stopQaPoll(), []);

  useEffect(() => {
    apiFetch('/stats')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`stats HTTP ${r.status}`))))
      .then(setStats)
      .catch(() => setError('No se pudo conectar con el servicio de publicaciones.'));
    apiFetch('/subjects?limit=40')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`subjects HTTP ${r.status}`))))
      .then((d: { subjects: Subject[] }) => setSubjects(d.subjects))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (author.trim()) params.set('author', author.trim());
      if (yearFrom) params.set('year_from', yearFrom);
      if (yearTo) params.set('year_to', yearTo);
      if (oaOnly) params.set('oa', '1');
      if (subject) params.set('subject', subject);
      if (sortNew) params.set('sort', 'new');
      if (libraryOnly) params.set('library_only', '1');
      params.set('page', String(page));
      apiFetch(`/search?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`search HTTP ${r.status}`))))
        .then((d: SearchResponse) => {
          if (id !== requestId.current) return;
          setData(d);
          setLoading(false);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setError('No se pudieron cargar los resultados.');
          setLoading(false);
        });
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, author, yearFrom, yearTo, oaOnly, subject, sortNew, page, libraryOnly]);

  useEffect(() => {
    if (!detailId) return;
    const id = ++detailReq.current;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    apiFetch(`/detail?id=${encodeURIComponent(detailId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`detail HTTP ${r.status}`))))
      .then((d: Detail) => {
        if (id !== detailReq.current) return;
        setDetail(d);
        setDetailLoading(false);
      })
      .catch(() => {
        if (id !== detailReq.current) return;
        setDetailError('No se pudo cargar la ficha. Reintentá en unos segundos.');
        setDetailLoading(false);
      });
  }, [detailId]);

  const openDetail = (id: string) => setDetailId(id);
  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
  };

  const resetPageOnFilterChange = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  const hasFilters = Boolean(query || author || yearFrom || yearTo || subject || oaOnly || sortNew);

  if (!authUser) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-header">
            <div className="login-brands">
              <span className="brand-chip">CITA</span>
              <span className="brand-chip">IIDYPCA</span>
              <span className="brand-chip">SURUS</span>
            </div>
            <h1>De publicaciones <span className="highlight">a benchmarks</span></h1>
            <p className="login-sub">Plataforma PIDTT-AEC — curación colaborativa de preguntas para modelos de lenguaje</p>
          </div>
          <form onSubmit={handleLogin} className="login-form">
            <h2>Iniciar sesión</h2>
            {authError && <div className="error" role="alert">{authError}</div>}
            <label className="filter">
              <span>Usuario</span>
              <input type="text" className="input login-input" placeholder="Tu usuario" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoFocus />
            </label>
            <label className="filter">
              <span>Contraseña</span>
              <input type="password" className="input login-input" placeholder="Tu contraseña" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} />
            </label>
            <button type="submit" className="btn-generate" disabled={!loginUser || !loginPass}>Entrar</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-brands" aria-label="Instituciones">
          <span className="brand-chip" title="Instituto de Ciencias, Ingenierías y Tecnología Aplicada">CITA</span>
          <span className="brand-chip" title="Instituto de Investigaciones en Energía No Convencional y Fotónico">IIDYPCA</span>
          <span className="brand-chip" title="SURUS (surus.lat)">SURUS</span>
        </div>
        <div className="app-header-inner">
          <h1>
            De publicaciones <span className="highlight">a benchmarks</span>
          </h1>
          <p className="app-subtitle">
            {stats
              ? `${formatNumber(stats.total)} registros del repositorio ri.conicet.gov.ar — ${formatNumber(stats.open_access)} en acceso abierto (${stats.year_min}–${stats.year_max})`
              : 'Conectando con el repositorio…'}
          </p>
          {authUser && (
            <div className="user-menu">
              <span className="user-name" title={authUser.username}>{authUser.display_name}</span>
              <button type="button" className="logout-btn" onClick={handleLogout} title="Cerrar sesión">⏏ Salir</button>
            </div>
          )}
          <button type="button" className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo nocturno'} aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo nocturno'}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* ── Tabs ── */}
        <div className="tabs-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'fuentes'}
            className={`tab-btn${activeTab === 'fuentes' ? ' active' : ''}`}
            onClick={() => setActiveTab('fuentes')}
          >
            <span className="tab-icon">📚</span>
            <span>Fuentes</span>
            <span className="tab-count">{formatNumber(library.length)}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'generacion'}
            className={`tab-btn${activeTab === 'generacion' ? ' active' : ''}`}
            onClick={() => setActiveTab('generacion')}
          >
            <span className="tab-icon">✏️</span>
            <span>Generación</span>
          </button>
        </div>

        {/* ── Tab Fuentes ── */}
        {activeTab === 'fuentes' && (
          <div className="tab-panel">
            <div className="search-bar">
              <input
                type="search"
                className="input search-input"
                placeholder="Buscar por título, autor o materia… (ej.: incendio, radar, supernova)"
                value={query}
                onChange={(e) => resetPageOnFilterChange(() => setQuery(e.target.value))}
                aria-label="Buscar publicaciones"
              />
              <div className="filters">
                <label className="filter">
                  <span>Autor</span>
                  <input
                    type="search"
                    className="input author-input"
                    placeholder="ej.: denham"
                    value={author}
                    onChange={(e) => resetPageOnFilterChange(() => setAuthor(e.target.value))}
                  />
                </label>
                <label className="filter">
                  <span>De</span>
                  <input
                    type="number"
                    className="input year-input"
                    placeholder="año"
                    min={stats?.year_min ?? 1900}
                    max={stats?.year_max ?? 2026}
                    value={yearFrom}
                    onChange={(e) => resetPageOnFilterChange(() => setYearFrom(e.target.value))}
                  />
                </label>
                <label className="filter">
                  <span>Hasta</span>
                  <input
                    type="number"
                    className="input year-input"
                    placeholder="año"
                    min={stats?.year_min ?? 1900}
                    max={stats?.year_max ?? 2026}
                    value={yearTo}
                    onChange={(e) => resetPageOnFilterChange(() => setYearTo(e.target.value))}
                  />
                </label>
                <label className="filter">
                  <span>Materia</span>
                  <select
                    className="input select"
                    value={subject}
                    onChange={(e) => resetPageOnFilterChange(() => setSubject(e.target.value))}
                  >
                    <option value="">Todas</option>
                    {subjects.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({formatNumber(s.count)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter checkbox-filter">
                  <input
                    type="checkbox"
                    checked={oaOnly}
                    onChange={(e) => resetPageOnFilterChange(() => setOaOnly(e.target.checked))}
                  />
                  <span>Solo acceso abierto</span>
                </label>
                <label className="filter checkbox-filter">
                  <input
                    type="checkbox"
                    checked={sortNew}
                    onChange={(e) => resetPageOnFilterChange(() => setSortNew(e.target.checked))}
                  />
                  <span>Más recientes primero</span>
                </label>
                <label className="filter checkbox-filter">
                  <input
                    type="checkbox"
                    checked={libraryOnly}
                    onChange={(e) => resetPageOnFilterChange(() => setLibraryOnly(e.target.checked))}
                  />
                  <span>Solo biblioteca</span>
                </label>
                {hasFilters && (
                  <button
                    type="button"
                    className="clear-btn"
                    onClick={() => {
                      setQuery('');
                      setAuthor('');
                      setYearFrom('');
                      setYearTo('');
                      setSubject('');
                      setOaOnly(false);
                      setSortNew(false);
                      setPage(1);
                    }}
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            </div>

            <div className="layout">
              {/* ── Izquierda: fuentes (resultados filtrados + biblioteca) ── */}
              <aside className="panel panel-sources" aria-label="Fuentes">
                <div className="panel-head">
                  <h2>Publicaciones</h2>
                  <span className="panel-count" aria-live="polite">
                    {data ? `${formatNumber(data.total)}` : '…'}
                  </span>
                </div>

                {relatedLoading && (
                  <div className="related-loading">
                    <div className="qa-spinner small" aria-hidden="true" />
                    <p>Buscando los 10 papers más cercanos en el espacio vectorial…</p>
                  </div>
                )}

                {relatedError && (
                  <div className="related-error" role="alert">
                    {relatedError}
                  </div>
                )}

                <div className="sources-list">
                  {loading && !data && <div className="empty small">Cargando…</div>}
                  {!loading && error && <div className="empty small">Error consultando las publicaciones.</div>}
                  {data && data.results.length === 0 && (
                    <div className="empty small">
                      No se encontraron publicaciones con esos criterios. Probá con otra búsqueda o quitá filtros.
                    </div>
                  )}
                  {data &&
                    data.results.map((r) => (
                      <div key={r.id} className={`source-item${isItemInLibrary(r.id) ? ' in-library' : ''}${r.open_access ? '' : ' no-oa'}`}>
                        <label
                          className="source-check"
                          title={isItemInLibrary(r.id) ? 'Quitar de biblioteca' : 'Agregar a biblioteca'}
                        >
                          <input
                            type="checkbox"
                            checked={isItemInLibrary(r.id)}
                            onChange={() => toggleLibraryItem(r.id)}
                          />
                        </label>
                        <div className="source-body">
                          <button
                            type="button"
                            className="source-title"
                            onClick={() => openDetail(r.id)}
                            title={r.title}
                          >
                            {r.title}
                          </button>
                          <p className="source-meta">
                            {r.creators ? r.creators : 'Sin autores'}
                            {r.date ? ` · ${formatDate(r.date)}` : ''}
                            {r.open_access ? <span className="oa-badge">OA</span> : <span className="no-oa-badge">sin PDF</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
                <div className="sources-foot">
                  {data && (
                    <span>
                      {formatNumber(data.total)} resultado{data.total === 1 ? '' : 's'} · {data.took_ms} ms
                    </span>
                  )}
                  {totalPages > 1 && (
                    <div className="pagination mini">
                      <button
                        type="button"
                        className="page-btn"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        ← Anterior
                      </button>
                      <span className="page-info">{data?.page} / {totalPages}</span>
                      <button
                        type="button"
                        className="page-btn"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Siguiente →
                      </button>
                    </div>
                  )}
                </div>
              </aside>

              {/* ── Panel central: biblioteca + papers relacionados ── */}
              <div className="center-stack">
                {/* ── Biblioteca del usuario ── */}
                <div className="panel panel-library" aria-label="Biblioteca del usuario">
                  <div className="panel-head">
                    <h2>Mi biblioteca</h2>
                    <span className="panel-count" aria-live="polite">
                      {formatNumber(library.length)} ítem{library.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="sources-list">
                    {library.length === 0 && (
                      <div className="empty small">
                        Todavía no tenés publicaciones en tu biblioteca. Buscá y tildá las que quieras incluir.
                      </div>
                    )}
                    {library.length > 0 && (
                      <div className="library-hint">
                        <p>
                          <strong>{formatNumber(library.length)}</strong> publicación{library.length === 1 ? '' : 's'} en tu biblioteca.
                          Las preguntas se generarán a partir de estos papers.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Papers relacionados ── */}
                <button
                  type="button"
                  className="btn-relate"
                  onClick={searchRelated}
                  disabled={relatedLoading || library.length === 0}
                  title="Busca por embeddings los 10 papers más cercanos a tu biblioteca"
                >
                  {relatedLoading ? 'Buscando…' : 'Buscar papers relacionados'}
                </button>

                {related && (
                  <div className="related-section-inline">
                    <div className="related-head">
                      <h3>Papers relacionados</h3>
                      <button
                        type="button"
                        className="clear-btn"
                        onClick={() => setRelated(null)}
                        title="Cerrar resultados de relacionados"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="related-sub">
                      {related.requested > 1
                        ? `Cercanía a ${related.requested} artículos de tu biblioteca · `
                        : 'Cercanía al artículo de tu biblioteca · '}
                      índice de {formatNumber(related.index_size)} papers ·{' '}
                      {Math.round(related.took_ms / 100) / 10} s
                    </p>
                    <p className="related-hint">
                      Tildá los papers que quieras incluir en tu biblioteca.
                    </p>
                    <div className="related-list">
                      {related.results.map((r) => (
                        <div
                          key={r.id}
                          className={`related-item${isItemInLibrary(r.id) ? ' selected' : ''}`}
                        >
                          <label className="related-check" title={isItemInLibrary(r.id) ? 'Quitar de biblioteca' : 'Agregar a biblioteca'}>
                            <input
                              type="checkbox"
                              checked={isItemInLibrary(r.id)}
                              onChange={() => toggleLibraryItem(r.id)}
                              aria-label={`Incluir ${r.title}`}
                            />
                          </label>
                          <div className="related-sim">
                            <span
                              className="related-sim-bar"
                              style={{ width: `${Math.round(r.similarity * 100)}%` }}
                            />
                            <span className="related-sim-label" title="Similitud coseno en el espacio de embeddings">
                              {Math.round(r.similarity * 100)}%
                            </span>
                          </div>
                          <div className="related-body">
                            <button
                              type="button"
                              className="source-title"
                              onClick={() => openDetail(r.id)}
                              title={r.title}
                            >
                              {r.title}
                            </button>
                            <p className="source-meta">
                              {r.creators ? r.creators : 'Sin autores'}
                              {r.date ? ` · ${formatDate(r.date)}` : ''}
                              {r.open_access ? <span className="oa-badge">OA</span> : <span className="no-oa-badge">sin PDF</span>}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab Generación ── */}
        {activeTab === 'generacion' && (
          <div className="tab-panel">
            <div className="layout">
              {/* ── Panel central: generate bar + P&R ── */}
              <div className="center-stack">
                {/* ── Generate bar (config + botón) ── */}
                <div className="generate-bar">
                  {/* Panel de configuración de QAs */}
                  <div className="qa-config">
                    <button type="button" className="qa-config-toggle" onClick={() => setQaConfigOpen(!qaConfigOpen)}>
                      <span className="qa-config-toggle-icon">{qaConfigOpen ? '▾' : '▸'}</span>
                      <span className="qa-config-toggle-label">Configuración</span>
                      <span className="qa-config-toggle-badges">
                        {qaTypes.size > 0 && <span className="qa-badge qa-badge-type">{qaTypes.size} tipo{qaTypes.size > 1 ? 's' : ''}</span>}
                        {qaAxes.size > 0 && <span className="qa-badge qa-badge-axis">{qaAxes.size} eje{qaAxes.size > 1 ? 's' : ''}</span>}
                      </span>
                    </button>
                    {qaConfigOpen && (
                      <div className="qa-config-body">
                        <div className="qa-config-section">
                          <span className="qa-config-label">Tipo de QA</span>
                          <div className="qa-type-grid">
                            {qaTypeOptions.map(t => (
                              <label key={t.id} className={`qa-type-chip${qaTypes.has(t.id) ? ' active' : ''}`}>
                                <input type="checkbox" checked={qaTypes.has(t.id)} onChange={() => toggleQaType(t.id)} />
                                <span className="qa-type-icon">{t.icon}</span>
                                <span className="qa-type-label">{t.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="qa-config-section">
                          <span className="qa-config-label">Ejes cognitivos</span>
                          <div className="qa-axes-grid">
                            {qaAxesOptions.map(ax => (
                              <label key={ax.id} className={`qa-axis-chip${qaAxes.has(ax.id) ? ' active' : ''}`} style={{ '--ax-color': ax.color } as React.CSSProperties}>
                                <input type="checkbox" checked={qaAxes.has(ax.id)} onChange={() => toggleQaAxis(ax.id)} />
                                <span className="qa-axis-dot" style={{ backgroundColor: ax.color }}></span>
                                <span className="qa-axis-label">{ax.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-generate"
                    onClick={generateQa}
                    disabled={qaLoading || library.length === 0}
                    title="Genera 5 preguntas y respuestas a partir de tu biblioteca"
                  >
                    {qaLoading ? 'Generando…' : 'Generar preguntas y respuestas'}
                  </button>
                  <p className="actions-hint">
                    {library.length > 0
                      ? `${formatNumber(library.length)} fuente${library.length === 1 ? '' : 's'} en tu biblioteca`
                      : 'Agregá fuentes a tu biblioteca desde el tab Fuentes para habilitar la generación.'}
                  </p>
                </div>

                {/* ── Centro: chat de preguntas y respuestas ── */}
                <section className="panel panel-chat" aria-label="Preguntas y respuestas">
                  <div className="panel-head">
                    <h2>Preguntas y respuestas</h2>
                    {qa && !qaLoading ? (
                      <button type="button" className="clear-btn" onClick={() => setQa(null)}>
                        Cerrar
                      </button>
                    ) : null}
                  </div>
                  <div className="chat-body" id="qa-section">
                    {(
                      <>
                      {qaLoading && (
                        <div className="qa-loading" role="status">
                          <div className="qa-spinner" aria-hidden="true" />
                          <div className="qa-loading-body">
                            <p className="qa-loading-title">Generando preguntas y respuestas…</p>
                            <ol className="qa-steps">
                              {[
                                { id: 'fulltext', label: 'Preparando textos (PDF → texto completo)' },
                                { id: 'llm', label: 'El modelo escribe los 5 items' },
                                { id: 'lint', label: 'Auto-auditoría del lote' },
                              ].map((st) => {
                                const order = ['resolving', 'fulltext', 'llm', 'lint', 'done'];
                                const cur = qaPhase ? order.indexOf(qaPhase.phase) : -1;
                                const stIdx = order.indexOf(st.id);
                                const cls = stIdx < cur ? 'step-done' : stIdx === cur ? 'step-active' : 'step-todo';
                                return (
                                  <li key={st.id} className={`qa-step ${cls}`}>
                                    <span className="qa-step-mark" aria-hidden="true">
                                      {stIdx < cur ? '✓' : stIdx === cur ? '●' : '○'}
                                    </span>
                                    {st.label}
                                    {stIdx === cur && qaPhase?.detail && (
                                      <span className="qa-step-detail"> — {qaPhase.detail}</span>
                                    )}
                                  </li>
                                );
                              })}
                            </ol>
                            <div className="qa-progress">
                              <div className="qa-progress-bar" style={{ width: `${qaPhase?.pct ?? 0}%` }} />
                            </div>
                            <p className="qa-loading-sub">
                              {qaPhase?.elapsed_s ? `${Math.round(qaPhase.elapsed_s)} s transcurridos` : ''}
                              {' '}· puede tardar entre 1 y 4 minutos (más si hay que descargar PDFs nuevos).
                            </p>
                          </div>
                        </div>
                      )}

                      {qaError && (
                        <div className="error" role="alert">
                          <strong>No se pudieron generar las preguntas:</strong> {qaError}
                        </div>
                      )}

                      {qa && (
                        <div className="chat-turns">
                          <p className="chat-note">
                            {qa.fulltext_count ? (
                              <>Generadas a partir del texto completo de {qa.fulltext_count} de {qa.with_abstract} artículo{qa.with_abstract === 1 ? '' : 's'} (el resto solo abstract)</>
                            ) : (
                              <>Generadas a partir de los resúmenes de {qa.with_abstract} artículo{qa.with_abstract === 1 ? '' : 's'} (sin texto completo disponible)</>
                            )}
                            {qa.requested !== qa.with_abstract ? ` (se seleccionaron ${qa.requested}, los demás no traen resumen)` : ''}{' '}
                            — {Math.round(qa.took_ms / 100) / 10} s
                          </p>
                          {qa.qa.map((item) => {
                            const flags = (qa.lint?.flags || []).filter((f) => f.n === item.n);
                            return (
                              <div className="chat-turn" key={item.n}>
                                <div className={`chat-bubble question${flags.length ? ' flagged' : ''}`}>
                                  <span className="bubble-label">
                                    P{item.n}
                                    {item.cultural_axis && (
                                      <span className={`qa-axis ${AXIS_CLASS[item.cultural_axis] || ''}`}>
                                        {AXIS_LABEL[item.cultural_axis] || item.cultural_axis}
                                      </span>
                                    )}
                                  </span>
                                  <p>{item.question}</p>
                                </div>
                                <div className="chat-bubble answer">
                                  <span className="bubble-label answer-label">R{item.n}</span>
                                  {item.options ? (
                                    // MCQ
                                    <div className="qa-mcq">
                                      {item.options.map((opt: string, i: number) => (
                                        <div key={i} className={`qa-mcq-option${opt.startsWith(item.correct) ? ' correct' : ''}`}>
                                          {opt}
                                        </div>
                                      ))}
                                    </div>
                                  ) : item.scenario ? (
                                    // Scenario
                                    <div className="qa-scenario-block">
                                      <p className="qa-scenario-text">{item.scenario}</p>
                                      <p className="qa-scenario-answer">{item.answer}</p>
                                    </div>
                                  ) : (
                                    // Open-ended
                                    <p>{item.answer}</p>
                                  )}
                                  <QARating
                                    value={ratings[hashKey(item.question)] || 0}
                                    onChange={(v) => setRating(item, v)}
                                  />
                                  {ratings[hashKey(item.question)] > 0 && (
                                    <textarea
                                      className="qa-notes"
                                      placeholder="Agregar una nota…"
                                      value={notes[hashKey(item.question)] || ''}
                                      onChange={(e) => saveNote(hashKey(item.question), e.target.value)}
                                      rows={2}
                                    />
                                  )}
                                  {(item.cite || item.article_ids.length > 0 || item.cultural_axis || flags.length > 0) && (
                                    <div className="qa-collapsible qa-answer-details">
                                      <button
                                        type="button"
                                        className="qa-collapsible-header"
                                        onClick={() => setExpanded((p) => ({ ...p, [`${item.n}-details`]: !p[`${item.n}-details`] }))}
                                        aria-expanded={!!expanded[`${item.n}-details`]}
                                      >
                                        <span className="qa-collapsible-icon">{expanded[`${item.n}-details`] ? '▾' : '▸'}</span>
                                        Detalles {flags.length > 0 && <span style={{color:'var(--gold)',fontWeight:700}}>· {flags.length} flag{flags.length>1?'s':''}</span>}
                                      </button>
                                      {expanded[`${item.n}-details`] && (
                                        <div className="qa-collapsible-body">
                                          {/* Cultural Axis with tooltip */}
                                          {item.cultural_axis && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Dimensión de competencia cultural que evalúa este ítem">🎯</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Eje cultural</span>
                                                <span className="qa-cultural-axis">{CULTURAL_AXIS_LABELS[item.cultural_axis] || item.cultural_axis}</span>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Contextual Background with tooltip */}
                                          {item.contextual_background && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Contexto que debe conocer el evaluador para juzgar la respuesta">📖</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Contexto</span>
                                                <p className="qa-context">{item.contextual_background}</p>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Expected Response Characteristics with tooltip */}
                                          {item.expected_response_characteristics && item.expected_response_characteristics.length > 0 && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Características que debe tener una respuesta culturalmente competente">✅</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Características esperadas</span>
                                                <ul className="qa-expected-list">
                                                  {item.expected_response_characteristics.map((c, i) => <li key={i}>{c}</li>)}
                                                </ul>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Common Failure Modes with tooltip */}
                                          {item.common_failure_modes && item.common_failure_modes.length > 0 && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Errores que revelan incompetencia cultural">⚠️</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Fallas comunes</span>
                                                <ul className="qa-failure-list">
                                                  {item.common_failure_modes.map((f, i) => <li key={i}>{f}</li>)}
                                                </ul>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Evaluator Disagreement with tooltip */}
                                          {item.evaluator_disagreement_note && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Áreas donde evaluadores de distintas culturas podrían discrepar (señal de buen ítem)">💬</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Posible desacuerdo</span>
                                                <p className="qa-disagreement">{item.evaluator_disagreement_note}</p>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Scoring Rubric with tooltip */}
                                          {item.scoring_rubric && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Rúbrica de evaluación del ítem">📊</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Rúbrica</span>
                                                <span className="qa-scoring">{SCORING_RUBRIC_LABELS[item.scoring_rubric] || item.scoring_rubric}</span>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Cite with tooltip */}
                                          {item.cite && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Extracto literal del paper fuente (Ctrl+F verificable)">📝</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Cita</span>
                                                <p className="qa-cite">«{item.cite}»</p>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Sources with tooltip */}
                                          {item.article_ids.length > 0 && (
                                            <div className="qa-detail-row">
                                              <span className="qa-detail-icon" title="Papers fuente en los que se basa el ítem">📚</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-detail-label">Basado en</span>
                                                <p className="qa-sources">
                                                  {item.article_ids.map((aid, idx) => {
                                                    const src = qa.used_articles.find((a) => a.id === aid);
                                                    const label = src ? (
                                                      <a href="#" onClick={(e) => { e.preventDefault(); openDetail(aid); }} title={src.title}>
                                                        {src.title.length > 60 ? src.title.slice(0, 60) + '…' : src.title}
                                                      </a>
                                                    ) : (
                                                      <span>art. {aid}</span>
                                                    );
                                                    return (
                                                      <span key={aid}>
                                                        {idx > 0 && <span className="qa-sources-sep"> · </span>}
                                                        {label}
                                                      </span>
                                                    );
                                                  })}
                                                </p>
                                              </div>
                                            </div>
                                          )}
                                          
                                          {/* Flags */}
                                          {flags.map((f, i) => (
                                            <div className="qa-detail-row flag-row" key={i}>
                                              <span className="qa-detail-icon">⚡</span>
                                              <div className="qa-detail-content">
                                                <span className="qa-flag">{f.detail}</span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {qa.lint && qa.lint.flags.length > 0 && (
                            <div className="qa-lint-note">
                              <strong>{qa.lint.flags.length} item{qa.lint.flags.length === 1 ? '' : 's'} con flag de auto-auditoría</strong>
                              {' — '}{qa.lint.note} (mezcla de ejes: {Object.entries(qa.lint.axis_mix).map(([a, n]) => `${AXIS_LABEL[a] || a} ${n}`).join(' · ')})
                            </div>
                          )}
                        </div>
                      )}

                      {!qa && !qaLoading && !qaError && (
                        <div className="chat-empty">
                          <p>
                            {library.length > 0
                              ? 'Presioná «Generar preguntas y respuestas» para crear 5 ítems a partir de tu biblioteca.'
                              : 'Agregá fuentes a tu biblioteca desde el tab Fuentes y presioná «Generar preguntas y respuestas».'}
                          </p>
                        </div>
                      )}

                    </>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* ── Ficha como modal ── */}
        {detailId && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
            <div className="detail-wrap" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="back-btn" onClick={closeDetail}>
                ← Volver
              </button>
              <DetailPanel
                loading={detailLoading}
                error={detailError}
                detail={detail}
                onFilterSubject={(s) => {
                  closeDetail();
                  setSubject(s);
                  setPage(1);
                }}
              />
            </div>
          </div>
        )}

        {loading && data && <div className="loading" aria-hidden="true" />}
      </main>

      <footer className="app-footer">
        Datos: repositorio ri.conicet.gov.ar (recopilación local del CITECCA, actualizada automáticamente).
        Hacé click en una fuente para abrir su ficha con el resumen y la descarga del PDF desde nuestro
        backup (Hugging Face).
      </footer>
    </div>
  );
}

export default App;
