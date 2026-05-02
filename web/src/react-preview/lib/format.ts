export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function titleize(key: string) {
  return key
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDisplayValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "N/A";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    return value
      .map((item) => {
        if (isRecord(item) || Array.isArray(item)) {
          return JSON.stringify(item);
        }
        return String(item);
      })
      .join(", ");
  }

  if (isRecord(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

export function formatDateTime(value?: string) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}

export function formatDateTimeInTimeZone(value: string | undefined, timeZone: string) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    const formatted = date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone
    });
    const timeZoneName = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      timeZone,
      timeZoneName: "shortOffset"
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;
    return timeZoneName ? `${formatted} (${timeZoneName})` : formatted;
  } catch {
    return formatDateTime(value);
  }
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
