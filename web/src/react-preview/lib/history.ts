import type { DisplayFieldValue } from "./display-fields";
import { buildDisplayFieldOptionLabel, extractDisplayFieldValues } from "./display-fields";
import type { NodeHistoryEntry } from "./types";

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

export type HistoryFieldChangeEvent = {
  id: string;
  targetId: number;
  targetIP: string;
  fieldId: string;
  groupPath: string[];
  fieldLabel: string;
  fieldOptionLabel: string;
  previous: DisplayFieldValue;
  current: DisplayFieldValue;
  previousRecordedAt: string;
  recordedAt: string;
};

export type HistoryCompareRow = {
  fieldId: string;
  groupPath: string[];
  fieldLabel: string;
  fieldOptionLabel: string;
  left: DisplayFieldValue;
  right: DisplayFieldValue;
  changed: boolean;
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

function compareDisplayFieldValues(left: DisplayFieldValue, right: DisplayFieldValue) {
  return left.text === right.text && left.tone === right.tone && left.missingKind === right.missingKind;
}

function buildMissingDisplayFieldLike(source: DisplayFieldValue): DisplayFieldValue {
  return {
    ...source,
    text: "N/A",
    tone: "muted",
    missingKind: "missing"
  };
}

function buildDisplayFieldMap(result: Record<string, unknown>) {
  const values = extractDisplayFieldValues(result);
  const map = new Map<string, DisplayFieldValue>();
  for (const value of values) {
    map.set(value.id, value);
  }
  return map;
}

export function buildHistoryFieldChangeEvents(items: NodeHistoryEntry[]) {
  const ordered = [...items].sort(
    (left, right) => new Date(left.recorded_at).getTime() - new Date(right.recorded_at).getTime()
  );
  const events: HistoryFieldChangeEvent[] = [];
  let previousMap = new Map<string, DisplayFieldValue>();
  let previousEntry: NodeHistoryEntry | null = null;

  ordered.forEach((item) => {
    const currentMap = buildDisplayFieldMap(item.result);
    const ids = Array.from(new Set([...previousMap.keys(), ...currentMap.keys()])).sort((left, right) => left.localeCompare(right));

    for (const id of ids) {
      const current = currentMap.get(id);
      const previous = previousMap.get(id);
      if (!current && !previous) {
        continue;
      }
      const previousValue = previous ?? buildMissingDisplayFieldLike(current!);
      const currentValue = current ?? buildMissingDisplayFieldLike(previous!);
      if (compareDisplayFieldValues(previousValue, currentValue)) {
        continue;
      }
      events.push({
        id: `${item.id}:${id}`,
        targetId: item.target_id,
        targetIP: item.target_ip,
        fieldId: id,
        groupPath: currentValue.groupPath,
        fieldLabel: currentValue.label,
        fieldOptionLabel: buildDisplayFieldOptionLabel(currentValue),
        previous: previousValue,
        current: currentValue,
        previousRecordedAt: previousEntry?.recorded_at ?? "",
        recordedAt: item.recorded_at
      });
    }

    previousMap = currentMap;
    previousEntry = item;
  });

  return events.sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime());
}

export function buildHistoryFieldOptions(events: HistoryFieldChangeEvent[]) {
  const map = new Map<string, { id: string; label: string }>();
  for (const event of events) {
    if (!map.has(event.fieldId)) {
      map.set(event.fieldId, { id: event.fieldId, label: event.fieldOptionLabel });
    }
  }
  return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function buildHistoryCompareRows(leftResult: Record<string, unknown>, rightResult: Record<string, unknown>) {
  const leftMap = buildDisplayFieldMap(leftResult);
  const rightMap = buildDisplayFieldMap(rightResult);
  const ids = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort((left, right) => left.localeCompare(right));

  return ids
    .map((id) => {
      const left = leftMap.get(id);
      const right = rightMap.get(id);
      if (!left && !right) {
        return null;
      }
      const leftValue = left ?? buildMissingDisplayFieldLike(right!);
      const rightValue = right ?? buildMissingDisplayFieldLike(left!);
      return {
        fieldId: id,
        groupPath: rightValue.groupPath,
        fieldLabel: rightValue.label,
        fieldOptionLabel: buildDisplayFieldOptionLabel(rightValue),
        left: leftValue,
        right: rightValue,
        changed: !compareDisplayFieldValues(leftValue, rightValue)
      } satisfies HistoryCompareRow;
    })
    .filter((item): item is HistoryCompareRow => Boolean(item))
    .sort((left, right) => left.fieldOptionLabel.localeCompare(right.fieldOptionLabel, "zh-CN"));
}
