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
  IpcResult,
  LocalSkill,
  LocalBackup,
  MessageRecord,
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

export type LelioApi = {
  getSettings: () => Promise<IpcResult<AppSettings>>;
  updateSettings: (patch: AppSettingsPatch) => Promise<IpcResult<AppSettings>>;
  getDatabaseHealth: () => Promise<IpcResult<DatabaseHealth>>;
  listProjects: () => Promise<IpcResult<Project[]>>;
  addProject: (input: ProjectCreateInput) => Promise<IpcResult<Project>>;
  updateProject: (input: ProjectUpdateInput) => Promise<IpcResult<Project>>;
  removeProject: (input: ProjectIdInput) => Promise<IpcResult<{ removed: true; id: string }>>;
  refreshProjectGitStatus: (input: ProjectIdInput) => Promise<IpcResult<Project>>;
  listTasks: () => Promise<IpcResult<Task[]>>;
  createTask: (input: TaskCreateInput) => Promise<IpcResult<Task>>;
  updateTask: (input: TaskUpdateInput) => Promise<IpcResult<Task>>;
  deleteTask: (input: TaskIdInput) => Promise<IpcResult<{ deleted: true; id: string }>>;
  getProjectMemory: (input: ProjectIdInput) => Promise<IpcResult<ProjectMemory>>;
  refreshProjectMemory: (input: ProjectIdInput) => Promise<IpcResult<ProjectMemory>>;
  getTaskMemory: (input: TaskIdInput) => Promise<IpcResult<TaskMemory>>;
  listSkills: () => Promise<IpcResult<LocalSkill[]>>;
  createSkill: (input: SkillCreateInput) => Promise<IpcResult<LocalSkill>>;
  updateSkill: (input: SkillUpdateInput) => Promise<IpcResult<LocalSkill>>;
  deleteSkill: (input: SkillIdInput) => Promise<IpcResult<{ deleted: true; id: string }>>;
  attachSkillToProject: (input: ProjectSkillLinkInput) => Promise<IpcResult<ProjectMemory>>;
  detachSkillFromProject: (input: ProjectSkillLinkInput) => Promise<IpcResult<ProjectMemory>>;
  attachSkillToAgent: (input: AgentSkillLinkInput) => Promise<IpcResult<LocalSkill[]>>;
  detachSkillFromAgent: (input: AgentSkillLinkInput) => Promise<IpcResult<LocalSkill[]>>;
  listSessions: () => Promise<IpcResult<SessionRecord[]>>;
  getSessionDetail: (input: SessionDetailInput) => Promise<IpcResult<SessionDetail>>;
  summarizeSession: (input: SessionIdActionInput) => Promise<IpcResult<SessionSummary>>;
  startTaskSession: (input: SessionTaskActionInput) => Promise<IpcResult<SessionActionResult>>;
  resumeTaskSession: (input: SessionTaskActionInput) => Promise<IpcResult<SessionActionResult>>;
  disconnectTaskSession: (input: SessionTaskActionInput) => Promise<IpcResult<SessionActionResult>>;
  disconnectSession: (input: SessionIdActionInput) => Promise<IpcResult<SessionActionResult>>;
  abortSession: (input: SessionIdActionInput) => Promise<IpcResult<SessionActionResult>>;
  listAgents: () => Promise<IpcResult<AgentProfile[]>>;
  listChannels: () => Promise<IpcResult<Channel[]>>;
  listChannelMessages: (input: ChannelMessagesInput) => Promise<IpcResult<MessageRecord[]>>;
  sendQuickChat: (input: QuickChatRequest) => Promise<IpcResult<QuickChatResult>>;
  cancelQuickChat: (input: QuickChatCancelInput) => Promise<IpcResult<{ cancelled: boolean; requestId: string }>>;
  runReviewRound: (input: ReviewRoundRequest) => Promise<IpcResult<ReviewRoundResult>>;
  synthesizeReview: (input: ReviewSynthesisRequest) => Promise<IpcResult<ReviewSynthesisResult>>;
  listTaskComments: (input: TaskIdInput) => Promise<IpcResult<TaskCommentRecord[]>>;
  listApprovals: (input?: ApprovalListInput) => Promise<IpcResult<ApprovalRecord[]>>;
  decideApproval: (input: ApprovalDecisionInput) => Promise<IpcResult<ApprovalDecisionResult>>;
  listBackups: () => Promise<IpcResult<LocalBackup[]>>;
  createBackup: (input?: BackupCreateInput) => Promise<IpcResult<LocalBackup>>;
  restoreBackup: (input: BackupRestoreInput) => Promise<IpcResult<BackupRestoreResult>>;
  getUpdateStrategy: () => Promise<IpcResult<UpdateStrategy>>;
  sendTestNotification: () => Promise<IpcResult<NotificationTestResult>>;
  previewCleanup: () => Promise<IpcResult<CleanupPreview>>;
  executeCleanup: (input: CleanupExecuteInput) => Promise<IpcResult<CleanupExecuteResult>>;
  createSampleProject: () => Promise<IpcResult<OnboardingSampleProjectResult>>;
  onQuickChatDelta: (handler: (delta: QuickChatDelta) => void) => () => void;
  listCachedRuntimes: () => Promise<IpcResult<RuntimeRecord[]>>;
  refreshRuntimes: () => Promise<IpcResult<RuntimeRecord[]>>;
  exportDiagnostics: (destination?: string) => Promise<IpcResult<DiagnosticsExport>>;
  logRendererError: (payload: RendererErrorPayload) => Promise<IpcResult<{ logged: boolean }>>;
  createCorrelationId: () => string;
};

declare global {
  interface Window {
    lelio: LelioApi;
  }
}
