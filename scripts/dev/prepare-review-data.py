#!/usr/bin/env python3
import copy
import datetime as dt
import http.cookiejar
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
IPQUALITY_SAMPLE_PATH = ROOT_DIR / "references" / "IPQuality" / "res" / "output.json"
DEFAULT_KOMARI_BASE = "http://127.0.0.1:8080"
DEFAULT_IPQ_BASE = "http://127.0.0.1:8090"
DEFAULT_DB_PATH = ROOT_DIR / "data" / "ipq" / "ipq.db"


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


def login_komari(opener, base_url):
    request_json(opener, "POST", f"{base_url}/api/login", {"username": "admin", "password": "admin"})


def login_ipq(opener, base_url):
    request_json(opener, "POST", f"{base_url}/api/v1/auth/login", {"username": "admin", "password": "admin"})


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
    return (payload or {}).get("data") or payload or {}


def register_ipq_node(opener, base_url, uuid, name):
    request_json(opener, "POST", f"{base_url}/api/v1/embed/nodes/register", {"uuid": uuid, "name": name})


def create_standalone_ipq_node(opener, base_url, name):
    _, payload = request_json(opener, "POST", f"{base_url}/api/v1/nodes", {"name": name})
    return payload or {}


def update_ipq_node_name(opener, base_url, uuid, name):
    _, payload = request_json(opener, "PUT", f"{base_url}/api/v1/nodes/{uuid}", {"name": name})
    return payload or {}


def add_ipq_target(opener, base_url, uuid, ip):
    _, payload = request_json(opener, "POST", f"{base_url}/api/v1/nodes/{uuid}/targets", {"ip": ip})
    return payload or {}


def get_ipq_node_detail(opener, base_url, uuid):
    _, payload = request_json(opener, "GET", f"{base_url}/api/v1/nodes/{uuid}")
    return payload or {}


def report_target_result(opener, base_url, uuid, reporter_token, target_ip, summary, result, recorded_at=None):
    payload = {"target_ip": target_ip, "summary": summary, "result": result}
    if recorded_at:
        payload["recorded_at"] = recorded_at
    last_error = None
    for _ in range(10):
        try:
            request_json(
                opener,
                "POST",
                f"{base_url}/api/v1/report/nodes/{uuid}",
                payload,
                headers={"X-IPQ-Reporter-Token": reporter_token},
            )
            return
        except RuntimeError as exc:
            last_error = exc
            if "404" not in str(exc) or "node not found" not in str(exc):
                raise
            time.sleep(0.2)
    raise last_error


def load_sample_result():
    with IPQUALITY_SAMPLE_PATH.open("r", encoding="utf-8") as fp:
        return json.load(fp)


def ensure_mapping(obj, key):
    value = obj.get(key)
    if not isinstance(value, dict):
        value = {}
        obj[key] = value
    return value


def build_sample_result(sample, ip, variant):
    result = copy.deepcopy(sample)
    head = ensure_mapping(result, "Head")
    info = ensure_mapping(result, "Info")
    score = ensure_mapping(result, "Score")
    factor = ensure_mapping(result, "Factor")
    media = ensure_mapping(result, "Media")
    mail = ensure_mapping(result, "Mail")

    recorded_at = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=variant * 10)).replace(microsecond=0)
    head["IP"] = ip
    head["Version"] = "review-seed"
    head["ReportTime"] = recorded_at.isoformat().replace("+00:00", "Z")

    info["ASN"] = str(32000 + variant)
    info["Organization"] = f"Review Seed Org {variant + 1}"

    score["Scamalytics"] = min(100, 5 + variant * 8)
    score["AbuseIPDB"] = min(100, variant * 2)
    score["IPQS"] = min(100, 15 + variant * 11)

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
    mail["Count"] = 300 + variant * 7

    return result, recorded_at.isoformat().replace("+00:00", "Z")


