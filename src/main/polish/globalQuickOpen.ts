import { app, globalShortcut, type BrowserWindow } from "electron";
import type { UpdateStrategy } from "../../shared/schemas";
import type { JsonlLogger } from "../logging/logger";

const QUICK_OPEN_ACCELERATOR = "CommandOrControl+Shift+L";

export function registerGlobalQuickOpen(
  logger: JsonlLogger,
  getWindow: () => BrowserWindow | null
): () => UpdateStrategy["globalQuickOpen"] {
  let registered = false;
  let reason: string | null = null;

  try {
    registered = globalShortcut.register(QUICK_OPEN_ACCELERATOR, () => {
      const window = getWindow();
      if (!window) {
        return;
      }
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
      app.focus({ steal: true });
    });
    reason = registered ? null : "Shortcut is already in use by another application.";
  } catch (error) {
    reason = error instanceof Error ? error.message : "Unable to register global shortcut.";
  }

  logger.info({
    source: "shortcut",
    eventName: "shortcut.quick_open.register",
    message: registered ? "Global quick open shortcut registered" : "Global quick open shortcut unavailable",
    metadata: { accelerator: QUICK_OPEN_ACCELERATOR, registered, reason }
  });

  return () => ({
    accelerator: QUICK_OPEN_ACCELERATOR,
    registered,
    reason
  });
}
