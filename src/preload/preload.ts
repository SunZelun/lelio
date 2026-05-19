import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { randomUUID } from "node:crypto";
import type {
  AgentProfile,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalListInput,
  ApprovalRecord,
  AppSettings,
  AppSettingsPatch,
  BackupCreateInput,
  BackupRestoreInput,
  BackupRestoreResult,
  Channel,
  ChannelMessagesInput,
  CleanupExecuteInput,
  CleanupExecuteResult,
  CleanupPreview,
  DatabaseHealth,
  DiagnosticsExport,
  AgentSkillLinkInput,
  IpcChannel,
  IpcRequest,
  IpcResult,
  LocalSkill,
  MessageRecord,
  LocalBackup,
  NotificationTestResult,
  OnboardingSampleProjectResult,
  Project,
  ProjectCreateInput,
  ProjectIdInput,
  ProjectMemory,
  ProjectSkillLinkInput,
  ProjectUpdateInput,
  QuickChatCancelInput,
  QuickChatDelta,
  QuickChatRequest,
  QuickChatResult,
  RendererErrorPayload,
  ReviewRoundRequest,
  ReviewRoundResult,
  ReviewSynthesisRequest,
  ReviewSynthesisResult,
  RuntimeRecord,
  SessionActionResult,
  SessionDetail,
  SessionDetailInput,
  SessionIdActionInput,
  SessionRecord,
  SessionSummary,
  SessionTaskActionInput,
  SkillCreateInput,
  SkillIdInput,
  SkillUpdateInput,
  Task,
  TaskCommentRecord,
  TaskMemory,
  TaskCreateInput,
  TaskIdInput,
  TaskUpdateInput,
  UpdateStrategy
} from "../shared/types";
import { IPC_CHANNELS } from "../shared/ipc";

async function invoke<TInput, TOutput>(channel: IpcChannel, data?: TInput): Promise<IpcResult<TOutput>> {
  const request: IpcRequest<TInput> = {
    correlationId: randomUUID(),
    data
  };
  return ipcRenderer.invoke(channel, request) as Promise<IpcResult<TOutput>>;
}

