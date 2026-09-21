import hashlib, json, os, re, secrets, sqlite3, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import urllib.request

# --- Config ---
AUTH_DB = "/mnt/shared/pidtt-aec/auth.db"
DATA_DIR = "/mnt/shared/conicet-data"
LLM_URL = "http://192.168.1.68:8005/v1/chat/completions"
LLM_MODEL = "citecca-agent"
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

def create_user(username, password, display_name):
    db = _connect()
    try:
        db.execute("INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
                   (username, _hash_password(password), display_name, time.time()))
        db.commit()
    except sqlite3.IntegrityError:
        return False
    finally:
        db.close()
    return True

def authenticate(username, password):
    db = _connect()
    row = db.execute("SELECT password_hash, display_name FROM users WHERE username=?", (username,)).fetchone()
    db.close()
    if not row or not _verify_password(password, row[0]):
        return None
    token = secrets.token_hex(32)
    now = time.time()
    db = _connect()
    db.execute("INSERT INTO tokens (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)",
               (token, username, now, now + TOKEN_TTL))
    db.execute("DELETE FROM tokens WHERE username=? AND expires_at < ?", (username, now))
    db.commit()
    db.close()
    return token, row[1]

def validate_token(token):
    if not token:
        return None
    db = _connect()
    row = db.execute("SELECT username, expires_at FROM tokens WHERE token=?", (token,)).fetchone()
    db.close()
    if row and row[1] > time.time():
        return row[0]
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
    row = db.execute("SELECT username, display_name, created_at FROM users WHERE username=?", (username,)).fetchone()
    db.close()
    return {"username": row[0], "display_name": row[1], "created_at": row[2]} if row else None

def init_db():
    db = _connect()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);
    """)
    db.commit()
    db.close()

def require_auth(handler):
    auth_header = handler.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        username = validate_token(auth_header[7:])
        if username:
            return username
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
    token, display_name = result
    return handler._json({"token": token, "username": body["username"], "display_name": display_name})

def handle_logout(handler):
    auth_header = handler.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        logout(auth_header[7:])
    return handler._json({"ok": True})

def handle_me(handler):
    username = require_auth(handler)
    if not username:
        return None
    user = get_user(username)
    if not user:
        return handler._json({"error": "usuario no encontrado"}, 404)
    return handler._json(user)
