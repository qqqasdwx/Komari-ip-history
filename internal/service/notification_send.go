package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/require"
	"gorm.io/gorm"
)

const javascriptSyncExecutionTimeout = 2 * time.Second

func renderNotificationTitle(settings NotificationSettings, event NotificationEvent) string {
	if strings.TrimSpace(settings.TitleTemplate) == "" {
		return ""
	}
	return RenderNotificationTemplate(settings.TitleTemplate, event, "")
}

func jsonStringInner(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) < 2 {
		return value
	}
	return string(encoded[1 : len(encoded)-1])
}

type NotificationEvent struct {
	NodeID           uint      `json:"node_id"`
	NodeName         string    `json:"node_name"`
	KomariNodeUUID   string    `json:"komari_node_uuid"`
	TargetID         uint      `json:"target_id"`
	TargetIP         string    `json:"target_ip"`
	FieldID          string    `json:"field_id"`
	FieldLabel       string    `json:"field_label"`
	GroupPath        []string  `json:"group_path"`
	PreviousValue    string    `json:"previous_value"`
	CurrentValue     string    `json:"current_value"`
	PreviousRecorded string    `json:"previous_recorded_at"`
	RecordedAt       time.Time `json:"recorded_at"`
	HistoryEntryID   uint      `json:"history_entry_id"`
	DetailURL        string    `json:"detail_url"`
	CompareURL       string    `json:"compare_url"`
}

func SendTestNotification(db *gorm.DB, channelID uint) error {
	if channelID == 0 {
		return errors.New("channel id is required")
	}
	var channel models.NotificationChannel
	if err := db.First(&channel, "id = ?", channelID).Error; err != nil {
		return err
	}
	if !channel.Enabled {
		return errors.New("notification channel disabled")
	}

	event := NotificationEvent{
		NodeName:       "Test Node",
		TargetIP:       "203.0.113.10",
		FieldID:        "score.ipqs",
		FieldLabel:     "IPQS 分数",
		PreviousValue:  "30",
		CurrentValue:   "50",
		RecordedAt:     time.Now().UTC(),
		DetailURL:      "https://example.com/#/nodes/test",
		CompareURL:     "https://example.com/#/nodes/test/compare",
		GroupPath:      []string{"风险评分"},
		HistoryEntryID: 1,
	}
	settings, err := GetNotificationSettings(db)
	if err != nil {
		return err
	}
	message := RenderNotificationTemplate(settings.MessageTemplate, event, defaultNotificationMessageTemplate)
	title := renderNotificationTitle(settings, event)
	return dispatchNotificationChannel(channel, event, message, title)
}

func DispatchNotificationRules(db *gorm.DB, node models.Node, target models.NodeTarget, historyEntryID uint, previousResult, currentResult map[string]any, recordedAt time.Time) error {
	settings, err := GetNotificationSettings(db)
	if err != nil {
		return err
	}
	if settings.ActiveChannelID == nil || *settings.ActiveChannelID == 0 {
		return nil
	}
	activeChannel, err := GetNotificationChannel(db, *settings.ActiveChannelID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if !activeChannel.Enabled {
		return nil
	}

	var previousRecordedAt *time.Time
	if target.CurrentResultUpdatedAt != nil && !target.CurrentResultUpdatedAt.IsZero() {
		value := target.CurrentResultUpdatedAt.UTC()
		previousRecordedAt = &value
	}
	events, err := buildNotificationEvents(db, node, target, historyEntryID, previousResult, currentResult, previousRecordedAt, recordedAt)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}

	rules, err := ListNotificationRules(db)
	if err != nil {
		return err
	}
	if len(rules) == 0 {
		return nil
	}
	for _, event := range events {
		for _, rule := range rules {
			if !rule.Enabled {
				continue
			}
			if strings.TrimSpace(strings.ToLower(rule.FieldID)) != strings.TrimSpace(strings.ToLower(event.FieldID)) {
				continue
			}
			if !notificationRuleMatches(rule, node.ID, target.ID) {
				continue
			}

			renderedTitle := renderNotificationTitle(settings, event)
			renderedMessage := RenderNotificationTemplate(settings.MessageTemplate, event, defaultNotificationMessageTemplate)
			err := dispatchNotificationChannel(models.NotificationChannel{
				ID:      activeChannel.ID,
				Name:    activeChannel.Name,
				Type:    activeChannel.Type,
				Enabled: activeChannel.Enabled,
				ConfigJSON: func() string {
					raw, _ := json.Marshal(activeChannel.Config)
					return string(raw)
				}(),
			}, event, renderedMessage, renderedTitle)
			delivery := models.NotificationDelivery{
				RuleID:         rule.ID,
				HistoryEntryID: historyEntryID,
				Status:         "success",
			}
			if err != nil {
				delivery.Status = "failed"
				delivery.ResponseSummary = trimDeliverySummary(err.Error())
			}
			if saveErr := db.Create(&delivery).Error; saveErr != nil {
				return saveErr
			}
		}
	}
	return nil
}

