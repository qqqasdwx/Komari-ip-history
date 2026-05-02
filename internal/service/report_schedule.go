package service

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"komari-ip-history/internal/models"

	"github.com/robfig/cron/v3"
	"gorm.io/gorm"
)

const defaultReporterScheduleCron = "0 0 * * *"
const defaultReporterScheduleTimezone = "UTC"

var reporterCronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

type UpdateNodeReportConfigInput struct {
	ScheduleCron     string `json:"schedule_cron"`
	ScheduleTimezone string `json:"schedule_timezone"`
	RunImmediately   bool   `json:"run_immediately"`
}

type NodeReportConfigPreview struct {
	ScheduleCron     string      `json:"schedule_cron"`
	ScheduleTimezone string      `json:"schedule_timezone"`
	RunImmediately   bool        `json:"run_immediately"`
	NextRuns         []time.Time `json:"next_runs"`
}

func normalizeReporterSchedule(node models.Node) (string, string, bool) {
	scheduleCron := strings.TrimSpace(node.ReporterScheduleCron)
	if scheduleCron == "" {
		scheduleCron = defaultReporterScheduleCron
	}
	scheduleTimezone := strings.TrimSpace(node.ReporterScheduleTimezone)
	runImmediately := true
	if node.ReporterToken != "" || node.ReporterScheduleCron != "" || node.ReporterRunImmediately {
		runImmediately = node.ReporterRunImmediately
	}
	return scheduleCron, scheduleTimezone, runImmediately
}

func normalizeReporterScheduleTimezone(scheduleTimezone string) (string, *time.Location, error) {
	normalized := strings.TrimSpace(scheduleTimezone)
	if normalized == "" {
		normalized = defaultReporterScheduleTimezone
	}
	location, err := time.LoadLocation(normalized)
	if err != nil {
		return "", nil, errors.New("invalid timezone")
	}
	return normalized, location, nil
}

func parseReporterSchedule(scheduleCron string, scheduleTimezone string) (string, string, *time.Location, cron.Schedule, error) {
	normalized := strings.TrimSpace(scheduleCron)
	if normalized == "" {
		normalized = defaultReporterScheduleCron
	}
	normalizedTimezone, location, err := normalizeReporterScheduleTimezone(scheduleTimezone)
	if err != nil {
		return "", "", nil, nil, err
	}
	schedule, err := reporterCronParser.Parse(normalized)
	if err != nil {
		return "", "", nil, nil, errors.New("invalid cron expression")
	}
	return normalized, normalizedTimezone, location, schedule, nil
}

func computeReporterNextRuns(schedule cron.Schedule, now time.Time, location *time.Location, count int) []time.Time {
	if count <= 0 {
		return []time.Time{}
	}
	runs := make([]time.Time, 0, count)
	cursor := now.In(location)
	for len(runs) < count {
		cursor = schedule.Next(cursor)
		runs = append(runs, cursor)
	}
	return runs
}

func previewNodeReportConfig(scheduleCron string, scheduleTimezone string, runImmediately bool, now time.Time) (NodeReportConfigPreview, error) {
	normalized, normalizedTimezone, location, schedule, err := parseReporterSchedule(scheduleCron, scheduleTimezone)
	if err != nil {
		return NodeReportConfigPreview{}, err
	}
	return NodeReportConfigPreview{
		ScheduleCron:     normalized,
		ScheduleTimezone: normalizedTimezone,
		RunImmediately:   runImmediately,
		NextRuns:         computeReporterNextRuns(schedule, now.UTC(), location, 10),
	}, nil
}

func buildNodeReportConfig(node models.Node, targetIPs []string) (NodeReportConfig, error) {
	scheduleCron, scheduleTimezone, runImmediately := normalizeReporterSchedule(node)
	preview, err := previewNodeReportConfig(scheduleCron, scheduleTimezone, runImmediately, time.Now().UTC())
	if err != nil {
		return NodeReportConfig{}, err
	}
	routeUUID := nodeRouteUUID(node)
	return NodeReportConfig{
		EndpointPath:     "/api/v1/report/nodes/" + routeUUID,
		InstallerPath:    "/api/v1/report/nodes/" + routeUUID + "/install.sh",
		ReporterToken:    node.ReporterToken,
		InstallToken:     node.InstallToken,
		TargetIPs:        targetIPs,
		ScheduleCron:     preview.ScheduleCron,
		ScheduleTimezone: strings.TrimSpace(scheduleTimezone),
		RunImmediately:   preview.RunImmediately,
		NextRuns:         preview.NextRuns,
	}, nil
}

func GetNodeReportConfigPreview(db *gorm.DB, uuid string, scheduleCron string, scheduleTimezone string, runImmediately *bool) (NodeReportConfigPreview, error) {
	node, err := loadNodeByUUID(db, uuid)
	if err != nil {
		return NodeReportConfigPreview{}, err
	}
	storedCron, storedTimezone, storedRunImmediately := normalizeReporterSchedule(node)
	if strings.TrimSpace(scheduleCron) == "" {
		scheduleCron = storedCron
	}
	if strings.TrimSpace(scheduleTimezone) == "" {
		scheduleTimezone = storedTimezone
	}
	nextRunImmediately := storedRunImmediately
	if runImmediately != nil {
		nextRunImmediately = *runImmediately
	}
	return previewNodeReportConfig(scheduleCron, scheduleTimezone, nextRunImmediately, time.Now().UTC())
}

func UpdateNodeReportConfig(db *gorm.DB, uuid string, input UpdateNodeReportConfigInput) (NodeReportConfig, error) {
	node, err := loadNodeByUUID(db, uuid)
	if err != nil {
		return NodeReportConfig{}, err
	}
	preview, err := previewNodeReportConfig(input.ScheduleCron, input.ScheduleTimezone, input.RunImmediately, time.Now().UTC())
	if err != nil {
		return NodeReportConfig{}, err
	}
	if err := db.Model(&node).Updates(map[string]any{
		"reporter_schedule_cron":     preview.ScheduleCron,
		"reporter_schedule_timezone": preview.ScheduleTimezone,
		"reporter_run_immediately":   preview.RunImmediately,
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
	config.ScheduleTimezone = preview.ScheduleTimezone
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
