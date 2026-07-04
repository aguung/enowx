import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Desktop } from "./os/Desktop";
import { DialogProvider } from "./os/dialog";
import { ContextMenuProvider } from "./os/contextmenu";
import { AuthGate } from "./os/AuthGate";
import { RequireDesktop } from "./os/RequireDesktop";
import { connectLive } from "./os/liveBus";

// Open the single live event stream as soon as the app boots, so no feature ever
// misses an event because it mounted after an action fired (the bug where a
// comment's count didn't update until refresh). EventSource retries until the
// user is authenticated.
connectLive();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ContextMenuProvider>
      <DialogProvider>
        <AuthGate>
          <RequireDesktop>
            <Desktop />
          </RequireDesktop>
        </AuthGate>
      </DialogProvider>
    </ContextMenuProvider>
  </StrictMode>
);
