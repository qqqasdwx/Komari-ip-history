export function routeLabel(pathname: string) {
  if (pathname === "/nodes") {
    return "节点结果";
  }
  if (pathname.startsWith("/nodes/")) {
    if (pathname.endsWith("/settings")) {
      return "节点设置";
    }
    if (pathname.endsWith("/snapshots") || pathname.endsWith("/compare")) {
      return "快照";
    }
    if (pathname.endsWith("/history")) {
      return "历史记录";
    }
    return "节点详情";
  }
  if (pathname === "/settings/integration") {
    return "接入配置";
  }
  if (pathname === "/settings/history-retention") {
    return "历史保留";
  }
  if (pathname === "/settings/api-keys") {
    return "开放 API";
  }
  if (pathname === "/settings/user" || pathname === "/settings/admin") {
    return "用户";
  }
  return "工作区";
}
