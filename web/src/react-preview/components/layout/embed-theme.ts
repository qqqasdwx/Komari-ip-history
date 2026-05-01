import type { CSSProperties } from "react";

export type EmbedTheme = "default" | "purcarte";
export type EmbedAppearance = "light" | "dark";

export const embedThemeCSSVariables = [
  "--ipq-embed-bg",
  "--ipq-embed-canvas",
  "--ipq-embed-surface",
  "--ipq-embed-card",
  "--ipq-embed-card-muted",
  "--ipq-embed-border",
  "--ipq-embed-text",
  "--ipq-embed-muted",
  "--ipq-embed-accent",
  "--ipq-embed-accent-soft",
  "--ipq-embed-accent-strong",
  "--ipq-embed-accent-contrast",
  "--ipq-purcarte-blur",
  "--ipq-purcarte-card",
  "--ipq-purcarte-canvas",
  "--ipq-purcarte-shell",
  "--ipq-purcarte-card-muted",
  "--ipq-purcarte-card-hover",
  "--ipq-purcarte-theme-shadow",
  "--ipq-purcarte-radius",
  "--ipq-purcarte-inner-card",
  "--ipq-purcarte-text",
  "--ipq-purcarte-muted",
  "--ipq-purcarte-inner-border",
  "--ipq-purcarte-inner-shadow",
  "--ipq-purcarte-accent",
  "--ipq-purcarte-accent-soft",
  "--ipq-purcarte-accent-soft-hover",
  "--ipq-purcarte-accent-strong",
  "--ipq-purcarte-accent-contrast"
] as const;

const hostThemeParamMap = [
  ["komari_bg", "--ipq-embed-bg"],
  ["komari_canvas", "--ipq-embed-canvas"],
  ["komari_surface", "--ipq-embed-surface"],
  ["komari_card", "--ipq-embed-card"],
  ["komari_card_muted", "--ipq-embed-card-muted"],
  ["komari_border", "--ipq-embed-border"],
  ["komari_text", "--ipq-embed-text"],
  ["komari_muted", "--ipq-embed-muted"],
  ["komari_accent_color", "--ipq-embed-accent"],
  ["komari_accent_soft", "--ipq-embed-accent-soft"],
  ["komari_accent_strong", "--ipq-embed-accent-strong"],
  ["komari_accent_contrast", "--ipq-embed-accent-contrast"]
] as const;

const purcarteParamMap = [
  ["komari_surface", "--ipq-purcarte-shell"],
  ["komari_purcarte_card_muted", "--ipq-purcarte-card-muted"],
  ["komari_purcarte_card_hover", "--ipq-purcarte-card-hover"],
  ["komari_theme_shadow", "--ipq-purcarte-theme-shadow"],
  ["komari_radius", "--ipq-purcarte-radius"],
  ["komari_purcarte_inner_card", "--ipq-purcarte-inner-card"],
  ["komari_purcarte_inner_border", "--ipq-purcarte-inner-border"],
  ["komari_purcarte_inner_shadow", "--ipq-purcarte-inner-shadow"],
  ["komari_purcarte_text", "--ipq-purcarte-text"],
  ["komari_purcarte_muted", "--ipq-purcarte-muted"],
  ["komari_text", "--ipq-purcarte-text"],
  ["komari_muted", "--ipq-purcarte-muted"],
  ["komari_border", "--ipq-purcarte-inner-border"],
  ["komari_accent_color", "--ipq-purcarte-accent"],
  ["komari_accent_strong", "--ipq-purcarte-accent-strong"],
  ["komari_accent_contrast", "--ipq-purcarte-accent-contrast"]
] as const;

function sanitizeEmbedCSSValue(value: string | null) {
  const text = (value || "").trim();
  if (!text || /[;{}]/.test(text) || /url\s*\(/i.test(text)) {
    return "";
  }
  return text;
}

export function getEmbedTheme(searchParams: URLSearchParams): EmbedTheme {
  const theme = (searchParams.get("komari_theme") || "").trim().toLowerCase();
  return theme.includes("purcarte") ? "purcarte" : "default";
}

export function getEmbedAppearance(searchParams: URLSearchParams): EmbedAppearance {
  const appearance = (searchParams.get("komari_appearance") || "").trim().toLowerCase();
  return appearance === "dark" ? "dark" : "light";
}

export function getEmbedThemeStyle(searchParams: URLSearchParams): CSSProperties | undefined {
  const style = {} as CSSProperties & Record<string, string>;
  for (const [param, variable] of hostThemeParamMap) {
    const value = sanitizeEmbedCSSValue(searchParams.get(param));
    if (value) {
      style[variable] = value;
    }
  }

  if (getEmbedTheme(searchParams) !== "purcarte") {
    return Object.keys(style).length > 0 ? style : undefined;
  }

  const blurParam = (searchParams.get("komari_blur") || "").trim();
  const blurValue = Number(blurParam.replace(/px$/i, ""));
  if (Number.isFinite(blurValue)) {
    style["--ipq-purcarte-blur"] = `${Math.max(0, Math.min(40, blurValue))}px`;
  }

  const purcarteCard = sanitizeEmbedCSSValue(
    searchParams.get("komari_purcarte_card") || searchParams.get("komari_card")
  );
  if (purcarteCard) {
    style["--ipq-purcarte-card"] = purcarteCard;
  }

  const canvas = sanitizeEmbedCSSValue(searchParams.get("komari_canvas"));
  if (canvas) {
    style["--ipq-purcarte-canvas"] = canvas;
  }

  for (const [param, variable] of purcarteParamMap) {
    const value = sanitizeEmbedCSSValue(searchParams.get(param));
    if (value) {
      style[variable] = value;
    }
  }

  const accentSoft = sanitizeEmbedCSSValue(searchParams.get("komari_accent_soft"));
  if (accentSoft) {
    style["--ipq-purcarte-accent-soft"] = accentSoft;
    style["--ipq-purcarte-accent-soft-hover"] = accentSoft;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}
