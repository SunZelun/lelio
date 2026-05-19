import { app, crashReporter } from "electron";
import type { JsonlLogger } from "../logging/logger";
import { redactError } from "../logging/redaction";

export function startLocalCrashReporter(): void {
  crashReporter.start({
    uploadToServer: false,
    submitURL: "",
    compress: false
  });
}

export function registerLocalCrashHandlers(logger: JsonlLogger): void {
  app.on("render-process-gone", (_event, _webContents, details) => {
    logger.error({
      source: "crash",
      eventName: "renderer.process_gone",
      message: "Renderer process exited unexpectedly",
      metadata: details
    });
  });

  app.on("child-process-gone", (_event, details) => {
    logger.error({
      source: "crash",
      eventName: "child.process_gone",
      message: "Child process exited unexpectedly",
      metadata: details
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error({
      source: "crash",
      eventName: "main.uncaught_exception",
      message: error.message,
      metadata: redactError(error)
    });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({
      source: "crash",
      eventName: "main.unhandled_rejection",
      message: reason instanceof Error ? reason.message : "Unhandled main-process promise rejection",
      metadata: redactError(reason)
    });
  });
}
