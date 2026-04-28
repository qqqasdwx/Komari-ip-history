export function formatByteSize(bytes: number) {
  const value = Number.isFinite(bytes) ? Math.max(bytes, 0) : 0;
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatRetentionDays(days: number) {
  if (days === -1) {
    return "永久保留";
  }
  return `保留最近 ${days} 天`;
}
