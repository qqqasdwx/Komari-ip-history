package service

import (
	"fmt"
	"net/url"
	"strings"

	"komari-ip-history/internal/config"
)

func HeaderPreview(cfg config.Config, publicBaseURL string, variant string) string {
	if variant == "inline" {
		return strings.TrimSpace("<script>\n" + LoaderScript(cfg, publicBaseURL) + "\n</script>")
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
  script.src = %s;
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

func LoaderScript(cfg config.Config, publicBaseURL string) string {
	return fmt.Sprintf(`(() => {
  const BASE_PATH = %q;
  const CONFIGURED_APP_BASE = %q;
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  const ROUTE_HINT_RE = /(client|clients|node|nodes|server|servers)/i;
  const ACTION_HINT_RE = /(编辑|删除|终端|命令|执行|Edit|Delete|Terminal|Command|Run)/i;
  const TITLE_BLACKLIST = /^(komari|dashboard|nodes|node|clients|client|服务器|节点)$/i;
  const state = {
    contextKey: "",
    status: null,
    button: null,
    portal: null,
    overlay: null,
    iframe: null,
    openLink: null,
    syncTimer: 0,
    fetchToken: 0
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

  function scheduleSync(delay) {
    window.clearTimeout(state.syncTimer);
    state.syncTimer = window.setTimeout(sync, typeof delay === "number" ? delay : 120);
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
      ".ipq-loader-frame {",
      "  width: 100%%;",
      "  height: 100%%;",
      "  border: 0;",
      "  background: #f8fafc;",
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
    button.addEventListener("click", handleAction);
    state.button = button;
    return button;
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
      '      <span>当前状态总览由本服务页面承载，注入端只负责轻量挂载。</span>',
      '    </div>',
      '    <div class="ipq-loader-dialog-actions">',
      '      <a class="ipq-loader-link" target="_blank" rel="noopener noreferrer">在独立页面打开</a>',
      '      <button type="button" class="ipq-loader-close">关闭</button>',
      '    </div>',
      '  </div>',
      '  <iframe class="ipq-loader-frame" referrerpolicy="same-origin"></iframe>',
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

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeModal();
      }
    });

    document.body.appendChild(overlay);
    state.overlay = overlay;
    state.iframe = overlay.querySelector("iframe");
    state.openLink = overlay.querySelector("a");
    return overlay;
  }

  function closeModal() {
    if (!state.overlay) return;
    state.overlay.setAttribute("data-open", "false");
  }

  function buildURLs(context, forceConnect) {
    const safeUUID = encodeURIComponent(context.uuid);
    const safeName = encodeURIComponent(context.name || "未命名节点");
    const detailURL = APP_BASE + "/#/nodes/" + safeUUID;
    const connectURL = APP_BASE + "/#/connect?uuid=" + safeUUID + "&name=" + safeName;

    if (forceConnect) {
      return {
        fullPageURL: connectURL,
        embedURL: connectURL + "&embed=1"
      };
    }

    return {
      fullPageURL: detailURL,
      embedURL: detailURL + "?embed=1"
    };
  }

  function openModal(context, forceConnect) {
    const overlay = ensureOverlay();
    const urls = buildURLs(context, !!forceConnect);
    if (state.iframe) {
      state.iframe.src = urls.embedURL;
      state.iframe.title = (context.name || "节点") + " IP 质量详情";
    }
    if (state.openLink) {
      state.openLink.href = urls.fullPageURL;
    }
    overlay.setAttribute("data-open", "true");
  }

  function isVisible(element) {
    return !!element && !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
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

    const selectors = [
      "[data-uuid]",
      "[data-id]",
      "[data-client-id]",
      "[data-node-id]",
      "[href]",
      "code",
      "pre"
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

    if (document.body) {
      return extractUUIDFromValue(document.body.innerText);
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
  function renderButton() {
    const button = ensureButton();
    button.disabled = false;

    if (!state.status) {
      button.textContent = "打开 IP 质量";
      return;
    }
    if (state.status.loading) {
      button.textContent = "加载 IP 质量入口";
      button.disabled = true;
      return;
    }
    if (state.status.login_required) {
      button.textContent = "打开 IP 质量";
      return;
    }
    if (state.status.error) {
      button.textContent = "打开 IP 质量";
      return;
    }
    button.textContent = state.status.exists ? "查看 IP 质量" : "添加 IP 质量检测";
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
      return;
    }

    button.classList.add("ipq-floating");
    ensurePortal();
    if (button.parentElement !== state.portal) {
      state.portal.appendChild(button);
    }
  }

  function unmountButton() {
    if (state.button && state.button.parentElement) {
      state.button.parentElement.removeChild(state.button);
    }
    cleanupPortal();
    closeModal();
  }

  async function fetchStatus(uuid) {
    const response = await fetch(API_BASE + "/nodes/" + encodeURIComponent(uuid) + "/status", {
      credentials: "include"
    });

    if (response.status === 401) {
      return { login_required: true };
    }
    if (!response.ok) {
      throw new Error("failed to load status");
    }
    return response.json();
  }

  async function handleAction() {
    const context = detectContext();
    if (!context) return;

    const forceConnect =
      !state.status ||
      state.status.loading ||
      state.status.login_required ||
      state.status.error ||
      !state.status.exists;

    openModal(context, forceConnect);
  }

  async function sync() {
    const context = detectContext();
    if (!context) {
      state.contextKey = "";
      state.status = null;
      unmountButton();
      return;
    }

    mountButton();

    if (state.contextKey === context.key && state.status && !state.status.loading) {
      renderButton();
      return;
    }

    state.contextKey = context.key;
    const fetchToken = ++state.fetchToken;
    state.status = { loading: true };
    renderButton();

    try {
      const status = await fetchStatus(context.uuid);
      if (fetchToken !== state.fetchToken) return;
      state.status = status;
    } catch (_) {
      if (fetchToken !== state.fetchToken) return;
      state.status = { error: true };
    }

    renderButton();
  }

  const observer = new MutationObserver(function () {
    scheduleSync(140);
  });

  function hookHistory(method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      scheduleSync(60);
      return result;
    };
  }

  ensureStyle();
  hookHistory("pushState");
  hookHistory("replaceState");
  window.addEventListener("hashchange", function () { scheduleSync(60); });
  window.addEventListener("popstate", function () { scheduleSync(60); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync(0);
})();`, cfg.BasePath, publicBaseURL)
}
