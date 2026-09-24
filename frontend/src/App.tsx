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
  used_articles?: { id: string; title: string }[];
  item_total?: number;
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

type AuthUser = { token: string; username: string; display_name: string; must_change?: boolean };

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
const RATINGS_KEY = 'pidtt-aec-qa-ratings-v3';

// Dimensiones de puntuación alineadas con ejes de benchmark cultural
const QUESTION_DIMS = [
  { id: 'especificidad', label: 'Especificidad cultural', hint: '¿El escenario está anclado en un contexto cultural concreto y reconocible?' },
  { id: 'discriminacion', label: 'Poder discriminativo', hint: '¿Diferencia entre respuestas culturalmente competentes e incompetentes?' },
  { id: 'autenticidad', label: 'Autenticidad', hint: '¿Se siente como una situación real, no un ejercicio forzado?' },
  { id: 'demanda', label: 'Demanda cognitiva', hint: '¿Requiere razonamiento cultural (no solo memoria)?' },
] as const;

const ANSWER_DIMS = [
  { id: 'precision', label: 'Precisión cultural', hint: '¿Es exacta y matizada, sin estereotipos?' },
  { id: 'fidelidad', label: 'Fidelidad a la fuente', hint: '¿Refleja fielmente el contenido del paper?' },
  { id: 'complejidad', label: 'Complejidad', hint: '¿Captura la complejidad del tema cultural?' },
  { id: 'equidad', label: 'Equidad', hint: '¿Es justa con distintas perspectivas culturales?' },
] as const;

type RatingDims = readonly number[];

interface RatingEntry {
  q: RatingDims; // pregunta: [claridad, especificidad, originalidad, utilidad]
  a: RatingDims; // respuesta: [fidelidad, completitud, precision, utilidad]
}

const emptyRating = (): RatingEntry => ({
  q: [0, 0, 0, 0],
  a: [0, 0, 0, 0],
});

// Clave estable por P&R: hash de la pregunta (djb2). Si un P&R se regenera
// con la misma pregunta, su puntuacion anterior se conserva.
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'q' + h.toString(16);
}

// Etiqueta descriptiva de cada puntuacion (1-7, matizado)
const RATING_LABELS: Record<number, string> = {
  0: 'sin puntuar',
  1: 'muy malo',
  2: 'malo',
  3: 'por debajo',
  4: 'regular',
  5: 'bueno',
  6: 'muy bueno',
  7: 'excelente',
};

