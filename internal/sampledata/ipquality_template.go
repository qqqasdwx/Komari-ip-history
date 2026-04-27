package sampledata

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

var (
	//go:embed ipquality_template.json
	ipqualityTemplateRaw []byte

	ipqualityTemplateOnce sync.Once
	ipqualityTemplateData map[string]any
	ipqualityTemplateErr  error
)

func IPQualityTemplateResult() (map[string]any, error) {
	ipqualityTemplateOnce.Do(func() {
		ipqualityTemplateErr = json.Unmarshal(ipqualityTemplateRaw, &ipqualityTemplateData)
	})
	if ipqualityTemplateErr != nil {
		return nil, ipqualityTemplateErr
	}
	raw, err := json.Marshal(ipqualityTemplateData)
	if err != nil {
		return nil, err
	}
	cloned := map[string]any{}
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func LocalProbeResult(targetIP string) (map[string]any, error) {
	result, err := IPQualityTemplateResult()
	if err != nil {
		return nil, err
	}

	head, _ := result["Head"].(map[string]any)
	if head == nil {
		head = map[string]any{}
		result["Head"] = head
	}
	head["IP"] = strings.TrimSpace(targetIP)
	head["Time"] = time.Now().UTC().Format("2006-01-02 15:04:05 MST")
	head["Command"] = "local-development-probe"
	head["Version"] = "dev-local-probe"

	return result, nil
}