const api = {
  getSettings: () => invoke<void, AppSettings>(IPC_CHANNELS.appGetSettings),
  updateSettings: (patch: AppSettingsPatch) => invoke<AppSettingsPatch, AppSettings>(IPC_CHANNELS.appUpdateSettings, patch),
  getDatabaseHealth: () => invoke<void, DatabaseHealth>(IPC_CHANNELS.dbGetHealth),
  listProjects: () => invoke<void, Project[]>(IPC_CHANNELS.projectList),
  addProject: (input: ProjectCreateInput) => invoke<ProjectCreateInput, Project>(IPC_CHANNELS.projectAdd, input),
  updateProject: (input: ProjectUpdateInput) => invoke<ProjectUpdateInput, Project>(IPC_CHANNELS.projectUpdate, input),
  removeProject: (input: ProjectIdInput) => invoke<ProjectIdInput, { removed: true; id: string }>(IPC_CHANNELS.projectRemove, input),
  refreshProjectGitStatus: (input: ProjectIdInput) => invoke<ProjectIdInput, Project>(IPC_CHANNELS.projectRefreshGitStatus, input),
  listTasks: () => invoke<void, Task[]>(IPC_CHANNELS.taskList),
  createTask: (input: TaskCreateInput) => invoke<TaskCreateInput, Task>(IPC_CHANNELS.taskCreate, input),
  updateTask: (input: TaskUpdateInput) => invoke<TaskUpdateInput, Task>(IPC_CHANNELS.taskUpdate, input),
  deleteTask: (input: TaskIdInput) => invoke<TaskIdInput, { deleted: true; id: string }>(IPC_CHANNELS.taskDelete, input),
  getProjectMemory: (input: ProjectIdInput) => invoke<ProjectIdInput, ProjectMemory>(IPC_CHANNELS.memoryProject, input),
  refreshProjectMemory: (input: ProjectIdInput) => invoke<ProjectIdInput, ProjectMemory>(IPC_CHANNELS.memoryProjectRefresh, input),
  getTaskMemory: (input: TaskIdInput) => invoke<TaskIdInput, TaskMemory>(IPC_CHANNELS.memoryTask, input),
  listSkills: () => invoke<void, LocalSkill[]>(IPC_CHANNELS.skillList),
  createSkill: (input: SkillCreateInput) => invoke<SkillCreateInput, LocalSkill>(IPC_CHANNELS.skillCreate, input),
  updateSkill: (input: SkillUpdateInput) => invoke<SkillUpdateInput, LocalSkill>(IPC_CHANNELS.skillUpdate, input),
  deleteSkill: (input: SkillIdInput) => invoke<SkillIdInput, { deleted: true; id: string }>(IPC_CHANNELS.skillDelete, input),
  attachSkillToProject: (input: ProjectSkillLinkInput) =>
    invoke<ProjectSkillLinkInput, ProjectMemory>(IPC_CHANNELS.skillAttachProject, input),
  detachSkillFromProject: (input: ProjectSkillLinkInput) =>
    invoke<ProjectSkillLinkInput, ProjectMemory>(IPC_CHANNELS.skillDetachProject, input),
  attachSkillToAgent: (input: AgentSkillLinkInput) => invoke<AgentSkillLinkInput, LocalSkill[]>(IPC_CHANNELS.skillAttachAgent, input),
  detachSkillFromAgent: (input: AgentSkillLinkInput) => invoke<AgentSkillLinkInput, LocalSkill[]>(IPC_CHANNELS.skillDetachAgent, input),
  listSessions: () => invoke<void, SessionRecord[]>(IPC_CHANNELS.sessionList),
  getSessionDetail: (input: SessionDetailInput) => invoke<SessionDetailInput, SessionDetail>(IPC_CHANNELS.sessionDetail, input),
  summarizeSession: (input: SessionIdActionInput) => invoke<SessionIdActionInput, SessionSummary>(IPC_CHANNELS.sessionSummarize, input),
  startTaskSession: (input: SessionTaskActionInput) => invoke<SessionTaskActionInput, SessionActionResult>(IPC_CHANNELS.sessionStart, input),
  resumeTaskSession: (input: SessionTaskActionInput) => invoke<SessionTaskActionInput, SessionActionResult>(IPC_CHANNELS.sessionResume, input),
  disconnectTaskSession: (input: SessionTaskActionInput) =>
    invoke<SessionTaskActionInput, SessionActionResult>(IPC_CHANNELS.sessionDisconnect, input),
  disconnectSession: (input: SessionIdActionInput) =>
    invoke<SessionIdActionInput, SessionActionResult>(IPC_CHANNELS.sessionDisconnectById, input),
  abortSession: (input: SessionIdActionInput) =>
    invoke<SessionIdActionInput, SessionActionResult>(IPC_CHANNELS.sessionAbort, input),
  listAgents: () => invoke<void, AgentProfile[]>(IPC_CHANNELS.agentList),
  listChannels: () => invoke<void, Channel[]>(IPC_CHANNELS.channelList),
  listChannelMessages: (input: ChannelMessagesInput) => invoke<ChannelMessagesInput, MessageRecord[]>(IPC_CHANNELS.messageListByChannel, input),
  sendQuickChat: (input: QuickChatRequest) => invoke<QuickChatRequest, QuickChatResult>(IPC_CHANNELS.quickChatSend, input),
  cancelQuickChat: (input: QuickChatCancelInput) =>
    invoke<QuickChatCancelInput, { cancelled: boolean; requestId: string }>(IPC_CHANNELS.quickChatCancel, input),
  runReviewRound: (input: ReviewRoundRequest) => invoke<ReviewRoundRequest, ReviewRoundResult>(IPC_CHANNELS.reviewRunRound, input),
  synthesizeReview: (input: ReviewSynthesisRequest) =>
    invoke<ReviewSynthesisRequest, ReviewSynthesisResult>(IPC_CHANNELS.reviewSynthesize, input),
  listTaskComments: (input: TaskIdInput) => invoke<TaskIdInput, TaskCommentRecord[]>(IPC_CHANNELS.taskCommentList, input),
  listApprovals: (input?: ApprovalListInput) => invoke<ApprovalListInput, ApprovalRecord[]>(IPC_CHANNELS.approvalList, input),
  decideApproval: (input: ApprovalDecisionInput) =>
    invoke<ApprovalDecisionInput, ApprovalDecisionResult>(IPC_CHANNELS.approvalDecide, input),
  listBackups: () => invoke<void, LocalBackup[]>(IPC_CHANNELS.backupList),
  createBackup: (input?: BackupCreateInput) => invoke<BackupCreateInput, LocalBackup>(IPC_CHANNELS.backupCreate, input),
  restoreBackup: (input: BackupRestoreInput) => invoke<BackupRestoreInput, BackupRestoreResult>(IPC_CHANNELS.backupRestore, input),
  getUpdateStrategy: () => invoke<void, UpdateStrategy>(IPC_CHANNELS.updateStrategy),
  sendTestNotification: () => invoke<void, NotificationTestResult>(IPC_CHANNELS.notificationTest),
  previewCleanup: () => invoke<void, CleanupPreview>(IPC_CHANNELS.cleanupPreview),
  executeCleanup: (input: CleanupExecuteInput) => invoke<CleanupExecuteInput, CleanupExecuteResult>(IPC_CHANNELS.cleanupExecute, input),
  createSampleProject: () => invoke<void, OnboardingSampleProjectResult>(IPC_CHANNELS.onboardingCreateSampleProject),
  onQuickChatDelta: (handler: (delta: QuickChatDelta) => void) => {
    const listener = (_event: IpcRendererEvent, delta: QuickChatDelta) => handler(delta);
    ipcRenderer.on(IPC_CHANNELS.quickChatDelta, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.quickChatDelta, listener);
  },
  listCachedRuntimes: () => invoke<void, RuntimeRecord[]>(IPC_CHANNELS.runtimeListCached),
  refreshRuntimes: () => invoke<void, RuntimeRecord[]>(IPC_CHANNELS.runtimeRefresh),
  exportDiagnostics: (destination?: string) =>
    invoke<{ destination?: string }, DiagnosticsExport>(IPC_CHANNELS.diagnosticsExport, { destination }),
  logRendererError: (payload: RendererErrorPayload) => invoke<RendererErrorPayload, { logged: boolean }>(IPC_CHANNELS.rendererLogError, payload),
  createCorrelationId: () => randomUUID()
};

contextBridge.exposeInMainWorld("lelio", api);

window.addEventListener("error", (event) => {
  void api.logRendererError({
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    route: window.location.hash || window.location.pathname,
    source: "window.error"
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  void api.logRendererError({
    message: reason instanceof Error ? reason.message : "Unhandled renderer promise rejection",
    stack: reason instanceof Error ? reason.stack : undefined,
    route: window.location.hash || window.location.pathname,
    source: "window.unhandledrejection",
    metadata: reason instanceof Error ? undefined : { reason }
  });
});
