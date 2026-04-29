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
import type { MeResponse } from "./lib/types";
import { AppShell } from "./components/layout/app-shell";
import { AppLoading } from "./components/layout/app-loading";
import { EmbedFrameShell } from "./components/layout/embed-frame-shell";
import { ToastViewport } from "./components/toast";
import { EmbedAdminAccessBridge } from "./pages/embed-admin-access-bridge";
import { LoginPage } from "./pages/login-page";
import { PublicNodeDetailPage } from "./pages/public-node-detail-page";

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
                <EmbedFrameShell>
                  <EmbedAdminAccessBridge />
                </EmbedFrameShell>
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
