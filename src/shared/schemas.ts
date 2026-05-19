import { z } from "zod";

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const SettingsSchema = z.object({
  copilotCliPath: z.string().nullable(),
  defaultCopilotModel: z.string(),
  corporateProviderName: z.string(),
  openAiCompatibleBaseUrl: z.string().nullable(),
  openAiCompatibleModel: z.string(),
  openAiCompatibleUseStreaming: z.boolean(),
  openAiCompatibleApiKeySet: z.boolean(),
  quickChatChannelId: z.string(),
  worktreeRoot: z.string(),
  maxConcurrentCodingSessions: z.number().int().min(1).max(10),
  maxConcurrentReviewSessions: z.number().int().min(1).max(10),
  runtimeRefreshIntervalMinutes: z.number().int().min(1).max(1440),
  logLevel: LogLevelSchema,
  logRetentionDays: z.number().int().min(1).max(90),
  diagnosticsExportLocation: z.string().nullable()
});

export const SettingsPatchSchema = SettingsSchema.partial().extend({
  openAiCompatibleApiKey: z.string().nullable().optional()
});

export type AppSettings = z.infer<typeof SettingsSchema>;
export type AppSettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const RuntimeHealthSchema = z.enum([
  "available",
  "unavailable",
  "auth-needed",
  "error",
  "running"
]);

export const RuntimeProviderSchema = z.enum([
  "copilot",
  "codex",
  "claude",
  "gemini",
  "opencode",
  "hermes"
]);

export const RuntimeRecordSchema = z.object({
  id: z.string(),
  providerType: RuntimeProviderSchema,
  name: z.string(),
  cliPath: z.string().nullable(),
  version: z.string().nullable(),
  health: RuntimeHealthSchema,
  lastCheckedAt: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  metadata: z.record(z.unknown())
});

export type RuntimeProvider = z.infer<typeof RuntimeProviderSchema>;
export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;
export type RuntimeRecord = z.infer<typeof RuntimeRecordSchema>;

export const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string(),
  providerType: z.string(),
  model: z.string().nullable(),
  instructions: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const ChannelSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Channel = z.infer<typeof ChannelSchema>;

export const MessageRecordSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  authorType: z.string(),
  authorId: z.string().nullable(),
  content: z.string(),
  metadata: z.record(z.unknown()),
  createdAt: z.string()
});

export type MessageRecord = z.infer<typeof MessageRecordSchema>;

export const ChannelMessagesInputSchema = z.object({
  channelId: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional()
});

export type ChannelMessagesInput = z.infer<typeof ChannelMessagesInputSchema>;

export const QuickChatRequestSchema = z.object({
  message: z.string().trim().min(1),
  channelId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable().optional(),
  clientRequestId: z.string().min(1).optional()
});

export type QuickChatRequest = z.infer<typeof QuickChatRequestSchema>;

export const QuickChatCancelSchema = z.object({
  requestId: z.string().min(1)
});

export type QuickChatCancelInput = z.infer<typeof QuickChatCancelSchema>;

export const QuickChatResultSchema = z.object({
  channel: ChannelSchema,
  userMessage: MessageRecordSchema,
  assistantMessage: MessageRecordSchema,
  provider: z.string(),
  model: z.string(),
  streamed: z.boolean(),
  errorMessage: z.string().nullable()
});

export type QuickChatResult = z.infer<typeof QuickChatResultSchema>;

export const QuickChatDeltaSchema = z.object({
  requestId: z.string(),
  messageId: z.string(),
  delta: z.string(),
  done: z.boolean()
});

export type QuickChatDelta = z.infer<typeof QuickChatDeltaSchema>;

export const ChecklistItemSchema = z.object({
  text: z.string(),
  checked: z.boolean()
});

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const TaskCommentRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  channelId: z.string().nullable(),
  messageId: z.string().nullable(),
  authorType: z.string(),
  authorId: z.string().nullable(),
  content: z.string(),
  checklist: z.array(ChecklistItemSchema),
  metadata: z.record(z.unknown()),
  createdAt: z.string()
});

export type TaskCommentRecord = z.infer<typeof TaskCommentRecordSchema>;

