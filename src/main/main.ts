import { app, BrowserWindow, globalShortcut } from "electron";
import path from "node:path";
import { ApprovalStore } from "./approvals/approvalStore";
import { QuickChatStore } from "./chat/quickChatStore";
import { ReviewChannelStore } from "./chat/reviewChannelStore";
import { openDatabase } from "./db/connection";
import { registerIpcHandlers } from "./ipc/handlers";
import { JsonlLogger } from "./logging/logger";
import { ProjectMemoryStore } from "./memory/projectMemoryStore";
import { ensureLelioDirectories, getLelioPaths } from "./paths";
import { registerGlobalQuickOpen } from "./polish/globalQuickOpen";
import { registerLocalCrashHandlers, startLocalCrashReporter } from "./polish/localCrashReporting";
import { NotificationService } from "./polish/notificationService";
import { applyPendingRestore, Phase9Store } from "./polish/phase9Store";
import { ProjectStore } from "./projects/projectStore";
import { RuntimeRegistry } from "./runtime/runtimeRegistry";
import { CopilotSdkAdapter } from "./runtime/copilotSdkAdapter";
import { OpenAiCompatibleAdapter } from "./runtime/openAiCompatibleAdapter";
import { SessionStore } from "./sessions/sessionStore";
import { SettingsStore } from "./settings/settingsStore";
import { TaskStore } from "./tasks/taskStore";

let mainWindow: BrowserWindow | null = null;

startLocalCrashReporter();

function createWindow(): void {
  const preloadPath = path.join(__dirname, "../preload/preload.cjs");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: "Lelio",
    backgroundColor: "#111316",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.setName("Lelio");

app.whenReady().then(() => {
  const paths = getLelioPaths();
  ensureLelioDirectories(paths);

  const logger = new JsonlLogger(paths.logsRoot, "info", 14);
  registerLocalCrashHandlers(logger);
  applyPendingRestore(paths, logger);
  logger.info({
    source: "app",
    eventName: "app.startup",
    message: "Lelio starting",
    metadata: {
      appDataRoot: paths.appDataRoot,
      logsRoot: paths.logsRoot,
      electron: process.versions.electron,
      node: process.versions.node
    }
  });

  const database = openDatabase(paths.databasePath, logger);
  const settingsStore = new SettingsStore(paths);
  const settings = settingsStore.get();
  logger.setLevel(settings.logLevel);
  logger.setRetentionDays(settings.logRetentionDays);

  const runtimeRegistry = new RuntimeRegistry(database.db, logger);
  const projectStore = new ProjectStore(database.db, logger);
  const taskStore = new TaskStore(database.db, logger);
  const memoryStore = new ProjectMemoryStore(database.db, logger, paths);
  const notificationService = new NotificationService(logger);
  const approvalStore = new ApprovalStore(database.db, logger, undefined, (approval) => notificationService.notifyApprovalPending(approval));
  approvalStore.cancelAllPending("app_startup", "app-startup");
  const copilotAdapter = new CopilotSdkAdapter(logger, runtimeRegistry, () => settingsStore.get());
  const openAiAdapter = new OpenAiCompatibleAdapter(() => settingsStore.getInternal());
  const quickChatStore = new QuickChatStore(database.db, logger, settingsStore, openAiAdapter);
  const reviewChannelStore = new ReviewChannelStore(database.db, logger, settingsStore, openAiAdapter);
  const sessionStore = new SessionStore(database.db, logger, taskStore, copilotAdapter, memoryStore, approvalStore, undefined, notificationService);
  const phase9Store = new Phase9Store(
    database.db,
    paths,
    settingsStore,
    projectStore,
    logger,
    app.getVersion(),
    registerGlobalQuickOpen(logger, () => mainWindow)
  );

  registerIpcHandlers({
    db: database.db,
    databasePath: database.databasePath,
    paths,
    logger,
    settingsStore,
    runtimeRegistry,
    projectStore,
    taskStore,
    sessionStore,
    memoryStore,
    quickChatStore,
    reviewChannelStore,
    approvalStore,
    phase9Store,
    notificationService
  });

  app.on("before-quit", () => {
    void sessionStore.stop();
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
