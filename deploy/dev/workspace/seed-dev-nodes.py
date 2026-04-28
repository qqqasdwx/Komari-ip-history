#!/usr/bin/env python3
import copy
import datetime as dt
import http.cookiejar
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[3]
IPQUALITY_SAMPLE_PATHS = [
    ROOT_DIR / "internal" / "sampledata" / "ipquality_template.json",
    ROOT_DIR / "references" / "IPQuality" / "res" / "output.json",
]
DEFAULT_IPQ_DB_PATH = ROOT_DIR / "data" / "ipq" / "ipq.db"
SEED_BASE_TIME = dt.datetime(2026, 4, 2, 0, 0, 0, tzinfo=dt.timezone.utc)
NAME_PREFIX = "开发种子-"
LEGACY_DEV_NODE_NAMES = {"测试节点", "通信样式测试"}


def build_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def request_json(opener, method, url, payload=None, headers=None):
    body = None
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with opener.open(request) as response:
            raw = response.read().decode("utf-8")
            return response.getcode(), json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {raw}") from exc


def request_text(opener, method, url, payload=None, headers=None):
    body = None
    request_headers = {}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with opener.open(request) as response:
            return response.getcode(), response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {raw}") from exc


def login_komari(opener, base_url, username, password):
    request_json(opener, "POST", f"{base_url}/api/login", {"username": username, "password": password})


def login_ipq(opener, base_url, username, password):
    request_json(opener, "POST", f"{base_url}/api/v1/auth/login", {"username": username, "password": password})


def list_komari_nodes(opener, base_url):
    _, payload = request_json(opener, "GET", f"{base_url}/api/admin/client/list")
    return payload or []


def list_ipq_nodes(opener, base_url):
    _, payload = request_json(opener, "GET", f"{base_url}/api/v1/nodes")
    return (payload or {}).get("items", [])


def remove_komari_node(opener, base_url, uuid):
    request_json(opener, "POST", f"{base_url}/api/admin/client/{uuid}/remove", {})


def remove_ipq_node(opener, base_url, uuid):
    request_text(opener, "DELETE", f"{base_url}/api/v1/nodes/{uuid}")


def add_komari_node(opener, base_url, name):
    _, payload = request_json(opener, "POST", f"{base_url}/api/admin/client/add", {"name": name})
    data = (payload or {}).get("data") or payload or {}
    return data


def edit_komari_node(opener, base_url, uuid, payload):
    request_text(opener, "POST", f"{base_url}/api/admin/client/{uuid}/edit", payload)


def register_ipq_node(opener, base_url, uuid, name):
    request_json(opener, "POST", f"{base_url}/api/v1/embed/nodes/register", {"uuid": uuid, "name": name})


def add_ipq_target(opener, base_url, uuid, ip):
    _, payload = request_json(opener, "POST", f"{base_url}/api/v1/nodes/{uuid}/targets", {"ip": ip})
    return payload or {}


def reorder_ipq_targets(opener, base_url, uuid, target_ids):
    request_json(opener, "POST", f"{base_url}/api/v1/nodes/{uuid}/targets/reorder", {"target_ids": target_ids})


def get_ipq_node_detail(opener, base_url, uuid):
    _, payload = request_json(opener, "GET", f"{base_url}/api/v1/nodes/{uuid}")
    return payload or {}


def get_ipq_history(opener, base_url, uuid, target_id=None, limit=20):
    query = urllib.parse.urlencode({"limit": limit, **({"target_id": target_id} if target_id else {})})
    _, payload = request_json(opener, "GET", f"{base_url}/api/v1/nodes/{uuid}/history?{query}")
    return payload or {}


def favorite_history(opener, base_url, uuid, history_id, target_id=None):
    suffix = f"?{urllib.parse.urlencode({'target_id': target_id})}" if target_id else ""
    request_json(opener, "POST", f"{base_url}/api/v1/nodes/{uuid}/history/{history_id}/favorite{suffix}")


