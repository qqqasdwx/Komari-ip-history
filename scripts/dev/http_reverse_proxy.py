#!/usr/bin/env python3
import argparse
import http.server
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def build_handler(target_base):
    class ProxyHandler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            self._proxy()

        def do_POST(self):
            self._proxy()

        def do_PUT(self):
            self._proxy()

        def do_DELETE(self):
            self._proxy()

        def do_PATCH(self):
            self._proxy()

        def do_HEAD(self):
            self._proxy()

        def log_message(self, fmt, *args):
            sys.stdout.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

        def _proxy(self):
            target_url = urllib.parse.urljoin(target_base.rstrip("/") + "/", self.path.lstrip("/"))
            body = None
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length > 0:
                body = self.rfile.read(length)

            headers = {}
            for key, value in self.headers.items():
                if key.lower() in HOP_BY_HOP_HEADERS or key.lower() == "host":
                    continue
                headers[key] = value
            parsed_target = urllib.parse.urlparse(target_base)
            headers["Host"] = parsed_target.netloc

            request = urllib.request.Request(target_url, data=body, headers=headers, method=self.command)
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    payload = response.read()
                    self.send_response(response.status)
                    for key, value in response.getheaders():
                        if key.lower() in HOP_BY_HOP_HEADERS:
                            continue
                        if key.lower() == "content-length":
                            continue
                        self.send_header(key, value)
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    if self.command != "HEAD" and payload:
                        self.wfile.write(payload)
            except urllib.error.HTTPError as exc:
                payload = exc.read()
                self.send_response(exc.code)
                for key, value in exc.headers.items():
                    if key.lower() in HOP_BY_HOP_HEADERS or key.lower() == "content-length":
                        continue
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.command != "HEAD" and payload:
                    self.wfile.write(payload)
            except Exception as exc:  # noqa: BLE001
                payload = str(exc).encode("utf-8")
                self.send_response(502)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(payload)

    return ProxyHandler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-host", default="127.0.0.1")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args()

    handler = build_handler(args.target)
    with ThreadingTCPServer((args.listen_host, args.listen_port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
