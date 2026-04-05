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
    Reddit: "Reddit",
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
  if (["isp", "residential", "line isp", "broadband", "home", "consumer", "家宽"].includes(text)) {
    return { text: "家宽", tone: "good" as const };
  }
  if (["business", "commercial", "enterprise", "商业"].includes(text)) {
    return { text: "商业", tone: "warn" as const };
  }
  if (["hosting", "datacenter", "data center", "server", "cloud", "vps", "机房"].includes(text)) {
    return { text: "机房", tone: "bad" as const };
  }
  if (["mobile", "cellular", "wireless", "mobile isp", "手机"].includes(text)) {
    return { text: "手机", tone: "good" as const };
  }
  if (["education", "edu", "university", "教育"].includes(text)) {
    return { text: "教育", tone: "warn" as const };
  }
  if (["government", "gov", "政府"].includes(text)) return { text: "政府", tone: "warn" as const };
  if (["banking", "bank", "银行"].includes(text)) return { text: "银行", tone: "warn" as const };
  if (["organization", "org", "组织"].includes(text)) return { text: "组织", tone: "warn" as const };
  if (["military", "mil", "军队"].includes(text)) return { text: "军队", tone: "warn" as const };
  if (["library", "lib", "图书馆"].includes(text)) return { text: "图书馆", tone: "warn" as const };
  if (["reserved", "rsv", "保留"].includes(text)) return { text: "保留", tone: "warn" as const };
  if (["other", "其他"].includes(text)) return { text: "其他", tone: "warn" as const };
  if (["cdn"].includes(text)) return { text: "CDN", tone: "bad" as const };
  if (["spider", "web spider", "search engine spider", "蜘蛛"].includes(text)) return { text: "蜘蛛", tone: "bad" as const };

  return { text: String(value), tone: "neutral" as const };
}

export function reportIPTypeText(value: unknown) {
  return reportIPTypeMeta(value).text;
}

export function reportIPTypeMeta(value: unknown) {
  if (reportMissingText(value)) return { text: "N/A", tone: "muted" as const };
  const text = String(value).trim().toLowerCase();
  if (text === "geo-consistent" || text === "原生ip") return { text: "原生IP", tone: "good" as const };
  if (text === "geo-discrepant" || text === "广播ip") return { text: "广播IP", tone: "bad" as const };
  return { text: String(value), tone: "neutral" as const };
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
  if (["解锁", "原生", "原创", "家宽", "手机", "原生IP", "可用", "否"].includes(text) || text.startsWith("[")) return "good";
  if (["商业", "教育", "政府", "银行", "组织", "军队", "图书馆", "保留", "其他", "网页"].includes(text)) return "warn";
  if (["失败", "机房", "CDN", "蜘蛛", "广播IP", "是", "不可用"].includes(text)) return "bad";
  if (text === "N/A") return "muted";
  return "neutral";
}
