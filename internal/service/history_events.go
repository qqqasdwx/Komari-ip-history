package service

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

type NodeHistoryFieldOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type NodeHistoryFieldOptionList struct {
	Items []NodeHistoryFieldOption `json:"items"`
}

type NodeHistoryChangeEvent struct {
	ID                string            `json:"id"`
	TargetID          uint              `json:"target_id"`
	TargetIP          string            `json:"target_ip"`
	FieldID           string            `json:"field_id"`
	GroupPath         []string          `json:"group_path"`
	FieldLabel        string            `json:"field_label"`
	FieldOptionLabel  string            `json:"field_option_label"`
	Previous          DisplayFieldValue `json:"previous"`
	Current           DisplayFieldValue `json:"current"`
	PreviousRecordedAt string           `json:"previous_recorded_at"`
	RecordedAt        time.Time         `json:"recorded_at"`
}

type NodeHistoryChangeEventPage struct {
	Items      []NodeHistoryChangeEvent `json:"items"`
	Total      int64                    `json:"total"`
	Page       int                      `json:"page"`
	PageSize   int                      `json:"page_size"`
	TotalPages int                      `json:"total_pages"`
}

func GetNodeHistoryEvents(db *gorm.DB, uuid string, selectedTargetID *uint, fieldID string, page, pageSize int, startAt, endAt *time.Time) (NodeHistoryChangeEventPage, error) {
	entries, err := loadNodeHistoryEntriesForEvents(db, uuid, selectedTargetID, endAt)
	if err != nil {
		return NodeHistoryChangeEventPage{}, err
	}
	events, err := buildNodeHistoryChangeEvents(entries, startAt)
	if err != nil {
		return NodeHistoryChangeEventPage{}, err
	}

	fieldID = strings.TrimSpace(strings.ToLower(fieldID))
	if fieldID != "" {
		filtered := make([]NodeHistoryChangeEvent, 0, len(events))
		for _, event := range events {
			if event.FieldID == fieldID {
				filtered = append(filtered, event)
			}
		}
		events = filtered
	}

	page = normalizeHistoryPage(page)
	pageSize = normalizeHistoryPageSize(0, pageSize)
	total := int64(len(events))
	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	startIndex := (page - 1) * pageSize
	if startIndex >= len(events) {
		return NodeHistoryChangeEventPage{
			Items:      []NodeHistoryChangeEvent{},
			Total:      total,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
		}, nil
	}
	endIndex := startIndex + pageSize
	if endIndex > len(events) {
		endIndex = len(events)
	}

	return NodeHistoryChangeEventPage{
		Items:      events[startIndex:endIndex],
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func GetNodeHistoryFieldOptions(db *gorm.DB, uuid string, selectedTargetID *uint, startAt, endAt *time.Time) (NodeHistoryFieldOptionList, error) {
	entries, err := loadNodeHistoryEntriesForEvents(db, uuid, selectedTargetID, endAt)
	if err != nil {
		return NodeHistoryFieldOptionList{}, err
	}
	events, err := buildNodeHistoryChangeEvents(entries, startAt)
	if err != nil {
		return NodeHistoryFieldOptionList{}, err
	}
	seen := make(map[string]NodeHistoryFieldOption)
	for _, event := range events {
		if _, ok := seen[event.FieldID]; ok {
			continue
		}
		seen[event.FieldID] = NodeHistoryFieldOption{
			ID:    event.FieldID,
			Label: event.FieldOptionLabel,
		}
	}
	items := make([]NodeHistoryFieldOption, 0, len(seen))
	for _, item := range seen {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return strings.Compare(items[i].Label, items[j].Label) < 0
	})
	return NodeHistoryFieldOptionList{Items: items}, nil
}

func loadNodeHistoryEntriesForEvents(db *gorm.DB, uuid string, selectedTargetID *uint, endAt *time.Time) ([]NodeHistoryEntry, error) {
	_, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return nil, err
	}
	selected, err := selectNodeTarget(targets, selectedTargetID)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return []NodeHistoryEntry{}, nil
	}

	targetByID := make(map[uint]models.NodeTarget, len(targets))
	targetIDs := make([]uint, 0, len(targets))
	for _, target := range targets {
		targetByID[target.ID] = target
		targetIDs = append(targetIDs, target.ID)
	}
	targetScope := targetIDs
	if selected != nil {
		targetScope = []uint{selected.ID}
	}

	query := db.Where("node_target_id IN ?", targetScope).Order("node_target_id ASC").Order("recorded_at ASC").Order("id ASC")
	if endAt != nil && !endAt.IsZero() {
		query = query.Where("recorded_at <= ?", endAt.UTC())
	}

	var history []models.NodeTargetHistory
	if err := query.Find(&history).Error; err != nil {
		return nil, err
	}

	items := make([]NodeHistoryEntry, 0, len(history))
	for _, item := range history {
		target := targetByID[item.NodeTargetID]
		items = append(items, NodeHistoryEntry{
			ID:         item.ID,
			TargetID:   item.NodeTargetID,
			TargetIP:   target.TargetIP,
			RecordedAt: item.RecordedAt,
			Summary:    item.Summary,
			Result:     decodeResultJSON(item.ResultJSON),
		})
	}
	return items, nil
}

