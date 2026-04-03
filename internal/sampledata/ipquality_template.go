package sampledata

import (
	_ "embed"
	"encoding/json"
	"sync"
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