func notificationRuleMatches(rule NotificationRuleDetail, nodeID uint, targetID uint) bool {
	if rule.AllNodes {
		return true
	}
	for _, scope := range rule.NodeScopes {
		if scope.NodeID != nodeID {
			continue
		}
		if scope.AllTargets {
			return true
		}
		for _, target := range scope.Targets {
			if target.TargetID == targetID {
				return true
			}
		}
	}
	return false
}

func dispatchNotificationChannel(channel models.NotificationChannel, event NotificationEvent, message, title string) error {
	config := decodeChannelConfig(channel.ConfigJSON)
	switch channel.Type {
	case "telegram":
		return sendTelegram(config, message, title)
	case "webhook":
		return sendWebhook(config, message, title)
	case "javascript":
		return sendJavascript(config, event, message, title)
	default:
		return errors.New("unsupported notification channel type")
	}
}

func sendTelegram(config map[string]any, message, title string) error {
	botToken := strings.TrimSpace(asString(config["bot_token"]))
	chatID := strings.TrimSpace(asString(config["chat_id"]))
	if botToken == "" || chatID == "" {
		return errors.New("telegram bot_token and chat_id are required")
	}
	endpoint := strings.TrimSpace(asString(config["endpoint"]))
	if endpoint == "" {
		endpoint = "https://api.telegram.org/bot"
	}

	fullMessage := message
	if title != "" {
		fullMessage = fmt.Sprintf("<b>%s</b>\n%s", title, message)
	}

	form := url.Values{}
	form.Set("chat_id", chatID)
	form.Set("text", fullMessage)
	form.Set("parse_mode", "HTML")
	if threadID := strings.TrimSpace(asString(config["message_thread_id"])); threadID != "" {
		form.Set("message_thread_id", threadID)
	}

	resp, err := http.PostForm(strings.TrimRight(endpoint, "/")+botToken+"/sendMessage", form)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram request failed with status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func sendWebhook(config map[string]any, message, title string) error {
	rawURL := strings.TrimSpace(asString(config["url"]))
	if rawURL == "" {
		return errors.New("webhook url is required")
	}
	method := strings.ToUpper(strings.TrimSpace(asString(config["method"])))
	if method == "" {
		method = "GET"
	}
	contentType := strings.TrimSpace(asString(config["content_type"]))
	if contentType == "" {
		contentType = "application/json"
	}
	bodyTemplate := asString(config["body"])
	if bodyTemplate == "" {
		bodyTemplate = `{"message":"{{message}}"}`
	}
	body := strings.ReplaceAll(strings.ReplaceAll(bodyTemplate, "{{message}}", message), "{{title}}", title)
	if strings.Contains(strings.ToLower(contentType), "json") {
		body = strings.ReplaceAll(strings.ReplaceAll(bodyTemplate, "{{message}}", jsonStringInner(message)), "{{title}}", jsonStringInner(title))
	}

	var req *http.Request
	var err error
	switch method {
	case "POST":
		req, err = http.NewRequest(http.MethodPost, rawURL, bytes.NewBufferString(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", contentType)
	case "GET":
		urlWithQuery := strings.ReplaceAll(strings.ReplaceAll(rawURL, "{{message}}", url.QueryEscape(message)), "{{title}}", url.QueryEscape(title))
		req, err = http.NewRequest(http.MethodGet, urlWithQuery, nil)
		if err != nil {
			return err
		}
	default:
		return errors.New("unsupported webhook method")
	}

	if headersText := strings.TrimSpace(asString(config["headers"])); headersText != "" {
		var headers map[string]string
		if err := json.Unmarshal([]byte(headersText), &headers); err == nil {
			for key, value := range headers {
				req.Header.Set(key, value)
			}
		}
	}
	if username := strings.TrimSpace(asString(config["username"])); username != "" {
		req.SetBasicAuth(username, strings.TrimSpace(asString(config["password"])))
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("webhook request failed with status %d: %s", resp.StatusCode, string(responseBody))
	}
	return nil
}

func sendJavascript(config map[string]any, event NotificationEvent, message, title string) error {
	script := strings.TrimSpace(asString(config["script"]))
	if script == "" {
		return errors.New("javascript script is required")
	}

	vm := goja.New()
	new(require.Registry).Enable(vm)
	setupConsole(vm)
	setupFetch(vm)
	setupXHR(vm)

	if _, err := runJavaScriptWithInterrupt(vm, "script", func() (goja.Value, error) {
		return vm.RunString(script)
	}); err != nil {
		return err
	}

	if sendEventValue := vm.Get("sendEvent"); sendEventValue != nil && !goja.IsUndefined(sendEventValue) && !goja.IsNull(sendEventValue) {
		if fn, ok := goja.AssertFunction(sendEventValue); ok {
			result, err := runJavaScriptWithInterrupt(vm, "sendEvent", func() (goja.Value, error) {
				return fn(goja.Undefined(), vm.ToValue(event))
			})
			if err != nil {
				return err
			}
			return awaitJavaScriptResult(vm, result, "sendEvent")
		}
	}

	sendMessageValue := vm.Get("sendMessage")
	fn, ok := goja.AssertFunction(sendMessageValue)
	if !ok {
		return errors.New("sendMessage function not defined in script")
	}
	result, err := runJavaScriptWithInterrupt(vm, "sendMessage", func() (goja.Value, error) {
		return fn(goja.Undefined(), vm.ToValue(message), vm.ToValue(title))
	})
	if err != nil {
		return err
	}
	return awaitJavaScriptResult(vm, result, "sendMessage")
}

func runJavaScriptWithInterrupt(vm *goja.Runtime, label string, run func() (goja.Value, error)) (goja.Value, error) {
	var timedOut atomic.Bool
	timeoutMessage := label + " timeout"
	timer := time.AfterFunc(javascriptSyncExecutionTimeout, func() {
		timedOut.Store(true)
		vm.Interrupt(timeoutMessage)
	})
	result, err := run()
	if !timer.Stop() {
		vm.ClearInterrupt()
	}
	if timedOut.Load() {
		return result, fmt.Errorf("%s", timeoutMessage)
	}
	if err != nil {
		return result, err
	}
	return result, nil
}

func setupConsole(vm *goja.Runtime) {
	console := vm.NewObject()
	console.Set("log", func(call goja.FunctionCall) goja.Value { return goja.Undefined() })
	vm.Set("console", console)
}

func setupFetch(vm *goja.Runtime) {
	vm.Set("fetch", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 1 {
			panic(vm.NewTypeError("fetch requires at least 1 argument"))
		}

		requestURL := call.Argument(0).String()
		options := map[string]any{
			"method":  "GET",
			"headers": map[string]string{},
			"body":    "",
		}
		if len(call.Arguments) > 1 {
			optObj := call.Argument(1).ToObject(vm)
			if optObj != nil {
				if method := optObj.Get("method"); method != nil && !goja.IsUndefined(method) {
					options["method"] = method.String()
				}
				if headers := optObj.Get("headers"); headers != nil && !goja.IsUndefined(headers) {
					headersObj := headers.ToObject(vm)
					if headersObj != nil {
						headerMap := make(map[string]string)
						for _, key := range headersObj.Keys() {
							headerMap[key] = headersObj.Get(key).String()
						}
						options["headers"] = headerMap
					}
				}
				if body := optObj.Get("body"); body != nil && !goja.IsUndefined(body) {
					options["body"] = body.String()
				}
			}
		}

		promise, resolve, reject := vm.NewPromise()
		resp, bodyBytes, err := performJavaScriptRequest(
			options["method"].(string),
			requestURL,
			options["headers"].(map[string]string),
			options["body"].(string),
		)
		if err != nil {
			reject(vm.ToValue(err.Error()))
			return vm.ToValue(promise)
		}

		responseObj := vm.NewObject()
		responseObj.Set("status", resp.StatusCode)
		responseObj.Set("statusText", resp.Status)
		responseObj.Set("ok", resp.StatusCode >= 200 && resp.StatusCode < 300)
		responseObj.Set("text", func(goja.FunctionCall) goja.Value {
			textPromise, textResolve, _ := vm.NewPromise()
			textResolve(vm.ToValue(string(bodyBytes)))
			return vm.ToValue(textPromise)
		})
		responseObj.Set("json", func(goja.FunctionCall) goja.Value {
			jsonPromise, jsonResolve, jsonReject := vm.NewPromise()
			var result any
			if err := json.Unmarshal(bodyBytes, &result); err != nil {
				jsonReject(vm.ToValue(err.Error()))
			} else {
				jsonResolve(vm.ToValue(result))
			}
			return vm.ToValue(jsonPromise)
		})
		resolve(responseObj)
		return vm.ToValue(promise)
	})
}

func setupXHR(vm *goja.Runtime) {
	vm.Set("xhr", func(call goja.FunctionCall) goja.Value {
		return goja.Undefined()
	})
	vm.Set("XMLHttpRequest", func(call goja.ConstructorCall) *goja.Object {
		xhr := call.This
		var method, requestURL string
		var headers = make(map[string]string)
		var requestBody string
		var async = true

		xhr.Set("readyState", 0)
		xhr.Set("status", 0)
		xhr.Set("statusText", "")
		xhr.Set("responseText", "")
		xhr.Set("response", "")
		xhr.Set("onreadystatechange", goja.Null())
		xhr.Set("onload", goja.Null())
		xhr.Set("onerror", goja.Null())

		xhr.Set("open", func(call goja.FunctionCall) goja.Value {
			if len(call.Arguments) < 2 {
				panic(vm.NewTypeError("open requires at least 2 arguments"))
			}
			method = call.Argument(0).String()
			requestURL = call.Argument(1).String()
			if len(call.Arguments) > 2 {
				async = call.Argument(2).ToBoolean()
			}
			xhr.Set("readyState", 1)
			callHandler(vm, xhr, "onreadystatechange")
			return goja.Undefined()
		})

		xhr.Set("setRequestHeader", func(call goja.FunctionCall) goja.Value {
			if len(call.Arguments) < 2 {
				panic(vm.NewTypeError("setRequestHeader requires 2 arguments"))
			}
			headers[call.Argument(0).String()] = call.Argument(1).String()
			return goja.Undefined()
		})

		xhr.Set("send", func(call goja.FunctionCall) goja.Value {
			if len(call.Arguments) > 0 && !goja.IsUndefined(call.Argument(0)) && !goja.IsNull(call.Argument(0)) {
				requestBody = call.Argument(0).String()
			}
			sendFunc := func() {
				resp, bodyBytes, err := performJavaScriptRequest(method, requestURL, headers, requestBody)
				if err != nil {
					xhr.Set("readyState", 4)
					xhr.Set("statusText", err.Error())
					callHandler(vm, xhr, "onerror")
					callHandler(vm, xhr, "onreadystatechange")
					return
				}
				xhr.Set("readyState", 2)
				callHandler(vm, xhr, "onreadystatechange")
				xhr.Set("readyState", 4)
				xhr.Set("status", resp.StatusCode)
				xhr.Set("statusText", resp.Status)
				xhr.Set("responseText", string(bodyBytes))
				xhr.Set("response", string(bodyBytes))
				callHandler(vm, xhr, "onreadystatechange")
				callHandler(vm, xhr, "onload")
			}
			_ = async
			sendFunc()
			return goja.Undefined()
		})
		return xhr
	})
}

func performJavaScriptRequest(method, requestURL string, headers map[string]string, requestBody string) (*http.Response, []byte, error) {
	var body io.Reader
	if requestBody != "" {
		body = bytes.NewReader([]byte(requestBody))
	}
	req, err := http.NewRequest(method, requestURL, body)
	if err != nil {
		return nil, nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	return resp, bodyBytes, nil
}

func callHandler(vm *goja.Runtime, obj *goja.Object, handlerName string) {
	handler := obj.Get(handlerName)
	if handler != nil && !goja.IsUndefined(handler) && !goja.IsNull(handler) {
		if fn, ok := goja.AssertFunction(handler); ok {
			_, _ = fn(obj)
		}
	}
}

func awaitJavaScriptResult(vm *goja.Runtime, result goja.Value, fnName string) error {
	if promise, ok := result.Export().(*goja.Promise); ok {
		timeout := time.NewTimer(30 * time.Second)
		defer timeout.Stop()
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-timeout.C:
				return fmt.Errorf("%s timeout", fnName)
			case <-ticker.C:
				_, _ = vm.RunString("void 0")
				switch promise.State() {
				case goja.PromiseStateFulfilled:
					if !promise.Result().ToBoolean() {
						return fmt.Errorf("%s returned false", fnName)
					}
					return nil
				case goja.PromiseStateRejected:
					return fmt.Errorf("%s promise rejected: %v", fnName, promise.Result())
				}
			}
		}
	}
	if !result.ToBoolean() {
		return fmt.Errorf("%s returned false", fnName)
	}
	return nil
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func buildNotificationEvents(db *gorm.DB, node models.Node, target models.NodeTarget, historyEntryID uint, previousResult, currentResult map[string]any, previousRecordedAt *time.Time, recordedAt time.Time) ([]NotificationEvent, error) {
	previousValues, err := extractDisplayFieldValues(previousResult)
	if err != nil {
		return nil, err
	}
	currentValues, err := extractDisplayFieldValues(currentResult)
	if err != nil {
		return nil, err
	}

	previousMap := make(map[string]DisplayFieldValue, len(previousValues))
	currentMap := make(map[string]DisplayFieldValue, len(currentValues))
	for _, value := range previousValues {
		previousMap[value.ID] = value
	}
	for _, value := range currentValues {
		currentMap[value.ID] = value
	}

	ids := unionFieldIDs(previousMap, currentMap)
	events := make([]NotificationEvent, 0, len(ids))
	publicBaseURL := notificationPublicBaseURL(db)
	targetQuery := "?target_id=" + strconv.Itoa(int(target.ID))
	routeUUID := nodeRouteUUID(node)
	detailURL := "/#/nodes/" + routeUUID + targetQuery
	compareURL := "/#/nodes/" + routeUUID + "/compare" + targetQuery
	if publicBaseURL != "" {
		detailURL = publicBaseURL + detailURL
		compareURL = publicBaseURL + compareURL
	}
	previousRecordedAtText := ""
	if previousRecordedAt != nil && !previousRecordedAt.IsZero() {
		previousRecordedAtText = previousRecordedAt.UTC().Format(time.RFC3339)
	}
	for _, id := range ids {
		if shouldIgnoreHistoryEventField(id) {
			continue
		}
		currentValue, currentOK := currentMap[id]
		previousValue, previousOK := previousMap[id]
		if !currentOK && !previousOK {
			continue
		}
		if !previousOK {
			previousValue = buildMissingDisplayFieldLike(currentValue)
		}
		if !currentOK {
			currentValue = buildMissingDisplayFieldLike(previousValue)
		}
		if compareDisplayFieldValues(previousValue, currentValue) {
			continue
		}
		events = append(events, NotificationEvent{
			NodeID:           node.ID,
			NodeName:         node.Name,
			KomariNodeUUID:   node.KomariNodeUUID,
			TargetID:         target.ID,
			TargetIP:         target.TargetIP,
			FieldID:          id,
			FieldLabel:       currentValue.Label,
			GroupPath:        append([]string{}, currentValue.GroupPath...),
			PreviousValue:    previousValue.Text,
			CurrentValue:     currentValue.Text,
			PreviousRecorded: previousRecordedAtText,
			RecordedAt:       recordedAt.UTC(),
			HistoryEntryID:   historyEntryID,
			DetailURL:        detailURL,
			CompareURL:       compareURL,
		})
	}
	return events, nil
}

func buildNotificationTitle(event NotificationEvent) string {
	return event.NodeName + " / " + event.TargetIP + " / " + event.FieldLabel
}

func buildNotificationMessage(event NotificationEvent) string {
	path := strings.Join(append(append([]string{}, event.GroupPath...), event.FieldLabel), " / ")
	return fmt.Sprintf("字段变化: %s\n旧值: %s\n新值: %s\n目标 IP: %s\n时间: %s", path, event.PreviousValue, event.CurrentValue, event.TargetIP, event.RecordedAt.Format(time.RFC3339))
}

func trimDeliverySummary(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 1024 {
		return value
	}
	return value[:1024]
}

func notificationPublicBaseURL(db *gorm.DB) string {
	if db == nil {
		return ""
	}
	settings, err := GetIntegrationSettings(db, config.Load().PublicBaseURL)
	if err != nil {
		return ""
	}
	return strings.TrimRight(settings.EffectivePublicBaseURL, "/")
}