func buildNodeHistoryChangeEvents(items []NodeHistoryEntry, startAt *time.Time) ([]NodeHistoryChangeEvent, error) {
	ordered := append([]NodeHistoryEntry{}, items...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].TargetID == ordered[j].TargetID {
			if ordered[i].RecordedAt.Equal(ordered[j].RecordedAt) {
				return ordered[i].ID < ordered[j].ID
			}
			return ordered[i].RecordedAt.Before(ordered[j].RecordedAt)
		}
		return ordered[i].TargetID < ordered[j].TargetID
	})

	events := make([]NodeHistoryChangeEvent, 0)
	previousMapByTarget := make(map[uint]map[string]DisplayFieldValue)
	previousEntryByTarget := make(map[uint]*NodeHistoryEntry)

	for _, item := range ordered {
		currentValues, err := extractDisplayFieldValues(item.Result)
		if err != nil {
			return nil, err
		}
		currentMap := make(map[string]DisplayFieldValue, len(currentValues))
		for _, value := range currentValues {
			currentMap[value.ID] = value
		}
		previousMap := previousMapByTarget[item.TargetID]
		previousEntry := previousEntryByTarget[item.TargetID]
		ids := unionFieldIDs(previousMap, currentMap)
		for _, id := range ids {
			currentValue, currentOk := currentMap[id]
			previousValue, previousOk := previousMap[id]
			if !currentOk && !previousOk {
				continue
			}
			if !previousOk {
				previousValue = buildMissingDisplayFieldLike(currentValue)
			}
			if !currentOk {
				currentValue = buildMissingDisplayFieldLike(previousValue)
			}
			if compareDisplayFieldValues(previousValue, currentValue) {
				continue
			}
			if startAt != nil && item.RecordedAt.Before(startAt.UTC()) {
				continue
			}
			previousRecordedAt := ""
			if previousEntry != nil {
				previousRecordedAt = previousEntry.RecordedAt.Format(time.RFC3339)
			}
			events = append(events, NodeHistoryChangeEvent{
				ID:                 strconvID(item.ID) + ":" + id,
				TargetID:           item.TargetID,
				TargetIP:           item.TargetIP,
				FieldID:            id,
				GroupPath:          append([]string{}, currentValue.GroupPath...),
				FieldLabel:         currentValue.Label,
				FieldOptionLabel:   buildDisplayFieldOptionLabel(currentValue),
				Previous:           previousValue,
				Current:            currentValue,
				PreviousRecordedAt: previousRecordedAt,
				RecordedAt:         item.RecordedAt,
			})
		}
		previousMapByTarget[item.TargetID] = currentMap
		copyEntry := item
		previousEntryByTarget[item.TargetID] = &copyEntry
	}

	sort.Slice(events, func(i, j int) bool {
		if events[i].RecordedAt.Equal(events[j].RecordedAt) {
			if events[i].TargetIP == events[j].TargetIP {
				return strings.Compare(events[i].FieldOptionLabel, events[j].FieldOptionLabel) < 0
			}
			return strings.Compare(events[i].TargetIP, events[j].TargetIP) < 0
		}
		return events[i].RecordedAt.After(events[j].RecordedAt)
	})
	return events, nil
}

func unionFieldIDs(left map[string]DisplayFieldValue, right map[string]DisplayFieldValue) []string {
	ids := make([]string, 0, len(left)+len(right))
	seen := make(map[string]struct{}, len(left)+len(right))
	for id := range left {
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for id := range right {
		if _, ok := seen[id]; ok {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func compareDisplayFieldValues(left DisplayFieldValue, right DisplayFieldValue) bool {
	return left.Text == right.Text && left.Tone == right.Tone && left.MissingKind == right.MissingKind
}

func buildMissingDisplayFieldLike(source DisplayFieldValue) DisplayFieldValue {
	next := source
	next.Text = "N/A"
	next.Tone = "muted"
	next.MissingKind = "missing"
	return next
}

func strconvID(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}
