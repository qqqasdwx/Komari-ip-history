const standaloneAppBase = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;

export function buildConnectPath(uuid: string, name: string, options?: { returnTo?: string }) {
  const params = new URLSearchParams({ uuid, name });
  if (options?.returnTo) {
    params.set("return_to", options.returnTo);
  }
  return `/connect?${params.toString()}`;
}

export function buildReportConfigListPath(uuid: string, options?: { fromKomari?: boolean; nodeName?: string }) {
  const params = new URLSearchParams();
  params.set("report_config", uuid);
  if (options?.fromKomari) {
    params.set("from_komari", "1");
  }
  if (options?.nodeName?.trim()) {
    params.set("node_name", options.nodeName.trim());
  }
  return `/nodes?${params.toString()}`;
}

export function toStandaloneAppURL(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${standaloneAppBase}/#${normalizedPath}`;
}

export function postEmbedAction(type: string, payload: Record<string, string>) {
  if (window.parent === window) {
    return;
  }
  window.parent.postMessage({ source: "ipq-embed", type, ...payload }, "*");
}
