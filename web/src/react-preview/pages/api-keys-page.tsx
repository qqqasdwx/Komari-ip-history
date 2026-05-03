import { type FormEvent, useEffect, useState } from "react";
import { Copy, KeyRound, PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { formatDateTime } from "../lib/format";
import type { APIAccessLogResponse, APIKeyItem, APIKeyListResponse } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { pushToast } from "../components/toast";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function statusClass(status: number) {
  if (status >= 200 && status < 300) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === 429) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status >= 400) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function APIKeysPage(props: { onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keys, setKeys] = useState<APIKeyItem[]>([]);
  const [logs, setLogs] = useState<APIAccessLogResponse | null>(null);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<APIKeyItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyID, setBusyID] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [keyResponse, logResponse] = await Promise.all([
        apiRequest<APIKeyListResponse>("/admin/api-keys"),
        apiRequest<APIAccessLogResponse>("/admin/api-access-logs?page_size=20")
      ]);
      setKeys(keyResponse.items);
      setLogs(logResponse);
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载开放 API 设置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写密钥名称。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const item = await apiRequest<APIKeyItem>("/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: trimmedName })
      });
      setCreatedKey(item);
      setName("");
      await load();
      pushToast("访问密钥已创建。");
    } catch (createError) {
      if (createError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(createError instanceof Error ? createError.message : "创建访问密钥失败");
    } finally {
      setSaving(false);
    }
  }

  async function copyCreatedKey() {
    if (!createdKey?.plaintext_key) {
      return;
    }
    try {
      await copyText(createdKey.plaintext_key);
      pushToast("访问密钥已复制。");
    } catch {
      pushToast("复制失败，请手动复制。", "error");
    }
  }

  async function updateKey(item: APIKeyItem, enabled: boolean) {
    setBusyID(item.id);
    setError("");
    try {
      await apiRequest<APIKeyItem>(`/admin/api-keys/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
      await load();
      pushToast(enabled ? "访问密钥已启用。" : "访问密钥已停用。");
    } catch (updateError) {
      if (updateError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(updateError instanceof Error ? updateError.message : "更新访问密钥失败");
    } finally {
      setBusyID(null);
    }
  }

  async function deleteKey(item: APIKeyItem) {
    if (!window.confirm(`删除访问密钥「${item.name}」？删除后使用它的调用会被拒绝。`)) {
      return;
    }
    setBusyID(item.id);
    setError("");
    try {
      await apiRequest(`/admin/api-keys/${item.id}`, { method: "DELETE" });
      if (createdKey?.id === item.id) {
        setCreatedKey(null);
      }
      await load();
      pushToast("访问密钥已删除。");
    } catch (deleteError) {
      if (deleteError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(deleteError instanceof Error ? deleteError.message : "删除访问密钥失败");
    } finally {
      setBusyID(null);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="开放 API" subtitle="管理外部系统读取节点结果所需的访问密钥。" />

      {error ? <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</Card> : null}

      <Card className="p-6">
        <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]" onSubmit={createKey}>
          <div className="grid gap-2">
            <Label className="text-slate-900" htmlFor="api-key-name">
              密钥名称
            </Label>
            <Input
              className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
              id="api-key-name"
              placeholder="例如：监控系统"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              className="h-11 rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]"
              disabled={saving}
              type="submit"
            >
              <KeyRound className="size-4" />
              <span>{saving ? "创建中..." : "创建访问密钥"}</span>
            </Button>
          </div>
        </form>
      </Card>

      {createdKey?.plaintext_key ? (
        <Card className="border-amber-200 bg-amber-50 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-amber-950">请立即保存访问密钥</h2>
                <Badge className="border-amber-300 bg-amber-100 text-amber-800">仅显示一次</Badge>
              </div>
              <p
                className="break-all rounded-xl border border-amber-200 bg-white px-3 py-3 font-mono text-sm text-amber-950"
                data-api-key-plaintext="true"
              >
                {createdKey.plaintext_key}
              </p>
            </div>
            <Button
              className="rounded-lg border border-amber-300 bg-white px-3 text-[13px] text-amber-800 hover:bg-amber-100"
              onClick={() => void copyCreatedKey()}
              type="button"
            >
              <Copy className="size-4" />
              <span>复制</span>
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">访问密钥</h2>
            <p className="text-sm text-slate-500">停用或删除后，对外 API 请求会立即被拒绝。</p>
          </div>
          <Button
            className="rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
            onClick={() => void load()}
            type="button"
          >
            刷新
          </Button>
        </div>

        {loading ? (
          <div className="grid gap-3">
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            暂无访问密钥。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">前缀</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">最近使用</th>
                  <th className="px-3 py-2 font-medium">创建时间</th>
                  <th className="px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {keys.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900">{item.name}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-500">{item.key_prefix}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Badge className={item.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                        {item.enabled ? "已启用" : "已停用"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(item.last_used_at ?? undefined)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(item.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.enabled ? (
                          <Button
                            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50"
                            disabled={busyID === item.id}
                            onClick={() => void updateKey(item, false)}
                            type="button"
                          >
                            <PauseCircle className="size-4" />
                            <span>停用</span>
                          </Button>
                        ) : (
                          <Button
                            className="h-9 rounded-lg border border-emerald-200 bg-white px-3 text-[13px] text-emerald-700 hover:bg-emerald-50"
                            disabled={busyID === item.id}
                            onClick={() => void updateKey(item, true)}
                            type="button"
                          >
                            <PlayCircle className="size-4" />
                            <span>启用</span>
                          </Button>
                        )}
                        <Button
                          className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-[13px] text-rose-700 hover:bg-rose-50"
                          disabled={busyID === item.id}
                          onClick={() => void deleteKey(item)}
                          type="button"
                        >
                          <Trash2 className="size-4" />
                          <span>删除</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">访问日志</h2>
          <p className="text-sm text-slate-500">展示最近 20 次对外 API 调用。</p>
        </div>
        {loading ? (
          <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
        ) : !logs || logs.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            暂无访问日志。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">密钥</th>
                  <th className="px-3 py-2 font-medium">方法</th>
                  <th className="px-3 py-2 font-medium">路径</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {logs.items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(item.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="font-medium text-slate-900">{item.key_name || "未通过认证"}</div>
                      <div className="font-mono text-xs text-slate-400">{item.key_prefix || "-"}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{item.method}</td>
                    <td className="max-w-[520px] truncate px-3 py-3 font-mono text-xs text-slate-500" title={item.path}>
                      {item.path}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Badge className={statusClass(item.status_code)}>{item.status_code}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
