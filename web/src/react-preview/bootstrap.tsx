import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";

export function bootReactPreview() {
  const rootElement = document.querySelector<HTMLDivElement>("#app");
  if (!rootElement) {
    throw new Error("missing app container");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>
  );
}
