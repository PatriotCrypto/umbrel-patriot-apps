#!/usr/bin/env python3
"""Offline web server for the Bible Terminal hotspot (runs on the Pi, no internet needed).

- Serves the reader from /opt/bible-terminal/www
- Any request for another host name (phones probing "is there internet?") is redirected to the reader,
  which is what makes the "Sign in to network" page pop up on phones
- Serves pre-compressed .gz files when the browser accepts them
- Runs a small in-memory chat for everyone on the hotspot (/api/chat). Messages are never written to disk and
  disappear when the Pi restarts or after a few hours.
Only the Python standard library is used.
"""
import json
import mimetypes
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.realpath(os.environ.get("BT_ROOT", "/opt/bible-terminal/www"))
IP = os.environ.get("BT_IP", "10.42.0.1")
PORT = int(os.environ.get("BT_PORT", "80"))
OWN_HOSTS = {IP, "localhost", "127.0.0.1"}
CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/svg+xml", ".svg")


class Chat:
    """Everything lives in memory. Nothing is logged or saved."""
    MAX_MSGS = 150
    TTL = 3 * 3600
    TEXT_MAX = 400
    REF = re.compile(r"^[0-9A-Za-z]{2,6}\.\d{1,3}\.\d{1,3}(?:-\d{1,3})?$")

    def __init__(self):
        self.cv = threading.Condition()
        self.msgs = []
        self.last = 0
        self.seen = {}      # client id -> last poll time
        self.buckets = {}   # key -> (tokens, time)
        self.waiting = {}   # ip -> number of phones currently holding a long-poll open
        self.total_waiting = 0

    @staticmethod
    def clean(text, limit):
        text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", str(text or ""))
        return text.strip()[:limit]

    def allow(self, key, burst=5, every=1.5):
        now = time.time()
        tok, t = self.buckets.get(key, (burst, now))
        tok = min(burst, tok + (now - t) / every)
        if tok < 1:
            self.buckets[key] = (tok, now)
            return False
        self.buckets[key] = (tok - 1, now)
        if len(self.buckets) > 2000:
            self.buckets = {k: v for k, v in self.buckets.items() if now - v[1] < 60}
        return True

    def post(self, ip, cid, nick, text, ref):
        nick = self.clean(nick, 24) or "Guest"
        text = self.clean(text, self.TEXT_MAX)
        ref = ref if isinstance(ref, str) and self.REF.match(ref) else ""
        if not text and not ref:
            return None
        cid = self.clean(cid, 40)
        with self.cv:
            if not (self.allow("ip:" + ip, 12, 1.0) and self.allow("id:" + cid)):
                return False
            self.last += 1
            self.msgs.append({"id": self.last, "t": int(time.time()), "nick": nick, "text": text, "ref": ref, "cid": cid})
            del self.msgs[:-self.MAX_MSGS]
            self.cv.notify_all()
            return self.last

    MAX_WAIT_IP = 6
    MAX_WAIT_ALL = 120

    def poll(self, after, cid, wait, ip="?"):
        deadline = time.time() + wait
        with self.cv:
            if wait:
                if self.waiting.get(ip, 0) >= self.MAX_WAIT_IP or self.total_waiting >= self.MAX_WAIT_ALL:
                    return None
                self.waiting[ip] = self.waiting.get(ip, 0) + 1
                self.total_waiting += 1
            try:
                return self._poll(after, cid, deadline)
            finally:
                if wait:
                    self.waiting[ip] -= 1
                    self.total_waiting -= 1
                    if not self.waiting[ip]:
                        del self.waiting[ip]

    def _poll(self, after, cid, deadline):
        if True:
            while True:
                now = time.time()
                self.msgs = [m for m in self.msgs if now - m["t"] < self.TTL]
                if cid:
                    self.seen[cid] = now
                    if len(self.seen) > 500:
                        self.seen = {k: v for k, v in self.seen.items() if now - v < 120}
                reset = after > self.last      # the Pi restarted since this phone last asked
                new = self.msgs if reset else [m for m in self.msgs if m["id"] > after]
                if new or reset or now >= deadline:
                    online = sum(1 for v in self.seen.values() if now - v < 45)
                    # ids of other people are never sent out; "mine" is worked out here for the asking phone only
                    out = [{"id": m["id"], "t": m["t"], "nick": m["nick"], "text": m["text"], "ref": m["ref"], "mine": bool(cid) and m["cid"] == cid} for m in new]
                    return {"msgs": out, "last": self.last, "reset": reset, "online": max(online, 1)}
                self.cv.wait(timeout=min(5, deadline - now))


