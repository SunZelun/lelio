export const IPC_CHANNELS = {
  appGetSettings: "app:getSettings",
  appUpdateSettings: "app:updateSettings",
  dbGetHealth: "db:getHealth",
  projectList: "project:list",
  projectAdd: "project:add",
  projectUpdate: "project:update",
  projectRemove: "project:remove",
  projectRefreshGitStatus: "project:refreshGitStatus",
  taskList: "task:list",
  taskCreate: "task:create",
  taskUpdate: "task:update",
  taskDelete: "task:delete",
  memoryProject: "memory:project",
  memoryProjectRefresh: "memory:projectRefresh",
  memoryTask: "memory:task",
  skillList: "skill:list",
  skillCreate: "skill:create",
  skillUpdate: "skill:update",
  skillDelete: "skill:delete",
  skillAttachProject: "skill:attachProject",
  skillDetachProject: "skill:detachProject",
  skillAttachAgent: "skill:attachAgent",
  skillDetachAgent: "skill:detachAgent",
  sessionList: "session:list",
  sessionDetail: "session:detail",
  sessionSummarize: "session:summarize",
  sessionStart: "session:start",
  sessionResume: "session:resume",
  sessionDisconnect: "session:disconnect",
  sessionDisconnectById: "session:disconnectById",
  sessionAbort: "session:abort",
  agentList: "agent:list",
  channelList: "channel:list",
  messageListByChannel: "message:listByChannel",
  quickChatSend: "quickChat:send",
  quickChatCancel: "quickChat:cancel",
  quickChatDelta: "quickChat:delta",
  reviewRunRound: "review:runRound",
  reviewSynthesize: "review:synthesize",
  taskCommentList: "taskComment:list",
  approvalList: "approval:list",
  approvalDecide: "approval:decide",
  backupList: "backup:list",
  backupCreate: "backup:create",
  backupRestore: "backup:restore",
  updateStrategy: "update:strategy",
  notificationTest: "notification:test",
  cleanupPreview: "cleanup:preview",
  cleanupExecute: "cleanup:execute",
  onboardingCreateSampleProject: "onboarding:createSampleProject",
  runtimeListCached: "runtime:listCached",
  runtimeRefresh: "runtime:refresh",
  diagnosticsExport: "diagnostics:export",
  rendererLogError: "renderer:logError"
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type IpcSuccess<T> = {
  ok: true;
  correlationId: string;
  data: T;
};

export type IpcFailure = {
  ok: false;
  correlationId: string;
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
};

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

export type IpcRequest<T = unknown> = {
  correlationId?: string;
  data?: T;
};
