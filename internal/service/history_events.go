package service

import (
	"container/heap"
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
	ID                 string            `json:"id"`
	TargetID           uint              `json:"target_id"`
	TargetIP           string            `json:"target_ip"`
	FieldID            string            `json:"field_id"`
	GroupPath          []string          `json:"group_path"`
	FieldLabel         string            `json:"field_label"`
	FieldOptionLabel   string            `json:"field_option_label"`
	Previous           DisplayFieldValue `json:"previous"`
	Current            DisplayFieldValue `json:"current"`
	PreviousRecordedAt string            `json:"previous_recorded_at"`
	RecordedAt         time.Time         `json:"recorded_at"`
}

type NodeHistoryChangeEventPage struct {
	Items      []NodeHistoryChangeEvent `json:"items"`
	Total      int64                    `json:"total"`
	Page       int                      `json:"page"`
	PageSize   int                      `json:"page_size"`
	TotalPages int                      `json:"total_pages"`
}

func GetNodeHistoryEvents(db *gorm.DB, uuid string, selectedTargetID *uint, fieldID string, page, pageSize int, startAt, endAt *time.Time) (NodeHistoryChangeEventPage, error) {
	page = normalizeHistoryPage(page)
	pageSize = normalizeHistoryPageSize(0, pageSize)
	keep := page * pageSize
	selected := &historyEventTopKHeap{}
	heap.Init(selected)
	total := int64(0)

	if err := streamNodeHistoryChangeEvents(db, uuid, selectedTargetID, startAt, endAt, fieldID, func(event NodeHistoryChangeEvent) error {
		total += 1
		if keep <= 0 {
			return nil
		}
		if selected.Len() < keep {
			heap.Push(selected, event)
			return nil
		}
		if compareHistoryEventOrder(event, (*selected)[0]) > 0 {
			heap.Pop(selected)
			heap.Push(selected, event)
		}
		return nil
	}); err != nil {
		return NodeHistoryChangeEventPage{}, err
	}

	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	events := selected.ItemsDescending()
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
	seen := make(map[string]NodeHistoryFieldOption)
	if err := streamNodeHistoryChangeEvents(db, uuid, selectedTargetID, startAt, endAt, "", func(event NodeHistoryChangeEvent) error {
		if _, ok := seen[event.FieldID]; ok {
			return nil
		}
		seen[event.FieldID] = NodeHistoryFieldOption{
			ID:    event.FieldID,
			Label: event.FieldOptionLabel,
		}
		return nil
	}); err != nil {
		return NodeHistoryFieldOptionList{}, err
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

type nodeHistoryEventRow struct {
	ID           uint
	NodeTargetID uint
	ResultJSON   string
	RecordedAt   time.Time
}

func streamNodeHistoryChangeEvents(
	db *gorm.DB,
	uuid string,
	selectedTargetID *uint,
	startAt, endAt *time.Time,
	fieldID string,
	visit func(NodeHistoryChangeEvent) error,
) error {
	_, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return err
	}
	_, scopedTargets, err := resolveHistoryTargetScope(targets, selectedTargetID)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return nil
	}

	targetByID := make(map[uint]models.NodeTarget, len(targets))
	for _, target := range targets {
		targetByID[target.ID] = target
	}
	targetScope := make([]uint, 0, len(scopedTargets))
	for _, target := range scopedTargets {
		targetScope = append(targetScope, target.ID)
	}
	normalizedFieldID := strings.TrimSpace(strings.ToLower(fieldID))
	var endBoundary time.Time
	hasEndBoundary := endAt != nil && !endAt.IsZero()
	if hasEndBoundary {
		endBoundary = endAt.UTC()
	}
	var startBoundary time.Time
	hasStartBoundary := startAt != nil && !startAt.IsZero()
	if hasStartBoundary {
		startBoundary = startAt.UTC()
	}

	query := db.Model(&models.NodeTargetHistory{}).
		Select("id", "node_target_id", "result_json", "recorded_at").
		Where("node_target_id IN ?", targetScope).
		Order("recorded_at ASC").
		Order("node_target_id ASC").
		Order("id ASC")
	if hasEndBoundary {
		query = query.Where("recorded_at <= ?", endBoundary)
	}

	rows, err := query.Rows()
	if err != nil {
		return err
	}
	defer rows.Close()

	previousStateByTarget := make(map[uint]map[string]DisplayFieldValue)
	previousStateSinceByTarget := make(map[uint]map[string]time.Time)

	for rows.Next() {
		var row nodeHistoryEventRow
		if err := db.ScanRows(rows, &row); err != nil {
			return err
		}

		currentValues, err := extractDisplayFieldValues(decodeResultJSON(row.ResultJSON))
		if err != nil {
			return err
		}
		currentMap := make(map[string]DisplayFieldValue, len(currentValues))
		for _, value := range currentValues {
			currentMap[value.ID] = value
		}
		previousState := previousStateByTarget[row.NodeTargetID]
		previousStateSince := previousStateSinceByTarget[row.NodeTargetID]
		ids := unionFieldIDs(previousState, currentMap)
		nextState := make(map[string]DisplayFieldValue, len(ids))
		nextStateSince := make(map[string]time.Time, len(ids))
		for _, id := range ids {
			currentValue, currentOk := currentMap[id]
			previousValue, previousOk := previousState[id]
			previousRecordedAtValue, previousRecordedAtOK := previousStateSince[id]
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
				nextState[id] = currentValue
				if previousRecordedAtOK && !previousRecordedAtValue.IsZero() {
					nextStateSince[id] = previousRecordedAtValue
				} else {
					nextStateSince[id] = row.RecordedAt
				}
				continue
			}
			nextState[id] = currentValue
			nextStateSince[id] = row.RecordedAt
			if hasStartBoundary && row.RecordedAt.Before(startBoundary) {
				continue
			}
			if normalizedFieldID != "" && id != normalizedFieldID {
				continue
			}
			target := targetByID[row.NodeTargetID]
			previousRecordedAt := ""
			if previousRecordedAtOK && !previousRecordedAtValue.IsZero() {
				previousRecordedAt = previousRecordedAtValue.Format(time.RFC3339)
			}
			if err := visit(NodeHistoryChangeEvent{
				ID:                 strconvID(row.ID) + ":" + id,
				TargetID:           row.NodeTargetID,
				TargetIP:           target.TargetIP,
				FieldID:            id,
				GroupPath:          append([]string{}, currentValue.GroupPath...),
				FieldLabel:         currentValue.Label,
				FieldOptionLabel:   buildDisplayFieldOptionLabel(currentValue),
				Previous:           previousValue,
				Current:            currentValue,
				PreviousRecordedAt: previousRecordedAt,
				RecordedAt:         row.RecordedAt,
			}); err != nil {
				return err
			}
		}
		previousStateByTarget[row.NodeTargetID] = nextState
		previousStateSinceByTarget[row.NodeTargetID] = nextStateSince
	}

	return rows.Err()
}

