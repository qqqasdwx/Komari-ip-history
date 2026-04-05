import type { ReactNode } from "react";
import { getFilteredCurrentResult } from "./result";
import {
  reportBoolText,
  reportCountryText,
  reportFieldLabel,
  reportIPTypeMeta,
  reportIPTypeText,
  reportMediaStatusText,
  reportMediaTypeText,
  reportMissingText,
  reportRiskMeta,
  reportToneFromText,
  reportUsageMeta
} from "./report-meta";

export type DisplayFieldValue = {
  id: string;
  path: string;
  groupPath: string[];
  label: string;
  text: string;
  tone: "good" | "bad" | "warn" | "muted" | "neutral";
  missingKind?: "missing";
};

function compactText(value: string) {
  return value.replace(/\s+/g, "");
}

function orderedReportEntries(record: Record<string, unknown>, order: string[] = []) {
  const seen = new Set<string>();
  const entries: Array<[string, unknown]> = [];

  for (const key of order) {
    if (record[key] !== undefined) {
      seen.add(key);
      entries.push([key, record[key]]);
    }
  }

  for (const entry of Object.entries(record)) {
    if (!seen.has(entry[0])) {
      entries.push(entry);
    }
  }

  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFieldID(path: string) {
  return path.toLowerCase();
}

function pushField(
  items: DisplayFieldValue[],
  input: {
    path: string;
    groupPath: string[];
    label: string;
    text: string;
    tone?: "good" | "bad" | "warn" | "muted" | "neutral";
    missingKind?: "missing";
  }
) {
  items.push({
    id: normalizeFieldID(input.path),
    path: input.path,
    groupPath: input.groupPath,
    label: input.label,
    text: input.text,
    tone: input.tone ?? reportToneFromText(input.text),
    missingKind: input.missingKind
  });
}

function renderExtraRows(
  items: DisplayFieldValue[],
  input: {
    record?: Record<string, unknown>;
    basePath: string;
    groupPath: string[];
    skipKeys?: string[];
  }
) {
  if (!input.record) return;
  const skipped = new Set(input.skipKeys ?? []);
  for (const [key, value] of Object.entries(input.record)) {
    if (skipped.has(key)) {
      continue;
    }
    const path = `${input.basePath}.${key}`;
    if (isRecord(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        const childPath = `${path}.${childKey}`;
        const childText = reportMissingText(childValue) ? "N/A" : String(childValue);
        pushField(items, {
          path: childPath,
          groupPath: [...input.groupPath, reportFieldLabel(key)],
          label: reportFieldLabel(childKey),
          text: childText
        });
      }
      continue;
    }

    const text = reportMissingText(value) ? "N/A" : String(value);
    pushField(items, {
      path,
      groupPath: input.groupPath,
      label: reportFieldLabel(key),
      text
    });
  }
}

export function extractDisplayFieldValues(result: Record<string, unknown>) {
  const structured = getFilteredCurrentResult(result, []);
  if (!structured) {
    return [] as DisplayFieldValue[];
  }

  const items: DisplayFieldValue[] = [];
  const head = structured.head ?? {};
  const info = structured.info ?? {};
  const type = structured.type ?? {};
  const score = structured.score ?? {};
  const factor = structured.factor ?? {};
  const media = structured.media ?? {};
  const mail = structured.mail ?? {};

  pushField(items, { path: "Head.IP", groupPath: ["头部"], label: "IP", text: reportMissingText(head.IP) ? "N/A" : String(head.IP) });
  pushField(items, { path: "Head.Time", groupPath: ["头部"], label: "报告时间", text: reportMissingText(head.Time) ? "N/A" : String(head.Time) });
  pushField(items, { path: "Head.Version", groupPath: ["头部"], label: "脚本版本", text: reportMissingText(head.Version) ? "N/A" : String(head.Version) });

  const regionText = (value: unknown) => {
    if (!isRecord(value)) return "";
    const code = reportMissingText(value.Code) ? "" : reportCountryText(value.Code);
    const name = reportMissingText(value.Name) ? "" : String(value.Name);
    return [code, name].filter(Boolean).join("");
  };
  const cityText = isRecord(info.City)
    ? [
        !reportMissingText(info.Region && isRecord(info.Region) ? info.Region.Name : "") ? String(info.Region && isRecord(info.Region) ? info.Region.Name : "") : "",
        !reportMissingText(info.City.Name) ? String(info.City.Name) : "",
        info.City.PostalCode && info.City.PostalCode !== "null" ? String(info.City.PostalCode) : ""
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const usagePlaceText = [regionText(info.Region), regionText(info.Continent)].filter(Boolean).join(", ");
  const registeredText = regionText(info.RegisteredRegion) || "N/A";
  const coordinateText = [reportMissingText(info.Latitude) ? "" : String(info.Latitude), reportMissingText(info.Longitude) ? "" : String(info.Longitude)]
    .filter(Boolean)
    .join(", ");

  pushField(items, { path: "Info.ASN", groupPath: ["基础信息（Maxmind 数据库）"], label: "自治系统号", text: info.ASN ? `AS${String(info.ASN)}` : "N/A", tone: "good" });
  pushField(items, { path: "Info.Organization", groupPath: ["基础信息（Maxmind 数据库）"], label: "组织", text: reportMissingText(info.Organization) ? "N/A" : String(info.Organization), tone: "good" });
  pushField(items, { path: "Info.Coordinate", groupPath: ["基础信息（Maxmind 数据库）"], label: "坐标", text: coordinateText || "N/A", tone: "good" });
  pushField(items, { path: "Info.Map", groupPath: ["基础信息（Maxmind 数据库）"], label: "地图", text: reportMissingText(info.Map) ? "N/A" : String(info.Map) });
  pushField(items, { path: "Info.City", groupPath: ["基础信息（Maxmind 数据库）"], label: "城市", text: cityText || "N/A", tone: "good" });
  pushField(items, { path: "Info.UsagePlace", groupPath: ["基础信息（Maxmind 数据库）"], label: "使用地", text: usagePlaceText || "N/A", tone: "good" });
  pushField(items, { path: "Info.RegisteredRegion", groupPath: ["基础信息（Maxmind 数据库）"], label: "注册地", text: registeredText, tone: "good" });
  pushField(items, { path: "Info.TimeZone", groupPath: ["基础信息（Maxmind 数据库）"], label: "时区", text: reportMissingText(info.TimeZone) ? "N/A" : String(info.TimeZone), tone: "good" });
  pushField(items, {
    path: "Info.Type",
    groupPath: ["基础信息（Maxmind 数据库）"],
    label: "IP类型",
    text: reportIPTypeText(info.Type),
    tone: reportIPTypeMeta(info.Type).tone
  });
  renderExtraRows(items, {
    record: info,
    basePath: "Info",
    groupPath: ["基础信息（Maxmind 数据库）"],
    skipKeys: ["ASN", "Organization", "Latitude", "Longitude", "DMS", "Map", "City", "Region", "Continent", "RegisteredRegion", "TimeZone", "Type"]
  });

  const providerOrder = ["IPinfo", "ipregistry", "ipapi", "IP2LOCATION", "AbuseIPDB"];
  if (isRecord(type.Usage)) {
    for (const [key, value] of orderedReportEntries(type.Usage, providerOrder)) {
      const meta = reportUsageMeta(value);
      pushField(items, {
        path: `Type.Usage.${key}`,
        groupPath: ["IP类型属性", reportFieldLabel(key)],
        label: "使用类型",
        text: meta.text,
        tone: meta.tone
      });
    }
  }
  if (isRecord(type.Company)) {
    for (const [key, value] of orderedReportEntries(type.Company, providerOrder)) {
      const meta = reportUsageMeta(value);
      pushField(items, {
        path: `Type.Company.${key}`,
        groupPath: ["IP类型属性", reportFieldLabel(key)],
        label: "公司类型",
        text: meta.text,
        tone: meta.tone
      });
    }
  }
  renderExtraRows(items, { record: type, basePath: "Type", groupPath: ["IP类型属性"], skipKeys: ["Usage", "Company"] });

  for (const [key, value] of orderedReportEntries(score, ["IP2LOCATION", "SCAMALYTICS", "ipapi", "AbuseIPDB", "IPQS", "DBIP"])) {
    const meta = reportRiskMeta(value);
    pushField(items, {
      path: `Score.${key}`,
      groupPath: ["风险评分"],
      label: reportFieldLabel(key),
      text: meta.text,
      tone: meta.tone
    });
  }

  const factorRowOrder = ["CountryCode", "Proxy", "Tor", "VPN", "Server", "Abuser", "Robot"];
  for (const row of factorRowOrder) {
    if (!isRecord(factor[row])) continue;
    for (const [key, value] of orderedReportEntries(factor[row] as Record<string, unknown>, ["IP2LOCATION", "ipapi", "ipregistry", "IPQS", "SCAMALYTICS", "ipdata", "IPinfo", "IPWHOIS", "DBIP"])) {
      const text = row === "CountryCode" ? reportCountryText(value) : reportBoolText(value);
      pushField(items, {
        path: `Factor.${row}.${key}`,
        groupPath: ["风险因子", reportFieldLabel(key)],
        label: reportFieldLabel(row),
        text
      });
    }
  }
  renderExtraRows(items, { record: factor, basePath: "Factor", groupPath: ["风险因子"], skipKeys: factorRowOrder });

  for (const [key, value] of orderedReportEntries(media, ["TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Reddit", "ChatGPT"])) {
    if (!isRecord(value)) continue;
    pushField(items, {
      path: `Media.${key}.Status`,
      groupPath: ["流媒体及AI服务解锁检测", reportFieldLabel(key)],
      label: "状态",
      text: reportMediaStatusText(value.Status)
    });
    pushField(items, {
      path: `Media.${key}.Region`,
      groupPath: ["流媒体及AI服务解锁检测", reportFieldLabel(key)],
      label: "地区",
      text: reportCountryText(value.Region)
    });
    pushField(items, {
      path: `Media.${key}.Type`,
      groupPath: ["流媒体及AI服务解锁检测", reportFieldLabel(key)],
      label: "方式",
      text: reportMediaTypeText(value.Type)
    });
    renderExtraRows(items, {
      record: value,
      basePath: `Media.${key}`,
      groupPath: ["流媒体及AI服务解锁检测", reportFieldLabel(key)],
      skipKeys: ["Status", "Region", "Type"]
    });
  }

  pushField(items, {
    path: "Mail.Port25",
    groupPath: ["邮局连通性及黑名单检测"],
    label: "本地25端口出站",
    text: reportMissingText(mail.Port25) ? "N/A" : mail.Port25 ? "可用" : "不可用",
    tone: reportMissingText(mail.Port25) ? "muted" : mail.Port25 ? "good" : "bad",
    missingKind: reportMissingText(mail.Port25) ? "missing" : undefined
  });
  for (const provider of ["Gmail", "Outlook", "Yahoo", "Apple", "QQ", "MailRU", "AOL", "GMX", "MailCOM", "163", "Sohu", "Sina"]) {
    const value = mail[provider];
    pushField(items, {
      path: `Mail.${provider}`,
      groupPath: ["邮局连通性及黑名单检测", "通信"],
      label: reportFieldLabel(provider),
      text: reportMissingText(value) ? "N/A" : value ? "可用" : "不可用",
      tone: reportMissingText(value) ? "muted" : value ? "good" : "bad",
      missingKind: reportMissingText(value) ? "missing" : undefined
    });
  }
  if (isRecord(mail.DNSBlacklist)) {
    for (const key of ["Total", "Clean", "Marked", "Blacklisted"]) {
      const text = reportMissingText(mail.DNSBlacklist[key]) ? "N/A" : String(mail.DNSBlacklist[key]);
      const tone =
        key === "Clean"
          ? "good"
          : key === "Marked"
            ? "warn"
            : key === "Blacklisted"
              ? Number(mail.DNSBlacklist[key]) > 0
                ? "bad"
                : "good"
              : "neutral";
      pushField(items, {
        path: `Mail.DNSBlacklist.${key}`,
        groupPath: ["邮局连通性及黑名单检测", "IP地址黑名单数据库"],
        label: reportFieldLabel(key),
        text,
        tone
      });
    }
    renderExtraRows(items, {
      record: mail.DNSBlacklist,
      basePath: "Mail.DNSBlacklist",
      groupPath: ["邮局连通性及黑名单检测", "IP地址黑名单数据库"],
      skipKeys: ["Total", "Clean", "Marked", "Blacklisted"]
    });
  }
  renderExtraRows(items, {
    record: mail,
    basePath: "Mail",
    groupPath: ["邮局连通性及黑名单检测"],
    skipKeys: ["Port25", "DNSBlacklist", "Gmail", "Outlook", "Yahoo", "Apple", "QQ", "MailRU", "AOL", "GMX", "MailCOM", "163", "Sohu", "Sina"]
  });

  for (const [key, value] of Object.entries(structured.remainder)) {
    if (!isRecord(value)) {
      pushField(items, {
        path: key,
        groupPath: [reportFieldLabel(key)],
        label: reportFieldLabel(key),
        text: reportMissingText(value) ? "N/A" : String(value)
      });
      continue;
    }
    renderExtraRows(items, { record: value, basePath: key, groupPath: [reportFieldLabel(key)] });
  }

  return items;
}

export function buildDisplayFieldOptionLabel(value: DisplayFieldValue) {
  return [...value.groupPath, value.label].map(compactText).join(" / ");
}

export function renderDisplayValueBadge(value: DisplayFieldValue): ReactNode {
  return (
    <span className={`report-badge report-badge-${value.tone}`}>
      {value.text}
      {value.missingKind === "missing" ? "（可能缺失）" : ""}
    </span>
  );
}
