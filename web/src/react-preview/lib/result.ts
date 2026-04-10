import { isRecord } from "./format";
import ipqualityTemplate from "./ipquality-template.json";

export type StructuredCurrentResult = {
  head?: Record<string, unknown>;
  info?: Record<string, unknown>;
  type?: Record<string, unknown>;
  factor?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  score?: Record<string, unknown>;
  media?: Record<string, unknown>;
  mail?: Record<string, unknown>;
  remainder: Record<string, unknown>;
};

function cloneRecord(record: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function takeStructuredGroup(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!isRecord(value)) {
    return undefined;
  }

  delete record[key];
  return value;
}

function filterHiddenFields(value: unknown, prefix: string, hiddenPaths: Set<string>): unknown {
  if (prefix && hiddenPaths.has(prefix)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      const filtered = filterHiddenFields(child, childPath, hiddenPaths);
      if (filtered !== undefined) {
        next[key] = filtered;
      }
    }

    if (prefix && Object.keys(next).length === 0) {
      return undefined;
    }

    return next;
  }

  return value;
}

function nullifyTemplate(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [];
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nullifyTemplate(child)]));
  }
  return null;
}

function mergeIntoTemplate(template: unknown, actual: unknown): unknown {
  if (Array.isArray(template)) {
    return Array.isArray(actual) ? actual : template;
  }

  if (isRecord(template)) {
    const actualRecord = isRecord(actual) ? actual : {};
    return Object.fromEntries(
      Object.entries(template).map(([key, childTemplate]) => [key, mergeIntoTemplate(childTemplate, actualRecord[key])])
    );
  }

  return actual === undefined ? template : actual;
}

export function getFilteredCurrentResult(result: Record<string, unknown>, hiddenPaths: string[]): StructuredCurrentResult | null {
  const template = nullifyTemplate(ipqualityTemplate) as Record<string, unknown>;
  const normalized = mergeIntoTemplate(template, result);
  const hidden = new Set(hiddenPaths);
  const filtered = filterHiddenFields(normalized, "", hidden);

  if (!isRecord(filtered) || Object.keys(filtered).length === 0) {
    return null;
  }

  const remainder = cloneRecord(filtered);
  return {
    head: takeStructuredGroup(remainder, "Head"),
    info: takeStructuredGroup(remainder, "Info"),
    type: takeStructuredGroup(remainder, "Type"),
    factor: takeStructuredGroup(remainder, "Factor"),
    meta: takeStructuredGroup(remainder, "Meta"),
    score: takeStructuredGroup(remainder, "Score"),
    media: takeStructuredGroup(remainder, "Media"),
    mail: takeStructuredGroup(remainder, "Mail"),
    remainder
  };
}

export function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0;
}
