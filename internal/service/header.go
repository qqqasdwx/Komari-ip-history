package service

import (
	"fmt"
	"net/url"
	"strings"

	"komari-ip-history/internal/config"
)

func HeaderPreview(cfg config.Config, publicBaseURL string, guestReadEnabled bool, variant string) string {
	if variant == "inline" {
		return strings.TrimSpace("<script>\n" + LoaderScript(cfg, publicBaseURL, guestReadEnabled) + "\n</script>")
	}

	loaderSrcExpr := fmt.Sprintf(`(window.location.origin + %q).replace(/\/+$/, "") + "/embed/loader.js"`, cfg.BasePath)
	if publicBaseURL != "" {
		loaderSrcExpr = fmt.Sprintf(`%q + "/embed/loader.js"`, publicBaseURL)
		if parsed, err := url.Parse(publicBaseURL); err == nil {
			host := parsed.Hostname()
			port := parsed.Port()
			if host != "" && regexpLikeLocalhost(host) {
				if port != "" {
					loaderSrcExpr = fmt.Sprintf(`(window.location.protocol + "//" + window.location.hostname + ":%s" + %q).replace(/\/+$/, "") + "/embed/loader.js"`, port, cfg.BasePath)
				} else {
					loaderSrcExpr = fmt.Sprintf(`(window.location.protocol + "//" + window.location.hostname + %q).replace(/\/+$/, "") + "/embed/loader.js"`, cfg.BasePath)
				}
			}
		}
	}

	return strings.TrimSpace(fmt.Sprintf(`<script>
(function () {
  var script = document.createElement("script");
  script.src = %s + "?v=" + Date.now();
  script.defer = true;
  document.head.appendChild(script);
}());
</script>`, loaderSrcExpr))
}

func regexpLikeLocalhost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "localhost" || host == "0.0.0.0" {
		return true
	}
	return strings.HasPrefix(host, "127.")
}