type historyEventTopKHeap []NodeHistoryChangeEvent

func (h historyEventTopKHeap) Len() int { return len(h) }

func (h historyEventTopKHeap) Less(i, j int) bool {
	return compareHistoryEventOrder(h[i], h[j]) < 0
}

func (h historyEventTopKHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
}

func (h *historyEventTopKHeap) Push(value any) {
	*h = append(*h, value.(NodeHistoryChangeEvent))
}

func (h *historyEventTopKHeap) Pop() any {
	old := *h
	last := len(old) - 1
	value := old[last]
	*h = old[:last]
	return value
}

func (h historyEventTopKHeap) ItemsDescending() []NodeHistoryChangeEvent {
	items := append([]NodeHistoryChangeEvent{}, h...)
	sort.Slice(items, func(i, j int) bool {
		return compareHistoryEventOrder(items[i], items[j]) > 0
	})
	return items
}

func compareHistoryEventOrder(left, right NodeHistoryChangeEvent) int {
	if left.RecordedAt.After(right.RecordedAt) {
		return 1
	}
	if left.RecordedAt.Before(right.RecordedAt) {
		return -1
	}
	if cmp := strings.Compare(left.TargetIP, right.TargetIP); cmp != 0 {
		if cmp < 0 {
			return 1
		}
		return -1
	}
	if cmp := strings.Compare(left.FieldOptionLabel, right.FieldOptionLabel); cmp != 0 {
		if cmp < 0 {
			return 1
		}
		return -1
	}
	if cmp := strings.Compare(left.ID, right.ID); cmp != 0 {
		if cmp < 0 {
			return 1
		}
		return -1
	}
	return 0
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
