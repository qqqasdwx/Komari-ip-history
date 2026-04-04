import type { ReactNode } from "react";
import { formatDisplayValue, isRecord } from "./format";
import { getFilteredCurrentResult, isEmptyRecord, type StructuredCurrentResult } from "./result";
import {
  reportBoolText,
  reportCountryText,
  reportFieldLabel,
  reportIPTypeText,
  reportMediaStatusText,
  reportMediaTypeText,
  reportMissingText,
  reportToneFromText,
  reportUsageMeta
} from "./report-meta";

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

function reportRiskMeta(value: unknown) {
  if (reportMissingText(value)) {
    return { score: "N/A", label: "N/A", tone: "muted", percent: null as number | null };
  }

  const text = String(value).trim();
  const numeric = Number.parseFloat(text.replace("%", ""));
  if (Number.isNaN(numeric)) {
    return { score: text, label: "未知", tone: "neutral", percent: null as number | null };
  }

  const percent = Math.max(0, Math.min(100, numeric));
  if (numeric <= 5) return { score: text, label: "极低", tone: "good", percent };
  if (numeric <= 25) return { score: text, label: "低", tone: "good", percent };
  if (numeric <= 60) return { score: text, label: "中等", tone: "warn", percent };
  if (numeric <= 85) return { score: text, label: "高", tone: "bad", percent };
  return { score: text, label: "极高", tone: "bad", percent };
}

function joinClassNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function isPathHidden(hiddenPaths: string[], path?: string) {
  if (!path) return false;
  return hiddenPaths.some((hiddenPath) => path === hiddenPath || path.startsWith(`${hiddenPath}.`));
}

function FieldTarget(props: {
  path?: string;
  onFieldClick?: (path: string) => void;
  className?: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  const interactive = Boolean(props.path && props.onFieldClick);
  return (
    <div
      className={joinClassNames(props.className, interactive && "report-clickable", props.hidden && "report-hidden-outline")}
      data-field-path={props.path}
      onClick={
        interactive
          ? (event) => {
              event.stopPropagation();
              props.onFieldClick?.(props.path!);
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.onFieldClick?.(props.path!);
              }
            }
          : undefined
      }
    >
      {props.children}
    </div>
  );
}

function ReportBadge(props: { text: string; tone?: string; path?: string; hidden?: boolean; onFieldClick?: (path: string) => void }) {
  const tone = props.tone ?? reportToneFromText(props.text);
  return (
    <FieldTarget path={props.path} hidden={props.hidden} onFieldClick={props.onFieldClick}>
      <span className={`report-badge report-badge-${tone}`}>{props.text}</span>
    </FieldTarget>
  );
}

function ReportMailChip(props: { text: string; tone: "good" | "bad" | "muted"; path?: string; hidden?: boolean; onFieldClick?: (path: string) => void }) {
  return (
    <FieldTarget path={props.path} hidden={props.hidden} onFieldClick={props.onFieldClick}>
      <span className={`report-mail-chip ${props.tone}`}>{props.text}</span>
    </FieldTarget>
  );
}

function ReportSection(props: { title: string; path?: string; hidden?: boolean; onFieldClick?: (path: string) => void; children: ReactNode }) {
  return (
    <FieldTarget path={props.path} hidden={props.hidden} onFieldClick={props.onFieldClick} className="result-group report-group">
      <div className="report-group-title">{props.title}</div>
      <div className="report-group-body">{props.children}</div>
    </FieldTarget>
  );
}

function ReportKVRow(props: {
  label: string;
  text: string;
  tone?: string;
  path?: string;
  hidden?: boolean;
  onFieldClick?: (path: string) => void;
}) {
  return (
    <FieldTarget path={props.path} hidden={props.hidden} onFieldClick={props.onFieldClick} className="report-kv-row">
      <span className="report-kv-label">{props.label}</span>
      <div className="report-kv-value">
        <span className={`report-badge report-badge-${props.tone ?? reportToneFromText(props.text)}`}>{props.text}</span>
      </div>
    </FieldTarget>
  );
}