def clear_node_runtime_data(db_path, node_uuid):
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute("SELECT id FROM nodes WHERE node_uuid = ?", (node_uuid,)).fetchone()
        if not row:
            raise RuntimeError(f"node not found in sqlite: {node_uuid}")
        node_id = row[0]
        target_ids = [item[0] for item in conn.execute("SELECT id FROM node_targets WHERE node_id = ?", (node_id,)).fetchall()]
        if target_ids:
            placeholders = ",".join("?" for _ in target_ids)
            conn.execute(f"DELETE FROM node_target_histories WHERE node_target_id IN ({placeholders})", target_ids)
        conn.execute(
            """
            UPDATE node_targets
            SET has_data = 0,
                current_summary = '',
                current_result_json = '',
                current_result_updated_at = NULL,
                last_seen_at = NULL
            WHERE node_id = ?
            """,
            (node_id,),
        )
        conn.execute(
            """
            UPDATE nodes
            SET has_data = 0,
                current_summary = '',
                current_result_json = '',
                current_result_updated_at = NULL
            WHERE id = ?
            """,
            (node_id,),
        )
        conn.commit()
    finally:
        conn.close()


def clear_all_nodes(komari_opener, komari_base, ipq_opener, ipq_base):
    for node in list_ipq_nodes(ipq_opener, ipq_base):
        remove_ipq_node(ipq_opener, ipq_base, node["node_uuid"])
    for node in list_komari_nodes(komari_opener, komari_base):
        remove_komari_node(komari_opener, komari_base, node["uuid"])


def summarize_bound_node(detail, komari_uuid, komari_name, category, komari_base):
    return {
        "category": category,
        "name": detail["name"],
        "ipq_name": detail["name"],
        "kind": "komari-bound",
        "komari_uuid": komari_uuid,
        "komari_name": komari_name,
        "komari_url": f"{komari_base}/instance/{komari_uuid}",
        "ipq_node_uuid": detail["node_uuid"],
        "ipq_url": f"#/nodes/{detail['node_uuid']}",
        "has_data": detail["has_data"],
        "target_count": len(detail.get("targets") or []),
        "history_count": None,
        "install_token": detail.get("report_config", {}).get("install_token", ""),
    }


def summarize_standalone_node(detail, category):
    return {
        "category": category,
        "name": detail["name"],
        "ipq_name": detail["name"],
        "kind": "ipq-standalone",
        "komari_uuid": "",
        "komari_name": "",
        "komari_url": "",
        "ipq_node_uuid": detail["node_uuid"],
        "ipq_url": f"#/nodes/{detail['node_uuid']}",
        "has_data": detail["has_data"],
        "target_count": len(detail.get("targets") or []),
        "history_count": None,
        "install_token": detail.get("report_config", {}).get("install_token", ""),
    }


def create_bound_node(komari_opener, komari_base, ipq_opener, ipq_base, sample, spec, db_path):
    komari_node = add_komari_node(komari_opener, komari_base, spec["komari_name"])
    register_ipq_node(ipq_opener, ipq_base, komari_node["uuid"], spec["komari_name"])
    update_ipq_node_name(ipq_opener, ipq_base, komari_node["uuid"], spec["ipq_name"])
    for ip in spec.get("targets", []):
        add_ipq_target(ipq_opener, ipq_base, komari_node["uuid"], ip)

    detail = get_ipq_node_detail(ipq_opener, ipq_base, komari_node["uuid"])
    reporter_token = detail.get("report_config", {}).get("reporter_token")
    for index, history_item in enumerate(spec.get("history", [])):
        result, recorded_at = build_sample_result(sample, history_item["ip"], index)
        report_target_result(
            ipq_opener,
            ipq_base,
            detail["node_uuid"],
            reporter_token,
            history_item["ip"],
            history_item["summary"],
            result,
            recorded_at,
        )
    if spec.get("force_no_data"):
        clear_node_runtime_data(db_path, detail["node_uuid"])
    detail = get_ipq_node_detail(ipq_opener, ipq_base, detail["node_uuid"])
    return summarize_bound_node(detail, komari_node["uuid"], spec["komari_name"], spec["category"], komari_base)


def create_standalone_node(ipq_opener, ipq_base, sample, spec, db_path):
    created = create_standalone_ipq_node(ipq_opener, ipq_base, spec["ipq_name"])
    node_uuid = created["node_uuid"]
    for ip in spec.get("targets", []):
        add_ipq_target(ipq_opener, ipq_base, node_uuid, ip)

    detail = get_ipq_node_detail(ipq_opener, ipq_base, node_uuid)
    reporter_token = detail.get("report_config", {}).get("reporter_token")
    for index, history_item in enumerate(spec.get("history", [])):
        result, recorded_at = build_sample_result(sample, history_item["ip"], index)
        report_target_result(
            ipq_opener,
            ipq_base,
            node_uuid,
            reporter_token,
            history_item["ip"],
            history_item["summary"],
            result,
            recorded_at,
        )
    if spec.get("force_no_data"):
        clear_node_runtime_data(db_path, node_uuid)
    detail = get_ipq_node_detail(ipq_opener, ipq_base, node_uuid)
    return summarize_standalone_node(detail, spec["category"])


