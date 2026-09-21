# PIDTT-AEC — Plataforma de Generación de Benchmarks Culturales

**Proyecto PIDTT (CITES-IDITECCA/UNRN)** — Plataforma para diseñar y validar benchmarks culturales para evaluación de modelos de IA. Genera items con citas verificables, auditoría estática (lint), y pipeline de auto-evaluación ciega.

---

## Arquitectura

```
pidtt-aec/
├── frontend/          # React + Vite (TypeScript) — UI de la plataforma
│   ├── src/           # Código fuente (App.tsx, componentes, estilos)
│   ├── index.html     # Entry point SPA
│   └── vite.config.ts # Configuración de build
│
├── backend/           # Python stdlib HTTP server — API REST
│   ├── conicet-api.py # Endpoints: /auth, /search, /generate-qa, /bench/*
│   └── auth.py        # Módulo de autenticación (SQLite + bcrypt)
│
├── capability/        # Cultural Benchmark Design Capability Package
│   ├── SKILL.md       # Workflow de 8 etapas para diseño de benchmarks
│   ├── TOOLS.md       # Suite de 9 herramientas tipadas
│   ├── BENCHMARK_SCHEMA.json  # Esquema machine-readable de specs
│   ├── TEST_CASES.jsonl       # Dataset de casos (65 tracks)
│   ├── eval_suite/    # Generador de casos de prueba
│   └── tools/         # audit_spec, validate_spec, score_quality, scaffold...
│
├── eval-suite/        # Pipeline de auto-evaluación
│   ├── bench_auto_eval.py     # Runner de evaluación ciega (LLM-judge)
│   └── runs/          # Resultados de corridas anteriores
│
├── deploy/            # Infraestructura de despliegue
│   ├── deploy.sh      # Deploy a contenedores LXC (CT 3101 frontend, CT 9004 backend)
│   ├── setup-lxc.sh   # Creación y configuración de contenedores
│   ├── .env.example   # Template de variables de entorno
│   └── .github/       # CI/CD workflows
│
└── .github/workflows/ # CI para frontend (lint, test, build)
```

---

## Despliegue actual (Producción)

| Servidor | Contenedor | Servicio | Puerto |
|----------|-----------|----------|--------|
| Host Proxmox (fuego) | CT 3101 (pidtt-aec) | Frontend React/Vite + Nginx | 80/443 |
| Host Proxmox (fuego) | CT 9004 (conicet) | Backend API Python | 8900 |
| Host Proxmox (fuego) | CT 9004 (conicet) | conicet-embed.service | interno |
| Host Proxmox (fuego) | CT 9004 (conicet) | conicet-crawl.service | interno |
| Gateway (nginx CT 8001) | — | /pidtt-aec → CT 3101 | 443 |
| Gateway (nginx CT 8001) | — | /conicet/api/bench → CT 9004 | 443 |

---

## Desarrollo local

### Prerrequisitos
- Node.js 20.x (frontend)
- Python 3.11+ (backend)
- SQLite (auth)

### Frontend
```bash
cd frontend
npm install
npm run dev      # Vite dev server en :5173
npm run build    # Build de producción en dist/
```

### Backend
```bash
cd backend
python3 conicet-api.py   # Corre en :8900
```

Variables de entorno (copiar de `backend/.env.example` o `deploy/.env.example`):
- `LLM_URL` — endpoint del modelo (default: http://192.168.1.68:8005/v1/chat/completions)
- `LLM_MODEL` — nombre del modelo (default: citecca-agent)
- `DATA_DIR` — directorio de datos CONICET (default: /mnt/shared/conicet-data)

### Capability (solo referencia/edición)
```bash
cd capability
# Es documentación + herramientas, no requiere build
```

### Eval suite
```bash
cd eval-suite
python3 bench_auto_eval.py --limit 5   # smoke test con 5 casos
```

---

## Endpoints del backend

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/register` | Registro de usuario |
| POST | `/auth/login` | Login + JWT |
| GET | `/stats` | Estadísticas del sistema |
| GET | `/subjects` | Lista de materias/conceptos |
| GET | `/search?q=` | Búsqueda en datos CONICET |
| GET | `/detail/{id}` | Detalle de un paper |
| POST | `/generate-qa` | Genera items de benchmark (async, retorna job ID) |
| GET | `/related` | Papers relacionados |
| GET | `/bench/health` | Health check del módulo benchmark |

---

## Flujo de generación de benchmarks

1. **Selección de papers** — el usuario elige 1-3 papers relacionados
2. **Contrato de diseño** — `/generate-qa` diseña items con:
   - Mezcla de ejes obligatoria: knowledge×2, reasoning×2, critical×1
   - Cita verbatim del abstract (≤15 palabras)
3. **Auto-auditoría estática** — `lint_qa_batch()` valida cada item
4. **Curación experta** — el usuario revisa flags y confirma/rechaza items
5. **Auto-evaluación ciega** — `bench_auto_eval.py` corre los casos contra el LLM-judge

---

## License

Los artículos de CONICET Digital están bajo licencias de sus autores (frecuentemente CC BY-NC 2.5 AR). La plataforma no almacena contenido completo, solo metadatos y abstracts.

---

## Contacto

- **Proyecto**: PIDTT-AEC — CITES-IDITECCA, UNRN
- **Línea**: Capacidad de diseño de benchmarks culturales sin reduccionismo
