export type HistoryDiffItem = {
  path: string;
  kind: "added" | "removed" | "changed";
  previous: string;
  current: string;
};

export type HistoryDiffSummary = {
  added: number;
  removed: number;
  changed: number;
  items: HistoryDiffItem[];
};

const IGNORED_PATHS = new Set(["Head.ReportTime"]);

function formatLeafValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenResult(value: unknown, prefix = "", out: Record<string, string> = {}) {
  if (value === null || value === undefined) {
    if (prefix) {
      out[prefix] = "N/A";
    }
    return out;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) {
        out[prefix] = "[]";
      }
      return out;
    }
    value.forEach((item, index) => {
      const nextPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flattenResult(item, nextPrefix, out);
    });
    return out;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      if (prefix) {
        out[prefix] = "{}";
      }
      return out;
    }
    entries.forEach(([key, item]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenResult(item, nextPrefix, out);
    });
    return out;
  }

  if (prefix) {
    out[prefix] = formatLeafValue(value);
  }
  return out;
}

export function compareHistoryResults(current: Record<string, unknown>, previous?: Record<string, unknown> | null): HistoryDiffSummary {
  const currentFlat = flattenResult(current);
  const previousFlat = flattenResult(previous ?? {});
  const paths = Array.from(new Set([...Object.keys(currentFlat), ...Object.keys(previousFlat)]))
    .filter((path) => !IGNORED_PATHS.has(path))
    .sort((left, right) => left.localeCompare(right));

  const items: HistoryDiffItem[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const path of paths) {
    const currentValue = currentFlat[path];
    const previousValue = previousFlat[path];

    if (previousValue === undefined) {
      added += 1;
      items.push({ path, kind: "added", previous: "N/A", current: currentValue });
      continue;
    }
    if (currentValue === undefined) {
      removed += 1;
      items.push({ path, kind: "removed", previous: previousValue, current: "N/A" });
      continue;
    }
    if (currentValue !== previousValue) {
      changed += 1;
      items.push({ path, kind: "changed", previous: previousValue, current: currentValue });
    }
  }

  return { added, removed, changed, items };
}
