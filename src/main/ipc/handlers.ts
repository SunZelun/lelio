import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { IpcChannel, IpcFailure, IpcRequest, IpcResult } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc";
import {
  ApprovalDecisionInputSchema,
  ApprovalListInputSchema,
  BackupCreateInputSchema,
  BackupRestoreInputSchema,
  CleanupExecuteInputSchema,
  ProjectAnalyzeInputSchema,
  ProjectCreateSchema,
  ProjectIdSchema,
  ProjectSkillLinkSchema,
  ProjectUpdateSchema,
  RendererErrorSchema,
  SettingsPatchSchema,
  SkillCreateSchema,
  SkillIdSchema,
  SkillUpdateSchema,
  AgentSkillLinkSchema,
  ChannelMessagesInputSchema,
  SessionDetailInputSchema,
  SessionIdActionSchema,
  SessionTaskActionSchema,
  QuickChatCancelSchema,
  QuickChatRequestSchema,
  ReviewRoundRequestSchema,
  ReviewSynthesisRequestSchema,
  TaskCreateSchema,
  TaskIdSchema,
  TaskUpdateSchema,
  type ApprovalDecisionInput,
  type ApprovalListInput,
  type BackupCreateInput,
  type BackupRestoreInput,
  type CleanupExecuteInput,
  type ProjectCreateInput,
  type ProjectIdInput,
  type ProjectSkillLinkInput,
  type ProjectUpdateInput,
  type ProjectAnalyzeInput,
  type AppSettingsPatch,
  type RendererErrorPayload,
  type SkillCreateInput,
  type SkillIdInput,
  type SkillUpdateInput,
  type AgentSkillLinkInput,
  type ChannelMessagesInput,
  type SessionDetailInput,
  type SessionIdActionInput,
  type SessionTaskActionInput,
  type QuickChatCancelInput,
  type QuickChatRequest,
  type ReviewRoundRequest,
  type ReviewSynthesisRequest,
  type TaskCreateInput,
  type TaskIdInput,
  type TaskUpdateInput
} from "../../shared/schemas";
import { getDatabaseHealth, listAgents, listChannels } from "../db/schema";
import { exportDiagnostics } from "../logging/diagnosticsExport";
import { createCorrelationId, type JsonlLogger } from "../logging/logger";
import { redactError } from "../logging/redaction";
import type { LelioPaths } from "../paths";
import type { RuntimeRegistry } from "../runtime/runtimeRegistry";
import type { SettingsStore } from "../settings/settingsStore";
import type { SqliteDatabase } from "../db/sqlite";
import type { ProjectStore } from "../projects/projectStore";
import { analyzeProjectDirectory } from "../projects/projectAnalyzer";
import type { SessionStore } from "../sessions/sessionStore";
import type { TaskStore } from "../tasks/taskStore";
import type { ProjectMemoryStore } from "../memory/projectMemoryStore";
import type { QuickChatStore } from "../chat/quickChatStore";
import type { ReviewChannelStore } from "../chat/reviewChannelStore";
import type { ApprovalStore } from "../approvals/approvalStore";
import type { NotificationService } from "../polish/notificationService";
import type { Phase9Store } from "../polish/phase9Store";

type Services = {
  db: SqliteDatabase;
  databasePath: string;
  paths: LelioPaths;
  logger: JsonlLogger;
  settingsStore: SettingsStore;
  runtimeRegistry: RuntimeRegistry;
  projectStore: ProjectStore;
  taskStore: TaskStore;
  sessionStore: SessionStore;
  memoryStore: ProjectMemoryStore;
  quickChatStore: QuickChatStore;
  reviewChannelStore: ReviewChannelStore;
  approvalStore: ApprovalStore;
  phase9Store: Phase9Store;
  notificationService: NotificationService;
};

type Handler<TInput, TOutput> = (input: TInput, correlationId: string, event: IpcMainInvokeEvent) => Promise<TOutput> | TOutput;