def report_target_result(opener, base_url, uuid, reporter_token, target_ip, summary, result, recorded_at=None):
    payload = {"target_ip": target_ip, "summary": summary, "result": result}
    if recorded_at:
        payload["recorded_at"] = recorded_at
    request_json(
        opener,
        "POST",
        f"{base_url}/api/v1/report/nodes/{uuid}",
        payload,
        headers={"X-IPQ-Reporter-Token": reporter_token},
    )


def load_sample_result():
    for path in IPQUALITY_SAMPLE_PATHS:
        if path.exists():
            with path.open("r", encoding="utf-8") as fp:
                return json.load(fp)
    candidates = ", ".join(str(path) for path in IPQUALITY_SAMPLE_PATHS)
    raise RuntimeError(f"missing IPQuality sample data; checked: {candidates}")


def ipq_db_path():
    return Path(os.environ.get("IPQ_DB_PATH") or DEFAULT_IPQ_DB_PATH)


def open_ipq_db():
    path = ipq_db_path()
    if not path.exists():
        raise RuntimeError(f"IPQ database not found: {path}")
    return sqlite3.connect(path, timeout=10)


def recompute_node_state_sql(conn, node_id):
    row = conn.execute(
        """
        SELECT MAX(current_result_updated_at)
        FROM node_targets
        WHERE node_id = ? AND has_data = 1 AND current_result_updated_at IS NOT NULL
        """,
        (node_id,),
    ).fetchone()
    updated_at = row[0] if row else None
    has_data = 1 if updated_at else 0
    conn.execute(
        """
        UPDATE nodes
        SET has_data = ?,
            current_summary = '',
            current_result_json = '',
            current_result_updated_at = ?
        WHERE id = ?
        """,
        (has_data, updated_at, node_id),
    )


def patch_target_without_data(target_id):
    with open_ipq_db() as conn:
        row = conn.execute("SELECT node_id FROM node_targets WHERE id = ?", (target_id,)).fetchone()
        if not row:
            raise RuntimeError(f"target not found in database: {target_id}")
        node_id = row[0]
        conn.execute("DELETE FROM node_target_histories WHERE node_target_id = ?", (target_id,))
        conn.execute(
            """
            UPDATE node_targets
            SET has_data = 0,
                current_summary = '',
                current_result_json = '',
                current_result_updated_at = NULL
            WHERE id = ?
            """,
            (target_id,),
        )
        recompute_node_state_sql(conn, node_id)


def delete_target_history(target_id, only_dev_default=False):
    with open_ipq_db() as conn:
        row = conn.execute("SELECT node_id FROM node_targets WHERE id = ?", (target_id,)).fetchone()
        if not row:
            raise RuntimeError(f"target not found in database: {target_id}")
        if only_dev_default:
            conn.execute(
                """
                DELETE FROM node_target_histories
                WHERE node_target_id = ? AND summary LIKE 'Development mock data for %'
                """,
                (target_id,),
            )
        else:
            conn.execute("DELETE FROM node_target_histories WHERE node_target_id = ?", (target_id,))


def ensure_mapping(obj, key):
    value = obj.get(key)
    if not isinstance(value, dict):
        value = {}
        obj[key] = value
    return value


