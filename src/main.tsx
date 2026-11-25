import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { useApp } from "./store/app";
import { useProject } from "./store/project";
import * as actions from "./features/generate/actions";
import * as fileOps from "./features/project/fileOps";
import "./styles.css";

// Handles for debugging and scripted E2E checks through the WebView's DevTools protocol.
(window as unknown as Record<string, unknown>).__speechorus = { useApp, useProject, actions, fileOps };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
