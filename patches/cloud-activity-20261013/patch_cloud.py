"""Apply reviewed, count-checked hooks to a staged copy of cloud_preview.py."""
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
changes = [
    ('import cloud_services\n', 'import cloud_services\nimport cloud_activity\n'),
    ('cloud_services.configure(STORE)\n', 'cloud_services.configure(STORE)\ncloud_activity.configure(STORE)\n'),
    ('        self.send_response(status)\n', "        if status == 200 and self.command == 'GET' and urlsplit(self.path).path == '/':\n            cloud_activity.record_safely(self)\n        self.send_response(status)\n"),
    ('    def do_POST(self):\n        route = urlsplit(self.path).path\n', '    def do_POST(self):\n        if cloud_activity.handle_post(self): return\n        route = urlsplit(self.path).path\n'),
    ('    def end_headers(self):\n', '    def end_headers(self):\n        if getattr(self, "activity_cookie", None):\n            self.send_header("Set-Cookie", f"{cloud_activity.COOKIE}={self.activity_cookie}; Path={self.public_prefix}; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax")\n        if urlsplit(self.path).path in ("/v1/activity", "/v1/oa-activity"):\n            self.send_header("Cache-Control", "private, no-store")\n'),
    ('    PUBLIC_ASSETS = {\n', '    PUBLIC_ASSETS = {\n        "/cloud-activity.js": "text/javascript; charset=utf-8",\n'),
    ('    def do_GET(self):\n        if not self.valid_origin():\n            return\n', '    def do_GET(self):\n        if not self.valid_origin():\n            return\n        if cloud_activity.handle_get(self): return\n'),
    ('                pwa_head = ', '                content = content.replace("</head>", \'<script defer src="\' + self.public_prefix + \'cloud-activity.js"></script></head>\')\n                pwa_head = '),
    ("        route = urlsplit(self.path).path\n        handler_class = AuthenticatedHandler\n", "        route = urlsplit(self.path).path\n        if route == '/v1/oa-activity':\n            return WorkbenchHandler.do_GET(self) if method == 'do_GET' else self.respond(405, {'error': 'Method not allowed'})\n        if route == '/v1/activity':\n            return WorkbenchHandler.do_POST(self) if method == 'do_POST' else self.respond(405, {'error': 'Method not allowed'})\n        handler_class = AuthenticatedHandler\n"),
]
for old, new in changes:
    if source.count(old) != 1:
        raise SystemExit('Cloud source changed; hook must be reviewed: ' + old[:70])
    source = source.replace(old, new, 1)
compile(source, str(path), 'exec')
path.write_text(source)
