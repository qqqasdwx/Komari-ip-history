import type { DisplayFieldValue } from "./display-fields";
import { buildDisplayFieldOptionLabel, extractDisplayFieldValues } from "./display-fields";

export type HistoryCompareRow = {
  fieldId: string;
  path: string;
  groupPath: string[];
  fieldLabel: string;
  fieldOptionLabel: string;
  left: DisplayFieldValue;
  right: DisplayFieldValue;
  changed: boolean;
};

export function mapDisplayPathToReportPaths(path: string) {
  if (!path) {
    return [];
  }
  if (path.startsWith("Head.")) {
    return ["Head"];
  }
  if (path === "Info.Coordinate") {
    return ["Info.Latitude", "Info.Longitude"];
  }
  if (path === "Info.UsagePlace") {
    return ["Info.Region"];
  }
  if (path.startsWith("Mail.DNSBlacklist.")) {
    return ["Mail.DNSBlacklist"];
  }
  return [path];
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
        path: rightValue.path || leftValue.path,
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
