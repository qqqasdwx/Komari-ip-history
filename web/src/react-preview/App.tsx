import {
  ExitIcon,
  GearIcon,
  RowsIcon
} from "@radix-ui/react-icons";
import {
  useEffect,
  useState
} from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";
import { apiRequest } from "./lib/api";
import { routeLabel } from "./lib/route-label";
import type { MeResponse } from "./lib/types";
import { AppLoading } from "./components/layout/app-loading";
import {
  EmbedFrameShell,
  getEmbedAppearance,
  getEmbedGlassStyle,
  getEmbedTheme
} from "./components/layout/embed-frame-shell";
import { SidebarSection, type NavItem } from "./components/layout/sidebar-section";
import { ToastViewport } from "./components/toast";
import { AdminPage } from "./pages/admin-page";
import { ConnectPage } from "./pages/connect-page";
import { EmbedAdminAccessBridge } from "./pages/embed-admin-access-bridge";
import { HistoryRetentionPage } from "./pages/history-retention-page";
import { IntegrationPage } from "./pages/integration-page";
import { LoginPage } from "./pages/login-page";
import { NodeDetailPage } from "./pages/node-detail-page";
import { NodeHistoryComparePage } from "./pages/node-history-compare-page";
import { NodeHistoryPage } from "./pages/node-history-page";
import { NodesPage } from "./pages/nodes-page";
import { PublicNodeDetailPage } from "./pages/public-node-detail-page";

const nodeNavItems: NavItem[] = [{ to: "/nodes", label: "节点结果", icon: <RowsIcon /> }];

const settingsNavItems: NavItem[] = [
  { to: "/settings/integration", label: "接入配置", icon: <GearIcon /> },
  { to: "/settings/history-retention", label: "历史保留", icon: <GearIcon /> },
  { to: "/settings/user", label: "用户", icon: <GearIcon /> }
];

function AppShell(props: { me: MeResponse; onLogout: () => Promise<void>; onUnauthorized: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const embedTheme = getEmbedTheme(searchParams);
  const embedAppearance = getEmbedAppearance(searchParams);
  const embedGlassStyle = getEmbedGlassStyle(searchParams);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (!isEmbed) {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
      return;
    }

    root.dataset.ipqEmbedTheme = embedTheme;
    body.dataset.ipqEmbedTheme = embedTheme;
    root.dataset.ipqEmbedAppearance = embedAppearance;
    body.dataset.ipqEmbedAppearance = embedAppearance;

    return () => {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
    };
  }, [embedAppearance, embedTheme, isEmbed]);

  const content = (
    <Routes>
      <Route path="/" element={<Navigate to="/nodes" replace />} />
      <Route path="/connect" element={<ConnectPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes" element={<NodesPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid" element={<NodeDetailPage me={props.me} onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/history" element={<NodeHistoryPage onUnauthorized={props.onUnauthorized} />} />
      <Route path="/nodes/:uuid/compare" element={<NodeHistoryComparePage onUnauthorized={props.onUnauthorized} />} />
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
    return (
      <div
        className={`embed-shell embed-theme-${embedTheme} embed-appearance-${embedAppearance} bg-slate-50 text-slate-900`}
        style={embedGlassStyle}
      >
        <div className="embed-panel mx-auto max-w-[1120px] space-y-6">{content}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="react-preview-shell grid min-h-screen grid-cols-1">
        <aside className="border-b border-slate-200 bg-white px-4 py-5 lg:border-b-0 lg:border-r">
          <div className="space-y-1 px-3 pb-6">
            <p className="text-3xl font-medium tracking-tight text-slate-900">Komari</p>
            <p className="text-sm text-slate-400">IP Quality</p>
          </div>
          <nav className="space-y-6">
            <SidebarSection title="节点" items={nodeNavItems} />
            <SidebarSection title="设置" items={settingsNavItems} />
          </nav>
        </aside>
        <main className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 lg:px-8">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Komari IP Quality</p>
              <p className="text-sm text-slate-500">{routeLabel(location.pathname)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-500">
                模式 {props.me.app_env ?? "unknown"}
              </span>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600"
                onClick={() => void props.onLogout()}
                type="button"
              >
                <ExitIcon />
                <span>退出登录</span>
              </button>
            </div>
          </header>
          <div className="space-y-6 px-6 pb-8 lg:px-8">{content}</div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await apiRequest<MeResponse>("/auth/me");
        if (cancelled) {
          return;
        }
        setMe(response.logged_in ? response : null);
      } catch {
        if (!cancelled) {
          setMe(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      navigate("/login", { replace: true });
    }
  }

  if (loading) {
    return <AppLoading />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to={me ? "/nodes" : "/login"} replace />} />
        <Route
          path="/public/nodes/:uuid"
          element={
            <EmbedFrameShell>
              <PublicNodeDetailPage />
            </EmbedFrameShell>
          }
        />
        <Route
          path="/login"
          element={<LoginPage me={me} onAuthenticated={(nextMe) => setMe(nextMe)} />}
        />
        <Route
          path="/*"
          element={
            me ? (
              <AppShell
                me={me}
                onLogout={handleLogout}
                onUnauthorized={() => {
                  setMe(null);
                }}
              />
            ) : (
              isEmbed ? (
                <EmbedAdminAccessBridge />
              ) : (
                <Navigate to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />
              )
            )
          }
        />
      </Routes>
      <ToastViewport />
    </>
  );
}
