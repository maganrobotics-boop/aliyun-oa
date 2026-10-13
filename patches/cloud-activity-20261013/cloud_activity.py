"""Cloud activity only: persistent visits and a read-only OA statistics endpoint."""
import hashlib
import hmac
import json
import logging
import math
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlsplit

COOKIE = '__Secure-omindos-activity'
WINDOWS = {'24h': 86400, '3d': 259200, '7d': 604800}
LOCK = threading.RLock()
LOG = logging.getLogger(__name__)


class ActivityStore:
    def __init__(self, root, token, now=None):
        self.path = Path(root) / 'cloud-activity.sqlite3'
        self.token = token.strip()
        if not re.fullmatch(r'[a-f0-9]{64}', self.token):
            raise ValueError('Invalid Cloud activity service key')
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value REAL NOT NULL)')
            db.execute('INSERT OR IGNORE INTO metadata VALUES (?,?)', ('started', time.time() if now is None else now))
            db.execute('''CREATE TABLE IF NOT EXISTS visits (
                id INTEGER PRIMARY KEY, actor TEXT NOT NULL, kind TEXT NOT NULL,
                name TEXT NOT NULL, started REAL NOT NULL, seen REAL NOT NULL)''')
            db.execute('CREATE INDEX IF NOT EXISTS visits_actor_seen ON visits(actor, seen DESC)')
            db.execute('CREATE INDEX IF NOT EXISTS visits_seen ON visits(seen)')
        self.path.chmod(0o600)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=3)
        db.row_factory = sqlite3.Row
        return db

    def touch(self, uid, name, guest, now=None):
        now = time.time() if now is None else now
        kind = 'account' if uid else 'guest'
        identity = uid if uid else guest
        actor = kind + ':' + hmac.new(self.token.encode(), identity.encode(), hashlib.sha256).hexdigest()
        name = name if uid else '游客浏览器 ' + actor[-8:]
        with LOCK, self.connect() as db:
            latest = db.execute('SELECT id,seen FROM visits WHERE actor=? ORDER BY seen DESC LIMIT 1', (actor,)).fetchone()
            if latest and now - latest['seen'] < 1800:
                db.execute('UPDATE visits SET seen=?,name=? WHERE id=?', (now, name, latest['id']))
            else:
                db.execute('INSERT INTO visits(actor,kind,name,started,seen) VALUES (?,?,?,?,?)', (actor, kind, name, now, now))
            db.execute('DELETE FROM visits WHERE seen<?', (now - 90 * 86400,))

    def dashboard(self, params, now=None):
        if set(params) - {'window', 'kind', 'q', 'sort', 'page'} or any(len(v) != 1 for v in params.values()):
            raise ValueError('Invalid filters')
        values = {k: v[0] for k, v in params.items()}
        window = values.get('window', '24h')
        kind = values.get('kind', 'all')
        sort = values.get('sort', 'recent')
        q = values.get('q', '').strip()
        page_text = values.get('page', '1')
        if window not in WINDOWS or kind not in ('all', 'account', 'guest') or sort not in ('recent', 'visits') or len(q) > 100 or not re.fullmatch(r'[1-9][0-9]{0,4}', page_text):
            raise ValueError('Invalid filters')
        page = int(page_text)
        now = time.time() if now is None else now
        cutoff = now - WINDOWS[window]
        with self.connect() as db:
            started = db.execute("SELECT value FROM metadata WHERE key='started'").fetchone()[0]
            counts = {k: {'accounts': 0, 'guests': 0} for k in WINDOWS}
            for key, duration in WINDOWS.items():
                for row in db.execute('SELECT kind,COUNT(DISTINCT actor) AS n FROM visits WHERE seen>=? AND seen<=? GROUP BY kind', (now-duration, now)):
                    counts[key]['accounts' if row['kind'] == 'account' else 'guests'] = row['n']
            args = (cutoff, now, kind, kind, q.lower())
            where = "seen>=? AND seen<=? AND (?='all' OR kind=?) AND instr(lower(name),?)>0"
            total = db.execute('SELECT COUNT(DISTINCT actor) FROM visits WHERE ' + where, args).fetchone()[0]
            order = 'visits DESC,lastSeen DESC,actor' if sort == 'visits' else 'lastSeen DESC,actor'
            rows = db.execute('''SELECT actor AS id,kind,MAX(name) AS displayName,
                MIN(started)*1000 AS firstSeen,MAX(seen)*1000 AS lastSeen,COUNT(*) AS visits
                FROM visits WHERE ''' + where + ' GROUP BY actor,kind ORDER BY ' + order + ' LIMIT 20 OFFSET ?', (*args, (page-1)*20)).fetchall()
        return {'source': 'cloud', 'asOf': int(now*1000), 'trackingStartedAt': int(started*1000),
                'window': window, 'summary': {'onlineCounts': counts}, 'records': [dict(r) for r in rows],
                'pagination': {'page': page, 'total': total, 'totalPages': max(1, math.ceil(total/20))}}


def configure(root):
    global STORE
    STORE = ActivityStore(root, (Path(root) / 'cloud-activity.key').read_text())


def record(handler):
    """Called for a successful workbench GET or same-origin foreground heartbeat."""
    uid = handler.identity()
    cookie = handler.cookies().get(COOKIE)
    guest = cookie.value if cookie and re.fullmatch(r'[a-f0-9]{32}', cookie.value) else secrets.token_hex(16)
    handler.activity_cookie = guest
    name = 'Cloud 管理账户'
    if uid and uid != 'legacy':
        import cloud_services
        with cloud_services.connect() as db:
            user = db.execute('SELECT name FROM users WHERE id=?', (uid,)).fetchone()
        if not user:
            return
        name = user['name']
    STORE.touch(uid, name, guest)


def record_safely(handler):
    try:
        record(handler)
    except Exception:
        # Observability must never interrupt the robot workspace.
        LOG.exception('Cloud activity write failed')


def handle_get(handler):
    if urlsplit(handler.path).path != '/v1/oa-activity':
        return False
    supplied = handler.headers.get('Authorization', '').encode()
    if not hmac.compare_digest(supplied, ('Bearer ' + STORE.token).encode()):
        handler.respond(401, {'error': 'Unauthorized'})
        return True
    try:
        params = parse_qs(urlsplit(handler.path).query, keep_blank_values=True, max_num_fields=5)
        result = STORE.dashboard(params)
    except ValueError:
        handler.respond(400, {'error': '筛选参数不正确。'})
    except sqlite3.Error:
        handler.respond(503, {'error': 'Cloud 上线统计暂不可用。'})
    else:
        handler.respond(200, result)
    return True


def handle_post(handler):
    if urlsplit(handler.path).path != '/v1/activity':
        return False
    if not handler.valid_origin():
        return True
    if handler.headers.get('Origin') != handler.public_origin:
        handler.respond(403, {'error': 'Same-origin request required'})
    elif handler.headers.get('Content-Length', '0') != '0' or handler.headers.get('Transfer-Encoding'):
        handler.close_connection = True
        handler.respond(400, {'error': 'Empty request required'})
    else:
        record_safely(handler)
        handler.send_bytes(204, b'', 'text/plain')
    return True
