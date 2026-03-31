import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "./styles.css";
import { App } from "./App";

export function bootReactPreview() {
  const rootElement = document.querySelector<HTMLDivElement>("#app");
  if (!rootElement) {
    throw new Error("missing app container");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <Theme accentColor="indigo" grayColor="slate" radius="large" scaling="100%">
        <HashRouter>
          <App />
        </HashRouter>
      </Theme>
    </StrictMode>
  );
}
