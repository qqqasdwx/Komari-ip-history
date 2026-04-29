import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, UnauthorizedError } from "../lib/api";
import type { MeResponse } from "../lib/types";
import { PageHeader } from "../components/layout/page-header";
import { pushToast } from "../components/toast";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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

      <Card className="p-6">
        <div className="summary-section">
          <div className="summary-head">
            <strong>当前用户</strong>
            <Badge variant="secondary">单用户模式</Badge>
          </div>
          <div className="muted">当前登录账号：{props.me.username ?? "admin"}。修改后会要求重新登录。</div>
        </div>

        <form className="mt-6 grid gap-4" onSubmit={handleSave}>
          <div className="grid gap-2">
            <Label className="font-normal text-slate-700" htmlFor="admin-username">
              新用户名
            </Label>
            <Input
              className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
              id="admin-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label className="font-normal text-slate-700" htmlFor="admin-password">
              新密码
            </Label>
            <Input
              className="h-11 rounded-xl px-3 focus:border-indigo-300 focus:ring-indigo-100"
              id="admin-password"
              type="password"
              placeholder="留空表示不修改密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div>
            <Button className="rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white hover:bg-[#6868e8]" type="submit" disabled={saving}>
              {saving ? "保存中..." : "保存并重新登录"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
