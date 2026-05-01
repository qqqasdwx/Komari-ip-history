import { type ReactNode, useLayoutEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  embedThemeCSSVariables,
  getEmbedAppearance,
  getEmbedTheme,
  getEmbedThemeStyle
} from "./embed-theme";

export function EmbedFrameShell(props: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const searchKey = searchParams.toString();
  const embedThemeState = useMemo(() => {
    const stableParams = new URLSearchParams(searchKey);
    return {
      theme: getEmbedTheme(stableParams),
      appearance: getEmbedAppearance(stableParams),
      style: getEmbedThemeStyle(stableParams)
    };
  }, [searchKey]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (!isEmbed) {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
      return;
    }

    root.dataset.ipqEmbedTheme = embedThemeState.theme;
    body.dataset.ipqEmbedTheme = embedThemeState.theme;
    root.dataset.ipqEmbedAppearance = embedThemeState.appearance;
    body.dataset.ipqEmbedAppearance = embedThemeState.appearance;
    Object.entries(embedThemeState.style || {}).forEach(([name, value]) => {
      if (typeof value !== "string") return;
      root.style.setProperty(name, value);
      body.style.setProperty(name, value);
    });

    return () => {
      delete root.dataset.ipqEmbedTheme;
      delete body.dataset.ipqEmbedTheme;
      delete root.dataset.ipqEmbedAppearance;
      delete body.dataset.ipqEmbedAppearance;
      embedThemeCSSVariables.forEach((name) => {
        root.style.removeProperty(name);
        body.style.removeProperty(name);
      });
    };
  }, [embedThemeState, isEmbed]);

  if (!isEmbed) {
    return <>{props.children}</>;
  }

  return (
    <div
      className={`embed-shell embed-theme-${embedThemeState.theme} embed-appearance-${embedThemeState.appearance} bg-slate-50 text-slate-900`}
      style={embedThemeState.style}
    >
      <div className="embed-panel mx-auto max-w-[1120px] space-y-6">{props.children}</div>
    </div>
  );
}