def seed_result(sample, ip, variant):
    result = copy.deepcopy(sample)
    head = ensure_mapping(result, "Head")
    info = ensure_mapping(result, "Info")
    score = ensure_mapping(result, "Score")
    factor = ensure_mapping(result, "Factor")
    media = ensure_mapping(result, "Media")
    mail = ensure_mapping(result, "Mail")

    recorded_at = (SEED_BASE_TIME + dt.timedelta(hours=variant * 2)).replace(microsecond=0)
    head["IP"] = ip
    head["Version"] = "dev-seed"
    head["ReportTime"] = recorded_at.isoformat().replace("+00:00", "Z")

    info["ASN"] = str(10000 + variant)
    info["Organization"] = f"Dev Seed Org {variant + 1}"

    score["Scamalytics"] = min(100, 10 + variant * 12)
    score["SCAMALYTICS"] = min(100, 10 + variant * 12)
    score["AbuseIPDB"] = min(100, variant * 3)
    score["IPQS"] = min(100, 20 + variant * 9)

    factor["IsVPN"] = "Yes" if variant % 2 == 0 else "No"
    factor["IsProxy"] = "No"
    factor["IsTor"] = "No"

    netflix = ensure_mapping(media, "Netflix")
    netflix["Status"] = "Yes" if variant % 2 == 0 else "No"
    netflix["Region"] = "US" if variant % 2 == 0 else "JP"

    chatgpt = ensure_mapping(media, "ChatGPT")
    chatgpt["Status"] = "Yes" if variant % 2 == 0 else "No"
    chatgpt["Region"] = "US" if variant % 2 == 0 else "N/A"

    mail["Available"] = variant % 2 == 0
    mail["Blacklisted"] = variant
    mail["Count"] = 400 + variant * 5

    return result, recorded_at.isoformat().replace("+00:00", "Z")


def cleanup_prefixed_nodes(komari_opener, komari_base, ipq_opener, ipq_base):
    ipq_nodes = list_ipq_nodes(ipq_opener, ipq_base)
    for node in ipq_nodes:
        name = node.get("name") or ""
        if name.startswith(NAME_PREFIX) or name in LEGACY_DEV_NODE_NAMES:
            remove_ipq_node(ipq_opener, ipq_base, node["komari_node_uuid"])

    komari_nodes = list_komari_nodes(komari_opener, komari_base)
    for node in komari_nodes:
        name = node.get("name") or ""
        if name.startswith(NAME_PREFIX) or name in LEGACY_DEV_NODE_NAMES:
            remove_komari_node(komari_opener, komari_base, node["uuid"])


def create_seed_node(komari_opener, komari_base, ipq_opener, ipq_base, sample, spec):
    created = add_komari_node(komari_opener, komari_base, spec["name"])
    uuid = created["uuid"]

    if spec.get("hidden") is not None:
        edit_komari_node(komari_opener, komari_base, uuid, {"hidden": bool(spec["hidden"])})

    register_ipq_node(ipq_opener, ipq_base, uuid, spec["name"])

    target_ids = []
    target_id_by_ip = {}
    reporter_token = None
    for ip in spec.get("ips", []):
        target = add_ipq_target(ipq_opener, ipq_base, uuid, ip)
        target_ids.append(target["id"])
        target_id_by_ip[ip] = target["id"]

    if spec.get("reorder") and target_ids:
        detail = get_ipq_node_detail(ipq_opener, ipq_base, uuid)
        current_targets = detail.get("targets") or []
        id_by_ip = {item["ip"]: item["id"] for item in current_targets}
        ordered_ids = [id_by_ip[ip] for ip in spec["reorder"] if ip in id_by_ip]
        if ordered_ids:
            reorder_ipq_targets(ipq_opener, ipq_base, uuid, ordered_ids)

    if spec.get("ips"):
        detail = get_ipq_node_detail(ipq_opener, ipq_base, uuid)
        reporter_token = detail.get("report_config", {}).get("reporter_token")
        if reporter_token:
            for history in spec.get("history", []):
                for ip in history["ips"]:
                    result, recorded_at = seed_result(sample, ip, history["variant"])
                    report_target_result(
                        ipq_opener,
                        ipq_base,
                        uuid,
                        reporter_token,
                        ip,
                        history["summary"],
                        result,
                        recorded_at,
                    )

    for target_id in target_ids:
        if spec.get("drop_dev_default_history", True):
            delete_target_history(target_id, only_dev_default=True)

    for ip in spec.get("clear_history_ips", []):
        target_id = target_id_by_ip.get(ip)
        if target_id:
            delete_target_history(target_id)

    for ip in spec.get("clear_data_ips", []):
        target_id = target_id_by_ip.get(ip)
        if target_id:
            patch_target_without_data(target_id)

    favorite_index = spec.get("favorite_history_index")
    if favorite_index is not None:
        favorite_target_ip = spec.get("favorite_target_ip")
        favorite_target_id = target_id_by_ip.get(favorite_target_ip) if favorite_target_ip else None
        history_page = get_ipq_history(ipq_opener, ipq_base, uuid, favorite_target_id, limit=20)
        history_items = history_page.get("items") or []
        if history_items:
            resolved_index = min(max(int(favorite_index), 0), len(history_items) - 1)
            favorite_history(ipq_opener, ipq_base, uuid, history_items[resolved_index]["id"], favorite_target_id)

    return {
        "uuid": uuid,
        "name": spec["name"],
        "ips": spec.get("ips", []),
        "path": f"/instance/{uuid}",
        "history_entries": len(spec.get("history", [])),
        "description": spec.get("description", ""),
    }