export const ReviewRoundRequestSchema = z.object({
  channelId: z.string().min(1),
  prompt: z.string().trim().min(1),
  agentIds: z.array(z.string().min(1)).min(3),
  taskId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  clientRequestId: z.string().min(1).optional()
});

export type ReviewRoundRequest = z.infer<typeof ReviewRoundRequestSchema>;

export const ReviewAgentReplySchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  message: MessageRecordSchema,
  errorMessage: z.string().nullable()
});

export type ReviewAgentReply = z.infer<typeof ReviewAgentReplySchema>;

export const ReviewRoundResultSchema = z.object({
  channel: ChannelSchema,
  requestMessage: MessageRecordSchema,
  replies: z.array(ReviewAgentReplySchema),
  errorCount: z.number().int().min(0),
  reviewRoundId: z.string()
});

export type ReviewRoundResult = z.infer<typeof ReviewRoundResultSchema>;

export const ReviewSynthesisRequestSchema = z.object({
  channelId: z.string().min(1),
  taskId: z.string().min(1),
  instructions: z.string().trim().min(1).nullable().optional(),
  clientRequestId: z.string().min(1).optional()
});

export type ReviewSynthesisRequest = z.infer<typeof ReviewSynthesisRequestSchema>;

export const ReviewSynthesisResultSchema = z.object({
  channel: ChannelSchema,
  synthesisMessage: MessageRecordSchema,
  taskComment: TaskCommentRecordSchema.nullable(),
  errorMessage: z.string().nullable()
});

export type ReviewSynthesisResult = z.infer<typeof ReviewSynthesisResultSchema>;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "cancelled", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type ApprovalRiskLevel = z.infer<typeof ApprovalRiskLevelSchema>;

export const ApprovalRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  taskId: z.string().nullable(),
  runId: z.string().nullable(),
  requestId: z.string().nullable(),
  toolCallId: z.string().nullable(),
  actionType: z.string(),
  summary: z.string(),
  riskLevel: ApprovalRiskLevelSchema,
  status: ApprovalStatusSchema,
  request: z.record(z.unknown()),
  response: z.record(z.unknown()).nullable(),
  resolutionReason: z.string().nullable(),
  metadata: z.record(z.unknown()),
  requestedAt: z.string(),
  resolvedAt: z.string().nullable()
});

export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ApprovalListInputSchema = z
  .object({
    status: ApprovalStatusSchema.optional(),
    taskId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional()
  })
  .optional();

export type ApprovalListInput = z.infer<typeof ApprovalListInputSchema>;

export const ApprovalDecisionInputSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "deny"]),
  feedback: z.string().trim().min(1).nullable().optional()
});

export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>;

export const ApprovalDecisionResultSchema = z.object({
  approval: ApprovalRecordSchema,
  resolvedLiveRequest: z.boolean()
});

export type ApprovalDecisionResult = z.infer<typeof ApprovalDecisionResultSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  path: z.string(),
  defaultBranch: z.string().nullable(),
  packageManager: z.string().nullable(),
  testCommand: z.string().nullable(),
  buildCommand: z.string().nullable(),
  metadata: z.record(z.unknown()),
  gitBranch: z.string().nullable(),
  gitDirty: z.boolean().nullable(),
  gitStatus: z.enum(["unknown", "clean", "dirty", "not-git", "error"]),
  gitChangedFilesCount: z.number().int().min(0),
  gitLastCheckedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectCreateSchema = z.object({
  path: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  packageManager: z.string().trim().min(1).nullable().optional(),
  testCommand: z.string().trim().min(1).nullable().optional(),
  buildCommand: z.string().trim().min(1).nullable().optional()
});

export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  packageManager: z.string().trim().min(1).nullable().optional(),
  testCommand: z.string().trim().min(1).nullable().optional(),
  buildCommand: z.string().trim().min(1).nullable().optional()
});

export type ProjectUpdateInput = z.infer<typeof ProjectUpdateSchema>;

export const ProjectIdSchema = z.object({
  id: z.string().min(1)
});

export type ProjectIdInput = z.infer<typeof ProjectIdSchema>;