func LoaderScript(cfg config.Config, publicBaseURL string, guestReadEnabled bool) string {
	return fmt.Sprintf(`(() => {
  const BASE_PATH = %q;
  const CONFIGURED_APP_BASE = %q;
  const GUEST_READ_ENABLED = %t;
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  const ROUTE_HINT_RE = /(client|clients|node|nodes|server|servers)/i;
  const ACTION_HINT_RE = /(编辑|删除|终端|命令|执行|Edit|Delete|Terminal|Command|Run)/i;
  const TITLE_BLACKLIST = /^(komari|dashboard|nodes|node|clients|client|服务器|节点)$/i;
  const state = {
    contextKey: "",
    button: null,
    portal: null,
    overlay: null,
    iframe: null,
    openLink: null,
    connectContext: null,
    connectButton: null,
    retryTimers: [],
    routeCycle: 0,
    busy: false,
    entryStateCache: {},
    entryStatePromises: {},
    themeName: "default",
    themeSettings: {},
    themeLoaded: false
  };

  if (window.__IPQ_LOADER_ATTACHED__) return;
  window.__IPQ_LOADER_ATTACHED__ = true;

  function getAppBase() {
    if (CONFIGURED_APP_BASE) {
      try {
        const configured = new URL(CONFIGURED_APP_BASE, window.location.href);
        if (configured.hostname && /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/i.test(configured.hostname)) {
          if (document.currentScript && document.currentScript.src) {
            return (new URL(document.currentScript.src, window.location.href)).origin + BASE_PATH;
          }
        }
      } catch (_) {}
      return CONFIGURED_APP_BASE.replace(/\/+$/, "");
    }
    try {
      if (document.currentScript && document.currentScript.src) {
        return (new URL(document.currentScript.src, window.location.href)).origin + BASE_PATH;
      }
    } catch (_) {}
    return window.location.origin + BASE_PATH;
  }

  const APP_BASE = getAppBase().replace(/\/+$/, "");
  const API_BASE = APP_BASE + "/api/v1/embed";
  const CACHE_BUST = Date.now().toString(36);
  function isDebugEnabled() {
    if (/(?:^|[?&])ipq_debug=1(?:&|$)/.test(window.location.search)) return true;
    try {
      return window.localStorage && window.localStorage.getItem("ipqLoaderDebug") === "1";
    } catch (_) {
      return false;
    }
  }

  const DEBUG_ENABLED = isDebugEnabled();

  function debugLog(event, detail) {
    if (!DEBUG_ENABLED || !window.console || !window.console.debug) return;
    window.console.debug("[IPQ Loader]", event, detail || "");
  }

  function clearRetryTimers() {
    while (state.retryTimers.length) {
      window.clearTimeout(state.retryTimers.pop());
    }
  }

  function scheduleRouteSync() {
    state.routeCycle += 1;
    const cycle = state.routeCycle;
    clearRetryTimers();

    [0, 80, 220, 520, 1100, 1800].forEach(function (delay) {
      const timer = window.setTimeout(function () {
        if (cycle !== state.routeCycle) return;
        sync();
      }, delay);
      state.retryTimers.push(timer);
    });
  }

  function ensureStyle() {
    if (document.getElementById("ipq-loader-style")) return;
    const style = document.createElement("style");
    style.id = "ipq-loader-style";
    style.textContent = [
      "#ipq-loader-portal {",
      "  position: fixed;",
      "  right: 24px;",
      "  bottom: 24px;",
      "  z-index: 99998;",
      "}",
      ".ipq-loader-button {",
      "  appearance: none;",
      "  border: 0;",
      "  border-radius: 999px;",
      "  padding: 10px 16px;",
      "  font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  color: #f7fffd;",
      "  background: linear-gradient(135deg, #0f766e, #155e75);",
      "  box-shadow: 0 12px 30px rgba(15, 118, 110, 0.28);",
      "  cursor: pointer;",
      "  transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease;",
      "}",
      ".ipq-loader-button:hover {",
      "  transform: translateY(-1px);",
      "  box-shadow: 0 16px 34px rgba(15, 118, 110, 0.32);",
      "}",
      ".ipq-loader-button[data-ipq-entry-state=\"pending\"]:not(.ipq-node-icon-button),",
      ".ipq-loader-button[data-ipq-entry-state=\"unknown\"]:not(.ipq-node-icon-button) {",
      "  color: #334155;",
      "  background: #e2e8f0;",
      "  box-shadow: 0 10px 24px rgba(100, 116, 139, 0.16);",
      "}",
      ".ipq-loader-button[data-ipq-entry-state=\"pending\"]:not(.ipq-node-icon-button):hover,",
      ".ipq-loader-button[data-ipq-entry-state=\"unknown\"]:not(.ipq-node-icon-button):hover {",
      "  box-shadow: 0 14px 30px rgba(100, 116, 139, 0.2);",
      "}",
      ".ipq-loader-button:disabled {",
      "  cursor: wait;",
      "  opacity: 0.72;",
      "}",
      ".ipq-loader-button.ipq-floating {",
      "  min-width: 168px;",
      "}",
      ".ipq-loader-inline-slot {",
      "  display: flex;",
      "  justify-content: flex-start;",
      "  margin-top: 12px;",
      "}",
      ".ipq-loader-inline-slot .ipq-loader-button {",
      "  box-shadow: 0 10px 24px rgba(15, 118, 110, 0.18);",
      "}",
      ".ipq-loader-overlay {",
      "  position: fixed;",
      "  inset: 0;",
      "  display: none;",
      "  align-items: center;",
      "  justify-content: center;",
      "  padding: 28px;",
      "  background: rgba(15, 23, 42, 0.48);",
      "  backdrop-filter: blur(6px);",
      "  z-index: 99999;",
      "}",
      ".ipq-loader-overlay[data-open=\"true\"] {",
      "  display: flex;",
      "}",
      ".ipq-loader-dialog {",
      "  width: min(1080px, calc(100vw - 32px));",
      "  height: min(820px, calc(100vh - 32px));",
      "  background: #fff;",
      "  border-radius: 22px;",
      "  overflow: hidden;",
      "  box-shadow: 0 30px 80px rgba(15, 23, 42, 0.35);",
      "  display: grid;",
      "  grid-template-rows: auto minmax(0, 1fr);",
      "}",
      ".ipq-loader-dialog-header {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  gap: 12px;",
      "  padding: 14px 18px;",
      "  background: linear-gradient(180deg, #f8fafc 0%%, #eef6f5 100%%);",
      "  border-bottom: 1px solid rgba(148, 163, 184, 0.28);",
      "}",
      ".ipq-loader-dialog-title {",
      "  display: grid;",
      "  gap: 4px;",
      "}",
      ".ipq-loader-dialog-title strong {",
      "  font: 700 15px/1.2 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  color: #0f172a;",
      "}",
      ".ipq-loader-dialog-title span {",
      "  font: 13px/1.3 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  color: #475569;",
      "}",
      ".ipq-loader-dialog-actions {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 10px;",
      "}",
      ".ipq-loader-link,",
      ".ipq-loader-close {",
      "  appearance: none;",
      "  border-radius: 999px;",
      "  padding: 8px 12px;",
      "  font: 600 13px/1 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  text-decoration: none;",
      "  cursor: pointer;",
      "}",
      ".ipq-loader-link {",
      "  border: 1px solid rgba(148, 163, 184, 0.45);",
      "  color: #0f172a;",
      "  background: #fff;",
      "}",
      ".ipq-loader-close {",
      "  border: 0;",
      "  color: #fff;",
      "  background: #0f766e;",
      "}",
      ".ipq-loader-close svg {",
      "  width: 18px;",
      "  height: 18px;",
      "}",
      ".ipq-loader-connect-panel {",
      "  display: none;",
      "  height: 100%%;",
      "  align-items: center;",
      "  justify-content: center;",
      "  padding: 24px;",
      "  background: #f8fafc;",
      "}",
      ".ipq-loader-overlay[data-connect-open=\"true\"] .ipq-loader-connect-panel {",
      "  display: flex;",
      "}",
      ".ipq-loader-overlay[data-connect-open=\"true\"] .ipq-loader-frame {",
      "  display: none;",
      "}",
      ".ipq-loader-overlay[data-connect-open=\"true\"] .ipq-loader-link {",
      "  display: none;",
      "}",
      ".ipq-loader-connect-card {",
      "  width: min(420px, 100%%);",
      "  display: grid;",
      "  gap: 14px;",
      "  padding: 24px;",
      "  border: 1px solid rgba(148, 163, 184, 0.28);",
      "  border-radius: 18px;",
      "  background: #fff;",
      "  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);",
      "}",
      ".ipq-loader-connect-card strong {",
      "  font: 700 18px/1.3 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  color: #0f172a;",
      "}",
      ".ipq-loader-connect-card span {",
      "  font: 14px/1.6 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  color: #475569;",
      "}",
      ".ipq-loader-connect-action {",
      "  justify-self: flex-start;",
      "  appearance: none;",
      "  border: 0;",
      "  border-radius: 12px;",
      "  padding: 10px 14px;",
      "  font: 700 14px/1 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  color: #fff;",
      "  background: #4f46e5;",
      "  cursor: pointer;",
      "}",
      ".ipq-loader-connect-action:disabled {",
      "  cursor: wait;",
      "  opacity: 0.72;",
      "}",
      ".ipq-loader-frame {",
      "  width: 100%%;",
      "  height: 100%%;",
      "  border: 0;",
      "  background: #f8fafc;",
      "}",
      ".ipq-loader-toast {",
      "  position: fixed;",
      "  right: 24px;",
      "  top: 24px;",
      "  z-index: 100000;",
      "  min-width: 220px;",
      "  max-width: min(420px, calc(100vw - 32px));",
      "  border-radius: 16px;",
      "  background: rgba(15, 23, 42, 0.96);",
      "  color: #fff;",
      "  padding: 12px 14px;",
      "  font: 500 13px/1.45 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
      "  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.35);",
      "  opacity: 0;",
      "  transform: translateY(-6px);",
      "  transition: opacity .18s ease, transform .18s ease;",
      "  pointer-events: none;",
      "}",
      ".ipq-loader-toast[data-open=\"true\"] {",
      "  opacity: 1;",
      "  transform: translateY(0);",
      "}",
      ".ipq-loader-button.ipq-node-icon-button {",
      "  width: 36px;",
      "  height: 36px;",
      "  min-width: 0;",
      "  padding: 0;",
      "  position: relative;",
      "  z-index: 2;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  pointer-events: auto;",
      "  touch-action: manipulation;",
      "  color: var(--accent-11, var(--primary, #5b4bc4));",
      "  background: transparent;",
      "  border: 0;",
      "  border-radius: var(--radius-lg, 12px);",
      "  box-shadow: none;",
      "  backdrop-filter: none;",
      "}",
      ".ipq-loader-button.ipq-node-icon-button[data-ipq-entry-state=\"connected\"] {",
      "  color: var(--accent-11, var(--primary, #5b4bc4));",
      "}",
      ".ipq-loader-button.ipq-node-icon-button[data-ipq-entry-state=\"pending\"],",
      ".ipq-loader-button.ipq-node-icon-button[data-ipq-entry-state=\"unknown\"] {",
      "  color: #94a3b8;",
      "}",
      ".ipq-loader-button.ipq-node-icon-button:hover {",
      "  color: var(--accent-11, #4f46e5);",
      "  background: var(--accent-a4, rgba(145, 119, 230, 0.16));",
      "  box-shadow: none;",
      "}",
      ".ipq-loader-button.ipq-node-icon-button[data-ipq-entry-state=\"pending\"]:hover,",
      ".ipq-loader-button.ipq-node-icon-button[data-ipq-entry-state=\"unknown\"]:hover {",
      "  color: #64748b;",
      "  background: rgba(148, 163, 184, 0.16);",
      "}",
      ".ipq-loader-button.ipq-node-icon-button svg {",
      "  width: 18px;",
      "  height: 18px;",
      "}",
      ".ipq-loader-default-home-slot {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  flex: 0 0 auto;",
      "  margin: 0;",
      "}",
      ".ipq-loader-button.ipq-default-home-button {",
      "  width: 23px;",
      "  height: 23px;",
      "  color: var(--accent-11, #3b82f6);",
      "  border-radius: var(--radius-2, 6px);",
      "}",
      ".ipq-loader-button.ipq-default-home-button[data-ipq-entry-state=\"pending\"],",
      ".ipq-loader-button.ipq-default-home-button[data-ipq-entry-state=\"unknown\"] {",
      "  color: var(--gray-9, #8b8d98);",
      "}",
      ".ipq-loader-button.ipq-default-home-button:hover {",
      "  transform: none;",
      "  color: var(--accent-11, #2563eb);",
      "  background: var(--gray-a3, rgba(148, 163, 184, 0.14));",
      "  box-shadow: none;",
      "}",
      ".ipq-loader-button.ipq-default-home-button[data-ipq-entry-state=\"pending\"]:hover,",
      ".ipq-loader-button.ipq-default-home-button[data-ipq-entry-state=\"unknown\"]:hover {",
      "  color: var(--gray-11, #60646c);",
      "  background: var(--gray-a3, rgba(148, 163, 184, 0.14));",
      "}",
      ".ipq-loader-button.ipq-default-home-button svg {",
      "  width: 14px;",
      "  height: 14px;",
      "}",
      ".ipq-loader-purcarte-slot {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  gap: 6px;",
      "  margin-left: auto;",
      "}",
      ".ipq-loader-purcarte-card-slot {",
      "  margin-right: 6px;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte {",
      "  background: var(--ipq-purcarte-overlay-tint, rgba(22, 34, 49, 0.18));",
      "  backdrop-filter: blur(2px) saturate(0.96);",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-dialog {",
      "  width: min(960px, calc(100vw - 56px));",
      "  height: min(80vh, calc(100vh - 56px));",
      "  padding: 20px;",
      "  background: linear-gradient(0deg, var(--ipq-purcarte-modal-tint, rgba(59, 79, 101, 0.42)), var(--ipq-purcarte-modal-tint, rgba(59, 79, 101, 0.42))), var(--ipq-purcarte-shell, var(--ipq-purcarte-card, rgba(255, 255, 255, 0.5)));",
      "  border: 1px solid var(--ipq-purcarte-theme-border, rgba(23, 23, 23, 0.28));",
      "  border-radius: 10px;",
      "  box-shadow: 0 2px 8px rgba(23, 23, 23, 0.24);",
      "  backdrop-filter: blur(var(--ipq-purcarte-blur, var(--purcarte-blur, 10px))) saturate(1.08);",
      "  gap: 0;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-dialog-header {",
      "  min-height: 32px;",
      "  padding: 0 0 14px;",
      "  background: transparent;",
      "  border-bottom: 0;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-dialog-title strong {",
      "  font-size: 20px;",
      "  line-height: 1.25;",
      "  font-weight: 700;",
      "  color: var(--ipq-purcarte-text, var(--foreground, #171717));",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-dialog-title span {",
      "  display: none;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-dialog-actions {",
      "  gap: 12px;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-link,",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-close {",
      "  border: 0;",
      "  background: transparent;",
      "  color: var(--ipq-purcarte-text, var(--primary, #171717));",
      "  box-shadow: none;",
      "  backdrop-filter: none;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-link {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  height: 32px;",
      "  padding: 0 14px;",
      "  border-radius: 10px;",
      "  background: var(--accent-a6, rgba(145, 119, 230, 0.32));",
      "  color: var(--accent-11, #5b4bc4);",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-link:hover {",
      "  background: var(--accent-a5, rgba(145, 119, 230, 0.24));",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-close {",
      "  width: 32px;",
      "  height: 32px;",
      "  padding: 0;",
      "  border-radius: 10px;",
      "  color: var(--ipq-purcarte-text, var(--primary, #171717));",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-close:hover {",
      "  background: var(--accent-a4, rgba(145, 119, 230, 0.16));",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-frame {",
      "  background: transparent;",
      "  border-radius: 10px;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-connect-panel {",
      "  background: transparent;",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-connect-card {",
      "  border-color: var(--ipq-purcarte-inner-border, rgba(255, 255, 255, 0.3));",
      "  border-radius: 10px;",
      "  background: var(--ipq-purcarte-inner-card, rgba(255, 255, 255, 0.18));",
      "  box-shadow: 0 2px 6px var(--ipq-purcarte-inner-shadow, rgba(23, 23, 23, 0.07));",
      "  backdrop-filter: blur(var(--ipq-purcarte-blur, 10px)) saturate(1.08);",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-connect-card strong {",
      "  color: var(--ipq-purcarte-text, var(--foreground, #171717));",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-connect-card span {",
      "  color: var(--ipq-purcarte-muted, rgba(49, 49, 49, 0.72));",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-connect-action {",
      "  border-radius: 10px;",
      "  background: var(--accent-a6, rgba(145, 119, 230, 0.32));",
      "  color: var(--accent-11, #5b4bc4);",
      "}",
      ".ipq-loader-overlay.ipq-loader-theme-purcarte .ipq-loader-connect-action:hover {",
      "  background: var(--accent-a5, rgba(145, 119, 230, 0.24));",
      "}",
      "@media (max-width: 720px) {",
      "  #ipq-loader-portal {",
      "    right: 16px;",
      "    bottom: 16px;",
      "    left: 16px;",
      "  }",
      "  .ipq-loader-button.ipq-floating {",
      "    width: 100%%;",
      "  }",
      "  .ipq-loader-inline-slot {",
      "    width: 100%%;",
      "  }",
      "  .ipq-loader-inline-slot .ipq-loader-button {",
      "    width: 100%%;",
      "  }",
      "  .ipq-loader-overlay {",
      "    padding: 12px;",
      "  }",
      "  .ipq-loader-dialog {",
      "    width: 100%%;",
      "    height: 100%%;",
      "    border-radius: 18px;",
      "  }",
      "  .ipq-loader-toast {",
      "    top: auto;",
      "    right: 16px;",
      "    bottom: 16px;",
      "    left: 16px;",
      "    max-width: none;",
      "  }",
      "  .ipq-loader-dialog-header {",
      "    align-items: flex-start;",
      "    flex-direction: column;",
      "  }",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function ensurePortal() {
    if (!state.portal) {
      state.portal = document.createElement("div");
      state.portal.id = "ipq-loader-portal";
    }
    if (!state.portal.isConnected) {
      document.body.appendChild(state.portal);
    }
    return state.portal;
  }

  function applyThemeClasses() {
    const purcarte = isPurCarteTheme();
    [state.portal, state.overlay].forEach(function (element) {
      if (!element) return;
      element.classList.toggle("ipq-loader-theme-purcarte", purcarte);
    });
    applyThemeVariables();
  }

  function readCSSVariable(name, fallback) {
    const roots = [document.documentElement, document.body, document.querySelector(".radix-themes")];
    for (const root of roots) {
      if (!root) continue;
      const value = window.getComputedStyle(root).getPropertyValue(name).trim();
      if (value) return value;
    }
    return fallback || "";
  }

  function sanitizeCSSValue(value) {
    const text = String(value || "").trim();
    if (!text || /[;{}]/.test(text) || /url\s*\(/i.test(text)) return "";
    return text;
  }

  function withAlpha(color, alpha) {
    const text = sanitizeCSSValue(color);
    const rgba = text.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (!rgba) return "";
    const channels = rgba.slice(1, 4).map(function (value) {
      return Math.max(0, Math.min(255, Number(value) || 0));
    });
    const nextAlpha = Math.max(0, Math.min(1, alpha));
    return "rgba(" + channels[0] + ", " + channels[1] + ", " + channels[2] + ", " + nextAlpha + ")";
  }

  function getPurCarteGlassConfig() {
    const settings = state.themeSettings || {};
    const appearance = getKomariAppearance() === "dark" ? "dark" : "light";
    const parts = String(settings.blurBackgroundColor || "").split("|").map(function (item) {
      return sanitizeCSSValue(item);
    }).filter(Boolean);
    const cssLight = sanitizeCSSValue(readCSSVariable("--card-light", ""));
    const cssDark = sanitizeCSSValue(readCSSVariable("--card-dark", ""));
    const cssCard = sanitizeCSSValue(readCSSVariable("--purcarte-card-color", readCSSVariable("--card", "")));
    const fallbackCard = appearance === "dark" ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.5)";
    const selectedCard = appearance === "dark"
      ? (cssDark || parts[1] || cssCard || parts[0] || fallbackCard)
      : (cssLight || parts[0] || cssCard || parts[1] || fallbackCard);
    const configuredBlur = Number(settings.blurValue);
    const cssBlur = readCSSVariable("--purcarte-blur", "");
    const parsedCSSBlur = Number(String(cssBlur).replace(/px$/i, ""));
    const blurValue = settings.enableBlur === false ? 0 : (
      Number.isFinite(configuredBlur) ? configuredBlur : (Number.isFinite(parsedCSSBlur) ? parsedCSSBlur : 10)
    );
    const blur = Math.max(0, Math.min(40, blurValue));
    const shell = withAlpha(selectedCard, appearance === "dark" ? 0.42 : 0.08) || selectedCard;
    return {
      appearance: appearance,
      card: selectedCard,
      cardMuted: selectedCard,
      cardHover: appearance === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.68)",
      border: appearance === "dark" ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.5)",
      themeBorder: appearance === "dark" ? "rgba(250, 250, 250, 0.5)" : "rgba(23, 23, 23, 0.5)",
      overlayTint: appearance === "dark" ? "rgba(0, 0, 0, 0.26)" : "rgba(22, 34, 49, 0.18)",
      modalTint: appearance === "dark" ? "rgba(0, 0, 0, 0.34)" : "rgba(59, 79, 101, 0.42)",
      innerCard: appearance === "dark" ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.18)",
      innerBorder: appearance === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.3)",
      innerShadow: appearance === "dark" ? "rgba(0, 0, 0, 0.08)" : "rgba(23, 23, 23, 0.07)",
      text: appearance === "dark" ? "rgba(250, 250, 250, 0.96)" : "rgba(23, 23, 23, 0.96)",
      muted: appearance === "dark" ? "rgba(250, 250, 250, 0.68)" : "rgba(49, 49, 49, 0.72)",
      shell: shell,
      blur: blur + "px"
    };
  }

  function applyThemeVariables() {
    const targets = [state.portal, state.overlay]
      .concat(Array.from(document.querySelectorAll("[data-ipq-purcarte-button='true']")))
      .filter(Boolean);
    if (!targets.length) return;
    if (!isPurCarteTheme()) {
      targets.forEach(function (element) {
        [
          "--ipq-purcarte-card",
          "--ipq-purcarte-card-muted",
          "--ipq-purcarte-card-hover",
          "--ipq-purcarte-border",
          "--ipq-purcarte-theme-border",
          "--ipq-purcarte-overlay-tint",
          "--ipq-purcarte-modal-tint",
          "--ipq-purcarte-inner-card",
          "--ipq-purcarte-inner-border",
          "--ipq-purcarte-inner-shadow",
          "--ipq-purcarte-text",
          "--ipq-purcarte-muted",
          "--ipq-purcarte-shell",
          "--ipq-purcarte-blur"
        ].forEach(function (name) {
          element.style.removeProperty(name);
        });
      });
      return;
    }

    const glass = getPurCarteGlassConfig();
    targets.forEach(function (element) {
      element.style.setProperty("--ipq-purcarte-card", glass.card);
      element.style.setProperty("--ipq-purcarte-card-muted", glass.cardMuted);
      element.style.setProperty("--ipq-purcarte-card-hover", glass.cardHover);
      element.style.setProperty("--ipq-purcarte-border", glass.border);
      element.style.setProperty("--ipq-purcarte-theme-border", glass.themeBorder);
      element.style.setProperty("--ipq-purcarte-overlay-tint", glass.overlayTint);
      element.style.setProperty("--ipq-purcarte-modal-tint", glass.modalTint);
      element.style.setProperty("--ipq-purcarte-inner-card", glass.innerCard);
      element.style.setProperty("--ipq-purcarte-inner-border", glass.innerBorder);
      element.style.setProperty("--ipq-purcarte-inner-shadow", glass.innerShadow);
      element.style.setProperty("--ipq-purcarte-text", glass.text);
      element.style.setProperty("--ipq-purcarte-muted", glass.muted);
      element.style.setProperty("--ipq-purcarte-shell", glass.shell);
      element.style.setProperty("--ipq-purcarte-blur", glass.blur);
    });
  }

  function cleanupPortal() {
    if (!state.portal) return;
    if (state.portal.childElementCount === 0 && state.portal.parentElement) {
      state.portal.parentElement.removeChild(state.portal);
    }
  }

  function ensureButton() {
    if (state.button) return state.button;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ipq-loader-button";
    button.addEventListener("click", function () {
      handleAction();
    });
    state.button = button;
    return button;
  }

  function ipqIconSVG() {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-check" aria-hidden="true">',
      '  <path d="M12 3l7 3v5c0 4.2-2.7 8-7 10-4.3-2-7-5.8-7-10V6l7-3z"></path>',
      '  <path d="M9 12l2 2 4-5"></path>',
      '</svg>'
    ].join("");
  }

  function entryStateCacheKey(context) {
    return String(context && context.uuid || "").trim().toLowerCase();
  }

  function entryStateName(entryState) {
    if (!entryState) return "unknown";
    return entryState.connected ? "connected" : "pending";
  }

  function buttonEntryState(button) {
    return button && button.getAttribute("data-ipq-entry-state") || "unknown";
  }

  function setButtonEntryState(button, entryState) {
    if (!button) return;
    button._ipqEntryState = entryState || null;
    button.setAttribute("data-ipq-entry-state", entryStateName(entryState));
  }

  function entryActionLabel(status) {
    if (status === "pending") return "开启 IP 质量检测";
    if (status === "unknown") return "检测接入状态";
    return "查看 IP 质量";
  }

  function renderContextButton(button, busy) {
    if (!button) return;
    const iconMode = button.getAttribute("data-ipq-icon-button") === "true";
    const status = buttonEntryState(button);
    const label = entryActionLabel(status);
    button.disabled = !!busy;
    if (iconMode) {
      button.innerHTML = ipqIconSVG();
      button.setAttribute("aria-label", busy ? "正在打开..." : label);
      button.setAttribute("title", busy ? "正在打开..." : label);
      return;
    }
    button.textContent = busy ? "处理中..." : label;
  }

  function findButtonByContext(slot, uuid) {
    const buttons = slot.querySelectorAll("[data-ipq-purcarte-button='true']");
    for (const button of buttons) {
      if (button.getAttribute("data-ipq-uuid") === uuid) {
        return button;
      }
    }
    return null;
  }

  function ensurePurCarteButton(slot, context) {
    let button = findButtonByContext(slot, context.uuid);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "ipq-loader-button ipq-node-icon-button ipq-purcarte-button";
      button.setAttribute("data-ipq-purcarte-button", "true");
      button.setAttribute("data-ipq-icon-button", "true");
      button.setAttribute("data-ipq-uuid", context.uuid);
      button.setAttribute("data-ipq-entry-state", "unknown");
      slot.appendChild(button);
      button.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        event.stopPropagation();
        triggerContextAction(event, button._ipqContext || context, button, "pointerdown");
      });
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        triggerContextAction(event, button._ipqContext || context, button, "click");
      });
    }
    button._ipqContext = context;
    refreshContextButtonState(button, context);
    applyThemeVariables();
    return button;
  }

  function triggerContextAction(event, context, button, source) {
    const now = Date.now();
    const previous = Number(button._ipqLastActionAt || 0);
    if (now - previous < 600) {
      debugLog("action_skipped_duplicate", { source: source, uuid: context && context.uuid });
      return;
    }
    button._ipqLastActionAt = now;
    debugLog("action_trigger", { source: source, uuid: context && context.uuid, title: button.getAttribute("title") || "" });
    handleAction(context, button);
  }

  function ensureOverlay() {
    if (state.overlay) return state.overlay;

    const overlay = document.createElement("div");
    overlay.className = "ipq-loader-overlay";
    overlay.id = "ipq-loader-overlay";
    overlay.innerHTML = [
      '<div class="ipq-loader-dialog" role="dialog" aria-modal="true" aria-label="IP 质量详情">',
      '  <div class="ipq-loader-dialog-header">',
      '    <div class="ipq-loader-dialog-title">',
      '      <strong>IP 质量详情</strong>',
      '      <span>当前结果由本服务页面提供。</span>',
      '    </div>',
      '    <div class="ipq-loader-dialog-actions">',
      '      <a class="ipq-loader-link" target="_blank" rel="noopener noreferrer">独立页面</a>',
      '      <button type="button" class="ipq-loader-close" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>',
      '    </div>',
      '  </div>',
      '  <div class="ipq-loader-connect-panel">',
      '    <div class="ipq-loader-connect-card">',
      '      <strong>当前节点尚未开启 IP 质量检测</strong>',
      '      <span>接入后会打开管理页面，用来配置检测目标、上报计划和接入命令。</span>',
      '      <button type="button" class="ipq-loader-connect-action">去接入</button>',
      '    </div>',
      '  </div>',
      '  <iframe class="ipq-loader-frame" referrerpolicy="same-origin" allowtransparency="true"></iframe>',
      '</div>'
    ].join("");

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        closeModal();
      }
    });

    const closeButton = overlay.querySelector(".ipq-loader-close");
    if (closeButton) {
      closeButton.addEventListener("click", closeModal);
    }

    state.connectButton = overlay.querySelector(".ipq-loader-connect-action");
    if (state.connectButton) {
      state.connectButton.addEventListener("click", function () {
        const context = state.connectContext;
        if (!context || state.connectButton.disabled) {
          return;
        }
        const targetWindow = window.open("about:blank", "_blank");
        if (targetWindow) {
          targetWindow.opener = null;
        }
        state.connectButton.disabled = true;
        state.connectButton.textContent = "正在打开...";
        connectNodeEntryState(context).then(function (entryState) {
          const nodeUUID = entryState && (entryState.node_uuid || entryState.komari_node_uuid) || context.uuid;
          closeModal();
          openStandalone(buildReportConfigURL(context, nodeUUID), targetWindow);
        }).catch(function (error) {
          if (targetWindow && !targetWindow.closed) {
            targetWindow.close();
          }
          debugLog("connect_node_failed", { message: error && error.message ? error.message : String(error || "") });
          showToast("打开接入页面失败，请稍后重试");
        }).finally(function () {
          state.connectButton.disabled = false;
          state.connectButton.textContent = "去接入";
        });
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeModal();
      }
    });

    document.body.appendChild(overlay);
    state.overlay = overlay;
    state.iframe = overlay.querySelector("iframe");
    state.openLink = overlay.querySelector("a");
    applyThemeClasses();
    return overlay;
  }

  function ensureToast() {
    let toast = document.getElementById("ipq-loader-toast");
    if (toast) return toast;
    toast = document.createElement("div");
    toast.id = "ipq-loader-toast";
    toast.className = "ipq-loader-toast";
    document.body.appendChild(toast);
    return toast;
  }

  function closeModal() {
    if (!state.overlay) return;
    const wasOpen = state.overlay.getAttribute("data-open") === "true";
    state.overlay.setAttribute("data-open", "false");
    state.overlay.setAttribute("data-connect-open", "false");
    state.connectContext = null;
    if (wasOpen) {
      scheduleRouteSync();
    }
  }

  function isModalOpen() {
    return !!(state.overlay && state.overlay.getAttribute("data-open") === "true");
  }

  function showToast(message) {
    debugLog("toast", { message: message });
    const toast = ensureToast();
    toast.textContent = message;
    toast.setAttribute("data-open", "true");
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(function () {
      toast.setAttribute("data-open", "false");
    }, 2800);
  }

  async function loadKomariPublicNode(context) {
    const nodesResponse = await fetch(window.location.origin + "/api/nodes", {
      credentials: "include",
      cache: "no-store"
    });
    if (!nodesResponse.ok) {
      debugLog("komari_nodes_failed", { status: nodesResponse.status });
      throw new Error("failed to load Komari public nodes");
    }

    const payload = await nodesResponse.json();
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.data)
        ? payload.data
        : Object.values(payload || {});
    return items.find(function (item) {
      return item && String(item.uuid || "").toLowerCase() === String(context.uuid).toLowerCase();
    }) || null;
  }

  function displayIPFromKomariNode(node) {
    return String(node && (node.ipv4 || node.ipv6) || "").trim();
  }

  function buildReportConfigURL(context, nodeUUID) {
    const params = new URLSearchParams();
    params.set("report_config", nodeUUID || context.uuid);
    params.set("from_komari", "1");
    if (context.name) {
      params.set("node_name", context.name);
    }
    return APP_BASE + "/?v=" + CACHE_BUST + "#/nodes?" + params.toString();
  }

  function openStandalone(url, targetWindow) {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.href = url;
      return;
    }
    const opened = window.open(url, "_blank", "noopener");
    if (!opened) {
      window.location.assign(url);
    }
  }

  async function fetchNodeEntryState(context) {
    const params = new URLSearchParams();
    params.set("uuid", context.uuid);
    params.set("name", context.name || "未命名节点");
    params.set("v", Date.now().toString(36));
    const response = await fetch(API_BASE + "/nodes/status?" + params.toString(), {
      credentials: "omit",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("failed to sync IPQ node");
    }
    return await response.json();
  }

  function cacheNodeEntryState(context, entryState) {
    const key = entryStateCacheKey(context);
    if (!key || !entryState) return;
    state.entryStateCache[key] = {
      value: entryState,
      expiresAt: Date.now() + 5000
    };
  }

  function clearEntryStateCache() {
    state.entryStateCache = {};
    state.entryStatePromises = {};
  }

  async function loadNodeEntryState(context) {
    try {
      const entryState = await fetchNodeEntryState(context);
      cacheNodeEntryState(context, entryState);
      return entryState;
    } catch (error) {
      debugLog("load_node_state_failed", { message: error && error.message ? error.message : String(error || "") });
      return null;
    }
  }

  async function loadCachedNodeEntryState(context) {
    const key = entryStateCacheKey(context);
    if (!key) return null;
    const cached = state.entryStateCache[key];
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    if (!state.entryStatePromises[key]) {
      state.entryStatePromises[key] = fetchNodeEntryState(context).then(function (entryState) {
        cacheNodeEntryState(context, entryState);
        return entryState;
      }).catch(function (error) {
        debugLog("cached_node_state_failed", { uuid: context && context.uuid, message: error && error.message ? error.message : String(error || "") });
        return null;
      }).finally(function () {
        delete state.entryStatePromises[key];
      });
    }
    return state.entryStatePromises[key];
  }

  function refreshContextButtonState(button, context) {
    if (!button || !context || !context.uuid) return;
    if (!button.getAttribute("data-ipq-entry-state")) {
      button.setAttribute("data-ipq-entry-state", "unknown");
    }
    renderContextButton(button, button.disabled);
    loadCachedNodeEntryState(context).then(function (entryState) {
      if (!entryState) return;
      if (button._ipqContext && button._ipqContext.uuid !== context.uuid) return;
      setButtonEntryState(button, entryState);
      renderContextButton(button, button.disabled);
    });
  }

  async function connectNodeEntryState(context) {
    const params = new URLSearchParams();
    params.set("uuid", context.uuid);
    params.set("name", context.name || "未命名节点");
    params.set("v", Date.now().toString(36));
    const response = await fetch(API_BASE + "/nodes/connect?" + params.toString(), {
      credentials: "omit",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("failed to connect IPQ node");
    }
    const entryState = await response.json();
    cacheNodeEntryState(context, entryState);
    return entryState;
  }

  function buildURLs(context, options) {
    const safeUUID = encodeURIComponent(context.uuid);
    if (options.mode === "public") {
      const params = new URLSearchParams();
      if (options.displayIP) {
        params.set("display_ip", options.displayIP);
      }
      if (context.name) {
        params.set("node_name", context.name);
      }
      appendThemeParams(params);
      const query = params.toString();
      const publicURL = APP_BASE + "/?v=" + CACHE_BUST + "#/public/nodes/" + safeUUID + (query ? "?" + query : "");
      return {
        fullPageURL: publicURL,
        embedURL: publicURL + (query ? "&" : "?") + "embed=1"
      };
    }

    const params = new URLSearchParams();
    if (options.komariReturn) {
      params.set("komari_return", options.komariReturn);
    }
    if (context.name) {
      params.set("node_name", context.name);
    }
    appendThemeParams(params);
    const query = params.toString();
    const detailURL = APP_BASE + "/?v=" + CACHE_BUST + "#/nodes/" + safeUUID + (query ? "?" + query : "");

    return {
      fullPageURL: detailURL,
      embedURL: detailURL + (query ? "&" : "?") + "embed=1"
    };
  }

  function openModal(context, options) {
    const overlay = ensureOverlay();
    applyThemeClasses();
    const urls = buildURLs(context, options || { mode: "admin" });
    overlay.setAttribute("data-connect-open", "false");
    state.connectContext = null;
    debugLog("open_modal", { uuid: context && context.uuid, mode: options && options.mode, embedURL: urls.embedURL });
    const title = state.overlay && state.overlay.querySelector(".ipq-loader-dialog-title strong");
    if (title) {
      title.textContent = (context.name || "节点") + " IP 质量";
    }
    if (state.iframe) {
      state.iframe.src = urls.embedURL;
      state.iframe.title = (context.name || "节点") + " IP 质量详情";
    }
    if (state.openLink) {
      state.openLink.href = urls.fullPageURL;
    }
    overlay.setAttribute("data-open", "true");
  }

  function openConnectPrompt(context, entryState) {
    const overlay = ensureOverlay();
    applyThemeClasses();
    state.connectContext = {
      uuid: context.uuid,
      name: context.name || (entryState && entryState.name) || "未命名节点"
    };
    debugLog("open_connect_prompt", { uuid: context && context.uuid, exists: !!(entryState && entryState.exists) });
    const title = overlay.querySelector(".ipq-loader-dialog-title strong");
    const subtitle = overlay.querySelector(".ipq-loader-dialog-title span");
    if (title) {
      title.textContent = (context.name || "节点") + " IP 质量";
    }
    if (subtitle) {
      subtitle.textContent = "当前节点还没有 IPQ 上报配置。";
    }
    if (state.openLink) {
      state.openLink.removeAttribute("href");
    }
    if (state.iframe) {
      state.iframe.removeAttribute("src");
      state.iframe.src = "about:blank";
    }
    if (state.connectButton) {
      state.connectButton.disabled = false;
      state.connectButton.textContent = "去接入";
    }
    overlay.setAttribute("data-connect-open", "true");
    overlay.setAttribute("data-open", "true");
  }

  function isVisible(element) {
    return !!element && !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function normalizeThemeName(value) {
    return String(value || "").trim();
  }

  function detectThemeFromDOM() {
    if (document.querySelector(".purcarte-blur, .theme-card-style") || /Theme by\s+PurCarte/i.test(document.body && document.body.textContent || "")) {
      return "PurCarte";
    }
    return "default";
  }

  function isPurCarteTheme() {
    const theme = normalizeThemeName(state.themeName || detectThemeFromDOM());
    return /purcarte/i.test(theme);
  }

  function getKomariAppearance() {
    const root = document.querySelector(".radix-themes.dark, .radix-themes.light");
    if (root && root.classList.contains("dark")) {
      return "dark";
    }
    if (root && root.classList.contains("light")) {
      return "light";
    }
    const configured = state.themeSettings && state.themeSettings.selectedDefaultAppearance;
    return configured === "dark" || configured === "light" ? configured : "";
  }

  function getKomariAccent() {
    const themed = document.querySelector("[data-accent-color]");
    const fromDOM = themed && themed.getAttribute("data-accent-color");
    return fromDOM || (state.themeSettings && state.themeSettings.selectThemeColor) || "";
  }

  function appendThemeParams(params) {
    const theme = normalizeThemeName(state.themeName || detectThemeFromDOM());
    if (theme) {
      params.set("komari_theme", theme);
    }
    const appearance = getKomariAppearance();
    if (appearance) {
      params.set("komari_appearance", appearance);
    }
    const accent = getKomariAccent();
    if (accent) {
      params.set("komari_accent", accent);
    }
    if (isPurCarteTheme()) {
      const glass = getPurCarteGlassConfig();
      params.set("komari_blur", glass.blur);
      params.set("komari_card", glass.card);
      params.set("komari_glass", "1");
    }
  }

  async function loadThemeInfo() {
    try {
      const response = await fetch(window.location.origin + "/api/public", {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("failed to load public info");
      }
      const payload = await response.json();
      const data = payload && payload.data ? payload.data : {};
      state.themeName = normalizeThemeName(data.theme) || detectThemeFromDOM();
      state.themeSettings = data.theme_settings || {};
    } catch (_) {
      state.themeName = detectThemeFromDOM();
      state.themeSettings = {};
    } finally {
      state.themeLoaded = true;
      applyThemeClasses();
      scheduleRouteSync();
    }
  }

  function extractUUIDFromValue(value) {
    if (!value) return "";
    const match = String(value).match(UUID_RE);
    return match ? match[0] : "";
  }

  function containsUUID(value, uuid) {
    return !!value && !!uuid && String(value).toLowerCase().indexOf(String(uuid).toLowerCase()) >= 0;
  }

  function extractUUID() {
    const searchParams = new URLSearchParams(window.location.search);
    const hashQueryIndex = window.location.hash.indexOf("?");
    const hashParams = new URLSearchParams(hashQueryIndex >= 0 ? window.location.hash.slice(hashQueryIndex + 1) : "");
    const keys = ["uuid", "id", "client", "client_uuid", "node", "node_uuid"];

    for (const key of keys) {
      const fromSearch = extractUUIDFromValue(searchParams.get(key));
      if (fromSearch) return fromSearch;
      const fromHash = extractUUIDFromValue(hashParams.get(key));
      if (fromHash) return fromHash;
    }

    const routeSources = [window.location.pathname, window.location.hash, window.location.search];
    for (const source of routeSources) {
      const found = extractUUIDFromValue(source);
      if (found) return found;
    }

    if (!UUID_RE.test(routeSources.join(" "))) {
      return "";
    }

    const selectors = [
      "[data-uuid]",
      "[data-id]",
      "[data-client-id]",
      "[data-node-id]",
      "a[href*='/instance/']",
      "a[href*='#/instance/']"
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const values = [
          element.getAttribute("data-uuid"),
          element.getAttribute("data-id"),
          element.getAttribute("data-client-id"),
          element.getAttribute("data-node-id"),
          element.getAttribute("href"),
          element.textContent
        ];
        for (const value of values) {
          const found = extractUUIDFromValue(value);
          if (found) return found;
        }
      }
    }
    return "";
  }

  function normalizeName(value) {
    if (!value) return "";
    const cleaned = String(value)
      .replace(UUID_RE, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s\-:|]+|[\s\-:|]+$/g, "")
      .trim();
    if (!cleaned || TITLE_BLACKLIST.test(cleaned)) {
      return "";
    }
    return cleaned;
  }

  function extractName(uuid) {
    const headingSelectors = [
      "main h1",
      "main h2",
      "[role='main'] h1",
      "[role='main'] h2",
      "h1",
      "h2",
      "main [class*='text-xl'][class*='font-bold']",
      "main [class*='font-bold']",
      "[class*='title']",
      "[class*='header'] strong"
    ];

    for (const selector of headingSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (!isVisible(element)) continue;
        const name = normalizeName(element.textContent);
        if (name && name !== uuid) {
          return name;
        }
      }
    }

    const titleName = normalizeName(document.title.replace(/\s*[-|].*$/, ""));
    if (titleName && titleName !== uuid) {
      return titleName;
    }

    return "未命名节点";
  }

  function detectContext() {
    const routeText = [window.location.pathname, window.location.hash].join(" ");
    if (!ROUTE_HINT_RE.test(routeText) && !UUID_RE.test(routeText)) {
      return null;
    }

    const uuid = extractUUID();
    if (!uuid) return null;

    const name = extractName(uuid);
    return {
      uuid: uuid,
      name: name,
      key: uuid + "|" + name
    };
  }

  function findPurCarteCardRoot(element) {
    let current = element;
    let depth = 0;
    while (current && depth < 8) {
      if (
        current.classList &&
        current.classList.contains("theme-card-style") &&
        (current.classList.contains("purcarte-blur") || current.querySelector(".purcarte-blur, a[href*='/instance/']"))
      ) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function findPurCarteHomeHeader(card, anchor) {
    let current = anchor.parentElement;
    let depth = 0;
    while (current && current !== card && depth < 5) {
      if (current.parentElement === card || (current.classList && current.classList.contains("justify-between"))) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return card;
  }

  function ensurePurCarteSlot(container, slotType, beforeElement) {
    let slot = container.querySelector(".ipq-loader-purcarte-slot[data-ipq-slot='" + slotType + "']");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "ipq-loader-purcarte-slot" + (slotType === "home" ? " ipq-loader-purcarte-card-slot" : "");
      slot.setAttribute("data-ipq-slot", slotType);
    }
    if (slot.parentElement !== container) {
      if (beforeElement && beforeElement.parentElement === container) {
        container.insertBefore(slot, beforeElement);
      } else {
        container.appendChild(slot);
      }
    }
    return slot;
  }

  function extractPurCarteName(anchor, uuid) {
    const heading = anchor.querySelector("h1, h2, h3, [class*='font-bold']");
    const raw = heading ? heading.textContent : anchor.textContent;
    return normalizeName(raw) || extractName(uuid);
  }

  function purCarteHomeContexts() {
    const contexts = [];
    const seen = {};
    const anchors = document.querySelectorAll("a[href*='/instance/']");
    for (const anchor of anchors) {
      if (!isVisible(anchor)) continue;
      const href = anchor.getAttribute("href") || "";
      const uuid = extractUUIDFromValue(href);
      if (!uuid || seen[uuid]) continue;
      const card = findPurCarteCardRoot(anchor);
      if (!card || !isVisible(card)) continue;
      const header = findPurCarteHomeHeader(card, anchor);
      const infoButton = Array.from(header.children).find(function (child) {
        return child.tagName === "BUTTON";
      });
      contexts.push({
        uuid: uuid,
        name: extractPurCarteName(anchor, uuid),
        key: uuid + "|" + extractPurCarteName(anchor, uuid),
        slot: ensurePurCarteSlot(header, "home", infoButton)
      });
      seen[uuid] = true;
    }
    return contexts;
  }

  function findDefaultHomeCardRoot(anchor) {
    let current = anchor;
    let depth = 0;
    while (current && depth < 8) {
      if (
        current.classList &&
        (current.classList.contains("node-card") || current.classList.contains("rt-Card")) &&
        current.querySelector("a[href*='/instance/']")
      ) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function findDefaultHomeHeader(card, anchor) {
    let current = anchor.parentElement;
    let depth = 0;
    while (current && current !== card && depth < 6) {
      if (
        current.classList &&
        current.classList.contains("rt-Flex") &&
        current.classList.contains("rt-r-jc-space-between") &&
        current.querySelector("a[href*='/instance/']") &&
        current.children.length >= 2
      ) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function findDefaultHomeActionGroup(header, anchor) {
    const anchorBranch = Array.from(header.children).find(function (child) {
      return child === anchor || child.contains(anchor);
    });
    const candidates = Array.from(header.children).filter(function (child) {
      return child !== anchorBranch && child !== null;
    });
    return candidates.find(function (child) {
      return child.classList && child.classList.contains("rt-Flex") && (child.querySelector("button, svg, .rt-Badge") || child.children.length > 0);
    }) || null;
  }

  function ensureDefaultHomeSlot(header, anchor) {
    const actionGroup = findDefaultHomeActionGroup(header, anchor) || header;
    let slot = actionGroup.querySelector(".ipq-loader-default-home-slot[data-ipq-slot='home']");
    if (!slot) {
      slot = document.createElement("span");
      slot.className = "ipq-loader-default-home-slot flex items-center justify-center";
      slot.setAttribute("data-ipq-slot", "home");
    }

    const badge = Array.from(actionGroup.children).find(function (child) {
      return child !== slot && child.classList && child.classList.contains("rt-Badge");
    });
    if (slot.parentElement !== actionGroup) {
      if (badge) {
        actionGroup.insertBefore(slot, badge);
      } else {
        actionGroup.appendChild(slot);
      }
    } else if (badge && slot.nextElementSibling !== badge) {
      actionGroup.insertBefore(slot, badge);
    }
    return slot;
  }

  function extractDefaultHomeName(anchor, uuid) {
    const heading = anchor.querySelector(".rt-r-weight-bold, h1, h2, h3, [class*='font-bold']");
    const raw = heading ? heading.textContent : anchor.textContent;
    return normalizeName(raw) || extractName(uuid);
  }

  function defaultHomeContexts() {
    const contexts = [];
    const seen = {};
    const anchors = document.querySelectorAll("a[href*='/instance/']");
    for (const anchor of anchors) {
      if (!isVisible(anchor)) continue;
      const href = anchor.getAttribute("href") || "";
      const uuid = extractUUIDFromValue(href);
      if (!uuid || seen[uuid]) continue;
      const card = findDefaultHomeCardRoot(anchor);
      if (!card || !isVisible(card)) continue;
      const header = findDefaultHomeHeader(card, anchor);
      if (!header || !isVisible(header)) continue;
      const name = extractDefaultHomeName(anchor, uuid);
      contexts.push({
        uuid: uuid,
        name: name,
        key: uuid + "|" + name,
        slot: ensureDefaultHomeSlot(header, anchor)
      });
      seen[uuid] = true;
    }
    return contexts;
  }

  function findDefaultHomeButton(slot, uuid) {
    const buttons = slot.querySelectorAll("[data-ipq-default-home-button='true']");
    for (const button of buttons) {
      if (button.getAttribute("data-ipq-uuid") === uuid) {
        return button;
      }
    }
    return null;
  }

  function ensureDefaultHomeButton(slot, context) {
    let button = findDefaultHomeButton(slot, context.uuid);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "rt-reset rt-BaseButton rt-r-size-1 rt-variant-ghost rt-IconButton ipq-loader-button ipq-node-icon-button ipq-default-home-button";
      button.setAttribute("data-accent-color", "");
      button.setAttribute("data-ipq-default-home-button", "true");
      button.setAttribute("data-ipq-icon-button", "true");
      button.setAttribute("data-ipq-uuid", context.uuid);
      button.setAttribute("data-ipq-entry-state", "unknown");
      slot.appendChild(button);
      button.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        event.stopPropagation();
        triggerContextAction(event, button._ipqContext || context, button, "pointerdown");
      });
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        triggerContextAction(event, button._ipqContext || context, button, "click");
      });
    }
    button._ipqContext = context;
    refreshContextButtonState(button, context);
    return button;
  }

  function findPurCarteDetailSlot(context) {
    const cards = document.querySelectorAll("main .purcarte-blur.theme-card-style, main .theme-card-style, .purcarte-blur.theme-card-style, .theme-card-style");
    const hasReliableName = context.name && context.name !== "未命名节点";
    for (const card of cards) {
      if (!isVisible(card)) continue;
      const text = normalizeName(card.textContent);
      if (!text) {
        continue;
      }
      if (hasReliableName && text.indexOf(context.name) < 0 && !containsUUID(text, context.uuid)) {
        continue;
      }
      if (card.querySelector("a[href*='/instance/']")) {
        continue;
      }
      return ensurePurCarteSlot(card, "detail", null);
    }
    return null;
  }

  function cleanupPurCarteButtons(activeUUIDs) {
    const buttons = document.querySelectorAll("[data-ipq-purcarte-button='true']");
    for (const button of buttons) {
      const uuid = button.getAttribute("data-ipq-uuid") || "";
      if (activeUUIDs[uuid]) continue;
      const slot = button.parentElement;
      button.remove();
      if (slot && slot.getAttribute("data-ipq-slot") && slot.childElementCount === 0) {
        slot.remove();
      }
    }
  }

  function cleanupDefaultHomeButtons(activeUUIDs) {
    const buttons = document.querySelectorAll("[data-ipq-default-home-button='true']");
    for (const button of buttons) {
      const uuid = button.getAttribute("data-ipq-uuid") || "";
      if (activeUUIDs[uuid]) continue;
      const slot = button.parentElement;
      button.remove();
      if (slot && slot.getAttribute("data-ipq-slot") && slot.childElementCount === 0) {
        slot.remove();
      }
    }
  }

  function syncPurCarte() {
    const activeUUIDs = {};
    let mounted = false;
    const context = detectContext();

    if (context) {
      const slot = findPurCarteDetailSlot(context);
      if (slot) {
        ensurePurCarteButton(slot, context);
        activeUUIDs[context.uuid] = true;
        mounted = true;
      }
      state.contextKey = context.key;
    } else {
      const contexts = purCarteHomeContexts();
      for (const item of contexts) {
        ensurePurCarteButton(item.slot, item);
        activeUUIDs[item.uuid] = true;
        mounted = true;
      }
    }

    cleanupPurCarteButtons(activeUUIDs);
    return mounted;
  }

  function syncDefaultHome() {
    const activeUUIDs = {};
    let mounted = false;
    const contexts = defaultHomeContexts();
    for (const item of contexts) {
      ensureDefaultHomeButton(item.slot, item);
      activeUUIDs[item.uuid] = true;
      mounted = true;
    }
    cleanupDefaultHomeButtons(activeUUIDs);
    return mounted;
  }

  function findMountContainer() {
    const context = detectContext();
    if (context) {
      const headingSelectors = [
        "main h1",
        "[role='main'] h1",
        "h1",
        "main h2",
        "[role='main'] h2",
        "h2"
      ];

      for (const selector of headingSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (!isVisible(element)) continue;
          if (!containsUUID(element.textContent, context.uuid)) continue;

          const headerBlock = element.parentElement;
          if (!headerBlock || !isVisible(headerBlock)) continue;

          let slot = headerBlock.querySelector(".ipq-loader-inline-slot[data-ipq-inline-slot='true']");
          if (!slot) {
            slot = document.createElement("div");
            slot.className = "ipq-loader-inline-slot";
            slot.setAttribute("data-ipq-inline-slot", "true");
          }

          const detailsCard = Array.from(headerBlock.children).find(function (child) {
            return child !== element && child.classList && child.classList.contains("DetailsGrid");
          });

          if (slot.parentElement !== headerBlock) {
            if (detailsCard) {
              headerBlock.insertBefore(slot, detailsCard);
            } else {
              headerBlock.appendChild(slot);
            }
          } else if (detailsCard && slot.nextElementSibling !== detailsCard) {
            headerBlock.insertBefore(slot, detailsCard);
          } else if (!detailsCard && headerBlock.lastElementChild !== slot) {
            headerBlock.appendChild(slot);
          }

          return slot;
        }
      }
    }

    const preferred = [
      "[role='toolbar']",
      ".toolbar",
      ".actions",
      ".action-group",
      ".btn-group",
      ".operations"
    ];
    for (const selector of preferred) {
      const element = document.querySelector(selector);
      if (isVisible(element)) {
        return element;
      }
    }

    const actionButtons = Array.from(document.querySelectorAll("button, a")).filter(function (element) {
      return isVisible(element) && ACTION_HINT_RE.test(element.textContent || "");
    });

    for (const element of actionButtons) {
      let parent = element.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        const interactiveCount = parent.querySelectorAll("button, a").length;
        if (interactiveCount >= 1 && interactiveCount <= 8) {
          return parent;
        }
        parent = parent.parentElement;
        depth += 1;
      }
    }

    return null;
  }
  function renderButton(context) {
    const button = ensureButton();
    button.classList.remove("ipq-purcarte-button");
    button.classList.remove("ipq-node-icon-button");
    button.removeAttribute("data-ipq-icon-button");
    if (context && context.uuid) {
      const previousUUID = button.getAttribute("data-ipq-uuid") || "";
      button._ipqContext = context;
      button.setAttribute("data-ipq-uuid", context.uuid);
      if (previousUUID !== context.uuid || !button.getAttribute("data-ipq-entry-state")) {
        button.setAttribute("data-ipq-entry-state", "unknown");
      }
    }
    renderContextButton(button, state.busy);
    if (context && context.uuid) {
      refreshContextButtonState(button, context);
    }
  }

  function mountButton() {
    const button = ensureButton();
    const container = findMountContainer();
    if (container) {
      button.classList.remove("ipq-floating");
      if (button.parentElement !== container) {
        container.appendChild(button);
      }
      cleanupPortal();
      return true;
    }

    button.classList.add("ipq-floating");
    ensurePortal();
    if (button.parentElement !== state.portal) {
      state.portal.appendChild(button);
    }
    return false;
  }

  function unmountButton(options) {
    if (state.button && state.button.parentElement) {
      state.button.parentElement.removeChild(state.button);
    }
    cleanupPortal();
    if (!options || options.closeModal !== false) {
      closeModal();
    }
  }

  async function handleAction(contextOverride, sourceButton) {
    const context = contextOverride || detectContext();
    if (!context) {
      debugLog("action_no_context", {});
      return;
    }
    debugLog("handle_action_start", { uuid: context.uuid, name: context.name, hasSourceButton: !!sourceButton });
    if (sourceButton) {
      renderContextButton(sourceButton, true);
    } else {
      state.busy = true;
      renderButton(context);
    }

    try {
      const meResponse = await fetch(window.location.origin + "/api/me", { credentials: "include" });
      const me = meResponse.ok ? await meResponse.json() : { logged_in: false };
      debugLog("komari_me", { ok: meResponse.ok, status: meResponse.status, loggedIn: !!(me && me.logged_in) });
      if (me && me.logged_in) {
        const entryState = await loadNodeEntryState(context);
        if (!entryState) {
          showToast("无法确认接入状态，请稍后重试");
          return;
        }
        if (sourceButton) {
          setButtonEntryState(sourceButton, entryState);
        }

        let displayIP = "";
        try {
          displayIP = displayIPFromKomariNode(await loadKomariPublicNode(context));
        } catch (_) {
          displayIP = "";
        }

        if (entryState.connected) {
          openModal(context, {
            mode: GUEST_READ_ENABLED ? "public" : "admin",
            displayIP: displayIP,
            komariReturn: window.location.href
          });
          return;
        }

        openConnectPrompt(context, entryState);
        return;
      }

      if (!GUEST_READ_ENABLED) {
        debugLog("guest_blocked", { uuid: context.uuid });
        showToast("管理员未开放该功能");
        return;
      }

      const currentNode = await loadKomariPublicNode(context);
      if (!currentNode) {
        debugLog("guest_node_not_found", { uuid: context.uuid });
        showToast("管理员未开放该功能");
        return;
      }

      const displayIP = displayIPFromKomariNode(currentNode);
      debugLog("guest_open", { uuid: context.uuid, displayIP: displayIP });
      openModal(context, { mode: "public", displayIP: displayIP });
    } catch (error) {
      debugLog("action_error", { message: error && error.message ? error.message : String(error || "") });
      showToast("打开 IP 质量失败，请稍后重试");
    } finally {
      debugLog("handle_action_end", { uuid: context.uuid });
      if (sourceButton) {
        renderContextButton(sourceButton, false);
      } else {
        state.busy = false;
        renderButton(context);
      }
    }
  }

  async function sync() {
    state.themeName = state.themeLoaded ? state.themeName : detectThemeFromDOM();
    applyThemeClasses();
    if (isModalOpen()) {
      return;
    }

    const context = detectContext();
    if (isPurCarteTheme()) {
      cleanupDefaultHomeButtons({});
      unmountButton({ closeModal: false });
      const mountedPurCarte = syncPurCarte();
      if (mountedPurCarte) {
        clearRetryTimers();
        return;
      }
    } else {
      cleanupPurCarteButtons({});
      if (!context) {
        const mountedDefaultHome = syncDefaultHome();
        if (mountedDefaultHome) {
          unmountButton({ closeModal: false });
          clearRetryTimers();
          return;
        }
      } else {
        cleanupDefaultHomeButtons({});
      }
    }

    if (!context) {
      state.contextKey = "";
      if (isModalOpen()) {
        unmountButton({ closeModal: false });
        return;
      }
      clearRetryTimers();
      unmountButton();
      return;
    }

    const mountedInline = mountButton();
    state.contextKey = context.key;
    renderButton(context);

    if (mountedInline) {
      clearRetryTimers();
    }
  }

  function hookHistory(method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      scheduleRouteSync();
      return result;
    };
  }

  function installMutationObserver() {
    if (!document.body || !window.MutationObserver) return;
    let scheduled = false;
    const observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(function () {
        scheduled = false;
        scheduleRouteSync();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  ensureStyle();
  hookHistory("pushState");
  hookHistory("replaceState");
  loadThemeInfo();
  installMutationObserver();
  window.addEventListener("hashchange", scheduleRouteSync);
  window.addEventListener("popstate", scheduleRouteSync);
  window.addEventListener("focus", function () {
    clearEntryStateCache();
    scheduleRouteSync();
  });
  window.addEventListener("message", function (event) {
    if (!event || !event.data || event.data.source !== "ipq-embed") {
      return;
    }
    try {
      if (event.origin !== new URL(APP_BASE).origin) {
        return;
      }
    } catch (_) {
      return;
    }

    if (event.data.type === "open-standalone" && event.data.url) {
      closeModal();
      openStandalone(event.data.url);
    }
  });
  scheduleRouteSync();
})();`, cfg.BasePath, publicBaseURL, guestReadEnabled)
}