function QARating({ value, onChange, dimensions }: { value: number[]; onChange: (v: number[]) => void; dimensions: readonly { id: string; label: string; hint: string }[] }) {
  return (
    <div className="qa-rating">
      <span className="qa-rating-label">Tu puntuación:</span>
      <div className="qa-rating-pips" role="radiogroup" aria-label="Puntuar de 1 a 7">
        {dimensions.map((dim, dimIdx) => (
          <div key={dim.id} className="qa-rating-dim">
            <span className="qa-rating-dim-label" title={dim.hint}>
              {dim.label}
            </span>
            <div className="qa-rating-pips-row">
              {[1, 2, 3, 4, 5, 6, 7].map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={value[dimIdx] === p}
                  aria-label={`${p} — ${RATING_LABELS[p]}`}
                  title={`${dim.label}: ${p} — ${RATING_LABELS[p]}`}
                  className={`pip${p <= (value[dimIdx] || 0) ? ' on' : ''}${value[dimIdx] === p ? ' sel' : ''}`}
                  onClick={() => {
                    const next = [...value];
                    next[dimIdx] = p;
                    onChange(next);
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className={`qa-rating-current${value.some(v => v > 0) ? '' : ' muted'}`}>
        {value.some(v => v > 0) ? dimensions.map((d, i) => `${d.label}: ${RATING_LABELS[value[i]] || '—'}`).join(' · ') : 'sin puntuar'}
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
      apiFetch('/auth/me').then(r => r.ok ? r.json() : Promise.reject())
        .then(d => { const u = { ...a, must_change: !!d.must_change }; setAuth(u); setAuthUser(u); })
        .catch(() => { clearAuth(); setAuthUser(null); });
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const r = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: loginUser, password: loginPass }) });
      if (!r.ok) throw new Error('Credenciales inválidas');
      const data = await r.json();
      const u = { token: data.token, username: data.username, display_name: data.display_name, must_change: !!data.must_change };
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

  // ==== Cambio forzado de contraseña (primer login) ====
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (pwNew !== pwConfirm) { setPwError('La nueva contraseña no coincide'); return; }
    try {
      const r = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ old_password: pwCurrent, new_password: pwNew }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo cambiar la contraseña');
      const u = { ...(authUser as AuthUser), must_change: false };
      setAuth(u);
      setAuthUser(u);
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
    } catch (e2) {
      setPwError(e2 instanceof Error ? e2.message : 'No se pudo cambiar la contraseña');
    }
  };

  // ==== Modal "Avisar bug" ====
  const [bugOpen, setBugOpen] = useState(false);
  const [bugText, setBugText] = useState('');
  const [bugError, setBugError] = useState('');
  const [bugSent, setBugSent] = useState(false);

  const openBugModal = () => { setBugOpen(true); setBugText(''); setBugError(''); setBugSent(false); };
  const closeBugModal = () => setBugOpen(false);

  const handleBugSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBugError('');
    try {
      const r = await apiFetch('/auth/bugs', { method: 'POST', body: JSON.stringify({ text: bugText }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo enviar el reporte');
      setBugSent(true);
      setBugText('');
    } catch (e2) {
      setBugError(e2 instanceof Error ? e2.message : 'No se pudo enviar el reporte');
    }
  };

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

  // Tabs: "fuentes" | "generacion" | "chat"
  const [activeTab, setActiveTab] = useState<'fuentes' | 'generacion' | 'chat'>('fuentes');

  // Chat state
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'assistant'; content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');
    setChatLoading(true);
    setChatMessages(prev => [...prev, { role: 'user', content: text }]);
    try {
      const r = await apiFetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const d = await r.json();
      if (r.ok && d.reply) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: d.reply }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: d.error || 'Error del modelo' }]);
      }
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: e instanceof Error ? e.message : 'Error de conexión' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Filtros de QAs por eje/tipo
  const [qaFilterAxes, setQaFilterAxes] = useState<Set<string>>(new Set());
  const [qaFilterTypes, setQaFilterTypes] = useState<Set<string>>(new Set());

  // Preview inline (sidebar)
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Edición inline de preguntas/respuestas
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null);
  const [editingAnswer, setEditingAnswer] = useState<number | null>(null);
  const [regeneratingQuestion, setRegeneratingQuestion] = useState<number | null>(null);
  const [regeneratingAnswer, setRegeneratingAnswer] = useState<number | null>(null);
  const [regeneratePrompt, setRegeneratePrompt] = useState<Record<number, string>>({});
  const [regeneratingLoading, setRegeneratingLoading] = useState<number | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  // Regenerar pregunta individual (llama al backend que reenvía al LLM)
  const regenerateQuestion = async (n: number, instruction: string) => {
    if (!qa) return;
    const item = qa.qa.find(q => q.n === n);
    if (!item) return;
    setRegeneratingLoading(n);
    try {
      const r = await apiFetch('/regenerate-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n,
          type: 'question',
          instruction,
          original: item.question,
          axis: item.cultural_axis,
        }),
      });
      const d = await r.json();
      if (r.ok && d.data?.question) {
        setQa(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            qa: prev.qa.map(q => q.n === n ? { ...q, question: d.data.question } : q),
          };
        });
        clearDecisionFor(n); // pregunta nueva → decisión anterior no aplica
      } else if (d.error) {
        setRegenerateError(`Pregunta ${n}: ${d.error}`);
      }
    } catch (e) {
      setRegenerateError(`Pregunta ${n}: ${e instanceof Error ? e.message : 'error de red'}`);
    } finally {
      setRegeneratingLoading(null);
      setRegeneratingQuestion(null);
    }
  };

  // Regenerar respuesta individual (llama al backend que reenvía al LLM)
  const regenerateAnswer = async (n: number, instruction: string) => {
    if (!qa) return;
    const item = qa.qa.find(q => q.n === n);
    if (!item) return;
    setRegeneratingLoading(n);
    try {
      const r = await apiFetch('/regenerate-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n,
          type: 'answer',
          instruction,
          original_question: item.question,
          original: item.answer || item.options?.join(' | ') || '',
          axis: item.cultural_axis,
        }),
      });
      const d = await r.json();
      if (r.ok && d.data) {
        setQa(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            qa: prev.qa.map(q => {
              if (q.n !== n) return q;
              const updated = { ...q };
              if (d.data.answer !== undefined) updated.answer = d.data.answer;
              if (d.data.options !== undefined) updated.options = d.data.options;
              if (d.data.correct !== undefined) updated.correct = d.data.correct;
              if (d.data.scenario !== undefined) updated.scenario = d.data.scenario;
              return updated;
            }),
          };
        });
        clearDecisionFor(n); // respuesta nueva → decisión anterior no aplica
      } else if (d.error) {
        setRegenerateError(`Respuesta ${n}: ${d.error}`);
      }
    } catch (e) {
      setRegenerateError(`Respuesta ${n}: ${e instanceof Error ? e.message : 'error de red'}`);
    } finally {
      setRegeneratingLoading(null);
      setRegeneratingAnswer(null);
    }
  };

  // Guardar pregunta editada
  const saveQuestion = (n: number) => {
    setEditingQuestion(null);
  };

  // Guardar respuesta editada
  const saveAnswer = (n: number) => {
    setEditingAnswer(null);
  };

  // Actualizar pregunta en estado local (si cambia el texto, la decisión ya no aplica)
  const updateQuestion = (n: number, text: string) => {
    const item = qa?.qa.find((q) => q.n === n);
    if (!item) return;
    const key = hashKey(item.question);
    if (item.question !== text && qaDecisions[key] && qaDecisionQ[key] === item.question) {
      clearDecisionLocal(key);
    }
    setQa(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        qa: prev.qa.map(q => q.n === n ? { ...q, question: text } : q),
      };
    });
  };

  // Actualizar respuesta en estado local (si cambia el texto, la decisión ya no aplica)
  const updateAnswer = (n: number, text: string) => {
    const item = qa?.qa.find((q) => q.n === n);
    if (!item) return;
    const key = hashKey(item.question);
    if ((item.answer || '') !== text && qaDecisions[key]) {
      clearDecisionLocal(key);
    }
    setQa(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        qa: prev.qa.map(q => q.n === n ? { ...q, answer: text } : q),
      };
    });
  };

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
  // Cantidad de ítems por lote (3/5/8)
  const [qaCount, setQaCount] = useState(5);
  // Vistas del panel central: 'lote' (generación actual) | 'guardadas' (colección)
  const [qaView, setQaView] = useState<'lote' | 'guardadas'>('lote');
  // Subconjunto de fuentes para la generación (vacío = toda la biblioteca)
  const [genSources, setGenSources] = useState<Set<string>>(new Set());
  // Puntaje 1-7 plegado por ítem ('Ver puntaje')
  const [qaRatingOpen, setQaRatingOpen] = useState<Record<number, boolean>>({});
  // ts del último lote restaurado de una sesión anterior (banner informativo)
  const [qaRestored, setQaRestored] = useState<number | null>(null);
  // Descripciones de la configuración (ejes y tipos) visibles sin hover
  const [qaHelpOpen, setQaHelpOpen] = useState(false);
  const qaTypeHints: Record<string, string> = {
    'open-ended': 'Respuesta libre: el evaluado formula su respuesta y se la juzga por contenido.',
    mcq: 'Opción múltiple: 4 alternativas y una correcta.',
    scenario: 'Escenario situado: el ítem trae un contexto narrado + pregunta + respuesta esperada.',
  };
  const qaAxesOptions = [
    { id: 'escenario', label: 'Escenario', color: '#4a90d9' },
    { id: 'critica', label: 'Crítica', color: '#d9534f' },
    { id: 'adaptacion', label: 'Adaptación', color: '#f0ad4e' },
    { id: 'dato', label: 'Dato cultural', color: '#7b68ee' },
    { id: 'razonamiento', label: 'Razonamiento', color: '#5cb85c' },
    { id: 'valores', label: 'Valores', color: '#e83e8c' },
  ];
  const qaAxisHints: Record<string, string> = {
    escenario: 'Pregunta basada en una situación concreta (museo, aula, debate) que el evaluado debe resolver.',
    critica: 'Pregunta que pide analizar limitaciones, sesgos o contradicciones de un planteo cultural.',
    adaptacion: 'Pregunta sobre cómo adaptar una práctica o mensaje a un contexto cultural distinto.',
    dato: 'Pregunta que evalúa conocimiento específico sobre un hecho o práctica cultural.',
    razonamiento: 'Pregunta que requiere inferir, comparar o argumentar sobre dinámicas culturales.',
    valores: 'Pregunta que explora tensiones entre valores culturales o éticos en un escenario.',
  };
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
  const toggleQaFilterAxis = (ax: string) => setQaFilterAxes(prev => {
    const next = new Set(prev);
    if (next.has(ax)) next.delete(ax); else next.add(ax);
    return next;
  });
  const toggleQaFilterType = (t: string) => setQaFilterTypes(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });
  const pollRef = useRef<number | undefined>(undefined);
  const qaTimeoutRef = useRef<number | undefined>(undefined);

  // QAs filtrados por eje/tipo
  const filteredQa = qa ? {
    ...qa,
    qa: qa.qa.filter(item => {
      if (qaFilterAxes.size > 0 && !qaFilterAxes.has(item.cultural_axis)) return false;
      if (qaFilterTypes.size > 0) {
        const itemType = item.options ? 'mcq' : item.scenario ? 'scenario' : 'open-ended';
        if (!qaFilterTypes.has(itemType)) return false;
      }
      return true;
    }),
  } : null;

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

  // Puntuaciones por P&R: { [hash]: { q: [4 dims], a: [4 dims] } }
  const [ratings, setRatings] = useState<Record<string, RatingEntry>>(() => {
    try {
      return JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const setRating = (item: QA, qDims: number[], aDims: number[]) => {
    const key = hashKey(item.question);
    setRatings((prev) => {
      const next = { ...prev, [key]: { q: qDims, a: aDims } };
      try { localStorage.setItem(RATINGS_KEY, JSON.stringify(next)); } catch { /* full/private mode */ }
      return next;
    });
  };

  // Decisiones aprobar/descartar por P&R, por usuario (sincronizadas con el
  // backend: /qa-store). Clave = hash de la pregunta (djb2).
  const [qaDecisions, setQaDecisions] = useState<Record<string, 'approved' | 'rejected'>>({});
  // Pregunta tal como se guardó en el store (para saber si un edit la invalida).
  const [qaDecisionQ, setQaDecisionQ] = useState<Record<string, string>>({});
  const [qaDecisionBusy, setQaDecisionBusy] = useState<string | null>(null);
  // P&R guardadas del usuario (aprobadas y descartadas), para el panel "Guardadas".
  const [qaSaved, setQaSaved] = useState<{ key: string; d: 'approved' | 'rejected'; q: string; a: string; options?: string[]; correct?: string; scenario?: string; cultural_axis?: string; cite?: string; article_ids?: string[]; ts?: number }[]>([]);

  const loadQaStore = async () => {
    if (!authUser) { setQaDecisions({}); setQaDecisionQ({}); setQaSaved([]); return; }
    try {
      const r = await apiFetch('/qa-store');
      const d = await r.json();
      if (r.ok) {
        const m: Record<string, 'approved' | 'rejected'> = {};
        const qm: Record<string, string> = {};
        const items = d.items || [];
        for (const it of items) {
          if (it.d === 'approved' || it.d === 'rejected') {
            m[it.key] = it.d;
            qm[it.key] = it.q || '';
          }
        }
        setQaDecisions(m);
        setQaDecisionQ(qm);
        setQaSaved(items);
      }
    } catch { setQaDecisions({}); setQaDecisionQ({}); setQaSaved([]); }
  };

  // Restaurar el último lote generado (para retomar la curación). Solo si no hay
  // ningún lote en memoria todavía.
  const loadQaBatch = async () => {
    if (!authUser) return;
    try {
      const r = await apiFetch('/qa-batch');
      const d = await r.json();
      if (r.ok && d.batch && d.batch.result && Array.isArray(d.batch.result.qa) && d.batch.result.qa.length > 0) {
        setQa(prev => (prev ? prev : (d.batch.result as QAResult)));
        setQaRestored(d.batch.ts || null);
      }
    } catch { /* sin batch guardado */ }
  };

  const clearDecisionLocal = async (key: string) => {
    setQaDecisions((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setQaDecisionQ((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await apiFetch('/qa-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', key }),
    }).catch(() => { /* ignore */ });
    refreshQaSaved();
  };

  const setDecision = async (n: number, decision: 'approved' | 'rejected') => {
    if (!qa || !authUser) return;
    const item = qa.qa.find((q) => q.n === n);
    if (!item) return;
    await setDecisionByKey(hashKey(item.question), decision, {
      question: item.question,
      answer: item.answer || '',
      options: item.options || [],
      correct: item.correct || '',
      scenario: item.scenario || '',
      cultural_axis: item.cultural_axis || '',
      cite: item.cite || '',
      article_ids: item.article_ids || [],
    });
  };

  // Si la pregunta se edita o regenera, la clave cambia y la decisión anterior
  // deja de aplicar: se borra del store del usuario.
  const clearDecisionFor = (n: number) => {
    if (!qa) return;
    const item = qa.qa.find((q) => q.n === n);
    if (!item) return;
    const key = hashKey(item.question);
    if (qaDecisions[key]) clearDecisionLocal(key);
  };

  // P&R guardadas del usuario (aprobadas y descartadas), para el panel
  // "Guardadas" de la pestaña Generación.
  const refreshQaSaved = async () => {
    if (!authUser) { setQaSaved([]); return; }
    try {
      const r = await apiFetch('/qa-store');
      const d = await r.json();
      if (r.ok) {
        setQaSaved((d.items || []).filter((it: { d: string }) => it.d === 'approved' || it.d === 'rejected'));
      }
    } catch { setQaSaved([]); }
  };

  const setDecisionByKey = async (
    key: string,
    decision: 'approved' | 'rejected',
    item: { question: string; answer: string; options?: string[]; correct?: string; scenario?: string; cultural_axis?: string; cite?: string; article_ids?: string[] },
  ) => {
    if (!authUser) return;
    const current = qaDecisions[key];
    const action: 'approve' | 'reject' | 'clear' =
      current === decision ? 'clear' : decision === 'approved' ? 'approve' : 'reject';
    if (action === 'clear') {
      clearDecisionLocal(key);
      refreshQaSaved();
      return;
    }
    setQaDecisionBusy(key);
    setQaDecisions((prev) => ({ ...prev, [key]: decision }));
    setQaDecisionQ((prev) => ({ ...prev, [key]: item.question }));
    try {
      const r = await apiFetch('/qa-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, key, item }),
      });
      const d = await r.json();
      if (!r.ok) {
        setQaDecisions((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setQaDecisionQ((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        alert(d.error || 'Error al guardar la decisión');
      }
    } catch {
      setQaDecisions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setQaDecisionQ((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } finally {
      setQaDecisionBusy(null);
      refreshQaSaved();
    }
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
    loadQaStore();
    loadQaBatch();
    setQaRestored(null);
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
    setRegenerateError(null);
    if (error) setQaError(error);
    if (result) {
      setQa(result);
      requestAnimationFrame(() => {
        document.getElementById('qa-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  // último payload de generación guardado para poder reintentar sin rearmar nada
  const lastGenPayload = useRef<Record<string, unknown> | null>(null);

  const generateQa = async (payloadOverride?: Record<string, unknown>) => {
    closeDetail();
    setQaLoading(true);
    setQaError(null);
    setQa(null);
    setQaPhase({ phase: 'resolving', detail: 'Preparando la generación…', pct: 1, elapsed_s: 0 });
    try {
      // Usar biblioteca del usuario como fuentes (o el subconjunto marcado).
      // Guardia: payloadOverride solo vale si parece un payload real (nunca un
      // evento sintético de React, que traria referencias ciclicas).
      const validOverride = payloadOverride && typeof payloadOverride === 'object'
        && ('library' in payloadOverride || 'count' in payloadOverride);
      const subset = [...genSources];
      const payload: Record<string, unknown> = validOverride ? { ...payloadOverride } : {
        library: true,
        count: qaCount,
        axes: [...qaAxes],
        qa_types: [...qaTypes],
      };
      // Si el usuario marcó un subconjunto de fuentes, pasa los ids explicitos
      if (!validOverride && subset.length > 0) payload.ids = subset;
      lastGenPayload.current = payload;

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
          setQaPhase({ phase: s.phase, detail: s.detail || '', pct: s.pct || 0, elapsed_s: s.elapsed_s || 0, used_articles: s.used_articles, item_total: s.item_total });
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

  // Reintentar la generación con el último payload (no hace falta rearmar nada)
  const retryGenerate = () => {
    const p = lastGenPayload.current;
    if (!p) return;
    generateQa(p);
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

  if (authUser && authUser.must_change) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-header">
            <div className="login-brands">
              <span className="brand-chip">CITA</span>
              <span className="brand-chip">IIDYPCA</span>
              <span className="brand-chip">SURUS</span>
            </div>
            <h1>Primera vez aquí</h1>
            <p className="login-sub">Hola {authUser.display_name}, antes de entrar tenés que cambiar tu contraseña.</p>
          </div>
          <form onSubmit={handlePasswordChange} className="login-form">
            <h2>Cambiar contraseña</h2>
            {pwError && <div className="error" role="alert">{pwError}</div>}
            <p className="pw-hint">Mínimo 8 caracteres y al menos un número. No puede ser igual a tu usuario ni a la anterior.</p>
            <label className="filter">
              <span>Contraseña actual</span>
              <input type="password" className="input login-input" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoFocus />
            </label>
            <label className="filter">
              <span>Nueva contraseña</span>
              <input type="password" className="input login-input" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            </label>
            <label className="filter">
              <span>Repetir nueva contraseña</span>
              <input type="password" className="input login-input" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} />
            </label>
            <button type="submit" className="btn-generate" disabled={!pwCurrent || !pwNew || !pwConfirm}>Cambiar contraseña</button>
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
              <button type="button" className="bug-btn" onClick={openBugModal} title="Reportar un problema">🐞 Avisar bug</button>
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
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <span className="tab-icon">💬</span>
            <span>Chat</span>
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
                <button
                  type="button"
                  className={`library-toggle${libraryOnly ? ' active' : ''}`}
                  onClick={() => resetPageOnFilterChange(() => setLibraryOnly(!libraryOnly))}
                  title="Mostrar solo publicaciones de tu biblioteca"
                >
                  <span className="toggle-icon">📚</span>
                  <span>{libraryOnly ? 'Mostrando biblioteca' : 'Solo biblioteca'}</span>
                </button>
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

            <div className="layout-sources">
              {/* ── Columna izquierda: resultados ── */}
              <div className="sources-col">
                <div className="panel panel-sources" aria-label="Resultados de búsqueda">
                  <div className="panel-head">
                    <h2>Resultados</h2>
                    <span className="panel-count" aria-live="polite">
                      {data ? `${formatNumber(data.total)}` : '…'}
                    </span>
                  </div>

                  <div className="sources-list">
                    {loading && !data && <div className="empty small">Cargando…</div>}
                    {!loading && error && <div className="empty small">Error consultando las publicaciones.</div>}
                    {data && data.results.length === 0 && (
                      <div className="empty small">
                        {libraryOnly
                          ? 'Tu biblioteca no tiene publicaciones que coincidan con estos filtros. Agregá más papers o ajustá los filtros.'
                          : 'No se encontraron publicaciones con esos criterios. Probá con otra búsqueda o quitá filtros.'}
                      </div>
                    )}
                    {data &&
                      data.results.map((r) => (
                        <div
                          key={r.id}
                          className={`source-item${isItemInLibrary(r.id) ? ' in-library' : ''}${r.open_access ? '' : ' no-oa'}`}
                          onClick={() => setPreviewId(previewId === r.id ? null : r.id)}
                        >
                          <label
                            className="source-check"
                            title={isItemInLibrary(r.id) ? 'Quitar de biblioteca' : 'Agregar a biblioteca'}
                            onClick={(e) => e.stopPropagation()}
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
                              onClick={(e) => { e.stopPropagation(); openDetail(r.id); }}
                              title={r.title}
                            >
                              {r.title}
                            </button>
                            <p className="source-meta">
                              <span className="creators">{r.creators ? r.creators : 'Sin autores'}</span>
                              {r.date ? <span className="date"> · {formatDate(r.date)}</span> : ''}
                              {r.open_access ? <span className="oa-badge">OA</span> : <span className="no-oa-badge">sin PDF</span>}
                              {isItemInLibrary(r.id) && <span className="lib-badge">en biblioteca</span>}
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
                </div>
              </div>

              {/* ── Columna derecha: biblioteca + preview ── */}
              <div className="sources-sidebar">
                {/* ── Biblioteca del usuario ── */}
                <div className="panel panel-library" aria-label="Biblioteca del usuario">
                  <div className="panel-head">
                    <h2>Mi biblioteca</h2>
                    <span className="panel-count">{formatNumber(library.length)}</span>
                  </div>
                  <div className="library-body">
                    {library.length === 0 ? (
                      <div className="library-empty">
                        <span className="library-empty-icon">📚</span>
                        <p>Todavía no tenés publicaciones en tu biblioteca.</p>
                        <p>Buscá y tildá las que quieras incluir.</p>
                      </div>
                    ) : (
                      <>
                        <div className="library-stats">
                          <div className="library-stat">
                            <span className="library-stat-value">{formatNumber(library.length)}</span>
                            <span className="library-stat-label">papeles</span>
                          </div>
                          <div className="library-stat">
                            <span className="library-stat-value">{formatNumber(data?.total ?? 0)}</span>
                            <span className="library-stat-label">visibles</span>
                          </div>
                        </div>
                        <div className="library-list">
                          {library.slice(0, 8).map((id) => {
                            const doc = data?.results.find(r => r.id === id);
                            return (
                              <div key={id} className="library-item">
                                <span className="library-item-title" title={doc?.title || id}>
                                  {doc?.title || id}
                                </span>
                                <button
                                  type="button"
                                  className="library-item-remove"
                                  onClick={() => toggleLibraryItem(id)}
                                  title="Quitar de biblioteca"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                          {library.length > 8 && (
                            <div className="library-item" style={{ justifyContent: 'center', color: 'var(--ink-muted)', fontSize: '0.75rem' }}>
                              +{library.length - 8} más…
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Preview inline ── */}
                {previewId && (() => {
                  const doc = data?.results.find(r => r.id === previewId);
                  if (!doc) return null;
                  return (
                    <div className="preview-panel" aria-label="Vista previa">
                      <div className="panel-head">
                        <h2>Vista previa</h2>
                        <button type="button" className="clear-btn" onClick={() => setPreviewId(null)}>×</button>
                      </div>
                      <div className="preview-body">
                        <h3 className="preview-title">{doc.title}</h3>
                        <div className="preview-meta">
                          <span className="preview-badge">
                            {doc.creators ? doc.creators.split(',')[0] : 'Sin autor'}
                            {doc.creators && doc.creators.split(',').length > 1 && ' et al.'}
                          </span>
                          {doc.date && <span className="preview-badge">{formatDate(doc.date)}</span>}
                          {doc.open_access ? <span className="preview-badge oa">OA</span> : <span className="preview-badge no-oa">sin PDF</span>}
                          {isItemInLibrary(doc.id) && <span className="preview-badge lib">en biblioteca</span>}
                        </div>
                        {doc.description && <p className="preview-desc">{doc.description.slice(0, 200)}…</p>}
                        <div className="preview-actions">
                          <button
                            type="button"
                            className="preview-btn primary"
                            onClick={() => toggleLibraryItem(doc.id)}
                          >
                            {isItemInLibrary(doc.id) ? 'Quitar de biblioteca' : 'Agregar a biblioteca'}
                          </button>
                          <button
                            type="button"
                            className="preview-btn"
                            onClick={() => openDetail(doc.id)}
                          >
                            Ver ficha completa
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Papers relacionados ── */}
                <button
                  type="button"
                  className="btn-relate"
                  onClick={searchRelated}
                  disabled={relatedLoading || library.length === 0}
                  title="Busca por embeddings los 10 papers más cercanos a tu biblioteca"
                >
                  {relatedLoading ? 'Buscando…' : 'buscar papers relacionados'}
                </button>

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
                              onClick={() => { setPreviewId(r.id); openDetail(r.id); }}
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
            <div className="layout-generate">
              {/* ── Sidebar: config + fuentes ── */}
              <div className="generate-col">
                {/* ── Configuración ── */}
                <div className="qa-config-panel">
                  <div className="panel-head">
                    <h2>Configuración</h2>
                    <div className="panel-head-actions">
                      <span className="panel-count">{qaTypes.size + qaAxes.size} opts</span>
                      <button
                        type="button"
                        className="panel-help-btn"
                        onClick={() => setQaHelpOpen(!qaHelpOpen)}
                        title="¿Qué significan los tipos y los ejes?"
                        aria-expanded={qaHelpOpen}
                      >
                        ?
                      </button>
                    </div>
                  </div>
                  <div className="qa-config-body">
                    {qaHelpOpen && (
                      <div className="qa-help">
                        <p className="qa-help-title">Tipos de ítem</p>
                        <ul className="qa-help-list">
                          {qaTypeOptions.map(t => (
                            <li key={t.id}><strong>{t.label}:</strong> {qaTypeHints[t.id]}</li>
                          ))}
                        </ul>
                        <p className="qa-help-title">Ejes cognitivos</p>
                        <ul className="qa-help-list">
                          {qaAxesOptions.map(ax => (
                            <li key={ax.id}>
                              <span className="qa-axis-dot" style={{ backgroundColor: ax.color }}></span>
                              <strong>{ax.label}:</strong> {qaAxisHints[ax.id]}
                            </li>
                          ))}
                        </ul>
                        <p className="qa-help-note">
                          Marcá los tipos y ejes que querés en el próximo lote. Con más de un tipo, el
                          lote se mezcla distribuyendo los formatos entre los ítems.
                        </p>
                      </div>
                    )}
                    <div className="qa-config-section">
                      <span className="qa-config-label">Tipo de QA</span>
                      <div className="qa-type-grid">
                        {qaTypeOptions.map(t => (
                          <label key={t.id} className={`qa-type-chip${qaTypes.has(t.id) ? ' active' : ''}`} onClick={() => toggleQaType(t.id)}>
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
                          <label key={ax.id} className={`qa-axis-chip${qaAxes.has(ax.id) ? ' active' : ''}`} style={{ '--ax-color': ax.color } as React.CSSProperties} onClick={() => toggleQaAxis(ax.id)} title={qaAxisHints[ax.id]}>
                            <span className="qa-axis-dot" style={{ backgroundColor: ax.color }}></span>
                            <span className="qa-axis-label">{ax.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="qa-config-section">
                      <span className="qa-config-label">Cantidad de ítems</span>
                      <div className="qa-count-row">
                        {[3, 5, 8].map(c => (
                          <button
                            key={c}
                            type="button"
                            className={`qa-count-btn${qaCount === c ? ' active' : ''}`}
                            onClick={() => setQaCount(c)}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Fuentes seleccionadas ── */}
                <div className="sources-selected-panel">
                  <div className="panel-head">
                    <h2>Fuentes</h2>
                    <div className="panel-head-actions">
                      <span className="panel-count">{formatNumber(library.length)}</span>
                      {genSources.size > 0 && (
                        <button
                          type="button"
                          className="panel-head-link"
                          onClick={() => setGenSources(new Set())}
                          title="Quitar selección: generar con toda la biblioteca"
                        >
                          Todo ({library.length})
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="sources-selected-body">
                    {library.length === 0 ? (
                      <div className="sources-selected-empty">
                        <p>Sin fuentes en tu biblioteca.</p>
                        <p><a href="#" onClick={(e) => { e.preventDefault(); setActiveTab('fuentes'); }}>Agregar desde Fuentes →</a></p>
                      </div>
                    ) : (
                      <>
                        <p className="sources-hint">
                          {genSources.size > 0
                            ? `${genSources.size} marcadas para este lote — las demás no se usan.`
                            : 'Sin selección: se usa toda la biblioteca.'}
                        </p>
                        <div className="sources-selected-list">
                          {library.slice(0, 12).map((id) => {
                            const doc = data?.results.find(r => r.id === id);
                            const marked = genSources.has(id);
                            return (
                              <span
                                key={id}
                                className={`source-tag${marked ? ' marked' : ''}`}
                                title={doc?.title || id}
                                onClick={() => setGenSources(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                              >
                                <span className="source-tag-check" aria-hidden="true">{marked ? '✓' : ''}</span>
                                <span className="source-tag-title">{doc?.title || id}</span>
                                <button
                                  type="button"
                                  className="source-tag-remove"
                                  title="Quitar de la biblioteca"
                                  onClick={(e) => { e.stopPropagation(); toggleLibraryItem(id); }}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                          {library.length > 12 && (
                            <span className="source-tag" style={{ color: 'var(--ink-muted)' }}>
                              +{library.length - 12} más…
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Botón generar ── */}
                <button
                  type="button"
                  className="btn-generate"
                  onClick={() => generateQa()}
                  disabled={qaLoading || library.length === 0}
                  title={`Genera ${qaCount} preguntas y respuestas a partir de ${genSources.size > 0 ? genSources.size : library.length} fuente(s)`}
                >
                  {qaLoading ? 'Generando…' : `Generar ${qaCount} preguntas y respuestas`}
                </button>
                <p className="actions-hint" style={{ textAlign: 'center', margin: 0, fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                  {library.length > 0
                    ? `${genSources.size > 0 ? genSources.size : library.length} fuente(s) · ${qaTypes.size} tipo(s) · ${qaAxes.size} eje(s)`
                    : 'Agregá fuentes a tu biblioteca para habilitar la generación.'}
                </p>
              </div>

              {/* ── Panel central: QAs ── */}
              <div className="center-stack">
                {/* ── Segmentado: Lote actual | Mis guardadas ── */}
                <div className="qa-view-tabs" role="tablist" aria-label="Vista del panel de generación">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={qaView === 'lote'}
                    className={`qa-view-tab${qaView === 'lote' ? ' active' : ''}`}
                    onClick={() => setQaView('lote')}
                  >
                    📝 Lote actual{qa ? ` (${qa.qa.length})` : ''}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={qaView === 'guardadas'}
                    className={`qa-view-tab${qaView === 'guardadas' ? ' active' : ''}`}
                    onClick={() => setQaView('guardadas')}
                  >
                    🗂 Mis guardadas ({qaSaved.length})
                  </button>
                </div>

                {qaView === 'lote' ? (
                  <>
                {/* ── Barra de progreso de curación ── */}
                {qa && !qaLoading && (() => {
                  const total = qa.qa.length;
                  const appr = qa.qa.filter((i) => qaDecisions[hashKey(i.question)] === 'approved').length;
                  const rej = qa.qa.filter((i) => qaDecisions[hashKey(i.question)] === 'rejected').length;
                  const decided = appr + rej;
                  return (
                    <div className="qa-curation-bar" role="status">
                      <span className="qa-curation-label">Curación del lote:</span>
                      <span className="qa-curation-pct">{decided}/{total}</span>
                      <div className="qa-curation-track" aria-hidden="true">
                        <div className="qa-curation-fill approved" style={{ width: `${total ? (appr / total) * 100 : 0}%` }} />
                        <div className="qa-curation-fill rejected" style={{ width: `${total ? (rej / total) * 100 : 0}%` }} />
                      </div>
                      <span className="qa-curation-counts">{appr} ✓ · {rej} ✕</span>
                      <span className="qa-curation-sep">·</span>
                      <span className="qa-curation-label">Colección:</span>
                      <span className="qa-curation-counts">
                        {qaSaved.filter((s) => s.d === 'approved').length} ✓ · {qaSaved.filter((s) => s.d === 'rejected').length} ✕
                      </span>
                    </div>
                  );
                })()}

                {/* ── Banner: lote restaurado de sesión anterior ── */}
                {qaRestored && qa && !qaLoading && (
                  <div className="qa-restored-banner" role="status">
                    🕘 Retomando un lote generado el{' '}
                    {new Date(qaRestored * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}.
                    Tus decisiones se mantuvieron; podés seguir curando o generar uno nuevo.
                  </div>
                )}

                {/* ── Filtros de QAs ── */}
                {filteredQa && filteredQa.qa.length > 0 && (
                  <div className="qa-filters">
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', alignSelf: 'center' }}>Filtrar:</span>
                    {qaAxesOptions.map(ax => (
                      <button
                        key={ax.id}
                        type="button"
                        className={`qa-filter-chip${qaFilterAxes.has(ax.id) ? ' active' : ''}`}
                        onClick={() => toggleQaFilterAxis(ax.id)}
                      >
                        <span className="qa-filter-dot" style={{ backgroundColor: ax.color }}></span>
                        {ax.label}
                      </button>
                    ))}
                    <span style={{ width: '1px', background: 'var(--line)', margin: '0 0.2rem' }}></span>
                    {qaTypeOptions.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className={`qa-filter-chip${qaFilterTypes.has(t.id) ? ' active' : ''}`}
                        onClick={() => toggleQaFilterType(t.id)}
                      >
                        {t.icon} {t.label}
                      </button>
                    ))}
                    {(qaFilterAxes.size > 0 || qaFilterTypes.size > 0) && (
                      <button
                        type="button"
                        className="qa-filter-chip"
                        onClick={() => { setQaFilterAxes(new Set()); setQaFilterTypes(new Set()); }}
                        style={{ color: 'var(--danger)' }}
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                )}

                {/* ── Loading ── */}
                {qaLoading && (
                  <div className="qa-loading" role="status">
                    <div className="qa-spinner" aria-hidden="true" />
                    <div className="qa-loading-body">
                      <p className="qa-loading-title">Generando {qaPhase?.item_total || qaCount} preguntas y respuestas…</p>
                      {qaPhase?.used_articles && qaPhase.used_articles.length > 0 && (
                        <p className="qa-loading-papers" title={qaPhase.used_articles.map((a) => a.title).join('\n')}>
                          📚 {qaPhase.used_articles.length} fuente(s) · primera: «{qaPhase.used_articles[0].title}»
                        </p>
                      )}
                      <ol className="qa-steps">
                        {[
                          { id: 'fulltext', label: 'Preparando textos (PDF → texto completo)' },
                          { id: 'llm', label: `El modelo escribe los ${qaPhase?.item_total || qaCount} items` },
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

                {/* ── Error ── */}
                {regenerateError && (
                  <div className="error" role="alert">
                    <strong>No se pudo regenerar:</strong> {regenerateError}
                    <button className="btn-link" onClick={() => setRegenerateError(null)}>
                      cerrar
                    </button>
                  </div>
                )}
                {qaError && (
                  <div className="error" role="alert">
                    <strong>No se pudieron generar las preguntas:</strong> {qaError}
                    {lastGenPayload.current && (
                      <>
                        <div className="qa-retry-hint">
                          El servicio LLM pudo haber estado ocupado o con error temporal.
                          Probá de nuevo, sin volver a armar la consulta.
                        </div>
                        <button
                          className="btn btn-primary"
                          onClick={retryGenerate}
                          disabled={qaLoading}
                        >
                          ↻ Reintentar con las mismas fuentes
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* ── QAs generados ── */}
                {filteredQa && filteredQa.qa.length > 0 && (
                  <section className="panel panel-chat" aria-label="Preguntas y respuestas">
                    <div className="panel-head">
                      <h2>Preguntas y respuestas</h2>
                      <button type="button" className="clear-btn" onClick={() => setQa(null)}>Cerrar</button>
                    </div>
                    <div className="chat-body" id="qa-section">
                      <div className="chat-turns">
                        <p className="chat-note">
                          {filteredQa.fulltext_count ? (
                            <>Generadas a partir del texto completo de {filteredQa.fulltext_count} de {filteredQa.with_abstract} artículo{filteredQa.with_abstract === 1 ? '' : 's'} (el resto solo abstract)</>
                          ) : (
                            <>Generadas a partir de los resúmenes de {filteredQa.with_abstract} artículo{filteredQa.with_abstract === 1 ? '' : 's'} (sin texto completo disponible)</>
                          )}
                          {filteredQa.requested !== filteredQa.with_abstract ? ` (se seleccionaron ${filteredQa.requested}, los demás no traen resumen)` : ''}{' '}
                          — {Math.round(filteredQa.took_ms / 100) / 10} s
                          {(qaFilterAxes.size > 0 || qaFilterTypes.size > 0) && ` · mostrando ${filteredQa.qa.length} de ${qa.qa.length}`}
                        </p>
                        {filteredQa.qa.map((item) => {
                          const flags = (filteredQa.lint?.flags || []).filter((f) => f.n === item.n);
                          const itemType = item.options ? 'mcq' : item.scenario ? 'scenario' : 'open-ended';
                          const decision = qaDecisions[hashKey(item.question)];
                          return (
                            <div className="chat-turn" key={item.n}>
                              <div className={`chat-bubble question${flags.length ? ' flagged' : ''}`}>
                                <div className="bubble-header">
                                  <span className="bubble-label">
                                    P{item.n}
                                    {decision && (
                                      <span className={`qa-decision-badge ${decision}`}>
                                        {decision === 'approved' ? '✓ Aprobada' : '✕ Descartada'}
                                      </span>
                                    )}
                                    {item.cultural_axis && (
                                      <span className={`qa-axis-badge ${AXIS_CLASS[item.cultural_axis] || ''}`}>
                                        {AXIS_LABEL[item.cultural_axis] || item.cultural_axis}
                                      </span>
                                    )}
                                    <span className="qa-type-badge">{itemType}</span>
                                  </span>
                                  <div className="bubble-actions">
                                    <button
                                      type="button"
                                      className="bubble-btn edit"
                                      onClick={() => setEditingQuestion(editingQuestion === item.n ? null : item.n)}
                                      title="Editar pregunta"
                                    >
                                      ✎
                                    </button>
                                    <button
                                      type="button"
                                      className="bubble-btn regenerate"
                                      onClick={() => setRegeneratingQuestion(regeneratingQuestion === item.n ? null : item.n)}
                                      title="Regenerar pregunta"
                                    >
                                      ⟳
                                    </button>
                                  </div>
                                </div>
                                {editingQuestion === item.n ? (
                                  <div className="bubble-edit">
                                    <textarea
                                      className="bubble-edit-input"
                                      value={item.question}
                                      onChange={(e) => updateQuestion(item.n, e.target.value)}
                                      rows={3}
                                    />
                                    <div className="bubble-edit-actions">
                                      <button
                                        type="button"
                                        className="bubble-edit-save"
                                        onClick={() => saveQuestion(item.n)}
                                      >
                                        Guardar
                                      </button>
                                      <button
                                        type="button"
                                        className="bubble-edit-cancel"
                                        onClick={() => setEditingQuestion(null)}
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <p>{item.question}</p>
                                )}
                                {qaRatingOpen[item.n] && (
                                  <QARating
                                    value={ratings[hashKey(item.question)]?.q || [0, 0, 0, 0]}
                                    onChange={(v) => setRating(item, v, ratings[hashKey(item.question)]?.a || [0, 0, 0, 0])}
                                    dimensions={QUESTION_DIMS}
                                  />
                                )}
                                {regeneratingQuestion === item.n && (
                                  <div className="regenerate-panel">
                                    <p className="regenerate-hint">
                                      Instrucciones para regenerar esta pregunta (opcional):
                                    </p>
                                    <textarea
                                      className="regenerate-input"
                                      placeholder="Ej: Enfocarme más en la adaptación cultural, evitar mencionar museos, usar un escenario de gestión de emergencias…"
                                      rows={3}
                                      value={regeneratePrompt[item.n] || ''}
                                      onChange={(e) => setRegeneratePrompt(prev => ({ ...prev, [item.n]: e.target.value }))}
                                    />
                                    <button
                                      type="button"
                                      className="regenerate-btn"
                                      onClick={() => regenerateQuestion(item.n, regeneratePrompt[item.n] || '')}
                                      disabled={regeneratingLoading === item.n}
                                    >
                                      {regeneratingLoading === item.n ? 'Regenerando…' : 'Regenerar pregunta'}
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className={`chat-bubble answer${decision ? ` decided-${decision}` : ''}`}>
                                <div className="bubble-header">
                                  <span className="bubble-label answer-label">R{item.n}</span>
                                  <div className="bubble-actions">
                                    <button
                                      type="button"
                                      className="bubble-btn edit"
                                      onClick={() => setEditingAnswer(editingAnswer === item.n ? null : item.n)}
                                      title="Editar respuesta"
                                    >
                                      ✎
                                    </button>
                                    <button
                                      type="button"
                                      className="bubble-btn regenerate"
                                      onClick={() => setRegeneratingAnswer(regeneratingAnswer === item.n ? null : item.n)}
                                      title="Regenerar respuesta"
                                    >
                                      ⟳
                                    </button>
                                  </div>
                                </div>
                                {editingAnswer === item.n ? (
                                  <div className="bubble-edit">
                                    <textarea
                                      className="bubble-edit-input"
                                      value={item.answer || ''}
                                      onChange={(e) => updateAnswer(item.n, e.target.value)}
                                      rows={4}
                                    />
                                    <div className="bubble-edit-actions">
                                      <button
                                        type="button"
                                        className="bubble-edit-save"
                                        onClick={() => saveAnswer(item.n)}
                                      >
                                        Guardar
                                      </button>
                                      <button
                                        type="button"
                                        className="bubble-edit-cancel"
                                        onClick={() => setEditingAnswer(null)}
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : item.options ? (
                                  <div className="qa-mcq">
                                    {item.options.map((opt: string, i: number) => (
                                      <div key={i} className={`qa-mcq-option${opt.startsWith(item.correct) ? ' correct' : ''}`}>
                                        {opt}
                                      </div>
                                    ))}
                                  </div>
                                ) : item.scenario ? (
                                  <div className="qa-scenario-block">
                                    <p className="qa-scenario-text">{item.scenario}</p>
                                    <p className="qa-scenario-answer">{item.answer}</p>
                                  </div>
                                ) : (
                                  <p>{item.answer}</p>
                                )}
                                {regeneratingAnswer === item.n && (
                                  <div className="regenerate-panel">
                                    <p className="regenerate-hint">
                                      Instrucciones para regenerar esta respuesta (opcional):
                                    </p>
                                    <textarea
                                      className="regenerate-input"
                                      placeholder="Ej: Hacerla más específica, usar un ejemplo concreto del paper, evitar generalidades…"
                                      rows={3}
                                      value={regeneratePrompt[`a${item.n}`] || ''}
                                      onChange={(e) => setRegeneratePrompt(prev => ({ ...prev, [`a${item.n}`]: e.target.value }))}
                                    />
                                    <button
                                      type="button"
                                      className="regenerate-btn"
                                      onClick={() => regenerateAnswer(item.n, regeneratePrompt[`a${item.n}`] || '')}
                                      disabled={regeneratingLoading === item.n}
                                    >
                                      {regeneratingLoading === item.n ? 'Regenerando…' : 'Regenerar respuesta'}
                                    </button>
                                  </div>
                                )}
                                {/* ── Decisión: acción principal al final del par ── */}
                                <div className={`qa-decision-block${decision ? ` has-${decision}` : ''}`}>
                                  <span className="qa-decision-label">
                                    {decision === 'approved' ? '✓ Aprobada' : decision === 'rejected' ? '✕ Descartada' : 'Decidí esta P&R:'}
                                  </span>
                                  <div className="qa-decision-btns">
                                    <button
                                      type="button"
                                      className={`qa-decision-btn approve${decision === 'approved' ? ' active' : ''}`}
                                      onClick={() => setDecision(item.n, 'approved')}
                                      disabled={qaDecisionBusy === hashKey(item.question)}
                                      title={decision === 'approved' ? 'Aprobada — clic para desmarcar' : 'Aprobar y guardar esta P&R en tu colección'}
                                    >
                                      ✓ Aprobar
                                    </button>
                                    <button
                                      type="button"
                                      className={`qa-decision-btn reject${decision === 'rejected' ? ' active' : ''}`}
                                      onClick={() => setDecision(item.n, 'rejected')}
                                      disabled={qaDecisionBusy === hashKey(item.question)}
                                      title={decision === 'rejected' ? 'Descartada — clic para desmarcar' : 'Descartar esta P&R'}
                                    >
                                      ✕ Descartar
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="qa-rating-toggle"
                                    onClick={() => setQaRatingOpen(prev => ({ ...prev, [item.n]: !prev[item.n] }))}
                                    aria-expanded={!!qaRatingOpen[item.n]}
                                    title="Puntuar en detalle (1-7 por dimensión)"
                                  >
                                    {qaRatingOpen[item.n] ? '▾ Ocultar puntaje' : '▸ Ver puntaje'}
                                  </button>
                                </div>
                                {qaRatingOpen[item.n] && (
                                  <QARating
                                    value={ratings[hashKey(item.question)]?.a || [0, 0, 0, 0]}
                                    onChange={(v) => setRating(item, ratings[hashKey(item.question)]?.q || [0, 0, 0, 0], v)}
                                    dimensions={ANSWER_DIMS}
                                  />
                                )}
                                {(ratings[hashKey(item.question)]?.q?.some(v => v > 0) || ratings[hashKey(item.question)]?.a?.some(v => v > 0)) && (
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
                                        {item.cultural_axis && (
                                          <div className="qa-detail-row">
                                            <span className="qa-detail-icon" title="Dimensión de competencia cultural que evalúa este ítem">🎯</span>
                                            <div className="qa-detail-content">
                                              <span className="qa-detail-label">Eje cultural</span>
                                              <span className="qa-cultural-axis">{CULTURAL_AXIS_LABELS[item.cultural_axis] || item.cultural_axis}</span>
                                            </div>
                                          </div>
                                        )}
                                        {item.contextual_background && (
                                          <div className="qa-detail-row">
                                            <span className="qa-detail-icon" title="Contexto que debe conocer el evaluador para juzgar la respuesta">📖</span>
                                            <div className="qa-detail-content">
                                              <span className="qa-detail-label">Contexto</span>
                                              <p className="qa-context">{item.contextual_background}</p>
                                            </div>
                                          </div>
                                        )}
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
                                        {item.evaluator_disagreement_note && (
                                          <div className="qa-detail-row">
                                            <span className="qa-detail-icon" title="Áreas donde evaluadores de distintas culturas podrían discrepar (señal de buen ítem)">💬</span>
                                            <div className="qa-detail-content">
                                              <span className="qa-detail-label">Posible desacuerdo</span>
                                              <p className="qa-disagreement">{item.evaluator_disagreement_note}</p>
                                            </div>
                                          </div>
                                        )}
                                        {item.scoring_rubric && (
                                          <div className="qa-detail-row">
                                            <span className="qa-detail-icon" title="Rúbrica de evaluación del ítem">📊</span>
                                            <div className="qa-detail-content">
                                              <span className="qa-detail-label">Rúbrica</span>
                                              <span className="qa-scoring">{SCORING_RUBRIC_LABELS[item.scoring_rubric] || item.scoring_rubric}</span>
                                            </div>
                                          </div>
                                        )}
                                        {item.cite && (
                                          <div className="qa-detail-row">
                                            <span className="qa-detail-icon" title="Extracto literal del paper fuente (Ctrl+F verificable)">📝</span>
                                            <div className="qa-detail-content">
                                              <span className="qa-detail-label">Cita</span>
                                              <p className="qa-cite">«{item.cite}»</p>
                                            </div>
                                          </div>
                                        )}
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
                        {filteredQa.lint && filteredQa.lint.flags.length > 0 && (
                          <div className="qa-lint-note">
                            <strong>{filteredQa.lint.flags.length} item{filteredQa.lint.flags.length === 1 ? '' : 's'} con flag de auto-auditoría</strong>
                            {' — '}{filteredQa.lint.note} (mezcla de ejes: {Object.entries(filteredQa.lint.axis_mix).map(([a, n]) => `${AXIS_LABEL[a] || a} ${n}`).join(' · ')})
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {/* ── Empty state ── */}
                {!qa && !qaLoading && !qaError && (
                  <div className="chat-empty">
                    <p>
                      {library.length > 0
                        ? `Presioná «Generar ${qaCount} preguntas y respuestas» para crear ${qaCount} ítems a partir de tu biblioteca.`
                        : 'Agregá fuentes a tu biblioteca desde el tab Fuentes y presioná «Generar preguntas y respuestas».'}
                    </p>
                    {library.length === 0 && (
                      <button type="button" className="preview-btn primary" onClick={() => setActiveTab('fuentes')} style={{ marginTop: '0.75rem' }}>
                        Ir a Fuentes →
                      </button>
                    )}
                  </div>
                )}
                </>
                ) : (
                  /* ── Vista: Mis guardadas (colección del usuario) ── */
                  <section className="panel panel-saved" aria-label="Preguntas y respuestas guardadas">
                    <div className="panel-head">
                      <h2>Mis guardadas ({qaSaved.length})</h2>
                      <div className="panel-head-actions">
                        <span className="panel-count">
                          {qaSaved.filter((s) => s.d === 'approved').length} ✓ · {qaSaved.filter((s) => s.d === 'rejected').length} ✕
                        </span>
                        <button
                          type="button"
                          className="panel-head-link"
                          onClick={() => setQaView('lote')}
                          title="Volver al lote actual"
                        >
                          ← Volver al lote
                        </button>
                      </div>
                    </div>
                    {qaSaved.length === 0 ? (
                      <div className="chat-empty" style={{ padding: '1rem' }}>
                        <p>Aún no guardaste ninguna P&R.</p>
                        <p>Aprobá o descartá un par del lote actual y quedará acá para siempre.</p>
                      </div>
                    ) : (
                      <div className="saved-list">
                        {qaSaved.map((s) => (
                          <div key={s.key} className={`saved-item ${s.d}`}>
                            <div className="saved-item-head">
                              <span className={`qa-decision-badge ${s.d}`}>
                                {s.d === 'approved' ? '✓ Aprobada' : '✕ Descartada'}
                              </span>
                              {s.cultural_axis && (
                                <span className="qa-type-badge">{s.cultural_axis}</span>
                              )}
                              <div className="bubble-actions">
                                <button
                                  type="button"
                                  className={`bubble-btn decision-approve${s.d === 'approved' ? ' active' : ''}`}
                                  onClick={() => setDecisionByKey(s.key, 'approved', {
                                    question: s.q, answer: s.a, options: s.options, correct: s.correct,
                                    scenario: s.scenario, cultural_axis: s.cultural_axis, cite: s.cite, article_ids: s.article_ids,
                                  })}
                                  disabled={qaDecisionBusy === s.key}
                                  title={s.d === 'approved' ? 'Aprobada — clic para desmarcar' : 'Aprobar y guardar esta P&R'}
                                >
                                  ✓ Aprobar
                                </button>
                                <button
                                  type="button"
                                  className={`bubble-btn decision-reject${s.d === 'rejected' ? ' active' : ''}`}
                                  onClick={() => setDecisionByKey(s.key, 'rejected', {
                                    question: s.q, answer: s.a, options: s.options, correct: s.correct,
                                    scenario: s.scenario, cultural_axis: s.cultural_axis, cite: s.cite, article_ids: s.article_ids,
                                  })}
                                  disabled={qaDecisionBusy === s.key}
                                  title={s.d === 'rejected' ? 'Descartada — clic para desmarcar' : 'Descartar esta P&R'}
                                >
                                  ✕ Descartar
                                </button>
                              </div>
                            </div>
                            <p className="saved-question">{s.q}</p>
                            {s.options && s.options.length > 0 ? (
                              <div className="qa-mcq compact">
                                {s.options.map((opt: string, i: number) => (
                                  <div key={i} className={`qa-mcq-option${opt.startsWith(s.correct || '') ? ' correct' : ''}`}>
                                    {opt}
                                  </div>
                                ))}
                              </div>
                            ) : s.scenario ? (
                              <div className="qa-scenario-block">
                                <p className="qa-scenario-text">{s.scenario}</p>
                                <p className="qa-scenario-answer">{s.a}</p>
                              </div>
                            ) : (
                              <p className="saved-answer">{s.a}</p>
                            )}
                            <p className="saved-date">
                              {s.ts ? new Date(s.ts * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab Chat ── */}
        {activeTab === 'chat' && (
          <div className="tab-panel">
            <div className="chat-panel">
              <div className="chat-messages">
                {chatMessages.length === 0 && (
                  <div className="chat-empty">
                    <p>Chat directo con el modelo. Sin system prompt, sin contexto de papers.</p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`chat-msg ${msg.role}`}>
                    <span className="chat-msg-label">{msg.role === 'user' ? 'Vos' : 'Modelo'}</span>
                    <p>{msg.content}</p>
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-msg assistant">
                    <span className="chat-msg-label">Modelo</span>
                    <p className="chat-loading-dot">…</p>
                  </div>
                )}
              </div>
              <div className="chat-input-row">
                <textarea
                  className="chat-input"
                  placeholder="Escribí tu mensaje…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                  rows={2}
                  disabled={chatLoading}
                />
                <button
                  type="button"
                  className="chat-send-btn"
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  {chatLoading ? '…' : 'Enviar'}
                </button>
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

      {bugOpen && (
        <div className="modal-overlay" onClick={closeBugModal} role="dialog" aria-modal="true" aria-label="Avisar un bug">
          <div className="bug-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="bug-close" onClick={closeBugModal} aria-label="Cerrar">✕</button>
            <h2>🐞 Avisar un bug</h2>
            {bugSent ? (
              <div className="bug-success" role="status">
                ✅ ¡Gracias! Tu reporte quedó guardado.
                <div className="bug-success-actions">
                  <button type="button" className="btn-generate" onClick={closeBugModal}>Cerrar</button>
                </div>
              </div>
            ) : (
              <>
                <p className="bug-hint">Contanos qué pasó: qué estabas haciendo, qué esperabas y qué ocurrió. Se envía anónimo (solo se guarda tu usuario interno).</p>
                {bugError && <div className="error" role="alert">{bugError}</div>}
                <form onSubmit={handleBugSubmit} className="bug-form">
                  <textarea
                    className="input bug-textarea"
                    placeholder="Describí el problema…"
                    rows={6}
                    value={bugText}
                    onChange={(e) => setBugText(e.target.value)}
                    autoFocus
                  />
                  <div className="bug-actions">
                    <button type="button" className="logout-btn" onClick={closeBugModal}>Cancelar</button>
                    <button type="submit" className="btn-generate" disabled={!bugText.trim()}>Enviar</button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