export const TaskStatusSchema = z.enum(["open", "in-progress", "blocked", "review", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  assigneeAgentId: z.string().nullable(),
  assigneeAgentName: z.string().nullable(),
  dueAt: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  sessionId: z.string().nullable(),
  sessionStatus: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  changedFilesCount: z.number().int().min(0).nullable(),
  testStatus: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Task = z.infer<typeof TaskSchema>;

const NullableStringPatchSchema = z.union([z.string().trim().min(1), z.null()]);

export const TaskCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable().optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeAgentId: z.string().min(1).nullable().optional(),
  dueAt: z.string().trim().min(1).nullable().optional(),
  branch: z.string().trim().min(1).nullable().optional(),
  worktreePath: z.string().trim().min(1).nullable().optional()
});

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

export const TaskUpdateSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).optional(),
  description: NullableStringPatchSchema.optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeAgentId: z.string().min(1).nullable().optional(),
  dueAt: NullableStringPatchSchema.optional(),
  branch: NullableStringPatchSchema.optional(),
  worktreePath: NullableStringPatchSchema.optional()
});

export type TaskUpdateInput = z.infer<typeof TaskUpdateSchema>;

export const TaskIdSchema = z.object({
  id: z.string().min(1)
});

export type TaskIdInput = z.infer<typeof TaskIdSchema>;

export const InstructionFileSchema = z.object({
  kind: z.string(),
  path: z.string(),
  sizeBytes: z.number().int().min(0),
  modifiedAt: z.string()
});

export type InstructionFile = z.infer<typeof InstructionFileSchema>;

export const MemoryWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning", "error"])
});

export type MemoryWarning = z.infer<typeof MemoryWarningSchema>;

export const LocalSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type LocalSkill = z.infer<typeof LocalSkillSchema>;

export const SkillCreateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable().optional(),
  content: z.string().trim().min(1)
});

export type SkillCreateInput = z.infer<typeof SkillCreateSchema>;

export const SkillUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  description: z.union([z.string().trim().min(1), z.null()]).optional(),
  content: z.string().trim().min(1).optional()
});

export type SkillUpdateInput = z.infer<typeof SkillUpdateSchema>;

export const SkillIdSchema = z.object({
  skillId: z.string().min(1)
});

export type SkillIdInput = z.infer<typeof SkillIdSchema>;

export const AttachedSkillSchema = LocalSkillSchema.extend({
  mountApproved: z.boolean(),
  attachedAt: z.string(),
  source: z.enum(["project", "agent"])
});

export type AttachedSkill = z.infer<typeof AttachedSkillSchema>;

export const ProjectSkillLinkSchema = z.object({
  projectId: z.string().min(1),
  skillId: z.string().min(1),
  mountApproved: z.boolean().optional()
});

export type ProjectSkillLinkInput = z.infer<typeof ProjectSkillLinkSchema>;

export const AgentSkillLinkSchema = z.object({
  agentId: z.string().min(1),
  skillId: z.string().min(1),
  mountApproved: z.boolean().optional()
});

export type AgentSkillLinkInput = z.infer<typeof AgentSkillLinkSchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string().nullable(),
  projectId: z.string().nullable(),
  summary: z.string(),
  createdAt: z.string()
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SkillMountRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  skillId: z.string(),
  skillName: z.string(),
  targetPath: z.string(),
  providerType: z.string(),
  mountedAt: z.string()
});

export type SkillMountRecord = z.infer<typeof SkillMountRecordSchema>;

export const ProjectMemorySchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  checkedAt: z.string(),
  detectedInstructionFiles: z.array(InstructionFileSchema),
  warnings: z.array(MemoryWarningSchema),
  contextCapsule: z.string(),
  attachedSkills: z.array(AttachedSkillSchema),
  sessionSummaries: z.array(SessionSummarySchema),
  latestSnapshotAt: z.string().nullable()
});

export type ProjectMemory = z.infer<typeof ProjectMemorySchema>;

export const TaskMemorySchema = z.object({
  taskId: z.string(),
  projectMemory: ProjectMemorySchema.nullable(),
  attachedSkills: z.array(AttachedSkillSchema),
  mountableSkills: z.array(AttachedSkillSchema)
});