def main():
    komari_base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080"
    ipq_base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8090"
    komari_display_base = sys.argv[3] if len(sys.argv) > 3 else komari_base
    extra_args = set(sys.argv[4:])
    cleanup_only = "--cleanup-only" in extra_args or "--empty" in extra_args
    username = "admin"
    password = "admin"

    komari_opener = build_opener()
    ipq_opener = build_opener()
    login_komari(komari_opener, komari_base, username, password)
    login_ipq(ipq_opener, ipq_base, username, password)

    cleanup_prefixed_nodes(komari_opener, komari_base, ipq_opener, ipq_base)

    if cleanup_only:
        print("开发种子节点已清理，当前可用于验证无节点空状态。")
        return

    sample = load_sample_result()
    specs = [
        {
            "name": f"{NAME_PREFIX}空节点",
            "ips": [],
            "history": [],
            "description": "无目标 IP，用于验证空状态和游客空弹窗。",
        },
        {
            "name": f"{NAME_PREFIX}有目标无数据",
            "ips": ["203.0.113.30"],
            "history": [],
            "clear_data_ips": ["203.0.113.30"],
            "description": "有目标 IP 但没有当前结果和历史，用于验证目标级空状态。",
        },
        {
            "name": f"{NAME_PREFIX}单IP无历史",
            "ips": ["203.0.113.40"],
            "history": [],
            "clear_history_ips": ["203.0.113.40"],
            "description": "有当前结果但没有历史快照，用于验证历史空状态。",
        },
        {
            "name": f"{NAME_PREFIX}单IP历史",
            "ips": ["203.0.113.10"],
            "history": [
                {"variant": 0, "summary": "初始快照", "ips": ["203.0.113.10"]},
                {"variant": 1, "summary": "第二次上报", "ips": ["203.0.113.10"]},
                {"variant": 2, "summary": "第三次上报", "ips": ["203.0.113.10"]},
                {"variant": 3, "summary": "第四次上报", "ips": ["203.0.113.10"]},
                {"variant": 4, "summary": "第五次上报", "ips": ["203.0.113.10"]},
                {"variant": 5, "summary": "第六次上报", "ips": ["203.0.113.10"]},
                {"variant": 6, "summary": "第七次上报", "ips": ["203.0.113.10"]},
                {"variant": 7, "summary": "第八次上报", "ips": ["203.0.113.10"]},
            ],
            "favorite_history_index": 1,
            "favorite_target_ip": "203.0.113.10",
            "description": "单 IP 当前结果和历史对比。",
        },
        {
            "name": f"{NAME_PREFIX}多IP历史",
            "ips": ["198.51.100.20", "2001:db8::20"],
            "reorder": ["198.51.100.20", "2001:db8::20"],
            "history": [
                {"variant": 0, "summary": "IPv4 初始快照", "ips": ["198.51.100.20"]},
                {"variant": 1, "summary": "IPv4 第二次上报", "ips": ["198.51.100.20"]},
                {"variant": 2, "summary": "IPv4 第三次上报", "ips": ["198.51.100.20"]},
                {"variant": 3, "summary": "IPv4 第四次上报", "ips": ["198.51.100.20"]},
                {"variant": 4, "summary": "IPv4 第五次上报", "ips": ["198.51.100.20"]},
                {"variant": 5, "summary": "IPv6 初始快照", "ips": ["2001:db8::20"]},
                {"variant": 6, "summary": "IPv6 第二次上报", "ips": ["2001:db8::20"]},
                {"variant": 7, "summary": "IPv6 第三次上报", "ips": ["2001:db8::20"]},
                {"variant": 8, "summary": "IPv6 第四次上报", "ips": ["2001:db8::20"]},
                {"variant": 9, "summary": "IPv6 第五次上报", "ips": ["2001:db8::20"]},
            ],
            "favorite_history_index": 2,
            "favorite_target_ip": "198.51.100.20",
            "description": "多 IP 标签切换、排序和分 IP 历史。",
        },
        {
            "name": f"{NAME_PREFIX}多快照对比",
            "ips": ["203.0.113.50"],
            "history": [
                {"variant": 0, "summary": "对比快照 01", "ips": ["203.0.113.50"]},
                {"variant": 1, "summary": "对比快照 02", "ips": ["203.0.113.50"]},
                {"variant": 2, "summary": "对比快照 03", "ips": ["203.0.113.50"]},
                {"variant": 3, "summary": "对比快照 04", "ips": ["203.0.113.50"]},
                {"variant": 4, "summary": "对比快照 05", "ips": ["203.0.113.50"]},
                {"variant": 5, "summary": "对比快照 06", "ips": ["203.0.113.50"]},
                {"variant": 6, "summary": "对比快照 07", "ips": ["203.0.113.50"]},
                {"variant": 7, "summary": "对比快照 08", "ips": ["203.0.113.50"]},
                {"variant": 8, "summary": "对比快照 09", "ips": ["203.0.113.50"]},
                {"variant": 9, "summary": "对比快照 10", "ips": ["203.0.113.50"]},
            ],
            "favorite_history_index": 0,
            "favorite_target_ip": "203.0.113.50",
            "description": "多条快照、收藏快照和差异对比。",
        },
        {
            "name": f"{NAME_PREFIX}长名称与密集数据节点-用于验证移动端换行和卡片布局稳定性-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "ips": ["198.51.100.60", "198.51.100.61", "2001:db8::60"],
            "reorder": ["198.51.100.60", "198.51.100.61", "2001:db8::60"],
            "history": [
                {"variant": 0, "summary": "密集 IPv4 A 初始", "ips": ["198.51.100.60"]},
                {"variant": 1, "summary": "密集 IPv4 A 第二次", "ips": ["198.51.100.60"]},
                {"variant": 2, "summary": "密集 IPv4 A 第三次", "ips": ["198.51.100.60"]},
                {"variant": 3, "summary": "密集 IPv4 B 初始", "ips": ["198.51.100.61"]},
                {"variant": 4, "summary": "密集 IPv4 B 第二次", "ips": ["198.51.100.61"]},
                {"variant": 5, "summary": "密集 IPv4 B 第三次", "ips": ["198.51.100.61"]},
                {"variant": 6, "summary": "密集 IPv6 初始", "ips": ["2001:db8::60"]},
                {"variant": 7, "summary": "密集 IPv6 第二次", "ips": ["2001:db8::60"]},
                {"variant": 8, "summary": "密集 IPv6 第三次", "ips": ["2001:db8::60"]},
            ],
            "description": "长节点名、多目标、多历史，用于验证响应式和密集数据布局。",
        },
    ]

    created = []
    for spec in specs:
        created.append(create_seed_node(komari_opener, komari_base, ipq_opener, ipq_base, sample, spec))

    print("开发种子节点已重建：")
    for item, spec in zip(created, specs):
        print(f"- {item['name']}")
        print(f"  场景: {spec['description']}")
        print(f"  Komari: {komari_display_base}{item['path']}")
        if item["ips"]:
            print(f"  目标 IP: {', '.join(item['ips'])}")
        print(f"  历史上报: {item['history_entries']}")


if __name__ == "__main__":
    main()
