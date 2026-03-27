package sampledata

import (
	"encoding/json"
	"time"
)

func DefaultCurrentResult(nodeUUID, nodeName string) (string, string, time.Time, error) {
	now := time.Now().UTC()
	payload := map[string]any{
		"Meta": map[string]any{
			"node_uuid":   nodeUUID,
			"node_name":   nodeName,
			"source":      "mock",
			"updated_at":  now.Format(time.RFC3339),
			"environment": "development",
		},
		"Score": map[string]any{
			"Scamalytics": 18,
			"AbuseIPDB":   0,
			"IPQS":        22,
		},
		"Media": map[string]any{
			"Netflix": map[string]any{
				"Status": "Yes",
				"Region": "US",
				"Type":   "Originals",
			},
			"ChatGPT": map[string]any{
				"Status": "Yes",
				"Region": "US",
				"Type":   "Web",
			},
		},
		"Mail": map[string]any{
			"Blacklisted": 0,
			"Available":   true,
		},
	}

	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", "", time.Time{}, err
	}

	return string(raw), "Development mock data", now, nil
}
