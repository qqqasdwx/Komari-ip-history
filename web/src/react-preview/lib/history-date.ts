function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 0);
  return next;
}

function padDateTimePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTimeInputValue(value: Date) {
  const year = value.getFullYear();
  const month = padDateTimePart(value.getMonth() + 1);
  const day = padDateTimePart(value.getDate());
  const hours = padDateTimePart(value.getHours());
  const minutes = padDateTimePart(value.getMinutes());
  const seconds = padDateTimePart(value.getSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

export function historyQueryValueToInputValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return formatDateTimeInputValue(parsed);
}

export function historyInputValueToQueryValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString();
}

function formatDateTimeDisplayValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace("T", " ");
}

export function describeHistoryDateRange(startDate: string, endDate: string) {
  if (!startDate && !endDate) {
    return "全部时间";
  }
  if (startDate && endDate) {
    return `${formatDateTimeDisplayValue(startDate)} ~ ${formatDateTimeDisplayValue(endDate)}`;
  }
  if (startDate) {
    return `${formatDateTimeDisplayValue(startDate)} 起`;
  }
  return `${formatDateTimeDisplayValue(endDate)} 止`;
}

export const historyDateRangePresets = [
  {
    label: "今天",
    resolve() {
      const now = new Date();
      return {
        startDate: formatDateTimeInputValue(startOfDay(now)),
        endDate: formatDateTimeInputValue(endOfDay(now))
      };
    }
  },
  {
    label: "近 7 天",
    resolve() {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 6);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(end))
      };
    }
  },
  {
    label: "本周",
    resolve() {
      const start = new Date();
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(end))
      };
    }
  },
  {
    label: "近 30 天",
    resolve() {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(end))
      };
    }
  },
  {
    label: "本月",
    resolve() {
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      const monthEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0);
      return {
        startDate: formatDateTimeInputValue(startOfDay(start)),
        endDate: formatDateTimeInputValue(endOfDay(monthEnd))
      };
    }
  }
];
