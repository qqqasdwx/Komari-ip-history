#!/usr/bin/env python3
import http.cookiejar
import json
import mimetypes
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


PURCARTE_RELEASE_API = "https://api.github.com/repos/Montia37/komari-theme-purcarte/releases/latest"
PURCARTE_ASSET_NAME = "komari-theme-purcarte.zip"


def build_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def request_json(opener, method, url, payload=None, headers=None):
    body = None
    request_headers = {"Accept": "application/json", "User-Agent": "Komari-ip-history-dev"}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with opener.open(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.getcode(), json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {raw}") from exc


def login(opener, base_url):
    request_json(opener, "POST", f"{base_url}/api/login", {"username": "admin", "password": "admin"})


def theme_list(opener, base_url):
    _, payload = request_json(opener, "GET", f"{base_url}/api/admin/theme/list")
    return (payload or {}).get("data", [])


def settings(opener, base_url):
    _, payload = request_json(opener, "GET", f"{base_url}/api/admin/settings/")
    return (payload or {}).get("data", {})


def find_latest_purcarte_asset():
    request = urllib.request.Request(
        PURCARTE_RELEASE_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Komari-ip-history-dev"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    for asset in payload.get("assets", []):
        if asset.get("name") == PURCARTE_ASSET_NAME and asset.get("browser_download_url"):
            return payload.get("tag_name") or "latest", asset["browser_download_url"]
    raise RuntimeError(f"missing release asset: {PURCARTE_ASSET_NAME}")


def download(url, target):
    request = urllib.request.Request(url, headers={"User-Agent": "Komari-ip-history-dev"})
    with urllib.request.urlopen(request, timeout=60) as response, target.open("wb") as fp:
        while True:
            chunk = response.read(1024 * 64)
            if not chunk:
                break
            fp.write(chunk)


def encode_multipart(file_path):
    boundary = "----ipq-dev-theme-boundary"
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/zip"
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    return boundary, head + file_path.read_bytes() + tail


def upload_theme(opener, base_url, file_path):
    boundary, body = encode_multipart(file_path)
    request = urllib.request.Request(
        f"{base_url}/api/admin/theme/upload",
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Komari-ip-history-dev",
        },
        method="PUT",
    )
    try:
        with opener.open(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return response.getcode(), json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"upload theme failed: {exc.code} {raw}") from exc


def set_theme(opener, base_url, theme):
    encoded = urllib.parse.quote(theme)
    request_json(opener, "GET", f"{base_url}/api/admin/theme/set?theme={encoded}")


def main():
    import sys

    base_url = (sys.argv[1] if len(sys.argv) > 1 else "http://proxy:8081").rstrip("/")
    opener = build_opener()
    login(opener, base_url)

    themes = theme_list(opener, base_url)
    has_purcarte = any(str(item.get("short", "")).lower() == "purcarte" for item in themes)

    if not has_purcarte:
        version, asset_url = find_latest_purcarte_asset()
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / PURCARTE_ASSET_NAME
            download(asset_url, archive)
            upload_theme(opener, base_url, archive)
        print(f"PurCarte theme uploaded from {version}")
    else:
        print("PurCarte theme already installed")

    set_theme(opener, base_url, "PurCarte")
    current = settings(opener, base_url).get("theme")
    if str(current).lower() != "purcarte":
        raise RuntimeError(f"failed to activate PurCarte theme, current theme: {current}")
    print("PurCarte theme is active")


if __name__ == "__main__":
    main()
