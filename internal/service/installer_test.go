package service

import (
	"strings"
	"testing"

	"komari-ip-history/internal/config"
)

func TestResolveInstallerScriptSourceUsesReleaseTag(t *testing.T) {
	source := ResolveInstallerScriptSource(config.Config{
		AppVersion: "v1.2.3",
		AppCommit:  "abc123",
	})

	if source.Channel != "release" {
		t.Fatalf("expected release channel, got %q", source.Channel)
	}
	if source.Ref != "v1.2.3" {
		t.Fatalf("expected release ref, got %q", source.Ref)
	}
	if strings.Contains(source.URL, "/master/") {
		t.Fatalf("release installer URL must not use master: %s", source.URL)
	}
	if !strings.HasSuffix(source.URL, "/v1.2.3/deploy/install.sh") {
		t.Fatalf("expected installer URL to use version tag, got %s", source.URL)
	}
	if source.Commit != "abc123" {
		t.Fatalf("expected commit to be preserved, got %q", source.Commit)
	}
}

func TestResolveInstallerScriptSourceDistinguishesLatestAndDevelopment(t *testing.T) {
	latest := ResolveInstallerScriptSource(config.Config{AppVersion: "latest"})
	if latest.Channel != "latest" || latest.Ref != "master" {
		t.Fatalf("expected latest to use master with latest channel, got %#v", latest)
	}

	development := ResolveInstallerScriptSource(config.Config{AppVersion: "dev"})
	if development.Channel != "development" || development.Ref != "master" {
		t.Fatalf("expected development to use master with development channel, got %#v", development)
	}
}

func TestResolveInstallerScriptSourceAllowsOverrideURL(t *testing.T) {
	source := ResolveInstallerScriptSource(config.Config{
		AppVersion:         "v1.2.3",
		InstallerScriptURL: "https://example.test/install.sh",
	})

	if source.Channel != "custom" {
		t.Fatalf("expected custom channel, got %q", source.Channel)
	}
	if source.URL != "https://example.test/install.sh" {
		t.Fatalf("expected custom URL, got %s", source.URL)
	}
}