export type TaskMemory = z.infer<typeof TaskMemorySchema>;

export const SessionStatusSchema = z.enum([
  "running",
  "idle",
  "waiting",
  "blocked",
  "completed",
  "failed",
  "aborted",
  "disconnected"
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const ExecutionRunStatusSchema = z.enum([
  "running",
  "idle",
  "completed",
  "failed",
  "aborted",
  "disconnected"
]);

export type ExecutionRunStatus = z.infer<typeof ExecutionRunStatusSchema>;

export const ExecutionRunSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  attemptNumber: z.number().int().min(1),
  worktreePath: z.string().nullable(),
  status: ExecutionRunStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  exitReason: z.string().nullable(),
  lastSequenceNumber: z.number().int().min(0),
  mountedSkills: z.array(SkillMountRecordSchema)
});

export type ExecutionRun = z.infer<typeof ExecutionRunSchema>;

export const SessionRecordSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  projectId: z.string().nullable(),
  agentId: z.string().nullable(),
  providerType: z.string(),
  model: z.string().nullable(),
  externalSessionId: z.string().nullable(),
  cwd: z.string().nullable(),
  status: SessionStatusSchema,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  runs: z.array(ExecutionRunSchema)
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const SessionIdActionSchema = z.object({
  sessionId: z.string().min(1)
});

export type SessionIdActionInput = z.infer<typeof SessionIdActionSchema>;

export const SessionTaskActionSchema = z.object({
  taskId: z.string().min(1)
});

export type SessionTaskActionInput = z.infer<typeof SessionTaskActionSchema>;

export const SessionActionResultSchema = z.object({
  session: SessionRecordSchema,
  task: TaskSchema
});

export type SessionActionResult = z.infer<typeof SessionActionResultSchema>;

export const RunMessageSchema = z.object({
  id: z.string(),
  runId: z.string(),
  attemptNumber: z.number().int().min(1),
  sequenceNumber: z.number().int().min(1),
  authorType: z.string(),
  contentType: z.string(),
  content: z.string(),
  metadata: z.unknown(),
  createdAt: z.string()
});

export type RunMessage = z.infer<typeof RunMessageSchema>;

export const SessionEventRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  eventType: z.string(),
  content: z.string(),
  metadata: z.unknown(),
  createdAt: z.string()
});

export type SessionEventRecord = z.infer<typeof SessionEventRecordSchema>;

export const GitChangedFileSchema = z.object({
  status: z.string(),
  path: z.string()
});

export type GitChangedFile = z.infer<typeof GitChangedFileSchema>;

export const GitChangedFilesSummarySchema = z.object({
  status: z.enum(["unknown", "clean", "dirty", "not-git", "error"]),
  branch: z.string().nullable(),
  checkedAt: z.string(),
  totalCount: z.number().int().min(0),
  files: z.array(GitChangedFileSchema),
  truncated: z.boolean(),
  error: z.string().nullable()
});

export type GitChangedFilesSummary = z.infer<typeof GitChangedFilesSummarySchema>;

export const SessionDetailInputSchema = z.object({
  id: z.string().min(1),
  includeGitSummary: z.boolean().optional(),
  sinceSequenceNumbers: z.record(z.number().int().min(0)).optional(),
  sinceEventCreatedAt: z.string().trim().min(1).optional()
});

export type SessionDetailInput = z.infer<typeof SessionDetailInputSchema>;

export const SessionDetailSchema = z.object({
  session: SessionRecordSchema,
  messages: z.array(RunMessageSchema),
  events: z.array(SessionEventRecordSchema),
  changedFiles: GitChangedFilesSummarySchema.nullable()
});

export type SessionDetail = z.infer<typeof SessionDetailSchema>;

export const DatabaseHealthSchema = z.object({
  ok: z.boolean(),
  databasePath: z.string(),
  migrationVersion: z.number(),
  tableCount: z.number(),
  defaultAgentCount: z.number(),
  defaultChannelCount: z.number()
});

