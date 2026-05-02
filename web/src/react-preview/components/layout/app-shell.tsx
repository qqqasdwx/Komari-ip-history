import {
  ArrowLeft,
  Camera,
  Clock3,
  History,
  Info,
  LogOut,
  Menu,
  Plug,
  Server,
  Settings,
  UserCog,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams
} from "react-router-dom";
import { routeLabel } from "../../lib/route-label";
import type { MeResponse } from "../../lib/types";
import { AdminPage } from "../../pages/admin-page";
import { ConnectPage } from "../../pages/connect-page";
import { HistoryRetentionPage } from "../../pages/history-retention-page";
import { IntegrationPage } from "../../pages/integration-page";
import { NodeDetailPage } from "../../pages/node-detail-page";
import { NodeHistoryComparePage } from "../../pages/node-history-compare-page";
import { NodeHistoryPage } from "../../pages/node-history-page";
import { NodeSettingsPage } from "../../pages/node-settings-page";
import { NodesPage } from "../../pages/nodes-page";
import { Button } from "../ui/button";
import { EmbedFrameShell } from "./embed-frame-shell";
import { SidebarSection, type NavItem } from "./sidebar-section";

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <Server />, end: true }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <Plug /> },
  { to: "/settings/history-retention", label: "历史保留", icon: <Clock3 /> },
  { to: "/settings/user", label: "用户", icon: <UserCog /> }
];

function nodeWorkspaceItems(uuid: string): NavItem[] {
  return [
    { to: "/nodes", label: "返回", icon: <ArrowLeft />, end: true },
    { to: `/nodes/${uuid}/settings`, label: "设置", icon: <Settings />, end: true },
    { to: `/nodes/${uuid}`, label: "详情", icon: <Info />, end: true },
    { to: `/nodes/${uuid}/history`, label: "历史", icon: <History /> },
    { to: `/nodes/${uuid}/snapshots`, label: "快照", icon: <Camera /> }
  ];
}

function ShellSidebar(props: { nodeUUID?: string; onNavigate?: () => void }) {
  if (props.nodeUUID) {
    return (
      <div className="flex h-full flex-col">
        <div className="space-y-1 px-3 pb-6">
          <p className="text-3xl font-medium tracking-tight text-slate-900">Komari</p>
          <p className="text-sm text-slate-400">节点工作区</p>
        </div>
        <nav className="space-y-6">
          <SidebarSection title="节点" items={nodeWorkspaceItems(props.nodeUUID)} onNavigate={props.onNavigate} />
        </nav>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1 px-3 pb-6">
        <p className="text-3xl font-medium tracking-tight text-slate-900">Komari</p>
        <p className="text-sm text-slate-400">IP Quality</p>
      </div>
      <nav className="space-y-6">
        <SidebarSection title="节点" items={nodeNavItems} onNavigate={props.onNavigate} />
        <SidebarSection title="设置" items={settingsNavItems} onNavigate={props.onNavigate} />
      </nav>
    </div>
  );
}

function LegacyCompareRedirect() {
  const { uuid = "" } = useParams();
  const location = useLocation();
  return <Navigate to={`/nodes/${uuid}/snapshots${location.search}`} replace />;
}

export function AppShell(props: { me: MeResponse; onLogout: () => Promise<void>; onUnauthorized: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isEmbed = searchParams.get("embed") === "1";
  const nodeWorkspaceMatch = /^\/nodes\/([^/]+)(?:\/|$)/.exec(location.pathname);
  const nodeWorkspaceUUID = !isEmbed ? nodeWorkspaceMatch?.[1] ?? "" : "";

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const content = (
    <Routes>
      <Route path="/" element={<Navigate to="/nodes" replace />} />
      <Route path="/connect" element={<ConnectPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes" element={<NodesPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/settings" element={<NodeSettingsPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid" element={<NodeDetailPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/history" element={<NodeHistoryPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/snapshots" element={<NodeHistoryComparePage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/compare" element={<LegacyCompareRedirect />} />
      <Route path="/nodes/:uuid/changes" element={<Navigate to="../history" relative="path" replace />} />
      <Route path="/settings/integration" element={<IntegrationPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/history-retention" element={<HistoryRetentionPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/settings/fields" element={<Navigate to="/nodes" replace />} />
      <Route path="/settings/admin" element={<Navigate to="/settings/user" replace />} />
      <Route
        path="/settings/user"
        element={<AdminPage me={props.me} onUnauthorized={props.onUnauthorized} />}
      />
      <Route path="*" element={<Navigate to="/nodes" replace />} />
    </Routes>
  );

  if (isEmbed) {
    return <EmbedFrameShell>{content}</EmbedFrameShell>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="关闭导航遮罩"
            className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
            onClick={() => setMobileNavOpen(false)}
            type="button"
          />
          <aside className="absolute inset-y-0 left-0 w-[min(84vw,320px)] border-r border-slate-200 bg-white px-4 py-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                <Settings className="size-4" />
                菜单
              </span>
              <Button
                aria-label="关闭导航"
                className="size-9 rounded-full border border-slate-200 bg-white p-0 text-slate-700 hover:bg-slate-50"
                onClick={() => setMobileNavOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </Button>
            </div>
            <ShellSidebar nodeUUID={nodeWorkspaceUUID} onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="react-preview-shell grid min-h-screen grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-slate-200 bg-white px-4 py-5 lg:block">
          <ShellSidebar nodeUUID={nodeWorkspaceUUID} />
        </aside>
        <main className="min-w-0">
          <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/90 px-4 py-4 backdrop-blur lg:static lg:border-b-0 lg:px-8 lg:py-5">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                aria-expanded={mobileNavOpen}
                aria-label="打开导航"
                className="size-10 rounded-full border border-slate-200 bg-white p-0 text-slate-700 hover:bg-slate-50 lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                type="button"
              >
                <Menu className="size-4" />
              </Button>
              <div className="min-w-0 space-y-1">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Komari IP Quality</p>
                <p className="truncate text-sm text-slate-500">{routeLabel(location.pathname)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-500">
                模式 {props.me.app_env ?? "unknown"}
              </span>
              <Button
                className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                onClick={() => void props.onLogout()}
                type="button"
              >
                <LogOut className="size-4" />
                <span>退出登录</span>
              </Button>
            </div>
          </header>
          <div className="space-y-6 px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-0">{content}</div>
        </main>
      </div>
    </div>
  );
}