function ReportObjectRow(props: {
  label: string;
  path: string;
  value: unknown;
  hiddenPaths: string[];
  onFieldClick?: (path: string) => void;
}) {
  if (!isRecord(props.value)) {
    const text = reportMissingText(props.value) ? "N/A" : String(props.value);
    return (
      <ReportKVRow
        label={props.label}
        text={text}
        path={props.path}
        hidden={isPathHidden(props.hiddenPaths, props.path)}
        onFieldClick={props.onFieldClick}
      />
    );
  }

  const entries = Object.entries(props.value);
  if (entries.length === 0) {
    return (
      <ReportKVRow
        label={props.label}
        text="N/A"
        path={props.path}
        hidden={isPathHidden(props.hiddenPaths, props.path)}
        onFieldClick={props.onFieldClick}
      />
    );
  }

  return (
    <FieldTarget path={props.path} hidden={isPathHidden(props.hiddenPaths, props.path)} onFieldClick={props.onFieldClick} className="report-line">
      <span className="report-label">{props.label}</span>
      <div className="report-values">
        {entries.map(([key, child]) => (
          <FieldTarget
            key={`${props.path}.${key}`}
            path={`${props.path}.${key}`}
            hidden={isPathHidden(props.hiddenPaths, `${props.path}.${key}`)}
            onFieldClick={props.onFieldClick}
            className="report-cell"
          >
            <strong>{reportFieldLabel(key)}</strong>
            <span className={`report-badge report-badge-${reportToneFromText(reportMissingText(child) ? "无" : String(child))}`}>
              {reportMissingText(child) ? "无" : String(child)}
            </span>
          </FieldTarget>
        ))}
      </div>
    </FieldTarget>
  );
}

function renderExtraRows(props: {
  record?: Record<string, unknown>;
  basePath: string;
  hiddenPaths: string[];
  skipKeys?: string[];
  onFieldClick?: (path: string) => void;
}) {
  if (!props.record) return null;
  const skipped = new Set(props.skipKeys ?? []);
  const entries = Object.entries(props.record).filter(([key]) => !skipped.has(key));
  if (entries.length === 0) return null;

  return entries.map(([key, value]) => (
    <ReportObjectRow
      key={`${props.basePath}.${key}`}
      label={reportFieldLabel(key)}
      path={`${props.basePath}.${key}`}
      value={value}
      hiddenPaths={props.hiddenPaths}
      onFieldClick={props.onFieldClick}
    />
  ));
}

function ScoreMeter(props: { percent: number | null; tone: string }) {
  if (props.percent === null) {
    return (
      <div className="report-score-bar">
        <div className="report-score-bar-track"></div>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, props.percent));
  const markerLeft = clamped === 0 ? "0%" : clamped === 100 ? "100%" : `${clamped}%`;
  return (
    <div className="report-score-bar">
      <div className="report-score-bar-track"></div>
      <div className={`report-score-bar-fill report-score-bar-fill-${props.tone}`} style={{ width: `${clamped}%` }}></div>
      <div className="report-score-bar-marker" style={{ left: markerLeft }}></div>
    </div>
  );
}

