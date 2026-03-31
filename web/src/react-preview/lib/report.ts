import { escapeHtml, isRecord, titleize } from "./format";
import { getFilteredCurrentResult, isEmptyRecord, type StructuredCurrentResult } from "./result";

function reportFieldLabel(key: string) {
  const labels: Record<string, string> = {
    IP: "IP",
    Time: "报告时间",
    Version: "脚本版本",
    Type: "类型",
    ASN: "自治系统",
    Organization: "组织",
    Latitude: "纬度",
    Longitude: "经度",
    DMS: "坐标",
    Map: "地图",
    TimeZone: "时区",
    RegisteredRegion: "注册地区",
    Usage: "使用类型",
    Company: "公司类型",
    CountryCode: "地区",
    Proxy: "代理",
    Tor: "Tor",
    VPN: "VPN",
    Server: "服务器",
    Abuser: "滥用者",
    Robot: "机器人",
    IPinfo: "IPinfo",
    ipregistry: "ipregistry",
    ipapi: "ipapi",
    IP2LOCATION: "IP2Location",
    IPWHOIS: "IPWHOIS",
    SCAMALYTICS: "Scamalytics",
    AbuseIPDB: "AbuseIPDB",
    DBIP: "DB-IP",
    DisneyPlus: "Disney+",
    AmazonPrimeVideo: "AmazonPV",
    TikTok: "TikTok",
    Youtube: "Youtube",
    Netflix: "Netflix",
    Spotify: "Spotify",
    ChatGPT: "ChatGPT",
    Port25: "25端口",
    MailRU: "MailRU",
    MailCOM: "MailCOM",
    DNSBlacklist: "DNSBL"
  };

  return labels[key] ?? titleize(key);
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

function reportMissingText(value: unknown) {
  return value === undefined || value === null || value === "" || value === "null";
}

function reportBoolText(value: unknown) {
  if (reportMissingText(value)) {
    return "无";
  }

  return value ? "是" : "否";
}

function reportUsageMeta(value: unknown) {
  if (reportMissingText(value)) {
    return { text: "无", tone: "muted" };
  }

  const text = String(value).trim().toLowerCase();
  if (["isp", "residential", "line isp", "broadband", "home", "consumer"].includes(text)) {
    return { text: "家宽", tone: "good" };
  }
  if (["business", "commercial", "enterprise"].includes(text)) {
    return { text: "商业", tone: "warn" };
  }
  if (["hosting", "datacenter", "data center", "server", "cloud", "vps"].includes(text)) {
    return { text: "机房", tone: "bad" };
  }
  if (["mobile", "cellular", "wireless"].includes(text)) {
    return { text: "移动", tone: "good" };
  }
  if (["education", "edu", "university"].includes(text)) {
    return { text: "教育", tone: "neutral" };
  }

  return { text: String(value), tone: "neutral" };
}

function reportIPTypeText(value: unknown) {
  if (reportMissingText(value)) {
    return "无";
  }
  if (String(value).trim().toLowerCase() === "geo-consistent") {
    return "原生IP";
  }

  return String(value);
}

function reportMediaStatusText(value: unknown) {
  if (reportMissingText(value)) {
    return "无";
  }

  const text = String(value).trim().toLowerCase();
  if (text === "yes") {
    return "解锁";
  }
  if (["block", "blocked", "no"].includes(text)) {
    return "失败";
  }

  return String(value);
}

function reportMediaTypeText(value: unknown) {
  if (reportMissingText(value)) {
    return "无";
  }

  const text = String(value).trim().toLowerCase();
  if (text === "native") {
    return "原生";
  }
  if (text === "originals") {
    return "原创";
  }
  if (text === "web") {
    return "网页";
  }

  return String(value);
}

function reportCountryText(value: unknown) {
  if (reportMissingText(value)) {
    return "无";
  }

  const text = String(value).trim();
  if (/^[A-Z]{2}$/.test(text)) {
    return `[${text}]`;
  }

  return text;
}

function reportRiskMeta(value: unknown) {
  if (reportMissingText(value)) {
    return { score: "无", label: "无", tone: "muted", percent: null as number | null };
  }

  const text = String(value).trim();
  const numeric = Number.parseFloat(text.replace("%", ""));
  if (Number.isNaN(numeric)) {
    return { score: text, label: "未知", tone: "neutral", percent: null as number | null };
  }

  const percent = Math.max(0, Math.min(100, numeric));
  if (numeric <= 5) {
    return { score: text, label: "极低", tone: "good", percent };
  }
  if (numeric <= 25) {
    return { score: text, label: "低", tone: "good", percent };
  }
  if (numeric <= 60) {
    return { score: text, label: "中等", tone: "warn", percent };
  }
  if (numeric <= 85) {
    return { score: text, label: "高", tone: "bad", percent };
  }

  return { score: text, label: "极高", tone: "bad", percent };
}

function reportToneFromText(text: string) {
  if (["解锁", "原生", "原创", "家宽", "移动", "可用", "否"].includes(text) || text.startsWith("[")) {
    return "good";
  }
  if (text === "商业" || text === "网页") {
    return "warn";
  }
  if (["失败", "机房", "是", "不可用"].includes(text)) {
    return "bad";
  }
  if (text === "无") {
    return "muted";
  }

  return "neutral";
}

function renderReportBadgeText(text: string, tone?: string) {
  const resolvedTone = tone ?? reportToneFromText(text);
  return `<span class="report-badge report-badge-${resolvedTone}">${escapeHtml(text)}</span>`;
}

function renderScoreMeter(percent: number | null, tone: string) {
  if (percent === null) {
    return `
      <div class="report-score-bar">
        <div class="report-score-bar-track"></div>
      </div>
    `;
  }

  const clamped = Math.max(0, Math.min(100, percent));
  const markerLeft = clamped === 0 ? "0%" : clamped === 100 ? "100%" : `${clamped}%`;
  return `
    <div class="report-score-bar">
      <div class="report-score-bar-track"></div>
      <div class="report-score-bar-fill report-score-bar-fill-${tone}" style="width:${clamped}%"></div>
      <div class="report-score-bar-marker" style="left:${markerLeft}"></div>
    </div>
  `;
}

function renderReportKVRow(label: string, value: string, tone?: string) {
  return `
    <div class="report-kv-row">
      <span class="report-kv-label">${escapeHtml(label)}</span>
      <div class="report-kv-value">${renderReportBadgeText(value, tone)}</div>
    </div>
  `;
}

function renderReportMatrix(columns: string[], rows: Array<{ label: string; values: Array<{ text: string; tone?: string }> }>) {
  if (columns.length === 0 || rows.length === 0) {
    return "";
  }

  const grid = `grid-template-columns:minmax(112px, 132px) repeat(${columns.length}, minmax(72px, 1fr));`;
  return `
    <div class="report-matrix">
      <div class="report-matrix-row report-matrix-head" style="${grid}">
        <div class="report-row-label">项目</div>
        ${columns.map((column) => `<div class="report-head-cell">${escapeHtml(column)}</div>`).join("")}
      </div>
      ${rows
        .map(
          (row) => `
            <div class="report-matrix-row" style="${grid}">
              <div class="report-row-label">${escapeHtml(row.label)}</div>
              ${row.values.map((value) => `<div class="report-table-cell">${renderReportBadgeText(value.text, value.tone)}</div>`).join("")}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderReportSection(title: string, rows: string) {
  if (!rows) {
    return "";
  }

  return `
    <div class="result-group report-group">
      <div class="report-group-title">${escapeHtml(title)}</div>
      <div class="report-group-body">${rows}</div>
    </div>
  `;
}

function renderReportLine(label: string, value: unknown) {
  const text = reportMissingText(value) ? "无" : String(value);
  return `
    <div class="report-line">
      <span class="report-label">${escapeHtml(label)}</span>
      <div class="report-values">${renderReportBadgeText(text)}</div>
    </div>
  `;
}

function renderReportObjectRow(label: string, value: unknown) {
  if (!isRecord(value)) {
    return renderReportLine(label, value);
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return renderReportLine(label, "无");
  }

  return `
    <div class="report-line">
      <span class="report-label">${escapeHtml(label)}</span>
      <div class="report-values">
        ${entries
          .map(
            ([key, child]) =>
              `<span class="report-cell"><strong>${escapeHtml(reportFieldLabel(key))}</strong>${renderReportBadgeText(
                reportMissingText(child) ? "无" : String(child)
              )}</span>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderReportRows(record: Record<string, unknown>, order: string[] = []) {
  return orderedReportEntries(record, order)
    .map(([key, value]) => renderReportObjectRow(reportFieldLabel(key), value))
    .join("");
}

function renderReportHeader(structured: StructuredCurrentResult) {
  const ip = reportMissingText(structured.head?.IP) ? "N/A" : String(structured.head?.IP);
  const time = reportMissingText(structured.head?.Time) ? "" : String(structured.head?.Time);
  const version = reportMissingText(structured.head?.Version) ? "" : String(structured.head?.Version);

  return `
    <div class="report-banner">
      <div class="report-banner-line">########################################################################</div>
      <div class="report-banner-title">IP质量体检报告：<span>${escapeHtml(ip)}</span></div>
      <div class="report-banner-meta">
        ${time ? `<span>报告时间：${escapeHtml(time)}</span>` : ""}
        ${version ? `<span>脚本版本：${escapeHtml(version)}</span>` : ""}
      </div>
      <div class="report-banner-line">########################################################################</div>
    </div>
  `;
}

function renderBaseInfoSection(structured: StructuredCurrentResult) {
  const info = structured.info;
  if (!info) {
    return "";
  }

  const city = isRecord(info.City)
    ? [
        info.Region && isRecord(info.Region) ? info.Region.Name : "",
        info.City.Name,
        info.City.PostalCode && info.City.PostalCode !== "null" ? info.City.PostalCode : ""
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const usagePlace = [
    info.Region && isRecord(info.Region) ? `${reportCountryText(info.Region.Code)}${info.Region.Name ? String(info.Region.Name) : ""}` : "",
    info.Continent && isRecord(info.Continent) ? `${reportCountryText(info.Continent.Code)}${info.Continent.Name ? String(info.Continent.Name) : ""}` : ""
  ]
    .filter(Boolean)
    .join(", ");

  const registered =
    info.RegisteredRegion && isRecord(info.RegisteredRegion)
      ? `${reportCountryText(info.RegisteredRegion.Code)}${info.RegisteredRegion.Name ? String(info.RegisteredRegion.Name) : ""}`
      : "无";

  const rows = [
    renderReportKVRow("自治系统号", info.ASN ? `AS${String(info.ASN)}` : "无", "good"),
    renderReportKVRow("组织", reportMissingText(info.Organization) ? "无" : String(info.Organization), "good"),
    renderReportKVRow("坐标", reportMissingText(info.DMS) ? "无" : String(info.DMS), "good"),
    renderReportKVRow("地图", reportMissingText(info.Map) ? "无" : String(info.Map), "neutral"),
    renderReportKVRow("城市", city || "无", "good"),
    renderReportKVRow("使用地", usagePlace || "无", "good"),
    renderReportKVRow("注册地", registered, "good"),
    renderReportKVRow("时区", reportMissingText(info.TimeZone) ? "无" : String(info.TimeZone), "good"),
    renderReportKVRow("IP类型", reportIPTypeText(info.Type), "good")
  ].join("");

  return renderReportSection("一、基础信息", rows);
}

function renderTypeSection(structured: StructuredCurrentResult) {
  const type = structured.type;
  if (!type) {
    return "";
  }

  const providerOrder = ["IPinfo", "ipregistry", "ipapi", "IP2LOCATION", "AbuseIPDB"];
  const usageProviders = isRecord(type.Usage) ? orderedReportEntries(type.Usage, providerOrder).map(([key]) => reportFieldLabel(key)) : [];
  const usageMap = new Map(
    (isRecord(type.Usage) ? orderedReportEntries(type.Usage, providerOrder) : []).map(([key, value]) => [reportFieldLabel(key), reportUsageMeta(value)])
  );
  const companyMap = new Map(
    (isRecord(type.Company) ? orderedReportEntries(type.Company, providerOrder) : []).map(([key, value]) => [reportFieldLabel(key), reportUsageMeta(value)])
  );
  const columns = Array.from(new Set([...usageProviders, ...companyMap.keys()]));

  const rows = [
    {
      label: "使用类型",
      values: columns.map((column) => usageMap.get(column) ?? { text: "无", tone: "muted" })
    },
    {
      label: "公司类型",
      values: columns.map((column) => companyMap.get(column) ?? { text: "无", tone: "muted" })
    }
  ];

  return renderReportSection("二、IP类型属性", renderReportMatrix(columns, rows));
}

function renderScoreSection(structured: StructuredCurrentResult) {
  const score = structured.score;
  if (!score) {
    return "";
  }

  const order = ["IP2LOCATION", "SCAMALYTICS", "ipapi", "AbuseIPDB", "IPQS", "Cloudflare", "DBIP"];
  const rows = orderedReportEntries(score, order)
    .map(([key, value]) => {
      const risk = reportRiskMeta(value);
      return `
        <div class="report-score-row">
          <span class="report-score-name">${escapeHtml(reportFieldLabel(key))}</span>
          <span class="report-score-value">${escapeHtml(risk.score)}</span>
          <span class="report-score-risk">${renderReportBadgeText(risk.label, risk.tone)}</span>
          <div class="report-score-main">${renderScoreMeter(risk.percent, risk.tone)}</div>
        </div>
      `;
    })
    .join("");

  const legend = `
    <div class="report-score-scale">
      <span class="report-score-name">风险等级</span>
      <span class="report-score-value"></span>
      <span class="report-score-risk"></span>
      <div class="report-score-main">
        <div class="report-score-scale-stack">
          <div class="report-score-scale-labels">
            <span>极低</span>
            <span>低</span>
            <span>中等</span>
            <span>高</span>
            <span>极高</span>
          </div>
          <div class="report-score-scale-track">
            <span class="report-score-scale-segment good"></span>
            <span class="report-score-scale-segment warn"></span>
            <span class="report-score-scale-segment bad"></span>
          </div>
        </div>
      </div>
    </div>
  `;

  return renderReportSection("三、风险评分", `${legend}<div class="report-score-list">${rows}</div>`);
}

function renderFactorSection(structured: StructuredCurrentResult) {
  const factor = structured.factor;
  if (!factor) {
    return "";
  }

  const providerOrder = ["IP2LOCATION", "ipapi", "ipregistry", "IPQS", "SCAMALYTICS", "ipdata", "IPinfo", "IPWHOIS", "DBIP"];
  const rowOrder = ["CountryCode", "Proxy", "Tor", "VPN", "Server", "Abuser", "Robot"];
  const providers = Array.from(
    new Set(
      rowOrder.flatMap((row) =>
        isRecord(factor[row]) ? orderedReportEntries(factor[row] as Record<string, unknown>, providerOrder).map(([key]) => reportFieldLabel(key)) : []
      )
    )
  );

  const rows = rowOrder
    .filter((row) => isRecord(factor[row]))
    .map((row) => {
      const valueMap = new Map(
        orderedReportEntries(factor[row] as Record<string, unknown>, providerOrder).map(([key, value]) => {
          const text = row === "CountryCode" ? reportCountryText(value) : reportBoolText(value);
          return [reportFieldLabel(key), { text }];
        })
      );

      return {
        label: reportFieldLabel(row),
        values: providers.map((provider) => valueMap.get(provider) ?? { text: "无" })
      };
    });

  return renderReportSection("四、风险因子", renderReportMatrix(providers, rows));
}

function renderMediaSection(structured: StructuredCurrentResult) {
  const media = structured.media;
  if (!media) {
    return "";
  }

  const serviceOrder = ["TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Spotify", "Reddit", "ChatGPT"];
  const services = orderedReportEntries(media, serviceOrder).map(([key]) => reportFieldLabel(key));
  const mediaMap = new Map(orderedReportEntries(media, serviceOrder).map(([key, value]) => [reportFieldLabel(key), isRecord(value) ? value : {}]));

  const rows = [
    {
      label: "状态",
      values: services.map((service) => {
        const text = reportMediaStatusText((mediaMap.get(service) as Record<string, unknown>).Status);
        return { text, tone: reportToneFromText(text) };
      })
    },
    {
      label: "地区",
      values: services.map((service) => {
        const text = reportCountryText((mediaMap.get(service) as Record<string, unknown>).Region);
        return { text, tone: reportToneFromText(text) };
      })
    },
    {
      label: "方式",
      values: services.map((service) => {
        const text = reportMediaTypeText((mediaMap.get(service) as Record<string, unknown>).Type);
        return { text, tone: reportToneFromText(text) };
      })
    }
  ];

  return renderReportSection("五、流媒体及AI服务解锁检测", renderReportMatrix(services, rows));
}

function renderMailSection(structured: StructuredCurrentResult) {
  const mail = structured.mail;
  if (!mail) {
    return "";
  }

  const providers = ["Gmail", "Outlook", "Yahoo", "Apple", "QQ", "MailRU", "AOL", "GMX", "MailCOM", "163", "Sohu", "Sina"];
  const comms = providers
    .filter((provider) => provider in mail)
    .map((provider) => {
      const ok = Boolean(mail[provider]);
      return `<span class="report-mail-chip ${ok ? "good" : "bad"}">${escapeHtml(reportFieldLabel(provider))}</span>`;
    })
    .join("");

  const dnsbl = isRecord(mail.DNSBlacklist) ? mail.DNSBlacklist : null;
  const dnsblRow = dnsbl
    ? `
      <div class="report-mail-summary">
        <span class="report-kv-label">IP地址黑名单数据库</span>
        <div class="report-mail-metrics">
          ${renderReportBadgeText(`有效 ${reportMissingText(dnsbl.Total) ? "无" : String(dnsbl.Total)}`, "neutral")}
          ${renderReportBadgeText(`正常 ${reportMissingText(dnsbl.Clean) ? "无" : String(dnsbl.Clean)}`, "good")}
          ${renderReportBadgeText(`已标记 ${reportMissingText(dnsbl.Marked) ? "无" : String(dnsbl.Marked)}`, "warn")}
          ${renderReportBadgeText(`黑名单 ${reportMissingText(dnsbl.Blacklisted) ? "无" : String(dnsbl.Blacklisted)}`, Number(dnsbl.Blacklisted) > 0 ? "bad" : "good")}
        </div>
      </div>
    `
    : "";

  const port25 = renderReportKVRow("本地25端口出站", reportMissingText(mail.Port25) ? "无" : mail.Port25 ? "可用" : "不可用");
  const commRow = comms
    ? `
      <div class="report-mail-summary">
        <span class="report-kv-label">通信</span>
        <div class="report-mail-metrics">${comms}</div>
      </div>
    `
    : "";

  return renderReportSection("六、邮局连通性及黑名单检测", `${port25}${commRow}${dnsblRow}`);
}

export function renderCurrentReportMarkup(result: Record<string, unknown>, hiddenPaths: string[]) {
  const structured = getFilteredCurrentResult(result, hiddenPaths);
  if (!structured) {
    return `
      <div class="empty-state">
        <strong>N/A</strong>
        <p class="muted">当前没有可展示的检测结果。</p>
      </div>
    `;
  }

  const sections = [
    renderReportHeader(structured),
    renderBaseInfoSection(structured),
    renderTypeSection(structured),
    renderScoreSection(structured),
    renderFactorSection(structured),
    renderMediaSection(structured),
    renderMailSection(structured),
    !isEmptyRecord(structured.remainder) ? renderReportSection("其他结果", renderReportRows(structured.remainder)) : ""
  ].filter(Boolean);

  if (sections.length === 0) {
    return `
      <div class="empty-state">
        <strong>N/A</strong>
        <p class="muted">当前还没有可展示的 IP 质量结果。</p>
      </div>
    `;
  }

  return `<div class="result-layout report-layout"><div class="report-shell">${sections.join("")}</div></div>`;
}
