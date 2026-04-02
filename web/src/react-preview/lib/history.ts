export type HistoryDiffItem = {
  path: string;
  kind: "added" | "removed" | "changed";
  previous: string;
  current: string;
  group: string;
};

export type HistoryDiffSummary = {
  added: number;
  removed: number;
  changed: number;
  items: HistoryDiffItem[];
};

const IGNORED_PATHS = new Set([
  "Head.ReportTime",
  "Head.Version",
  "Head.Command",
  "Head.GitHub",
  "Meta.node_name",
  "Meta.node_uuid",
  "Meta.source",
  "Meta.updated_at"
]);

const NOISE_PREFIXES = ["Meta."];

export function historyDiffGroup(path: string): string {
  if (!path) {
    return "Other";
  }
  const [group] = path.split(/[.[\]]/, 1);
  return group || "Other";
}

export function isMeaningfulHistoryPath(path: string): boolean {
  if (IGNORED_PATHS.has(path)) {
    return false;
  }
  return !NOISE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function filterHistoryDiffItems(
  items: HistoryDiffItem[],
  options?: { group?: string; meaningfulOnly?: boolean }
) {
  return items.filter((item) => {
    if (options?.group && options.group !== "全部" && item.group !== options.group) {
      return false;
    }
    if (options?.meaningfulOnly && !isMeaningfulHistoryPath(item.path)) {
      return false;
    }
    return true;
  });
}

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
      items.push({ path, group: historyDiffGroup(path), kind: "added", previous: "N/A", current: currentValue });
      continue;
    }
    if (currentValue === undefined) {
      removed += 1;
      items.push({ path, group: historyDiffGroup(path), kind: "removed", previous: previousValue, current: "N/A" });
      continue;
    }
    if (currentValue !== previousValue) {
      changed += 1;
      items.push({ path, group: historyDiffGroup(path), kind: "changed", previous: previousValue, current: currentValue });
    }
  }

  return { added, removed, changed, items };
}