function Matrix(props: {
  columns: string[];
  rows: Array<{ label: string; values: Array<{ text: string; tone?: string; path?: string; hidden?: boolean }> }>;
  onFieldClick?: (path: string) => void;
}) {
  if (props.columns.length === 0 || props.rows.length === 0) return null;
  const style = { gridTemplateColumns: `minmax(var(--report-row-label-min, 112px), var(--report-row-label-max, 132px)) repeat(${props.columns.length}, minmax(var(--report-column-min, 92px), 1fr))` };

  return (
    <div className="report-matrix">
      <div className="report-matrix-row report-matrix-head" style={style}>
        <div className="report-row-label">项目</div>
        {props.columns.map((column) => (
          <div key={column} className="report-head-cell">
            {column}
          </div>
        ))}
      </div>
      {props.rows.map((row) => (
        <div key={row.label} className="report-matrix-row" style={style}>
          <div className="report-row-label">{row.label}</div>
          {row.values.map((value, index) => (
            <div key={`${row.label}-${props.columns[index]}`} className="report-table-cell">
              <ReportBadge text={value.text} tone={value.tone} path={value.path} hidden={value.hidden} onFieldClick={props.onFieldClick} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ReportHeader(props: { structured: StructuredCurrentResult; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  const ip = reportMissingText(props.structured.head?.IP) ? "N/A" : String(props.structured.head?.IP);
  const time = reportMissingText(props.structured.head?.Time) ? "N/A" : String(props.structured.head?.Time);
  const version = reportMissingText(props.structured.head?.Version) ? "N/A" : String(props.structured.head?.Version);

  return (
    <div className="report-banner">
      <div className="report-banner-line">########################################################################</div>
      <FieldTarget path="Head.IP" hidden={isPathHidden(props.hiddenPaths, "Head.IP")} onFieldClick={props.onFieldClick} className="report-banner-title">
        IP质量体检报告：<span>{ip}</span>
      </FieldTarget>
      <div className="report-banner-meta">
        <FieldTarget path="Head.Time" hidden={isPathHidden(props.hiddenPaths, "Head.Time")} onFieldClick={props.onFieldClick}>
          <span>报告时间：{time}</span>
        </FieldTarget>
        <FieldTarget path="Head.Version" hidden={isPathHidden(props.hiddenPaths, "Head.Version")} onFieldClick={props.onFieldClick}>
          <span>脚本版本：{version}</span>
        </FieldTarget>
      </div>
      <div className="report-banner-line">########################################################################</div>
    </div>
  );
}

function BaseInfoSection(props: { structured: StructuredCurrentResult; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  const info = props.structured.info;
  if (!info) return null;

  const regionText = (value: unknown) => {
    if (!isRecord(value)) return "";
    const code = reportMissingText(value.Code) ? "" : reportCountryText(value.Code);
    const name = reportMissingText(value.Name) ? "" : String(value.Name);
    return [code, name].filter(Boolean).join("");
  };

  const city = isRecord(info.City)
    ? [
        !reportMissingText(info.Region && isRecord(info.Region) ? info.Region.Name : "") ? String(info.Region && isRecord(info.Region) ? info.Region.Name : "") : "",
        !reportMissingText(info.City.Name) ? String(info.City.Name) : "",
        info.City.PostalCode && info.City.PostalCode !== "null" ? String(info.City.PostalCode) : ""
      ]
      .filter(Boolean)
      .join(", ")
    : "";

  const usagePlace = [regionText(info.Region), regionText(info.Continent)].filter(Boolean).join(", ");
  const registered = regionText(info.RegisteredRegion) || "N/A";
  const coordinate = [reportMissingText(info.Latitude) ? "" : String(info.Latitude), reportMissingText(info.Longitude) ? "" : String(info.Longitude)]
    .filter(Boolean)
    .join(", ");

  return (
    <ReportSection title="一、基础信息（Maxmind 数据库）" path="Info" hidden={isPathHidden(props.hiddenPaths, "Info")} onFieldClick={props.onFieldClick}>
      <ReportKVRow label="自治系统号" text={info.ASN ? `AS${String(info.ASN)}` : "N/A"} tone="good" path="Info.ASN" hidden={isPathHidden(props.hiddenPaths, "Info.ASN")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="组织" text={reportMissingText(info.Organization) ? "N/A" : String(info.Organization)} tone="good" path="Info.Organization" hidden={isPathHidden(props.hiddenPaths, "Info.Organization")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="坐标" text={coordinate || "N/A"} tone="good" path="Info.Latitude" hidden={isPathHidden(props.hiddenPaths, "Info.Latitude") || isPathHidden(props.hiddenPaths, "Info.Longitude")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="地图" text={reportMissingText(info.Map) ? "N/A" : String(info.Map)} tone="neutral" path="Info.Map" hidden={isPathHidden(props.hiddenPaths, "Info.Map")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="城市" text={city || "N/A"} tone="good" path="Info.City" hidden={isPathHidden(props.hiddenPaths, "Info.City")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="使用地" text={usagePlace || "N/A"} tone="good" path="Info.Region" hidden={isPathHidden(props.hiddenPaths, "Info.Region")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="注册地" text={registered} tone="good" path="Info.RegisteredRegion" hidden={isPathHidden(props.hiddenPaths, "Info.RegisteredRegion")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="时区" text={reportMissingText(info.TimeZone) ? "N/A" : String(info.TimeZone)} tone="good" path="Info.TimeZone" hidden={isPathHidden(props.hiddenPaths, "Info.TimeZone")} onFieldClick={props.onFieldClick} />
      <ReportKVRow label="IP类型" text={reportIPTypeText(info.Type)} tone="good" path="Info.Type" hidden={isPathHidden(props.hiddenPaths, "Info.Type")} onFieldClick={props.onFieldClick} />
      {renderExtraRows({
        record: info,
        basePath: "Info",
        hiddenPaths: props.hiddenPaths,
        skipKeys: ["ASN", "Organization", "Latitude", "Longitude", "DMS", "Map", "City", "Region", "Continent", "RegisteredRegion", "TimeZone", "Type"],
        onFieldClick: props.onFieldClick
      })}
    </ReportSection>
  );
}

function TypeSection(props: { structured: StructuredCurrentResult; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  const type = props.structured.type;
  if (!type) return null;

  const providerOrder = ["IPinfo", "ipregistry", "ipapi", "IP2LOCATION", "AbuseIPDB"];
  const usageEntries = isRecord(type.Usage) ? orderedReportEntries(type.Usage, providerOrder) : [];
  const companyEntries = isRecord(type.Company) ? orderedReportEntries(type.Company, providerOrder) : [];
  const columns = Array.from(new Set([...usageEntries.map(([key]) => reportFieldLabel(key)), ...companyEntries.map(([key]) => reportFieldLabel(key))]));
  const usageMap = new Map(usageEntries.map(([key, value]) => [reportFieldLabel(key), { ...reportUsageMeta(value), path: `Type.Usage.${key}` }]));
  const companyMap = new Map(companyEntries.map(([key, value]) => [reportFieldLabel(key), { ...reportUsageMeta(value), path: `Type.Company.${key}` }]));

  return (
    <ReportSection title="二、IP类型属性" path="Type" hidden={isPathHidden(props.hiddenPaths, "Type")} onFieldClick={props.onFieldClick}>
      <Matrix
        columns={columns}
        onFieldClick={props.onFieldClick}
        rows={[
          {
            label: "使用类型",
            values: columns.map((column) => {
              const value = usageMap.get(column) ?? { text: "N/A", tone: "muted" };
              return { ...value, hidden: isPathHidden(props.hiddenPaths, value.path) };
            })
          },
          {
            label: "公司类型",
            values: columns.map((column) => {
              const value = companyMap.get(column) ?? { text: "N/A", tone: "muted" };
              return { ...value, hidden: isPathHidden(props.hiddenPaths, value.path) };
            })
          }
        ]}
      />
      {renderExtraRows({
        record: type,
        basePath: "Type",
        hiddenPaths: props.hiddenPaths,
        skipKeys: ["Usage", "Company"],
        onFieldClick: props.onFieldClick
      })}
    </ReportSection>
  );
}

function ScoreSection(props: { structured: StructuredCurrentResult; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  const score = props.structured.score;
  if (!score) return null;

  const order = ["IP2LOCATION", "SCAMALYTICS", "ipapi", "AbuseIPDB", "IPQS", "DBIP"];
  const rows = orderedReportEntries(score, order);

  return (
    <ReportSection title="三、风险评分" path="Score" hidden={isPathHidden(props.hiddenPaths, "Score")} onFieldClick={props.onFieldClick}>
      <div className="report-score-scale">
        <span className="report-score-name">风险等级</span>
        <span className="report-score-value"></span>
        <span className="report-score-risk"></span>
        <div className="report-score-main">
          <div className="report-score-scale-stack">
            <div className="report-score-scale-labels">
              <span>极低</span>
              <span>低</span>
              <span>中等</span>
              <span>高</span>
              <span>极高</span>
            </div>
            <div className="report-score-scale-track">
              <span className="report-score-scale-segment good"></span>
              <span className="report-score-scale-segment warn"></span>
              <span className="report-score-scale-segment bad"></span>
            </div>
          </div>
        </div>
      </div>
      <div className="report-score-list">
        {rows.map(([key, value]) => {
          const risk = reportRiskMeta(value);
          return (
            <FieldTarget key={key} path={`Score.${key}`} hidden={isPathHidden(props.hiddenPaths, `Score.${key}`)} onFieldClick={props.onFieldClick} className="report-score-row">
              <span className="report-score-name">{reportFieldLabel(key)}</span>
              <span className="report-score-value">{risk.score}</span>
              <span className="report-score-risk">
                <span className={`report-badge report-badge-${risk.tone}`}>{risk.label}</span>
              </span>
              <div className="report-score-main">
                <ScoreMeter percent={risk.percent} tone={risk.tone} />
              </div>
            </FieldTarget>
          );
        })}
      </div>
    </ReportSection>
  );
}

function FactorSection(props: { structured: StructuredCurrentResult; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  const factor = props.structured.factor;
  if (!factor) return null;

  const providerOrder = ["IP2LOCATION", "ipapi", "ipregistry", "IPQS", "SCAMALYTICS", "ipdata", "IPinfo", "IPWHOIS", "DBIP"];
  const rowOrder = ["CountryCode", "Proxy", "Tor", "VPN", "Server", "Abuser", "Robot"];
  const providers = Array.from(
    new Set(
      rowOrder.flatMap((row) =>
        isRecord(factor[row]) ? orderedReportEntries(factor[row] as Record<string, unknown>, providerOrder).map(([key]) => reportFieldLabel(key)) : []
      )
    )
  );

  return (
    <ReportSection title="四、风险因子" path="Factor" hidden={isPathHidden(props.hiddenPaths, "Factor")} onFieldClick={props.onFieldClick}>
      <Matrix
        columns={providers}
        onFieldClick={props.onFieldClick}
        rows={rowOrder
          .filter((row) => isRecord(factor[row]))
          .map((row) => {
            const valueMap = new Map(
              orderedReportEntries(factor[row] as Record<string, unknown>, providerOrder).map(([key, value]) => {
                const text = row === "CountryCode" ? reportCountryText(value) : reportBoolText(value);
                return [reportFieldLabel(key), { text, path: `Factor.${row}.${key}`, hidden: isPathHidden(props.hiddenPaths, `Factor.${row}.${key}`) }];
              })
            );
            return {
              label: reportFieldLabel(row),
              values: providers.map((provider) => valueMap.get(provider) ?? { text: "N/A", tone: "muted" })
            };
          })}
      />
      {renderExtraRows({
        record: factor,
        basePath: "Factor",
        hiddenPaths: props.hiddenPaths,
        skipKeys: rowOrder,
        onFieldClick: props.onFieldClick
      })}
    </ReportSection>
  );
}

function MediaSection(props: { structured: StructuredCurrentResult; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  const media = props.structured.media;
  if (!media) return null;

  const serviceOrder = ["TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Reddit", "ChatGPT"];
  const services = orderedReportEntries(media, serviceOrder).map(([key]) => reportFieldLabel(key));
  const mediaMap = new Map(orderedReportEntries(media, serviceOrder).map(([key, value]) => [reportFieldLabel(key), { key, value: isRecord(value) ? value : {} }]));

  return (
    <ReportSection title="五、流媒体及AI服务解锁检测" path="Media" hidden={isPathHidden(props.hiddenPaths, "Media")} onFieldClick={props.onFieldClick}>
      <Matrix
        columns={services}
        onFieldClick={props.onFieldClick}
        rows={[
          {
            label: "状态",
            values: services.map((service) => {
              const entry = mediaMap.get(service)!;
              const text = reportMediaStatusText(entry.value.Status);
              return { text, tone: reportToneFromText(text), path: `Media.${entry.key}.Status`, hidden: isPathHidden(props.hiddenPaths, `Media.${entry.key}.Status`) };
            })
          },
          {
            label: "地区",
            values: services.map((service) => {
              const entry = mediaMap.get(service)!;
              const text = reportCountryText(entry.value.Region);
              return { text, tone: reportToneFromText(text), path: `Media.${entry.key}.Region`, hidden: isPathHidden(props.hiddenPaths, `Media.${entry.key}.Region`) };
            })
          },
          {
            label: "方式",
            values: services.map((service) => {
              const entry = mediaMap.get(service)!;
              const text = reportMediaTypeText(entry.value.Type);
              return { text, tone: reportToneFromText(text), path: `Media.${entry.key}.Type`, hidden: isPathHidden(props.hiddenPaths, `Media.${entry.key}.Type`) };
            })
          }
        ]}
      />
      {orderedReportEntries(media, serviceOrder).map(([key, value]) =>
        isRecord(value)
          ? renderExtraRows({
              record: value,
              basePath: `Media.${key}`,
              hiddenPaths: props.hiddenPaths,
              skipKeys: ["Status", "Region", "Type"],
              onFieldClick: props.onFieldClick
            })
          : null
      )}
    </ReportSection>
  );
}

function MailSection(props: { structured: StructuredCurrentResult; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  const mail = props.structured.mail;
  if (!mail) return null;

  const providers = ["Gmail", "Outlook", "Yahoo", "Apple", "QQ", "MailRU", "AOL", "GMX", "MailCOM", "163", "Sohu", "Sina"];
  const dnsbl = isRecord(mail.DNSBlacklist) ? mail.DNSBlacklist : null;

  return (
    <ReportSection title="六、邮局连通性及黑名单检测" path="Mail" hidden={isPathHidden(props.hiddenPaths, "Mail")} onFieldClick={props.onFieldClick}>
      <FieldTarget path="Mail.Port25" hidden={isPathHidden(props.hiddenPaths, "Mail.Port25")} onFieldClick={props.onFieldClick} className="report-mail-summary report-mail-summary-inline">
        <span className="report-kv-label">本地25端口出站</span>
        <div className="report-mail-inline-text">
          <span className={`report-inline-text ${reportMissingText(mail.Port25) ? "report-inline-text-muted" : mail.Port25 ? "report-inline-text-good" : "report-inline-text-bad"}`}>{reportMissingText(mail.Port25) ? "N/A" : mail.Port25 ? "可用" : "不可用"}</span>
        </div>
      </FieldTarget>

      {providers.length > 0 ? (
        <div className="report-mail-summary report-mail-summary-inline">
          <span className="report-kv-label">通信</span>
          <div className="report-mail-metrics report-mail-mailboxes">
            {providers.map((provider) => {
              const value = mail[provider];
              const text = reportFieldLabel(provider);
              const tone = reportMissingText(value) ? "muted" : value ? "good" : "bad";
              return (
                <ReportMailChip
                  key={provider}
                  text={text}
                  tone={tone}
                  path={`Mail.${provider}`}
                  hidden={isPathHidden(props.hiddenPaths, `Mail.${provider}`)}
                  onFieldClick={props.onFieldClick}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {dnsbl ? (
        <FieldTarget path="Mail.DNSBlacklist" hidden={isPathHidden(props.hiddenPaths, "Mail.DNSBlacklist")} onFieldClick={props.onFieldClick} className="report-mail-summary report-mail-summary-inline">
          <span className="report-kv-label">IP地址黑名单数据库</span>
          <div className="report-mail-inline-text">
            <span className="report-inline-text report-inline-text-neutral">有效 {reportMissingText(dnsbl.Total) ? "N/A" : String(dnsbl.Total)}</span>
            <span className="report-inline-sep">/</span>
            <span className="report-inline-text report-inline-text-good">正常 {reportMissingText(dnsbl.Clean) ? "N/A" : String(dnsbl.Clean)}</span>
            <span className="report-inline-sep">/</span>
            <span className="report-inline-text report-inline-text-warn">已标记 {reportMissingText(dnsbl.Marked) ? "N/A" : String(dnsbl.Marked)}</span>
            <span className="report-inline-sep">/</span>
            <span className={`report-inline-text ${Number(dnsbl.Blacklisted) > 0 ? "report-inline-text-bad" : "report-inline-text-good"}`}>黑名单 {reportMissingText(dnsbl.Blacklisted) ? "N/A" : String(dnsbl.Blacklisted)}</span>
          </div>
        </FieldTarget>
      ) : null}
      {dnsbl
        ? renderExtraRows({
            record: dnsbl,
            basePath: "Mail.DNSBlacklist",
            hiddenPaths: props.hiddenPaths,
            skipKeys: ["Total", "Clean", "Marked", "Blacklisted"],
            onFieldClick: props.onFieldClick
          })
        : null}
      {renderExtraRows({
        record: mail,
        basePath: "Mail",
        hiddenPaths: props.hiddenPaths,
        skipKeys: ["Port25", "DNSBlacklist", ...providers.filter((provider) => provider in mail)],
        onFieldClick: props.onFieldClick
      })}
    </ReportSection>
  );
}

function RemainderSection(props: { remainder: Record<string, unknown>; hiddenPaths: string[]; onFieldClick?: (path: string) => void }) {
  if (isEmptyRecord(props.remainder)) return null;
  return (
    <>
      {Object.entries(props.remainder).map(([key, value]) => (
        <ReportSection key={key} title={reportFieldLabel(key)} path={key} hidden={isPathHidden(props.hiddenPaths, key)} onFieldClick={props.onFieldClick}>
          <ReportObjectRow label={reportFieldLabel(key)} path={key} value={value} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        </ReportSection>
      ))}
    </>
  );
}

export function CurrentReportView(props: {
  result: Record<string, unknown>;
  hiddenPaths: string[];
  previewMode?: boolean;
  showHiddenOutlines?: boolean;
  compact?: boolean;
  onFieldClick?: (path: string) => void;
}) {
  const structured = getFilteredCurrentResult(props.result, props.previewMode && props.showHiddenOutlines ? [] : props.hiddenPaths);
  if (!structured) {
    return (
      <div className="empty-state">
        <strong>N/A</strong>
        <p className="muted">当前没有可展示的检测结果。</p>
      </div>
    );
  }

  return (
    <div className={joinClassNames("result-layout", "report-layout", props.compact && "report-layout-compact")}>
      <div className="report-shell">
        <ReportHeader structured={structured} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        <BaseInfoSection structured={structured} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        <TypeSection structured={structured} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        <ScoreSection structured={structured} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        <FactorSection structured={structured} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        <MediaSection structured={structured} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        <MailSection structured={structured} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
        <RemainderSection remainder={structured.remainder} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
      </div>
    </div>
  );
}

function previewNodeLabel(path: string) {
  const key = path.split(".").pop() || path;
  return reportFieldLabel(key);
}

function formatPreviewValue(value: unknown) {
  const text = formatDisplayValue(value);
  if (text.length <= 160) {
    return text;
  }
  return `${text.slice(0, 157)}...`;
}

function FieldPreviewNode(props: {
  value: unknown;
  path: string;
  hiddenPaths: string[];
  onFieldClick?: (path: string) => void;
  depth?: number;
}) {
  const depth = props.depth ?? 0;
  const hidden = isPathHidden(props.hiddenPaths, props.path);

  if (Array.isArray(props.value)) {
    return (
      <FieldTarget
        path={props.path}
        hidden={hidden}
        onFieldClick={props.onFieldClick}
        className={joinClassNames("field-preview-node", "field-preview-leaf", depth > 0 && "field-preview-child")}
      >
        <div className="field-preview-row">
          <div className="field-preview-meta">
            <strong>{previewNodeLabel(props.path)}</strong>
            <span className="field-preview-path">{props.path}</span>
          </div>
          <div className="field-preview-value">{formatPreviewValue(props.value)}</div>
        </div>
      </FieldTarget>
    );
  }

  if (isRecord(props.value)) {
    const entries = Object.entries(props.value);
    return (
      <div className={joinClassNames("field-preview-node", depth === 0 ? "field-preview-group" : "field-preview-child")}>
        <FieldTarget path={props.path} hidden={hidden} onFieldClick={props.onFieldClick} className="field-preview-group-head">
          <div className="field-preview-meta">
            <strong>{previewNodeLabel(props.path)}</strong>
            <span className="field-preview-path">{props.path}</span>
          </div>
          <span className="field-preview-count">{entries.length} 项</span>
        </FieldTarget>
        <div className="field-preview-children">
          {entries.length > 0 ? (
            entries.map(([key, child]) => (
              <FieldPreviewNode
                key={`${props.path}.${key}`}
                value={child}
                path={`${props.path}.${key}`}
                hiddenPaths={props.hiddenPaths}
                onFieldClick={props.onFieldClick}
                depth={depth + 1}
              />
            ))
          ) : (
            <div className="field-preview-empty">空对象</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <FieldTarget
      path={props.path}
      hidden={hidden}
      onFieldClick={props.onFieldClick}
      className={joinClassNames("field-preview-node", "field-preview-leaf", depth > 0 && "field-preview-child")}
    >
      <div className="field-preview-row">
        <div className="field-preview-meta">
          <strong>{previewNodeLabel(props.path)}</strong>
          <span className="field-preview-path">{props.path}</span>
        </div>
        <div className="field-preview-value">{formatPreviewValue(props.value)}</div>
      </div>
    </FieldTarget>
  );
}

export function FullFieldPreview(props: {
  result: Record<string, unknown>;
  hiddenPaths: string[];
  onFieldClick?: (path: string) => void;
}) {
  const entries = Object.entries(props.result ?? {});

  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <strong>N/A</strong>
        <p className="muted">当前没有可用于预览的字段。</p>
      </div>
    );
  }

  return (
    <div className="field-preview-tree">
      {entries.map(([key, value]) => (
        <FieldPreviewNode key={key} value={value} path={key} hiddenPaths={props.hiddenPaths} onFieldClick={props.onFieldClick} />
      ))}
    </div>
  );
}
