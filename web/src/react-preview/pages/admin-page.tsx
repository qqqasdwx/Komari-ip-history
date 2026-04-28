import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, UnauthorizedError } from "../lib/api";
import type { MeResponse } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { pushToast } from "../components/toast";

export function AdminPage(props: { me: MeResponse; onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState(props.me.username ?? "admin");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest("/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ username: username.trim(), password })
      });
      pushToast("用户信息已保存，请重新登录。");
      navigate("/login", { replace: true });
    } catch (saveError) {
      if (saveError instanceof UnauthorizedError) {
        props.onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存用户设置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="用户" subtitle="修改登录账号和密码。" />

      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="summary-section">
          <div className="summary-head">
            <strong>当前用户</strong>
            <span className="chip">单用户模式</span>
          </div>
          <div className="muted">当前登录账号：{props.me.username ?? "admin"}。修改后会要求重新登录。</div>
        </div>

        <form className="section mt-6 space-y-4" onSubmit={handleSave}>
          <label className="grid gap-2 text-sm text-slate-700">
            <span>新用户名</span>
            <input
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm text-slate-700">
            <span>新密码</span>
            <input
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              type="password"
              placeholder="留空表示不修改密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div>
            <button className="button" type="submit" disabled={saving}>
              {saving ? "保存中..." : "保存并重新登录"}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}