CHAT = Chat()


class Handler(BaseHTTPRequestHandler):
    server_version = "BibleTerminal"
    protocol_version = "HTTP/1.1"
    timeout = 45  # drop sockets that sit silent, so a stuck phone can't hold a thread forever

    def log_message(self, *args):  # keep the SD card quiet
        pass

    def _host(self):
        return (self.headers.get("Host") or "").split(":")[0].strip().lower()

    def _send(self, code, body=b"", headers=None, head=False):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _handle(self, head=False):
        if self._host() not in OWN_HOSTS:
            return self._send(302, b"", {"Location": "http://%s/" % IP, "Cache-Control": "no-store"}, head)
        path = unquote(urlparse(self.path).path)
        if "\x00" in path:
            return self._send(400, b"bad request", {"Content-Type": "text/plain"}, head)
        if path == "/api/chat":
            return self._chat_get(head)
        if path.startswith("/api/"):
            return self._send(404, b"not found", {"Content-Type": "text/plain"}, head)
        if path.endswith("/"):
            path += "index.html"
        full = os.path.realpath(os.path.join(ROOT, path.lstrip("/")))
        if not (full == ROOT or full.startswith(ROOT + os.sep)):
            return self._send(403, b"forbidden", {"Content-Type": "text/plain"}, head)
        plain_exists = os.path.isfile(full)
        gz = full + ".gz"
        accepts_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "")
        if not plain_exists and not os.path.isfile(gz):
            if os.path.splitext(path)[1]:
                return self._send(404, b"not found", {"Content-Type": "text/plain"}, head)
            full, plain_exists = os.path.join(ROOT, "index.html"), True  # single-page app route
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        headers = {"Content-Type": ctype}
        headers["Cache-Control"] = "no-cache" if full.endswith(("index.html", "config.js")) else "public, max-age=86400"
        if os.path.isfile(gz) and accepts_gzip:
            with open(gz, "rb") as f:
                body = f.read()
            headers["Content-Encoding"] = "gzip"
            headers["Vary"] = "Accept-Encoding"
        elif plain_exists:
            with open(full, "rb") as f:
                body = f.read()
        else:  # only a .gz exists and the browser can't take it
            import gzip
            with gzip.open(gz, "rb") as f:
                body = f.read()
        self._send(200, body, headers, head)

    def do_GET(self):
        self._handle()

    def do_HEAD(self):
        self._handle(head=True)

    def _json(self, code, obj, head=False):
        self._send(code, json.dumps(obj).encode(), {"Content-Type": "application/json", "Cache-Control": "no-store"}, head)

    def _chat_get(self, head=False):
        q = parse_qs(urlparse(self.path).query)
        try:
            after = int(q.get("after", ["0"])[0])
            wait = max(0, min(20, float(q.get("wait", ["0"])[0])))
        except ValueError:
            return self._json(400, {"error": "bad request"}, head)
        out = CHAT.poll(after, (q.get("cid", [""])[0])[:40], 0 if head else wait, self.client_address[0])
        if out is None:
            return self._json(429, {"error": "too many open connections"}, head)
        self._json(200, out, head)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.close_connection = True
            return self._json(400, {"error": "bad request"})
        body = self.rfile.read(n) if 0 < n <= 4096 else b""
        if n > 4096:
            self.close_connection = True
            return self._json(413, {"error": "too big"})
        if path != "/api/chat" or self.headers.get("X-BT") != "1" or self._host() not in OWN_HOSTS:
            return self._send(405, b"read only", {"Allow": "GET, HEAD", "Content-Type": "text/plain"})
        try:
            d = json.loads(body or b"{}")
            assert isinstance(d, dict)
        except Exception:
            return self._json(400, {"error": "bad request"})
        r = CHAT.post(self.client_address[0], d.get("cid"), d.get("nick"), d.get("text"), d.get("ref"))
        if r is None:
            return self._json(400, {"error": "empty"})
        if r is False:
            return self._json(429, {"error": "slow down"})
        self._json(200, {"id": r})


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print("Bible Terminal serving %s on port %d" % (ROOT, PORT), file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
