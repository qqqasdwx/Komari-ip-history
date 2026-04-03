import { titleize } from "./format";

export type DisplayTone = "good" | "bad" | "warn" | "muted" | "neutral";

export function reportFieldLabel(key: string) {
  const labels: Record<string, string> = {
    IP: "IP",
    GitHub: "GitHub",
    Time: "报告时间",
    Version: "脚本版本",
    Type: "类型",
    ASN: "自治系统号",
    Organization: "组织",
    Latitude: "纬度",
    Longitude: "经度",
    DMS: "坐标",
    Map: "地图",
    TimeZone: "时区",
    Continent: "洲别",
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
    DNSBlacklist: "IP地址黑名单数据库",
    Total: "有效",
    Clean: "正常",
    Marked: "已标记",
    Blacklisted: "黑名单",
    Status: "状态",
    Region: "地区",
    Mailbox: "通信"
  };

  return labels[key] ?? titleize(key);
}

export function reportMissingText(value: unknown) {
  return value === undefined || value === null || value === "" || value === "null";
}

export function reportBoolText(value: unknown) {
  if (reportMissingText(value)) {
    return "N/A";
  }
  return value ? "是" : "否";
}

export function reportUsageMeta(value: unknown) {
  if (reportMissingText(value)) {
    return { text: "N/A", tone: "muted" as const };
  }

  const text = String(value).trim().toLowerCase();
  if (["isp", "residential", "line isp", "broadband", "home", "consumer"].includes(text)) {
    return { text: "家宽", tone: "good" as const };
  }
  if (["business", "commercial", "enterprise"].includes(text)) {
    return { text: "商业", tone: "warn" as const };
  }
  if (["hosting", "datacenter", "data center", "server", "cloud", "vps"].includes(text)) {
    return { text: "机房", tone: "bad" as const };
  }
  if (["mobile", "cellular", "wireless"].includes(text)) {
    return { text: "移动", tone: "good" as const };
  }
  if (["education", "edu", "university"].includes(text)) {
    return { text: "教育", tone: "neutral" as const };
  }

  return { text: String(value), tone: "neutral" as const };
}

export function reportIPTypeText(value: unknown) {
  if (reportMissingText(value)) return "N/A";
  if (String(value).trim().toLowerCase() === "geo-consistent") return "原生IP";
  return String(value);
}

export function reportMediaStatusText(value: unknown) {
  if (reportMissingText(value)) return "N/A";
  const text = String(value).trim().toLowerCase();
  if (text === "yes") return "解锁";
  if (["block", "blocked", "no"].includes(text)) return "失败";
  return String(value);
}

export function reportMediaTypeText(value: unknown) {
  if (reportMissingText(value)) return "N/A";
  const text = String(value).trim().toLowerCase();
  if (text === "native") return "原生";
  if (text === "originals") return "原创";
  if (text === "web") return "网页";
  return String(value);
}

export function reportCountryText(value: unknown) {
  if (reportMissingText(value)) return "N/A";
  const text = String(value).trim();
  if (/^[A-Z]{2}$/.test(text)) return `[${text}]`;
  return text;
}

export function reportRiskMeta(value: unknown) {
  if (reportMissingText(value)) {
    return { text: "N/A", tone: "muted" as const };
  }

  const text = String(value).trim();
  const numeric = Number.parseFloat(text.replace("%", ""));
  if (Number.isNaN(numeric)) {
    return { text, tone: "neutral" as const };
  }
  if (numeric <= 25) return { text, tone: "good" as const };
  if (numeric <= 60) return { text, tone: "warn" as const };
  return { text, tone: "bad" as const };
}

export function reportToneFromText(text: string): DisplayTone {
  if (["解锁", "原生", "原创", "家宽", "移动", "可用", "否"].includes(text) || text.startsWith("[")) return "good";
  if (text === "商业" || text === "网页") return "warn";
  if (["失败", "机房", "是", "不可用"].includes(text)) return "bad";
  if (text === "N/A") return "muted";
  return "neutral";
}
