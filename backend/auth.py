import hashlib, json, os, re, secrets, sqlite3, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import urllib.request

# --- Config ---
AUTH_DB = "/mnt/shared/pidtt-aec/auth.db"
DATA_DIR = "/mnt/shared/conicet-data"
LLM_URL = os.environ.get("LLM_URL", "http://192.168.1.68:8005/v1/chat/completions")
LLM_MODEL = os.environ.get("LLM_MODEL", "citecca-agent")
HOST = "0.0.0.0"
PORT = 8900
TOKEN_TTL = 86400 * 7

_auth_lock = threading.Lock()

def _connect():
    with _auth_lock:
        return sqlite3.connect(AUTH_DB, check_same_thread=False)

def _hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}:{h.hex()}"

def _verify_password(password, stored):
    salt, _ = stored.split(":", 1)
    return secrets.compare_digest(_hash_password(password, salt), stored)

def _password_error(new_password, username=None, old_hash=None):
    """Devuelve None si la clave es valida, sino el motivo del rechazo."""
    p = (new_password or "").strip()
    if len(p) < 8:
        return "la contraseña debe tener al menos 8 caracteres"
    if not any(c.isdigit() for c in p):
        return "la contraseña debe incluir al menos un numero"
    if username and p.lower() == username.lower():
        return "la contraseña no puede ser igual al usuario"
    if old_hash and _verify_password(p, old_hash):
        return "la nueva contraseña no puede ser igual a la anterior"
    return None

def create_user(username, password, display_name, must_change=False):
    db = _connect()
    try:
        db.execute("INSERT INTO users (username, password_hash, display_name, created_at, must_change) VALUES (?, ?, ?, ?, ?)",
                   (username, _hash_password(password), display_name, time.time(), 1 if must_change else 0))
        db.commit()
    except sqlite3.IntegrityError:
        return False
    finally:
        db.close()
    return True

def authenticate(username, password):
    db = _connect()
    row = db.execute("SELECT password_hash, display_name, must_change, role, disabled FROM users WHERE username=?", (username,)).fetchone()
    db.close()
    if not row or not _verify_password(password, row[0]):
        return None
    if row[4]:
        return None  # usuario deshabilitado: no puede iniciar sesión
    token = secrets.token_hex(32)
    now = time.time()
    db = _connect()
    db.execute("INSERT INTO tokens (token, username, created_at, expires_at, must_change) VALUES (?, ?, ?, ?, ?)",
               (token, username, now, now + TOKEN_TTL, row[2]))
    db.execute("DELETE FROM tokens WHERE username=? AND expires_at < ?", (username, now))
    db.commit()
    db.close()
    return token, row[1], row[2], row[3]

def validate_token(token):
    if not token:
        return None
    db = _connect()
    row = db.execute("SELECT username, expires_at, must_change FROM tokens WHERE token=?", (token,)).fetchone()
    db.close()
    if row and row[1] > time.time():
        u = get_user(row[0])
        return row[0], row[2], (u or {}).get("role", "user")
    if row:
        db = _connect()
        db.execute("DELETE FROM tokens WHERE token=?", (token,))
        db.commit()
        db.close()
    return None

def logout(token):
    db = _connect()
    db.execute("DELETE FROM tokens WHERE token=?", (token,))
    db.commit()
    db.close()

def get_user(username):
    db = _connect()
    row = db.execute("SELECT username, display_name, created_at, must_change, role, last_login, disabled FROM users WHERE username=?", (username,)).fetchone()
    db.close()
    if not row:
        return None
    return {
        "username": row[0], "display_name": row[1], "created_at": row[2],
        "must_change": bool(row[3]),
        "role": row[4] if row[4] else "user",
        "last_login": row[5],
        "disabled": bool(row[6]),
    }