export type DatabaseHealth = z.infer<typeof DatabaseHealthSchema>;

export const DiagnosticsExportSchema = z.object({
  exportPath: z.string(),
  createdAt: z.string(),
  includedFiles: z.array(z.string())
});

export type DiagnosticsExport = z.infer<typeof DiagnosticsExportSchema>;

export const BackupManifestSchema = z.object({
  appVersion: z.string(),
  schemaVersion: z.number().int().min(0),
  createdAt: z.string(),
  databaseFile: z.string(),
  settingsFile: z.string().nullable(),
  logsDirectory: z.string().nullable(),
  secretsIncluded: z.boolean(),
  integrityCheck: z.literal("ok")
});

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const LocalBackupSchema = z.object({
  backupPath: z.string(),
  manifestPath: z.string(),
  createdAt: z.string(),
  schemaVersion: z.number().int().min(0),
  appVersion: z.string(),
  secretsIncluded: z.boolean(),
  sizeBytes: z.number().int().min(0)
});

export type LocalBackup = z.infer<typeof LocalBackupSchema>;

export const BackupCreateInputSchema = z
  .object({
    destination: z.string().trim().min(1).optional(),
    includeSecrets: z.boolean().optional()
  })
  .optional();

export type BackupCreateInput = z.infer<typeof BackupCreateInputSchema>;

export const BackupRestoreInputSchema = z.object({
  backupPath: z.string().trim().min(1)
});

export type BackupRestoreInput = z.infer<typeof BackupRestoreInputSchema>;

export const BackupRestoreResultSchema = z.object({
  restorePending: z.boolean(),
  restartRequired: z.boolean(),
  backupPath: z.string(),
  manifest: BackupManifestSchema,
  pendingRestorePath: z.string()
});

export type BackupRestoreResult = z.infer<typeof BackupRestoreResultSchema>;

export const UpdateStrategySchema = z.object({
  currentVersion: z.string(),
  mode: z.literal("manual"),
  channel: z.literal("local"),
  automaticChecksEnabled: z.literal(false),
  feedUrl: z.null(),
  notes: z.array(z.string()),
  globalQuickOpen: z.object({
    accelerator: z.string(),
    registered: z.boolean(),
    reason: z.string().nullable()
  })
});

export type UpdateStrategy = z.infer<typeof UpdateStrategySchema>;

export const NotificationTestResultSchema = z.object({
  requested: z.boolean(),
  shown: z.boolean(),
  reason: z.string().nullable()
});

export type NotificationTestResult = z.infer<typeof NotificationTestResultSchema>;

export const CleanupCandidateSchema = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  taskStatus: TaskStatusSchema,
  path: z.string(),
  kind: z.literal("task-worktree"),
  sizeBytes: z.number().int().min(0),
  safeToDelete: z.boolean(),
  reason: z.string().nullable(),
  lastActivityAt: z.string().nullable()
});

export type CleanupCandidate = z.infer<typeof CleanupCandidateSchema>;

export const CleanupPreviewSchema = z.object({
  generatedAt: z.string(),
  candidates: z.array(CleanupCandidateSchema),
  totalBytes: z.number().int().min(0),
  deletableBytes: z.number().int().min(0)
});

export type CleanupPreview = z.infer<typeof CleanupPreviewSchema>;

export const CleanupExecuteInputSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1)
});

export type CleanupExecuteInput = z.infer<typeof CleanupExecuteInputSchema>;

export const CleanupExecuteResultSchema = z.object({
  deletedAt: z.string(),
  deletedCandidates: z.array(CleanupCandidateSchema),
  deletedBytes: z.number().int().min(0)
});

export type CleanupExecuteResult = z.infer<typeof CleanupExecuteResultSchema>;

export const OnboardingSampleProjectResultSchema = z.object({
  project: ProjectSchema,
  createdFiles: z.array(z.string()),
  alreadyExisted: z.boolean()
});

export type OnboardingSampleProjectResult = z.infer<typeof OnboardingSampleProjectResultSchema>;

export const RendererErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
  route: z.string().optional(),
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export type RendererErrorPayload = z.infer<typeof RendererErrorSchema>;
