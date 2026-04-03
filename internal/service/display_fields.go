package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"komari-ip-history/internal/sampledata"
)

type DisplayFieldValue struct {
	ID          string   `json:"id"`
	Path        string   `json:"path"`
	GroupPath   []string `json:"group_path"`
	Label       string   `json:"label"`
	Text        string   `json:"text"`
	Tone        string   `json:"tone"`
	MissingKind string   `json:"missing_kind,omitempty"`
}

type structuredCurrentResult struct {
	Head      map[string]any
	Info      map[string]any
	Type      map[string]any
	Factor    map[string]any
	Meta      map[string]any
	Score     map[string]any
	Media     map[string]any
	Mail      map[string]any
	Remainder map[string]any
}

var whitespacePattern = regexp.MustCompile(`\s+`)

func compactText(value string) string {
	return whitespacePattern.ReplaceAllString(value, "")
}

func normalizeFieldID(path string) string {
	return strings.ToLower(path)
}

func reportFieldLabel(key string) string {
	labels := map[string]string{
		"IP":                "IP",
		"GitHub":            "GitHub",
		"Time":              "报告时间",
		"Version":           "脚本版本",
		"Type":              "类型",
		"ASN":               "自治系统号",
		"Organization":      "组织",
		"Latitude":          "纬度",
		"Longitude":         "经度",
		"DMS":               "坐标",
		"Map":               "地图",
		"TimeZone":          "时区",
		"Continent":         "洲别",
		"RegisteredRegion":  "注册地区",
		"Usage":             "使用类型",
		"Company":           "公司类型",
		"CountryCode":       "地区",
		"Proxy":             "代理",
		"Tor":               "Tor",
		"VPN":               "VPN",
		"Server":            "服务器",
		"Abuser":            "滥用者",
		"Robot":             "机器人",
		"IPinfo":            "IPinfo",
		"ipregistry":        "ipregistry",
		"ipapi":             "ipapi",
		"IP2LOCATION":       "IP2Location",
		"IPWHOIS":           "IPWHOIS",
		"SCAMALYTICS":       "Scamalytics",
		"AbuseIPDB":         "AbuseIPDB",
		"DBIP":              "DB-IP",
		"DisneyPlus":        "Disney+",
		"AmazonPrimeVideo":  "AmazonPV",
		"TikTok":            "TikTok",
		"Youtube":           "Youtube",
		"Netflix":           "Netflix",
		"Spotify":           "Spotify",
		"ChatGPT":           "ChatGPT",
		"Port25":            "25端口",
		"MailRU":            "MailRU",
		"MailCOM":           "MailCOM",
		"DNSBlacklist":      "IP地址黑名单数据库",
		"Total":             "有效",
		"Clean":             "正常",
		"Marked":            "已标记",
		"Blacklisted":       "黑名单",
		"Status":            "状态",
		"Region":            "地区",
		"Mailbox":           "通信",
	}
	if label, ok := labels[key]; ok {
		return label
	}
	return titleize(key)
}

func titleize(key string) string {
	if key == "" {
		return ""
	}
	var builder strings.Builder
	runes := []rune(key)
	for i, r := range runes {
		if i > 0 && ((r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9' && !(runes[i-1] >= '0' && runes[i-1] <= '9'))) {
			builder.WriteRune(' ')
		}
		builder.WriteRune(r)
	}
	result := strings.ReplaceAll(builder.String(), "_", " ")
	return strings.TrimSpace(result)
}

func reportMissingText(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		trimmed := strings.TrimSpace(typed)
		return trimmed == "" || trimmed == "null"
	default:
		return false
	}
}

func reportBoolText(value any) string {
	if reportMissingText(value) {
		return "N/A"
	}
	switch typed := value.(type) {
	case bool:
		if typed {
			return "是"
		}
		return "否"
	case string:
		lower := strings.ToLower(strings.TrimSpace(typed))
		if lower == "true" || lower == "yes" {
			return "是"
		}
		if lower == "false" || lower == "no" {
			return "否"
		}
	}
	if truthy, ok := value.(float64); ok {
		if truthy != 0 {
			return "是"
		}
		return "否"
	}
	return fmt.Sprint(value)
}