def create_komari_only_node(komari_opener, komari_base, spec):
    komari_node = add_komari_node(komari_opener, komari_base, spec["komari_name"])
    return {
        "category": spec["category"],
        "name": spec["komari_name"],
        "kind": "komari-only",
        "komari_uuid": komari_node["uuid"],
        "komari_name": spec["komari_name"],
        "komari_url": f"{komari_base}/instance/{komari_node['uuid']}",
        "ipq_node_uuid": "",
        "ipq_url": "",
        "has_data": False,
        "target_count": 0,
        "history_count": 0,
        "install_token": "",
    }


def main():
    komari_base = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_KOMARI_BASE
    ipq_base = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_IPQ_BASE
    output_path = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT_DIR / ".tmp" / "dev-preview" / "review-data-summary.json"
    db_path = Path(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_DB_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)

    komari_opener = build_opener()
    ipq_opener = build_opener()
    login_komari(komari_opener, komari_base)
    login_ipq(ipq_opener, ipq_base)

    clear_all_nodes(komari_opener, komari_base, ipq_opener, ipq_base)

    sample = load_sample_result()
    summary = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "komari_base": komari_base,
        "ipq_base": ipq_base,
        "nodes": [],
    }

    summary["nodes"].append(
        create_komari_only_node(
            komari_opener,
            komari_base,
            {"category": "未接入 IPQ", "komari_name": "komari-01-未接入"},
        )
    )

    bound_specs = [
        {
            "category": "已接入 IPQ / 空节点",
            "komari_name": "komari-02-空节点",
            "ipq_name": "ipq-02-空节点",
            "targets": [],
            "history": [],
        },
        {
            "category": "已接入 IPQ / 无数据",
            "komari_name": "komari-03-无数据",
            "ipq_name": "ipq-03-无数据",
            "targets": ["203.0.113.30"],
            "history": [],
            "force_no_data": True,
        },
        {
            "category": "已接入 IPQ / 单条数据",
            "komari_name": "komari-04-单条数据",
            "ipq_name": "ipq-04-单条数据",
            "targets": ["203.0.113.40"],
            "history": [{"ip": "203.0.113.40", "summary": "首次上报"}],
        },
        {
            "category": "已接入 IPQ / 多条历史",
            "komari_name": "komari-05-多条历史",
            "ipq_name": "ipq-05-多条历史",
            "targets": ["203.0.113.50"],
            "history": [
                {"ip": "203.0.113.50", "summary": "第 1 次上报"},
                {"ip": "203.0.113.50", "summary": "第 2 次上报"},
                {"ip": "203.0.113.50", "summary": "第 3 次上报"},
                {"ip": "203.0.113.50", "summary": "第 4 次上报"},
                {"ip": "203.0.113.50", "summary": "第 5 次上报"},
            ],
        },
        {
            "category": "真实上报节点",
            "komari_name": "komari-06-真实上报",
            "ipq_name": "ipq-06-真实上报",
            "targets": [],
            "history": [],
        },
    ]

    for spec in bound_specs:
        summary["nodes"].append(create_bound_node(komari_opener, komari_base, ipq_opener, ipq_base, sample, spec, db_path))

    summary["nodes"].append(
        create_standalone_node(
            ipq_opener,
            ipq_base,
            sample,
            {
                "category": "IPQ 独立节点",
                "ipq_name": "ipq-07-独立节点",
                "targets": ["203.0.113.70"],
                "history": [],
                "force_no_data": True,
            },
            db_path,
        )
    )

    real_node = next(node for node in summary["nodes"] if node["category"] == "真实上报节点")
    with output_path.open("w", encoding="utf-8") as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)

    print(f"已重建验收节点集：{output_path}")
    for item in summary["nodes"]:
        print(f"- {item['category']}: {item['name']}")
        if item["komari_url"]:
            print(f"  Komari: {item['komari_url']}")
        if item["ipq_node_uuid"]:
            print(f"  IPQ: {ipq_base}/#/nodes/{item['ipq_node_uuid']}")
    print(f"真实上报节点 install token: {real_node['install_token']}")


if __name__ == "__main__":
    main()
