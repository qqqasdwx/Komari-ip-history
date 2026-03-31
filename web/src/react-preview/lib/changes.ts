import {
  classifyCompareLeafChanges,
  collectCompareLeafChanges,
  emptyCompareStats,
  mergeCompareStats,
  type ClassifiedCompareChanges,
  type CompareLeafChange,
  type CompareStats
} from "../../compare";
import { formatDisplayValue } from "./format";
import { getFilteredCurrentResult, parseResultJSON } from "./result";
import type { ChangePriorityConfig, NodeDetail, NodeHistoryItem } from "./types";

export type StructuredCompareGroup = {
  key: string;
  title: string;
  chip: string;
  stats: CompareStats;
  changes: CompareLeafChange[];
  classifiedChanges: ClassifiedCompareChanges;
};

export function buildStructuredCompareGroups(
  currentResult: Record<string, unknown>,
  previousResult: Record<string, unknown> | undefined,
  hiddenPaths: string[],
  secondaryPaths: string[]
) {
  const structured = getFilteredCurrentResult(currentResult, hiddenPaths);
  const previousStructured = previousResult ? getFilteredCurrentResult(previousResult, hiddenPaths) : null;
  if (!structured) {
    return [] as StructuredCompareGroup[];
  }

  return [
    { key: "Head", title: "Head", chip: "报告头", current: structured.head, previous: previousStructured?.head },
    { key: "Info", title: "Info", chip: "基础信息", current: structured.info, previous: previousStructured?.info },
    { key: "Type", title: "Type", chip: "类型信息", current: structured.type, previous: previousStructured?.type },
    { key: "Factor", title: "Factor", chip: "风险因子", current: structured.factor, previous: previousStructured?.factor },
    { key: "Score", title: "Score", chip: "风险分项", current: structured.score, previous: previousStructured?.score },
    { key: "Media", title: "Media", chip: "流媒体与服务", current: structured.media, previous: previousStructured?.media },
    { key: "Mail", title: "Mail", chip: "邮件能力", current: structured.mail, previous: previousStructured?.mail },
    { key: "Other", title: "其他字段", chip: "动态字段", current: structured.remainder, previous: previousStructured?.remainder }
  ]
    .filter((group) => group.current && Object.keys(group.current).length > 0)
    .map((group) => {
      const changes = collectCompareLeafChanges(group.current, group.previous, "", group.key);
      const classifiedChanges = classifyCompareLeafChanges(changes, secondaryPaths);
      const stats = emptyCompareStats();
      stats.changed = changes.filter((change) => change.status === "changed").length;
      stats.added = changes.filter((change) => change.status === "added").length;
      stats.unchanged = changes.filter((change) => change.status === "unchanged").length;
      return {
        ...group,
        stats,
        changes,
        classifiedChanges
      };
    });
}

function focusPrimaryChangeGroups(groups: StructuredCompareGroup[]) {
  const primaryGroups = groups
    .map((group) => ({
      ...group,
      stats: {
        changed: group.classifiedChanges.primary.filter((item) => item.status === "changed").length,
        added: group.classifiedChanges.primary.filter((item) => item.status === "added").length,
        unchanged: 0
      },
      changes: group.classifiedChanges.primary,
      classifiedChanges: {
        primary: group.classifiedChanges.primary,
        secondary: []
      }
    }))
    .filter((group) => group.classifiedChanges.primary.length > 0);

  if (primaryGroups.length > 0) {
    return primaryGroups;
  }

  return groups.filter((group) => group.stats.changed > 0 || group.stats.added > 0);
}

export function buildRecentChangeSummary(
  detail: NodeDetail,
  hiddenPaths: string[],
  priority: ChangePriorityConfig
) {
  const latestRecord = detail.history[0] ?? null;
  const previousRecord = detail.history[1] ?? null;

  if (!latestRecord) {
    return {
      state: "empty" as const
    };
  }

  if (!previousRecord) {
    return {
      state: "single" as const,
      latestRecordedAt: latestRecord.recorded_at
    };
  }

  const latestResult = parseResultJSON(latestRecord.result_json);
  const previousResult = parseResultJSON(previousRecord.result_json);
  const groups = focusPrimaryChangeGroups(
    buildStructuredCompareGroups(latestResult, previousResult, hiddenPaths, priority.secondary_paths)
  );
  const stats = groups.reduce(
    (summary, group) => mergeCompareStats(summary, group.stats),
    emptyCompareStats()
  );

  return {
    state: "overview" as const,
    groups,
    latestRecord,
    previousRecord,
    stats
  };
}

export function renderChangeValue(change: CompareLeafChange) {
  if (change.status === "added") {
    return `新增为 ${formatDisplayValue(change.current)}`;
  }

  return `${formatDisplayValue(change.previous)} -> ${formatDisplayValue(change.current)}`;
}

export function groupHistoryPath(path: string) {
  return path.replaceAll(".", " / ");
}

export function parseHistoryRecordResult(record?: NodeHistoryItem | null) {
  return record ? parseResultJSON(record.result_json) : {};
}
