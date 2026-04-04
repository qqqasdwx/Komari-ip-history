package service

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"github.com/robfig/cron/v3"
	"gorm.io/gorm"
)

const defaultReporterScheduleCron = "0 0 * * *"

var reporterCronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

type UpdateNodeReportConfigInput struct {
	ScheduleCron   string `json:"schedule_cron"`
	RunImmediately bool   `json:"run_immediately"`
}

type NodeReportConfigPreview struct {
	ScheduleCron   string      `json:"schedule_cron"`
	RunImmediately bool        `json:"run_immediately"`
	NextRuns       []time.Time `json:"next_runs"`
}

func normalizeReporterSchedule(node models.Node) (string, bool) {
	scheduleCron := strings.TrimSpace(node.ReporterScheduleCron)
	if scheduleCron == "" {
		scheduleCron = defaultReporterScheduleCron
	}
	runImmediately := true
	if node.ReporterToken != "" || node.ReporterScheduleCron != "" || node.ReporterRunImmediately {
		runImmediately = node.ReporterRunImmediately
	}
	return scheduleCron, runImmediately
}

func parseReporterSchedule(scheduleCron string) (string, cron.Schedule, error) {
	normalized := strings.TrimSpace(scheduleCron)
	if normalized == "" {
		normalized = defaultReporterScheduleCron
	}
	schedule, err := reporterCronParser.Parse(normalized)
	if err != nil {
		return "", nil, errors.New("invalid cron expression")
	}
	return normalized, schedule, nil
}

func computeReporterNextRuns(schedule cron.Schedule, now time.Time, count int) []time.Time {
	if count <= 0 {
		return []time.Time{}
	}
	runs := make([]time.Time, 0, count)
	cursor := now
	for len(runs) < count {
		cursor = schedule.Next(cursor)
		runs = append(runs, cursor.UTC())
	}
	return runs
}

func previewNodeReportConfig(scheduleCron string, runImmediately bool, now time.Time) (NodeReportConfigPreview, error) {
	normalized, schedule, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return NodeReportConfigPreview{}, err
	}
	return NodeReportConfigPreview{
		ScheduleCron:   normalized,
		RunImmediately: runImmediately,
		NextRuns:       computeReporterNextRuns(schedule, now.UTC(), 10),
	}, nil
}

func buildNodeReportConfig(node models.Node, targetIPs []string) (NodeReportConfig, error) {
	scheduleCron, runImmediately := normalizeReporterSchedule(node)
	preview, err := previewNodeReportConfig(scheduleCron, runImmediately, time.Now().UTC())
	if err != nil {
		return NodeReportConfig{}, err
	}
	return NodeReportConfig{
		EndpointPath:   "/api/v1/report/nodes/" + node.KomariNodeUUID,
		InstallerPath:  "/api/v1/report/nodes/" + node.KomariNodeUUID + "/install.sh",
		ReporterToken:  node.ReporterToken,
		TargetIPs:      targetIPs,
		ScheduleCron:   preview.ScheduleCron,
		RunImmediately: preview.RunImmediately,
		NextRuns:       preview.NextRuns,
	}, nil
}

func GetNodeReportConfigPreview(db *gorm.DB, uuid string, scheduleCron string, runImmediately *bool) (NodeReportConfigPreview, error) {
	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		return NodeReportConfigPreview{}, err
	}
	storedCron, storedRunImmediately := normalizeReporterSchedule(node)
	if strings.TrimSpace(scheduleCron) == "" {
		scheduleCron = storedCron
	}
	nextRunImmediately := storedRunImmediately
	if runImmediately != nil {
		nextRunImmediately = *runImmediately
	}
	return previewNodeReportConfig(scheduleCron, nextRunImmediately, time.Now().UTC())
}

func UpdateNodeReportConfig(db *gorm.DB, uuid string, input UpdateNodeReportConfigInput) (NodeReportConfig, error) {
	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		return NodeReportConfig{}, err
	}
	preview, err := previewNodeReportConfig(input.ScheduleCron, input.RunImmediately, time.Now().UTC())
	if err != nil {
		return NodeReportConfig{}, err
	}
	if err := db.Model(&node).Updates(map[string]any{
		"reporter_schedule_cron":   preview.ScheduleCron,
		"reporter_run_immediately": preview.RunImmediately,
	}).Error; err != nil {
		return NodeReportConfig{}, err
	}

	_, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return NodeReportConfig{}, err
	}
	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}

	config, err := buildNodeReportConfig(node, targetIPs)
	if err != nil {
		return NodeReportConfig{}, err
	}
	config.ScheduleCron = preview.ScheduleCron
	config.RunImmediately = preview.RunImmediately
	config.NextRuns = preview.NextRuns
	return config, nil
}

func ParseOptionalRunImmediately(raw string) (*bool, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, nil
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		result := true
		return &result, nil
	case "0", "false", "no", "off":
		result := false
		return &result, nil
	default:
		return nil, fmt.Errorf("invalid run_immediately value: %s", strconv.Quote(value))
	}
}