func reportUsageMeta(value any) (string, string) {
	if reportMissingText(value) {
		return "N/A", "muted"
	}
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	switch {
	case containsString([]string{"isp", "residential", "line isp", "broadband", "home", "consumer"}, text):
		return "家宽", "good"
	case containsString([]string{"business", "commercial", "enterprise"}, text):
		return "商业", "warn"
	case containsString([]string{"hosting", "datacenter", "data center", "server", "cloud", "vps"}, text):
		return "机房", "bad"
	case containsString([]string{"mobile", "cellular", "wireless"}, text):
		return "移动", "good"
	case containsString([]string{"education", "edu", "university"}, text):
		return "教育", "neutral"
	default:
		return fmt.Sprint(value), "neutral"
	}
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func reportIPTypeText(value any) string {
	if reportMissingText(value) {
		return "N/A"
	}
	if strings.ToLower(strings.TrimSpace(fmt.Sprint(value))) == "geo-consistent" {
		return "原生IP"
	}
	return fmt.Sprint(value)
}

func reportMediaStatusText(value any) string {
	if reportMissingText(value) {
		return "N/A"
	}
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if text == "yes" {
		return "解锁"
	}
	if text == "block" || text == "blocked" || text == "no" {
		return "失败"
	}
	return fmt.Sprint(value)
}

func reportMediaTypeText(value any) string {
	if reportMissingText(value) {
		return "N/A"
	}
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	switch text {
	case "native":
		return "原生"
	case "originals":
		return "原创"
	case "web":
		return "网页"
	default:
		return fmt.Sprint(value)
	}
}

func reportCountryText(value any) string {
	if reportMissingText(value) {
		return "N/A"
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if len(text) == 2 && strings.ToUpper(text) == text {
		return "[" + text + "]"
	}
	return text
}

func reportRiskMeta(value any) (string, string) {
	if reportMissingText(value) {
		return "N/A", "muted"
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	numeric, err := strconv.ParseFloat(strings.TrimSuffix(text, "%"), 64)
	if err != nil {
		return text, "neutral"
	}
	switch {
	case numeric <= 25:
		return text, "good"
	case numeric <= 60:
		return text, "warn"
	default:
		return text, "bad"
	}
}

func reportToneFromText(text string) string {
	switch {
	case containsString([]string{"解锁", "原生", "原创", "家宽", "移动", "可用", "否"}, text), strings.HasPrefix(text, "["):
		return "good"
	case text == "商业" || text == "网页":
		return "warn"
	case containsString([]string{"失败", "机房", "是", "不可用"}, text):
		return "bad"
	case text == "N/A":
		return "muted"
	default:
		return "neutral"
	}
}

func orderedReportEntries(record map[string]any, order []string) [][2]any {
	seen := map[string]struct{}{}
	entries := make([][2]any, 0, len(record))
	for _, key := range order {
		if value, ok := record[key]; ok {
			seen[key] = struct{}{}
			entries = append(entries, [2]any{key, value})
		}
	}
	extraKeys := make([]string, 0, len(record))
	for key := range record {
		if _, ok := seen[key]; ok {
			continue
		}
		extraKeys = append(extraKeys, key)
	}
	sort.Strings(extraKeys)
	for _, key := range extraKeys {
		entries = append(entries, [2]any{key, record[key]})
	}
	return entries
}

func pushDisplayField(items *[]DisplayFieldValue, path string, groupPath []string, label string, text string, tone string, missing bool) {
	resolvedTone := tone
	if resolvedTone == "" {
		resolvedTone = reportToneFromText(text)
	}
	value := DisplayFieldValue{
		ID:        normalizeFieldID(path),
		Path:      path,
		GroupPath: append([]string{}, groupPath...),
		Label:     label,
		Text:      text,
		Tone:      resolvedTone,
	}
	if missing {
		value.MissingKind = "missing"
	}
	*items = append(*items, value)
}

func extractDisplayFieldValues(result map[string]any) ([]DisplayFieldValue, error) {
	structured, err := getStructuredCurrentResult(result)
	if err != nil || structured == nil {
		return []DisplayFieldValue{}, err
	}

	items := make([]DisplayFieldValue, 0, 128)
	head := structured.Head
	info := structured.Info
	typeGroup := structured.Type
	score := structured.Score
	factor := structured.Factor
	media := structured.Media
	mail := structured.Mail

	pushDisplayField(&items, "Head.IP", []string{"头部"}, "IP", valueOrNA(head["IP"]), "", reportMissingText(head["IP"]))
	pushDisplayField(&items, "Head.Time", []string{"头部"}, "报告时间", valueOrNA(head["Time"]), "", reportMissingText(head["Time"]))
	pushDisplayField(&items, "Head.Version", []string{"头部"}, "脚本版本", valueOrNA(head["Version"]), "", reportMissingText(head["Version"]))

	regionText := func(value any) string {
		record, ok := asMap(value)
		if !ok {
			return ""
		}
		code := ""
		if !reportMissingText(record["Code"]) {
			code = reportCountryText(record["Code"])
		}
		name := ""
		if !reportMissingText(record["Name"]) {
			name = fmt.Sprint(record["Name"])
		}
		return strings.Join(filterEmpty([]string{code, name}), "")
	}

	cityText := ""
	if city, ok := asMap(info["City"]); ok {
		regionName := ""
		if region, ok := asMap(info["Region"]); ok && !reportMissingText(region["Name"]) {
			regionName = fmt.Sprint(region["Name"])
		}
		cityName := ""
		if !reportMissingText(city["Name"]) {
			cityName = fmt.Sprint(city["Name"])
		}
		postal := ""
		if !reportMissingText(city["PostalCode"]) && fmt.Sprint(city["PostalCode"]) != "null" {
			postal = fmt.Sprint(city["PostalCode"])
		}
		cityText = strings.Join(filterEmpty([]string{regionName, cityName, postal}), ", ")
	}
	usagePlaceText := strings.Join(filterEmpty([]string{regionText(info["Region"]), regionText(info["Continent"])}), ", ")
	registeredText := regionText(info["RegisteredRegion"])
	if registeredText == "" {
		registeredText = "N/A"
	}
	coordinateText := strings.Join(filterEmpty([]string{rawString(info["Latitude"]), rawString(info["Longitude"])}), ", ")

	pushDisplayField(&items, "Info.ASN", []string{"基础信息（Maxmind 数据库）"}, "自治系统号", asnOrNA(info["ASN"]), "good", false)
	pushDisplayField(&items, "Info.Organization", []string{"基础信息（Maxmind 数据库）"}, "组织", valueOrNA(info["Organization"]), "good", false)
	pushDisplayField(&items, "Info.Coordinate", []string{"基础信息（Maxmind 数据库）"}, "坐标", fallbackText(coordinateText), "good", false)
	pushDisplayField(&items, "Info.Map", []string{"基础信息（Maxmind 数据库）"}, "地图", valueOrNA(info["Map"]), "", false)
	pushDisplayField(&items, "Info.City", []string{"基础信息（Maxmind 数据库）"}, "城市", fallbackText(cityText), "good", false)
	pushDisplayField(&items, "Info.UsagePlace", []string{"基础信息（Maxmind 数据库）"}, "使用地", fallbackText(usagePlaceText), "good", false)
	pushDisplayField(&items, "Info.RegisteredRegion", []string{"基础信息（Maxmind 数据库）"}, "注册地", registeredText, "good", false)
	pushDisplayField(&items, "Info.TimeZone", []string{"基础信息（Maxmind 数据库）"}, "时区", valueOrNA(info["TimeZone"]), "good", false)
	pushDisplayField(&items, "Info.Type", []string{"基础信息（Maxmind 数据库）"}, "IP类型", reportIPTypeText(info["Type"]), "good", false)

	renderExtraRows(&items, info, "Info", []string{"基础信息（Maxmind 数据库）"}, []string{"ASN", "Organization", "Latitude", "Longitude", "DMS", "Map", "City", "Region", "Continent", "RegisteredRegion", "TimeZone", "Type"})

	providerOrder := []string{"IPinfo", "ipregistry", "ipapi", "IP2LOCATION", "AbuseIPDB"}
	if usage, ok := asMap(typeGroup["Usage"]); ok {
		for _, entry := range orderedReportEntries(usage, providerOrder) {
			key := entry[0].(string)
			text, tone := reportUsageMeta(entry[1])
			pushDisplayField(&items, "Type.Usage."+key, []string{"IP类型属性", reportFieldLabel(key)}, "使用类型", text, tone, false)
		}
	}
	if company, ok := asMap(typeGroup["Company"]); ok {
		for _, entry := range orderedReportEntries(company, providerOrder) {
			key := entry[0].(string)
			text, tone := reportUsageMeta(entry[1])
			pushDisplayField(&items, "Type.Company."+key, []string{"IP类型属性", reportFieldLabel(key)}, "公司类型", text, tone, false)
		}
	}
	renderExtraRows(&items, typeGroup, "Type", []string{"IP类型属性"}, []string{"Usage", "Company"})

	for _, entry := range orderedReportEntries(score, []string{"IP2LOCATION", "SCAMALYTICS", "ipapi", "AbuseIPDB", "IPQS", "Cloudflare", "DBIP"}) {
		key := entry[0].(string)
		text, tone := reportRiskMeta(entry[1])
		pushDisplayField(&items, "Score."+key, []string{"风险评分"}, reportFieldLabel(key), text, tone, false)
	}

	factorRowOrder := []string{"CountryCode", "Proxy", "Tor", "VPN", "Server", "Abuser", "Robot"}
	for _, row := range factorRowOrder {
		record, ok := asMap(factor[row])
		if !ok {
			continue
		}
		for _, entry := range orderedReportEntries(record, []string{"IP2LOCATION", "ipapi", "ipregistry", "IPQS", "SCAMALYTICS", "ipdata", "IPinfo", "IPWHOIS", "DBIP"}) {
			key := entry[0].(string)
			text := reportBoolText(entry[1])
			if row == "CountryCode" {
				text = reportCountryText(entry[1])
			}
			pushDisplayField(&items, "Factor."+row+"."+key, []string{"风险因子", reportFieldLabel(key)}, reportFieldLabel(row), text, "", false)
		}
	}
	renderExtraRows(&items, factor, "Factor", []string{"风险因子"}, factorRowOrder)

	for _, entry := range orderedReportEntries(media, []string{"TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Spotify", "Reddit", "ChatGPT"}) {
		key := entry[0].(string)
		record, ok := asMap(entry[1])
		if !ok {
			continue
		}
		groupPath := []string{"流媒体及AI服务解锁检测", reportFieldLabel(key)}
		pushDisplayField(&items, "Media."+key+".Status", groupPath, "状态", reportMediaStatusText(record["Status"]), "", false)
		pushDisplayField(&items, "Media."+key+".Region", groupPath, "地区", reportCountryText(record["Region"]), "", false)
		pushDisplayField(&items, "Media."+key+".Type", groupPath, "方式", reportMediaTypeText(record["Type"]), "", false)
		renderExtraRows(&items, record, "Media."+key, groupPath, []string{"Status", "Region", "Type"})
	}

	port25Missing := reportMissingText(mail["Port25"])
	port25Text := "N/A"
	port25Tone := "muted"
	if !port25Missing {
		if truthy(mail["Port25"]) {
			port25Text = "可用"
			port25Tone = "good"
		} else {
			port25Text = "不可用"
			port25Tone = "bad"
		}
	}
	pushDisplayField(&items, "Mail.Port25", []string{"邮局连通性及黑名单检测"}, "本地25端口出站", port25Text, port25Tone, port25Missing)
	for _, provider := range []string{"Gmail", "Outlook", "Yahoo", "Apple", "QQ", "MailRU", "AOL", "GMX", "MailCOM", "163", "Sohu", "Sina"} {
		value := mail[provider]
		missing := reportMissingText(value)
		text := "N/A"
		tone := "muted"
		if !missing {
			if truthy(value) {
				text = "可用"
				tone = "good"
			} else {
				text = "不可用"
				tone = "bad"
			}
		}
		pushDisplayField(&items, "Mail."+provider, []string{"邮局连通性及黑名单检测", "通信"}, reportFieldLabel(provider), text, tone, missing)
	}
	if dnsbl, ok := asMap(mail["DNSBlacklist"]); ok {
		for _, key := range []string{"Total", "Clean", "Marked", "Blacklisted"} {
			text := valueOrNA(dnsbl[key])
			tone := "neutral"
			switch key {
			case "Clean":
				tone = "good"
			case "Marked":
				tone = "warn"
			case "Blacklisted":
				number := 0.0
				switch typed := dnsbl[key].(type) {
				case float64:
					number = typed
				case int:
					number = float64(typed)
				}
				if number > 0 {
					tone = "bad"
				} else {
					tone = "good"
				}
			}
			pushDisplayField(&items, "Mail.DNSBlacklist."+key, []string{"邮局连通性及黑名单检测", "IP地址黑名单数据库"}, reportFieldLabel(key), text, tone, false)
		}
		renderExtraRows(&items, dnsbl, "Mail.DNSBlacklist", []string{"邮局连通性及黑名单检测", "IP地址黑名单数据库"}, []string{"Total", "Clean", "Marked", "Blacklisted"})
	}
	renderExtraRows(&items, mail, "Mail", []string{"邮局连通性及黑名单检测"}, []string{"Port25", "DNSBlacklist", "Gmail", "Outlook", "Yahoo", "Apple", "QQ", "MailRU", "AOL", "GMX", "MailCOM", "163", "Sohu", "Sina"})

	extraKeys := make([]string, 0, len(structured.Remainder))
	for key := range structured.Remainder {
		extraKeys = append(extraKeys, key)
	}
	sort.Strings(extraKeys)
	for _, key := range extraKeys {
		value := structured.Remainder[key]
		if _, ok := asMap(value); !ok {
			pushDisplayField(&items, key, []string{reportFieldLabel(key)}, reportFieldLabel(key), valueOrNA(value), "", false)
			continue
		}
		renderExtraRows(&items, value.(map[string]any), key, []string{reportFieldLabel(key)}, nil)
	}

	return items, nil
}

func buildDisplayFieldOptionLabel(value DisplayFieldValue) string {
	parts := append([]string{}, value.GroupPath...)
	parts = append(parts, value.Label)
	for index, part := range parts {
		parts[index] = compactText(part)
	}
	return strings.Join(parts, " / ")
}

func renderExtraRows(items *[]DisplayFieldValue, record map[string]any, basePath string, groupPath []string, skipKeys []string) {
	if record == nil {
		return
	}
	skipped := map[string]struct{}{}
	for _, key := range skipKeys {
		skipped[key] = struct{}{}
	}
	keys := make([]string, 0, len(record))
	for key := range record {
		if _, ok := skipped[key]; ok {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := record[key]
		path := basePath + "." + key
		if nested, ok := asMap(value); ok {
			childKeys := make([]string, 0, len(nested))
			for childKey := range nested {
				childKeys = append(childKeys, childKey)
			}
			sort.Strings(childKeys)
			for _, childKey := range childKeys {
				childValue := nested[childKey]
				pushDisplayField(items, path+"."+childKey, append([]string{}, append(groupPath, reportFieldLabel(key))...), reportFieldLabel(childKey), valueOrNA(childValue), "", false)
			}
			continue
		}
		pushDisplayField(items, path, groupPath, reportFieldLabel(key), valueOrNA(value), "", false)
	}
}

func getStructuredCurrentResult(result map[string]any) (*structuredCurrentResult, error) {
	template, err := sampledata.IPQualityTemplateResult()
	if err != nil {
		return nil, err
	}
	normalized, ok := mergeIntoTemplate(nullifyTemplate(template), result).(map[string]any)
	if !ok || len(normalized) == 0 {
		return nil, nil
	}
	remainder, err := cloneMap(normalized)
	if err != nil {
		return nil, err
	}
	return &structuredCurrentResult{
		Head:      takeStructuredGroup(remainder, "Head"),
		Info:      takeStructuredGroup(remainder, "Info"),
		Type:      takeStructuredGroup(remainder, "Type"),
		Factor:    takeStructuredGroup(remainder, "Factor"),
		Meta:      takeStructuredGroup(remainder, "Meta"),
		Score:     takeStructuredGroup(remainder, "Score"),
		Media:     takeStructuredGroup(remainder, "Media"),
		Mail:      takeStructuredGroup(remainder, "Mail"),
		Remainder: remainder,
	}, nil
}

func nullifyTemplate(value any) any {
	if items, ok := value.([]any); ok {
		return items
	}
	if record, ok := asMap(value); ok {
		next := map[string]any{}
		for key, child := range record {
			next[key] = nullifyTemplate(child)
		}
		return next
	}
	return nil
}

func mergeIntoTemplate(template any, actual any) any {
	if _, ok := template.([]any); ok {
		if items, ok := actual.([]any); ok {
			return items
		}
		return template
	}
	if templateRecord, ok := asMap(template); ok {
		actualRecord, _ := asMap(actual)
		next := map[string]any{}
		for key, childTemplate := range templateRecord {
			next[key] = mergeIntoTemplate(childTemplate, actualRecord[key])
		}
		return next
	}
	if actual == nil {
		return template
	}
	return actual
}

func takeStructuredGroup(record map[string]any, key string) map[string]any {
	value, ok := asMap(record[key])
	if !ok {
		return nil
	}
	delete(record, key)
	return value
}

func cloneMap(value map[string]any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	cloned := map[string]any{}
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func asMap(value any) (map[string]any, bool) {
	record, ok := value.(map[string]any)
	return record, ok
}

func valueOrNA(value any) string {
	if reportMissingText(value) {
		return "N/A"
	}
	return fmt.Sprint(value)
}

func fallbackText(value string) string {
	if strings.TrimSpace(value) == "" {
		return "N/A"
	}
	return value
}

func rawString(value any) string {
	if reportMissingText(value) {
		return ""
	}
	return fmt.Sprint(value)
}

func filterEmpty(items []string) []string {
	filtered := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func asnOrNA(value any) string {
	if reportMissingText(value) {
		return "N/A"
	}
	return "AS" + fmt.Sprint(value)
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		lower := strings.ToLower(strings.TrimSpace(typed))
		return lower == "true" || lower == "yes" || lower == "1"
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return false
	}
}
