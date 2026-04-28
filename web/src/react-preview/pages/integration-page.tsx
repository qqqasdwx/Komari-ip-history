import { useEffect, useState } from "react";
import { apiRequest, UnauthorizedError } from "../lib/api";
import { copyText } from "../lib/clipboard";
import type { IntegrationSettings, MeResponse, RuntimeResponse } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { pushToast } from "../components/toast";

function buildPreviewPath(variant: "loader" | "inline", baseURL: string) {
  const query = new URLSearchParams({ variant });
  if (baseURL) {
    query.set("public_base_url", baseURL);
  }
  return `/admin/header-preview?${query.toString()}`;
}

export function IntegrationPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [integration, setIntegration] = useState<IntegrationSettings | null>(null);
  const [publicBaseURLInput, setPublicBaseURLInput] = useState("");
  const [guestReadEnabledInput, setGuestReadEnabledInput] = useState(false);
  const [loaderCode, setLoaderCode] = useState("");
  const [inlineCode, setInlineCode] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingGuestRead, setSavingGuestRead] = useState(false);
  const publicBaseURL = (integration?.public_base_url ?? "").trim();
  const savedPublicBaseURL = (integration?.public_base_url ?? "").trim();
  const savedGuestReadEnabled = Boolean(integration?.guest_read_enabled);
  const basePath = runtime?.base_path || props.me.base_path || "";
  const suggestedPublicBaseURL = `${window.location.origin}${basePath || ""}`.replace(/\/$/, "");
  const previewPublicBaseURL = publicBaseURL || suggestedPublicBaseURL;
  const publicBaseURLDirty = publicBaseURLInput.trim() !== savedPublicBaseURL;
  const guestReadDirty = guestReadEnabledInput !== savedGuestReadEnabled;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [runtimeResponse, integrationResponse, loaderPreview, inlinePreview] = await Promise.all([
          apiRequest<RuntimeResponse>("/admin/runtime"),
          apiRequest<IntegrationSettings>("/admin/integration"),
          apiRequest<{ code: string }>(buildPreviewPath("loader", previewPublicBaseURL)),
          apiRequest<{ code: string }>(buildPreviewPath("inline", previewPublicBaseURL))
        ]);

        if (cancelled) {
          return;
        }

        setRuntime(runtimeResponse);
        setIntegration(integrationResponse);
        setPublicBaseURLInput(integrationResponse.public_base_url ?? "");
        setGuestReadEnabledInput(Boolean(integrationResponse.guest_read_enabled));
        setLoaderCode(loaderPreview.code);
        setInlineCode(inlinePreview.code);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof UnauthorizedError) {
          props.onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载接入配置失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [props.onUnauthorized, previewPublicBaseURL]);

  async function handleCopy(value: string, successText: string) {
    try {
      await copyText(value);
      pushToast(successText);
    } catch {
      pushToast("复制失败，请手动复制。", "error");
    }
  }

  async function saveIntegrationSettings(
    nextValue: string,
    guestReadEnabled: boolean,
    options: { saving: "address" | "guest"; successText: string; errorText: string }
  ) {
    if (options.saving === "address") {
      setSavingAddress(true);
    } else {
      setSavingGuestRead(true);
    }
    setError("");
    try {
      const saved = await apiRequest<IntegrationSettings>("/admin/integration", {
        method: "PUT",
        body: JSON.stringify({ public_base_url: nextValue, guest_read_enabled: guestReadEnabled })
      });
      setIntegration(saved);
      setPublicBaseURLInput(saved.public_base_url ?? "");
      setGuestReadEnabledInput(Boolean(saved.guest_read_enabled));
      const nextPreviewPublicBaseURL = saved.public_base_url || suggestedPublicBaseURL;

      const [runtimeResponse, loaderPreview, inlinePreview] = await Promise.all([
        apiRequest<RuntimeResponse>("/admin/runtime"),
        apiRequest<{ code: string }>(buildPreviewPath("loader", nextPreviewPublicBaseURL)),
        apiRequest<{ code: string }>(buildPreviewPath("inline", nextPreviewPublicBaseURL))
      ]);
      setRuntime(runtimeResponse);
      setLoaderCode(loaderPreview.code);
      setInlineCode(inlinePreview.code);
      pushToast(options.successText);
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : options.errorText);
    } finally {
      if (options.saving === "address") {
        setSavingAddress(false);
      } else {
        setSavingGuestRead(false);
      }
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="接入配置" subtitle="复制 Header 到 Komari。默认按独立部署接入，需要时再兼容子路径。" />

      {loading ? (
        <div className="grid gap-4">
          <div className="h-36 animate-pulse rounded-[24px] bg-slate-100" />
          <div className="h-44 animate-pulse rounded-[24px] bg-slate-100" />
          <div className="h-44 animate-pulse rounded-[24px] bg-slate-100" />
        </div>
      ) : error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">{error}</div>
      ) : (
        <>
          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">接入地址</h2>
                <p className="text-sm leading-6 text-slate-500">
                  默认留空即可，系统会按你当前访问本服务时的地址生成 Header。只有在你需要固定域名、端口，或希望用户统一通过某个外部地址访问时，再手动填写。
                </p>
              </div>

              <label className="flex w-full flex-col gap-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">手动覆盖地址（可选）</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                  placeholder={suggestedPublicBaseURL || window.location.origin}
                  value={publicBaseURLInput}
                  onChange={(event) => setPublicBaseURLInput(event.target.value)}
                  type="text"
                />
              </label>

              <p className="text-sm leading-6 text-slate-500">
                {publicBaseURL
                  ? `当前已固定为：${publicBaseURL}`
                  : `留空时将使用：${suggestedPublicBaseURL || window.location.origin}`}
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  className="button"
                  disabled={savingAddress || !publicBaseURLDirty}
                  onClick={() =>
                    void saveIntegrationSettings(publicBaseURLInput, savedGuestReadEnabled, {
                      saving: "address",
                      successText: publicBaseURLInput.trim() ? "接入地址已保存。" : "已恢复为自动推导地址。",
                      errorText: "保存接入地址失败"
                    })
                  }
                  type="button"
                >
                  {savingAddress ? "保存中…" : "保存"}
                </button>
                <button
                  className="button ghost"
                  disabled={savingAddress || savedPublicBaseURL === ""}
                  onClick={() =>
                    void saveIntegrationSettings("", savedGuestReadEnabled, {
                      saving: "address",
                      successText: "已恢复为自动推导地址。",
                      errorText: "恢复默认地址失败"
                    })
                  }
                  type="button"
                >
                  恢复默认
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">游客只读</h2>
                <p className="text-sm leading-6 text-slate-500">
                  只影响 Komari 注入弹窗。开启后，Komari 游客在节点本身公开时可查看当前结果；关闭后，游客点击按钮只会收到提示。
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <input
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={guestReadEnabledInput}
                  onChange={(event) => setGuestReadEnabledInput(event.target.checked)}
                  type="checkbox"
                />
                <span className="space-y-1">
                  <span className="block font-medium text-slate-900">允许游客查看已接入节点的当前结果</span>
                  <span className="block text-slate-500">默认关闭。管理员链路和后台页面不受影响。</span>
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="button"
                  disabled={savingGuestRead || !guestReadDirty}
                  onClick={() =>
                    void saveIntegrationSettings(savedPublicBaseURL, guestReadEnabledInput, {
                      saving: "guest",
                      successText: guestReadEnabledInput ? "已开放游客只读。" : "已关闭游客只读。",
                      errorText: "保存游客只读设置失败"
                    })
                  }
                  type="button"
                >
                  {savingGuestRead ? "保存中…" : "保存游客只读设置"}
                </button>
                <span className="text-sm text-slate-500">
                  {savedGuestReadEnabled ? "当前状态：已开放" : "当前状态：未开放"}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="section-head">
              <div>
                <h2>推荐方案：loader 版</h2>
                <p className="muted">推荐优先使用 loader 版，后续更新通常不需要重新复制整段代码。</p>
              </div>
              <button className="button" onClick={() => void handleCopy(loaderCode, "短 loader 版代码已复制。")} type="button">
                复制 loader 版
              </button>
            </div>
            <pre className="code-block code-block-compact">{loaderCode}</pre>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="section-head">
              <div>
                <h2>完整内联版</h2>
                <p className="muted">只有在你明确不想依赖 loader 时再使用。逻辑更新后需要重新复制。</p>
              </div>
              <button className="button ghost" onClick={() => void handleCopy(inlineCode, "完整内联版代码已复制。")} type="button">
                复制完整内联版
              </button>
            </div>
            <pre className="code-block code-block-compact">{inlineCode}</pre>
          </section>
        </>
      )}
    </section>
  );
}
