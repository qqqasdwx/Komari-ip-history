export type CompareStatus = "changed" | "added" | "unchanged";

export type CompareStats = {
  changed: number;
  added: number;
  unchanged: number;
};

export type CompareLeafChange = {
  path: string;
  fullPath: string;
  status: CompareStatus;
  previous: unknown;
  current: unknown;
};

export type ComparePriority = "primary" | "secondary";

export type ClassifiedCompareChanges = {
  primary: CompareLeafChange[];
  secondary: CompareLeafChange[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function emptyCompareStats(): CompareStats {
  return { changed: 0, added: 0, unchanged: 0 };
}

export function mergeCompareStats(target: CompareStats, next: CompareStats): CompareStats {
  target.changed += next.changed;
  target.added += next.added;
  target.unchanged += next.unchanged;
  return target;
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqual(value, right[index]));
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  return false;
}

export function compareValueStatus(current: unknown, previous: unknown): CompareStatus {
  if (previous === undefined) {
    return "added";
  }
  return deepEqual(current, previous) ? "unchanged" : "changed";
}

export function compareValueStats(current: unknown, previous: unknown): CompareStats {
  if (isRecord(current)) {
    return Object.entries(current).reduce((stats, [key, value]) => {
      const previousValue = isRecord(previous) ? previous[key] : undefined;
      return mergeCompareStats(stats, compareValueStats(value, previousValue));
    }, emptyCompareStats());
  }

  return {
    changed: compareValueStatus(current, previous) === "changed" ? 1 : 0,
    added: compareValueStatus(current, previous) === "added" ? 1 : 0,
    unchanged: compareValueStatus(current, previous) === "unchanged" ? 1 : 0
  };
}

export function collectCompareLeafChanges(
  current: unknown,
  previous: unknown,
  prefix = "",
  fullPrefix = prefix
): CompareLeafChange[] {
  if (isRecord(current)) {
    return Object.entries(current).flatMap(([key, value]) => {
      const nextPath = prefix ? `${prefix}.${key}` : key;
      const nextFullPath = fullPrefix ? `${fullPrefix}.${key}` : key;
      const previousValue = isRecord(previous) ? previous[key] : undefined;
      return collectCompareLeafChanges(value, previousValue, nextPath, nextFullPath);
    });
  }

  return [
    {
      path: prefix,
      fullPath: fullPrefix,
      status: compareValueStatus(current, previous),
      previous,
      current
    }
  ];
}

function matchesSecondaryPath(fullPath: string, secondaryPath: string): boolean {
  return fullPath === secondaryPath || fullPath.startsWith(`${secondaryPath}.`);
}

export function comparePathPriority(fullPath: string, secondaryPaths: string[]): ComparePriority {
  if (secondaryPaths.some((secondaryPath) => matchesSecondaryPath(fullPath, secondaryPath))) {
    return "secondary";
  }
  return "primary";
}

export function classifyCompareLeafChanges(
  changes: CompareLeafChange[],
  secondaryPaths: string[]
): ClassifiedCompareChanges {
  return changes.reduce<ClassifiedCompareChanges>(
    (result, change) => {
      if (change.status === "unchanged") {
        return result;
      }
      const priority = comparePathPriority(change.fullPath, secondaryPaths);
      result[priority].push(change);
      return result;
    },
    { primary: [], secondary: [] }
  );
}
