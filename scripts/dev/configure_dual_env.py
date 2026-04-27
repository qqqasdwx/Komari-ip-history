#!/usr/bin/env python3
import json
import sys
import urllib.parse
import urllib.request
import http.cookiejar


def build_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def request_json(opener, method, url, payload=None):
    headers = {"Accept": "application/json"}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with opener.open(request) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def login_ipq(opener, base_url):
    request_json(opener, "POST", f"{base_url}/api/v1/auth/login", {"username": "admin", "password": "admin"})


def login_komari(opener, base_url):
    request_json(opener, "POST", f"{base_url}/api/login", {"username": "admin", "password": "admin"})


def configure_pair(komari_base, ipq_base, public_base_url):
    ipq = build_opener()
    login_ipq(ipq, ipq_base)
    request_json(
        ipq,
        "PUT",
        f"{ipq_base}/api/v1/admin/integration",
        {"public_base_url": public_base_url, "guest_read_enabled": False},
    )
    loader_payload = request_json(
        ipq,
        "GET",
        f"{ipq_base}/api/v1/admin/header-preview?{urllib.parse.urlencode({'variant': 'loader'})}",
    )
    loader_code = loader_payload["code"]

    komari = build_opener()
    login_komari(komari, komari_base)
    settings = request_json(komari, "GET", f"{komari_base}/api/admin/settings/").get("data", {})
    settings["custom_head"] = loader_code
    request_json(komari, "POST", f"{komari_base}/api/admin/settings/", settings)

    public_info = request_json(komari, "GET", f"{komari_base}/api/public").get("data", {})
    return {
        "komari_base": komari_base,
        "ipq_base": ipq_base,
        "public_base_url": public_base_url,
        "theme": public_info.get("theme", ""),
    }


def main():
    if len(sys.argv) != 10:
        raise SystemExit("usage: configure_dual_env.py <komari_default> <ipq_default> <public_default> <komari_purcarte> <ipq_purcarte> <public_purcarte> <out_json> <label_default> <label_purcarte>")

    komari_default, ipq_default, public_default, komari_purcarte, ipq_purcarte, public_purcarte, out_json, label_default, label_purcarte = sys.argv[1:]
    result = {
        label_default: configure_pair(komari_default, ipq_default, public_default),
        label_purcarte: configure_pair(komari_purcarte, ipq_purcarte, public_purcarte),
    }
    with open(out_json, "w", encoding="utf-8") as fp:
        json.dump(result, fp, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
