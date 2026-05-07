package service

import (
	"fmt"
	"strings"
	"unicode"

	"komari-ip-history/internal/config"
)

const defaultInstallerRawBaseURL = "https://raw.githubusercontent.com/qqqasdwx/Komari-ip-history"

type InstallerScriptSource struct {
	URL     string `json:"url"`
	Ref     string `json:"ref"`
	Version string `json:"version"`
	Commit  string `json:"commit"`
	Channel string `json:"channel"`
	Label   string `json:"label"`
}

func ResolveInstallerScriptSource(cfg config.Config) InstallerScriptSource {
	appVersion := strings.TrimSpace(cfg.AppVersion)
	if appVersion == "" {
		appVersion = "dev"
	}
	appCommit := strings.TrimSpace(cfg.AppCommit)

	if overrideURL := strings.TrimSpace(cfg.InstallerScriptURL); overrideURL != "" {
		return InstallerScriptSource{
			URL:     overrideURL,
			Ref:     strings.TrimSpace(cfg.InstallerScriptRef),
			Version: appVersion,
			Commit:  appCommit,
			Channel: "custom",
			Label:   "custom script",
		}
	}

	ref := strings.TrimSpace(cfg.InstallerScriptRef)
	channel := "development"
	label := "development default branch"
	if ref != "" {
		channel = "custom-ref"
		label = "custom ref " + ref
	} else if isReleaseVersion(appVersion) {
		ref = appVersion
		channel = "release"
		label = "version " + appVersion
	} else if strings.EqualFold(appVersion, "latest") {
		ref = "master"
		channel = "latest"
		label = "latest default branch"
	} else {
		ref = "master"
	}

	return InstallerScriptSource{
		URL:     fmt.Sprintf("%s/%s/deploy/install.sh", defaultInstallerRawBaseURL, ref),
		Ref:     ref,
		Version: appVersion,
		Commit:  appCommit,
		Channel: channel,
		Label:   label,
	}
}

func isReleaseVersion(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 2 || value[0] != 'v' {
		return false
	}
	return unicode.IsDigit(rune(value[1]))
}