export function registerIpcHandlers(services: Services): void {
  registerHandler(services, IPC_CHANNELS.appGetSettings, z.undefined(), () => services.settingsStore.get());
  registerHandler(services, IPC_CHANNELS.appUpdateSettings, SettingsPatchSchema, (patch: AppSettingsPatch) => {
    const next = services.settingsStore.update(patch);
    services.logger.setLevel(next.logLevel);
    services.logger.setRetentionDays(next.logRetentionDays);
    return next;
  });
  registerHandler(services, IPC_CHANNELS.dbGetHealth, z.undefined(), () =>
    getDatabaseHealth(services.db, services.databasePath)
  );
  registerHandler(services, IPC_CHANNELS.projectList, z.undefined(), () => services.projectStore.list());
  registerHandler(services, IPC_CHANNELS.projectAdd, ProjectCreateSchema, (input: ProjectCreateInput, correlationId) =>
    services.projectStore.add(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.projectUpdate, ProjectUpdateSchema, (input: ProjectUpdateInput, correlationId) =>
    services.projectStore.update(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.projectRemove, ProjectIdSchema, (input: ProjectIdInput, correlationId) =>
    services.projectStore.remove(input.id, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.projectRefreshGitStatus, ProjectIdSchema, (input: ProjectIdInput, correlationId) =>
    services.projectStore.refreshGitStatus(input.id, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.projectSelectFolder, z.undefined(), async (_input, _correlationId, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
      properties: ["openDirectory"],
      title: "Select project folder"
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }
    return { canceled: false, path: result.filePaths[0] };
  });
  registerHandler(services, IPC_CHANNELS.projectAnalyze, ProjectAnalyzeInputSchema, (input: ProjectAnalyzeInput) =>
    analyzeProjectDirectory(input.path)
  );
  registerHandler(services, IPC_CHANNELS.taskList, z.undefined(), () => services.taskStore.list());
  registerHandler(services, IPC_CHANNELS.taskCreate, TaskCreateSchema, (input: TaskCreateInput, correlationId) =>
    services.taskStore.create(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.taskUpdate, TaskUpdateSchema, (input: TaskUpdateInput, correlationId) =>
    services.taskStore.update(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.taskDelete, TaskIdSchema, (input: TaskIdInput, correlationId) =>
    services.taskStore.delete(input.id, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.memoryProject, ProjectIdSchema, (input: ProjectIdInput) =>
    services.memoryStore.getProjectMemory(input.id)
  );
  registerHandler(services, IPC_CHANNELS.memoryProjectRefresh, ProjectIdSchema, (input: ProjectIdInput, correlationId) =>
    services.memoryStore.refreshProjectMemory(input.id, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.memoryTask, TaskIdSchema, (input: TaskIdInput) =>
    services.memoryStore.getTaskMemory(input.id)
  );
  registerHandler(services, IPC_CHANNELS.skillList, z.undefined(), () => services.memoryStore.listSkills());
  registerHandler(services, IPC_CHANNELS.skillCreate, SkillCreateSchema, (input: SkillCreateInput, correlationId) =>
    services.memoryStore.createSkill(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.skillUpdate, SkillUpdateSchema, (input: SkillUpdateInput, correlationId) =>
    services.memoryStore.updateSkill(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.skillDelete, SkillIdSchema, (input: SkillIdInput, correlationId) =>
    services.memoryStore.deleteSkill(input.skillId, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.skillAttachProject, ProjectSkillLinkSchema, (input: ProjectSkillLinkInput, correlationId) =>
    services.memoryStore.attachSkillToProject(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.skillDetachProject, ProjectSkillLinkSchema, (input: ProjectSkillLinkInput, correlationId) =>
    services.memoryStore.detachSkillFromProject(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.skillAttachAgent, AgentSkillLinkSchema, (input: AgentSkillLinkInput, correlationId) =>
    services.memoryStore.attachSkillToAgent(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.skillDetachAgent, AgentSkillLinkSchema, (input: AgentSkillLinkInput, correlationId) =>
    services.memoryStore.detachSkillFromAgent(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.sessionList, z.undefined(), () => services.sessionStore.list());
  registerHandler(services, IPC_CHANNELS.sessionDetail, SessionDetailInputSchema, (input: SessionDetailInput) =>
    services.sessionStore.getDetail(input)
  );
  registerHandler(services, IPC_CHANNELS.sessionSummarize, SessionIdActionSchema, (input: SessionIdActionInput, correlationId) =>
    services.memoryStore.summarizeSession(input.sessionId, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.sessionStart, SessionTaskActionSchema, (input: SessionTaskActionInput, correlationId) =>
    services.sessionStore.startTaskSession(input.taskId, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.sessionResume, SessionTaskActionSchema, (input: SessionTaskActionInput, correlationId) =>
    services.sessionStore.resumeTaskSession(input.taskId, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.sessionDisconnect, SessionTaskActionSchema, (input: SessionTaskActionInput, correlationId) =>
    services.sessionStore.disconnectTaskSession(input.taskId, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.sessionDisconnectById, SessionIdActionSchema, (input: SessionIdActionInput, correlationId) =>
    services.sessionStore.disconnectSession(input.sessionId, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.sessionAbort, SessionIdActionSchema, (input: SessionIdActionInput, correlationId) =>
    services.sessionStore.abortSession(input.sessionId, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.agentList, z.undefined(), () => listAgents(services.db));
  registerHandler(services, IPC_CHANNELS.channelList, z.undefined(), () => listChannels(services.db));
  registerHandler(services, IPC_CHANNELS.messageListByChannel, ChannelMessagesInputSchema, (input: ChannelMessagesInput) =>
    services.quickChatStore.listMessages(input.channelId, input.limit)
  );
  registerHandler(services, IPC_CHANNELS.quickChatSend, QuickChatRequestSchema, (input: QuickChatRequest, correlationId, event) =>
    services.quickChatStore.send(input, correlationId, (delta) => {
      event.sender.send(IPC_CHANNELS.quickChatDelta, delta);
    })
  );
  registerHandler(services, IPC_CHANNELS.quickChatCancel, QuickChatCancelSchema, (input: QuickChatCancelInput) =>
    services.quickChatStore.cancel(input.requestId)
  );
  registerHandler(services, IPC_CHANNELS.reviewRunRound, ReviewRoundRequestSchema, (input: ReviewRoundRequest, correlationId) =>
    services.reviewChannelStore.runReviewRound(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.reviewSynthesize, ReviewSynthesisRequestSchema, (input: ReviewSynthesisRequest, correlationId) =>
    services.reviewChannelStore.synthesize(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.taskCommentList, TaskIdSchema, (input: TaskIdInput) =>
    services.reviewChannelStore.listTaskComments(input.id)
  );
  registerHandler(services, IPC_CHANNELS.approvalList, ApprovalListInputSchema, (input: ApprovalListInput) =>
    services.approvalStore.list(input)
  );
  registerHandler(services, IPC_CHANNELS.approvalDecide, ApprovalDecisionInputSchema, (input: ApprovalDecisionInput, correlationId) =>
    services.approvalStore.decide(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.backupList, z.undefined(), () => services.phase9Store.listBackups());
  registerHandler(services, IPC_CHANNELS.backupCreate, BackupCreateInputSchema, (input: BackupCreateInput, correlationId) =>
    services.phase9Store.createBackup(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.backupRestore, BackupRestoreInputSchema, (input: BackupRestoreInput, correlationId) =>
    services.phase9Store.scheduleRestore(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.updateStrategy, z.undefined(), () => services.phase9Store.getUpdateStrategy());
  registerHandler(services, IPC_CHANNELS.notificationTest, z.undefined(), (_input, correlationId) =>
    services.notificationService.sendTest(correlationId)
  );
  registerHandler(services, IPC_CHANNELS.cleanupPreview, z.undefined(), () => services.phase9Store.previewCleanup());
  registerHandler(services, IPC_CHANNELS.cleanupExecute, CleanupExecuteInputSchema, (input: CleanupExecuteInput, correlationId) =>
    services.phase9Store.executeCleanup(input, correlationId)
  );
  registerHandler(services, IPC_CHANNELS.onboardingCreateSampleProject, z.undefined(), (_input, correlationId) =>
    services.phase9Store.createSampleProject(correlationId)
  );
  registerHandler(services, IPC_CHANNELS.runtimeListCached, z.undefined(), () => services.runtimeRegistry.listCached());
  registerHandler(services, IPC_CHANNELS.runtimeRefresh, z.undefined(), (_input, correlationId) =>
    services.runtimeRegistry.refresh(correlationId)
  );
  registerHandler(services, IPC_CHANNELS.diagnosticsExport, z.object({ destination: z.string().optional() }).optional(), (input, correlationId) =>
    exportDiagnostics({
      correlationId,
      paths: services.paths,
      settingsStore: services.settingsStore,
      logger: services.logger,
      getDatabaseHealth: () => getDatabaseHealth(services.db, services.databasePath),
      getRuntimeInventory: () => services.runtimeRegistry.listCached(),
      destination: input?.destination ?? services.settingsStore.get().diagnosticsExportLocation
    })
  );
  registerHandler(services, IPC_CHANNELS.rendererLogError, RendererErrorSchema, (input: RendererErrorPayload, correlationId) => {
    services.logger.error({
      source: "renderer",
      eventName: "renderer.error",
      message: input.message,
      correlationId,
      metadata: input
    });
    return { logged: true };
  });
}

export function success<T>(correlationId: string, data: T): IpcResult<T> {
  return { ok: true, correlationId, data };
}

export function failure(correlationId: string, error: unknown, code = "IPC_HANDLER_ERROR"): IpcFailure {
  const message = error instanceof Error ? error.message : "Unknown IPC error";
  return {
    ok: false,
    correlationId,
    error: {
      message,
      code,
      details: redactError(error)
    }
  };
}

function registerHandler<TInput, TOutput>(
  services: Services,
  channel: IpcChannel,
  schema: z.ZodType<TInput>,
  handler: Handler<TInput, TOutput>
): void {
  ipcMain.handle(channel, async (event, request: IpcRequest<TInput> | undefined): Promise<IpcResult<TOutput>> => {
    const correlationId = request?.correlationId ?? createCorrelationId();
    services.logger.info({
      source: "ipc",
      eventName: "ipc.request",
      message: `IPC request ${channel}`,
      correlationId,
      metadata: { channel }
    });

    try {
      const parsed = schema.parse(request?.data);
      const data = await handler(parsed, correlationId, event);
      services.logger.info({
        source: "ipc",
        eventName: "ipc.success",
        message: `IPC success ${channel}`,
        correlationId,
        metadata: { channel }
      });
      return success(correlationId, data);
    } catch (error) {
      services.logger.exception({
        source: "ipc",
        eventName: "ipc.failure",
        message: `IPC failure ${channel}`,
        correlationId,
        error,
        metadata: { channel }
      });
      return failure(correlationId, error);
    }
  });
}
