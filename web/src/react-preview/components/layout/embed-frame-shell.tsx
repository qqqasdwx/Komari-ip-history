import { type CSSProperties, type ReactNode, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export function getEmbedTheme(searchParams: URLSearchParams) {
  const theme = (searchParams.get("komari_theme") || "").trim().toLowerCase();
  if (theme.includes("purcarte")) {
    return "purcarte";
  }
  return "default";
}

export function getEmbedAppearance(searchParams: URLSearchParams) {
  const appearance = (searchParams.get("komari_appearance") || "").trim().toLowerCase();
  return appearance === "dark" ? "dark" : "light";
}

function sanitizeEmbedCSSValue(value: string | null) {
  const text = (value || "").trim();
  if (!text || /[;{}]/.test(text) || /url\s*\(/i.test(text)) {
    return "";
  }
  return text;
}

export function getEmbedGlassStyle(searchParams: URLSearchParams): CSSProperties | undefined {
  if (getEmbedTheme(searchParams) !== "purcarte") {
    return undefined;
  }

  const style = {} as CSSProperties & Record<string, string>;
  const blurParam = (searchParams.get("komari_blur") || "").trim();
  const blurValue = Number(blurParam.replace(/px$/i, ""));
  if (Number.isFinite(blurValue)) {
    style["--ipq-purcarte-blur"] = `${Math.max(0, Math.min(40, blurValue))}px`;
  }

  const card = sanitizeEmbedCSSValue(searchParams.get("komari_card"));
  if (card) {
    style["--ipq-purcarte-card"] = card;
  }

  return style;
}

export function EmbedFrameShell(props: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const embedTheme = getEmbedTheme(searchParams);
  const embedAppearance = getEmbedAppearance(searchParams);
  const embedGlassStyle = getEmbedGlassStyle(searchParams);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (!isEmbed) {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
      return;
    }

    root.dataset.ipqEmbedTheme = embedTheme;
    body.dataset.ipqEmbedTheme = embedTheme;
    root.dataset.ipqEmbedAppearance = embedAppearance;
    body.dataset.ipqEmbedAppearance = embedAppearance;

    return () => {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
    };
  }, [embedAppearance, embedTheme, isEmbed]);

  if (!isEmbed) {
    return <>{props.children}</>;
  }

  return (
    <div
      className={`embed-shell embed-theme-${embedTheme} embed-appearance-${embedAppearance} bg-slate-50 text-slate-900`}
      style={embedGlassStyle}
    >
      <div className="embed-panel mx-auto max-w-[1120px] space-y-6">{props.children}</div>
    </div>
  );
}
