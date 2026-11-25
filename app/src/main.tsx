import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles/theme.css";
import "./styles/brand.css";
import { App } from "./App";
import { installKeyboardHandling } from "./lib/softKeyboard";
import { installSquircles } from "./lib/squircle";
import { AppProvider } from "./state";

installKeyboardHandling();
installSquircles();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