def _migrate(db):
    """Agrega columnas nuevas si faltan (DBs viejas)."""
    cols_users = [r[1] for r in db.execute("PRAGMA table_info(users)")]
    if "must_change" not in cols_users:
        db.execute("ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0")
    if "role" not in cols_users:
        db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    if "last_login" not in cols_users:
        db.execute("ALTER TABLE users ADD COLUMN last_login REAL DEFAULT NULL")
    cols_tokens = [r[1] for r in db.execute("PRAGMA table_info(tokens)")]
    if "must_change" not in cols_tokens:
        db.execute("ALTER TABLE tokens ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0")
    if "role" not in cols_tokens:
        db.execute("ALTER TABLE tokens ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    if "disabled" not in cols_users:
        db.execute("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0")
    db.execute("CREATE TABLE IF NOT EXISTS bugs (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, text TEXT NOT NULL, created_at REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open')")
    cols_bugs = [r[1] for r in db.execute("PRAGMA table_info(bugs)")]
    if "status" not in cols_bugs:
        db.execute("ALTER TABLE bugs ADD COLUMN status TEXT NOT NULL DEFAULT 'open'")

def init_db():
    db = _connect()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at REAL NOT NULL, must_change INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL, must_change INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);
    """)
    _migrate(db)
    db.commit()
    db.close()

def require_auth(handler):
    auth_header = handler.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        v = validate_token(auth_header[7:])
        if v:
            u = get_user(v[0])
            if u and u.get("disabled"):
                handler._json({"error": "acceso deshabilitado"}, 403)
                return None
            return v[0]
    handler._json({"error": "no autorizado"}, 401)
    return None

def handle_login(handler):
    clen = int(handler.headers.get("Content-Length") or 0)
    if clen <= 0 or clen > 10000:
        return handler._json({"error": "body invalido"}, 400)
    body = json.loads(handler.rfile.read(clen).decode())
    result = authenticate(body.get("username", ""), body.get("password", ""))
    if not result:
        return handler._json({"error": "credenciales invalidas"}, 401)
    token, display_name, must_change, role = result
    # Registrar último acceso
    db = _connect()
    db.execute("UPDATE users SET last_login=? WHERE username=?", (time.time(), body["username"]))
    db.commit()
    db.close()
    return handler._json({"token": token, "username": body["username"], "display_name": display_name, "must_change": bool(must_change), "role": role})

def handle_password(handler):
    auth_header = handler.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return handler._json({"error": "no autorizado"}, 401)
    v = validate_token(auth_header[7:])
    if not v:
        return handler._json({"error": "no autorizado"}, 401)
    username, must_change, _role = v
    clen = int(handler.headers.get("Content-Length") or 0)
    if clen <= 0 or clen > 10000:
        return handler._json({"error": "body invalido"}, 400)
    body = json.loads(handler.rfile.read(clen).decode())
    db = _connect()
    row = db.execute("SELECT password_hash FROM users WHERE username=?", (username,)).fetchone()
    if not row or not _verify_password(body.get("old_password", ""), row[0]):
        db.close()
        return handler._json({"error": "contraseña actual incorrecta"}, 403)
    err = _password_error(body.get("new_password", ""), username=username, old_hash=row[0])
    if err:
        db.close()
        return handler._json({"error": err}, 400)
    now = time.time()
    db.execute("UPDATE users SET password_hash=?, must_change=0 WHERE username=?", (_hash_password(body["new_password"]), username))
    db.execute("UPDATE tokens SET must_change=0 WHERE username=? AND expires_at > ?", (username, now))
    db.commit()
    db.close()
    return handler._json({"ok": True, "must_change": False})

def handle_bugs(handler):
    """POST /auth/bugs — guarda un reporte de bug (free text)."""
    auth_header = handler.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return handler._json({"error": "no autorizado"}, 401)
    v = validate_token(auth_header[7:])
    if not v:
        return handler._json({"error": "no autorizado"}, 401)
    username = v[0]
    clen = int(handler.headers.get("Content-Length") or 0)
    if clen <= 0 or clen > 10000:
        return handler._json({"error": "body invalido"}, 400)
    body = json.loads(handler.rfile.read(clen).decode())
    text = (body.get("text") or "").strip()
    if not text:
        return handler._json({"error": "el texto está vacío"}, 400)
    db = _connect()
    cur = db.execute("INSERT INTO bugs (username, text, created_at) VALUES (?, ?, ?)", (username, text, time.time()))
    db.commit()
    bug_id = cur.lastrowid
    db.close()
    return handler._json({"ok": True, "id": bug_id})

def handle_logout(handler):
    auth_header = handler.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        logout(auth_header[7:])
    return handler._json({"ok": True})

def handle_me(handler):
    auth_header = handler.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return handler._json({"error": "no autorizado"}, 401)
    v = validate_token(auth_header[7:])
    if not v:
        return handler._json({"error": "no autorizado"}, 401)
    username, must_change, role = v
    user = get_user(username)
    if not user:
        return handler._json({"error": "usuario no encontrado"}, 404)
    user["must_change"] = bool(must_change)
    user["role"] = role
    return handler._json(user)

def require_admin(handler):
    """Devuelve username si es admin, sino responde 403 y devuelve None."""
    auth_header = handler.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return handler._json({"error": "no autorizado"}, 401) or None
    v = validate_token(auth_header[7:])
    if not v:
        return handler._json({"error": "no autorizado"}, 401) or None
    username, _mc, role = v
    if role != "admin":
        return handler._json({"error": "requiere rol admin"}, 403) or None
    return username
