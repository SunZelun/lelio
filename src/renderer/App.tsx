import {
  Archive,
  Bell,
  Bot,
  Box,
  Bug,
  CalendarDays,
  ClipboardList,
  Columns3,
  Database,
  Download,
  FileCheck2,
  FolderPlus,
  GitBranch,
  Home,
  Inbox,
  MessageSquare,
  PauseCircle,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Settings,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AgentProfile,
  ApprovalRecord,
  AppSettings,
  AppSettingsPatch,
  CleanupPreview,
  Channel,
  DatabaseHealth,
  LocalBackup,
  Project,
  ProjectCreateInput,
  ProjectMemory,
  ProjectUpdateInput,
  LocalSkill,
  MessageRecord,
  RuntimeRecord,
  SessionDetail,
  SessionRecord,
  SessionSummary,
  SessionStatus,
  UpdateStrategy,
  TaskMemory,
  Task,
  TaskCommentRecord,
  TaskCreateInput,
  TaskPriority,
  TaskStatus,
  TaskUpdateInput
} from "../shared/types";

type View = "dashboard" | "tasks" | "sessions" | "memory" | "chat" | "reviews" | "approvals" | "settings";

type LoadState = {
  settings: AppSettings | null;
  health: DatabaseHealth | null;
  projects: Project[];
  tasks: Task[];
  sessions: SessionRecord[];
  agents: AgentProfile[];
  channels: Channel[];
  runtimes: RuntimeRecord[];
  skills: LocalSkill[];
  error: string | null;
  correlationId: string | null;
};

type TaskFilters = {
  projectId: string;
  status: TaskStatus | "all";
  priority: TaskPriority | "all";
  assigneeAgentId: string;
};

const initialLoadState: LoadState = {
  settings: null,
  health: null,
  projects: [],
  tasks: [],
  sessions: [],
  agents: [],
  channels: [],
  runtimes: [],
  skills: [],
  error: null,
  correlationId: null
};

const taskStatusColumns: Array<{ status: TaskStatus; label: string }> = [
  { status: "open", label: "Open" },
  { status: "in-progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
  { status: "cancelled", label: "Cancelled" }
];

const taskPriorities: Array<{ priority: TaskPriority; label: string }> = [
  { priority: "low", label: "Low" },
  { priority: "medium", label: "Medium" },
  { priority: "high", label: "High" },
  { priority: "urgent", label: "Urgent" }
];

const railItems: Array<{ label: string; icon: typeof Inbox; view?: View }> = [
  { label: "Inbox", icon: Inbox },
  { label: "Projects", icon: Home, view: "dashboard" },
  { label: "Tasks", icon: ClipboardList, view: "tasks" },
  { label: "Sessions", icon: TerminalSquare, view: "sessions" },
  { label: "Memory", icon: Archive, view: "memory" },
  { label: "Quick Chat", icon: MessageSquare, view: "chat" },
  { label: "Reviews", icon: FileCheck2, view: "reviews" },
  { label: "Approvals", icon: ShieldAlert, view: "approvals" },
  { label: "Channels", icon: MessageSquare },
  { label: "AI teammates", icon: Bot }
];

type SessionDetailLoadOptions = {
  includeGitSummary?: boolean;
  append?: boolean;
  silent?: boolean;
};

export default function App(): JSX.Element {
  const [view, setView] = useState<View>("dashboard");
  const [state, setState] = useState<LoadState>(initialLoadState);
  const [refreshing, setRefreshing] = useState(false);
  const [busyProjectIds, setBusyProjectIds] = useState<Set<string>>(new Set());
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set());
  const [addingProject, setAddingProject] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedMemoryProjectId, setSelectedMemoryProjectId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(null);
  const [taskMemory, setTaskMemory] = useState<TaskMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [savingSummaryIds, setSavingSummaryIds] = useState<Set<string>>(new Set());
  const [selectedChatChannelId, setSelectedChatChannelId] = useState<string>("channel-explore");
  const [selectedChatAgentId, setSelectedChatAgentId] = useState<string>("agent-researcher");
  const [channelMessages, setChannelMessages] = useState<MessageRecord[]>([]);
  const [sendingQuickChat, setSendingQuickChat] = useState(false);
  const [streamingDraft, setStreamingDraft] = useState<{ requestId: string; messageId: string; content: string } | null>(null);
  const [selectedReviewChannelId, setSelectedReviewChannelId] = useState<string>("channel-reviews");
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState<string>("");
  const [selectedReviewAgentIds, setSelectedReviewAgentIds] = useState<string[]>([]);
  const [reviewMessages, setReviewMessages] = useState<MessageRecord[]>([]);
  const [taskComments, setTaskComments] = useState<TaskCommentRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [backups, setBackups] = useState<LocalBackup[]>([]);
  const [updateStrategy, setUpdateStrategy] = useState<UpdateStrategy | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [phase9Busy, setPhase9Busy] = useState(false);
  const [phase9Notice, setPhase9Notice] = useState<string | null>(null);
  const [runningReviewRound, setRunningReviewRound] = useState(false);
  const [synthesizingReview, setSynthesizingReview] = useState(false);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (view === "sessions" && !selectedSessionId && state.sessions.length > 0) {
      setSelectedSessionId(state.sessions[0].id);
    }
  }, [selectedSessionId, state.sessions, view]);

  useEffect(() => {
    if (view === "memory" && !selectedMemoryProjectId && state.projects.length > 0) {
      setSelectedMemoryProjectId(state.projects[0].id);
    }
  }, [selectedMemoryProjectId, state.projects, view]);

  useEffect(() => {
    if (view !== "memory" || !selectedMemoryProjectId) {
      return;
    }
    void loadProjectMemory(selectedMemoryProjectId);
  }, [selectedMemoryProjectId, view]);

  useEffect(() => {
    if (view !== "sessions" || !selectedSessionId) {
      return;
    }
    void loadSessionDetail(selectedSessionId, { includeGitSummary: true });
  }, [selectedSessionId, view]);

  useEffect(() => {
    if (view !== "sessions") {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshSessions();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(() => {
    if (view !== "sessions" || !selectedSessionId) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void loadSessionDetail(selectedSessionId, {
        append: true,
        includeGitSummary: false,
        silent: true
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedSessionId, sessionDetail, view]);

  useEffect(() => {
    if (view !== "tasks" || !selectedTaskId) {
      return;
    }
    void loadTaskMemory(selectedTaskId);
    void loadTaskComments(selectedTaskId);
    void loadApprovals();
  }, [selectedTaskId, view]);

  useEffect(() => {
    if (view !== "chat") {
      return;
    }
    void loadChannelMessages(selectedChatChannelId);
  }, [selectedChatChannelId, view]);

  useEffect(() => {
    if (view !== "reviews") {
      return;
    }
    void loadReviewMessages(selectedReviewChannelId);
  }, [selectedReviewChannelId, view]);

  useEffect(() => {
    if (view !== "reviews" || selectedReviewAgentIds.length >= 3) {
      return;
    }
    const defaultAgentIds = state.agents
      .filter((agent) => agent.enabled && agent.providerType === "openai-compatible")
      .slice(0, 3)
      .map((agent) => agent.id);
    if (defaultAgentIds.length >= 3) {
      setSelectedReviewAgentIds(defaultAgentIds);
    }
  }, [selectedReviewAgentIds.length, state.agents, view]);

  useEffect(() => {
    if (view !== "approvals") {
      return;
    }
    void loadApprovals();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadApprovals();
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(() => {
    if (view !== "settings") {
      return;
    }
    void loadPolishData();
  }, [view]);

  useEffect(() => {
    return window.lelio.onQuickChatDelta((delta) => {
      setStreamingDraft((current) => {
        if (delta.done) {
          return null;
        }
        if (!current || current.requestId !== delta.requestId) {
          return { requestId: delta.requestId, messageId: delta.messageId, content: delta.delta };
        }
        return { ...current, content: `${current.content}${delta.delta}` };
      });
    });
  }, []);

  const activeProviders = useMemo(
    () => state.runtimes.filter((runtime) => runtime.health === "available").length,
    [state.runtimes]
  );

  const activeTaskCount = useMemo(
    () => state.tasks.filter((task) => !["done", "cancelled"].includes(task.status)).length,
    [state.tasks]
  );

  const activeSessionCount = useMemo(
    () => state.sessions.filter((session) => isActiveSessionStatus(session.status)).length,
    [state.sessions]
  );

  async function unwrap<T>(request: Promise<{ ok: true; data: T; correlationId: string } | { ok: false; error: { message: string }; correlationId: string }>): Promise<T> {
    const result = await request;
    if (!result.ok) {
      setState((current) => ({ ...current, error: result.error.message, correlationId: result.correlationId }));
      throw new Error(`${result.error.message} (${result.correlationId})`);
    }
    return result.data;
  }

  async function loadInitialData(): Promise<void> {
    try {
      const [settings, health, projects, tasks, sessions, agents, channels, runtimes, skills, loadedApprovals] = await Promise.all([
        unwrap(window.lelio.getSettings()),
        unwrap(window.lelio.getDatabaseHealth()),
        unwrap(window.lelio.listProjects()),
        unwrap(window.lelio.listTasks()),
        unwrap(window.lelio.listSessions()),
        unwrap(window.lelio.listAgents()),
        unwrap(window.lelio.listChannels()),
        unwrap(window.lelio.listCachedRuntimes()),
        unwrap(window.lelio.listSkills()),
        unwrap(window.lelio.listApprovals({ limit: 100 }))
      ]);
      setState({ settings, health, projects, tasks, sessions, agents, channels, runtimes, skills, error: null, correlationId: null });
      setApprovals(loadedApprovals);
      setSelectedTaskId(tasks[0]?.id ?? null);
      setSelectedSessionId(sessions[0]?.id ?? null);
      setSelectedMemoryProjectId(projects[0]?.id ?? null);
      setSelectedChatChannelId(settings.quickChatChannelId || channels[0]?.id || "channel-explore");
      setSelectedChatAgentId(agents.find((agent) => agent.id === "agent-researcher")?.id ?? agents.find((agent) => agent.providerType === "openai-compatible")?.id ?? "");
      setSelectedReviewChannelId(channels.find((channel) => channel.id === "channel-reviews")?.id ?? channels[0]?.id ?? "channel-reviews");
      setSelectedReviewTaskId(tasks[0]?.id ?? "");
      setSelectedReviewAgentIds(
        agents
          .filter((agent) => agent.enabled && agent.providerType === "openai-compatible")
          .slice(0, 3)
          .map((agent) => agent.id)
      );
    } catch {
      // The per-request unwrap path records the visible error and correlation ID.
    }
  }

  async function refreshRuntimes(): Promise<void> {
    setRefreshing(true);
    try {
      const runtimes = await unwrap(window.lelio.refreshRuntimes());
      setState((current) => ({ ...current, runtimes, error: null, correlationId: null }));
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshSessions(): Promise<void> {
    try {
      const sessions = await unwrap(window.lelio.listSessions());
      setState((current) => ({ ...current, sessions, error: null, correlationId: null }));
      setSelectedSessionId((current) => current ?? sessions[0]?.id ?? null);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function loadSessionDetail(sessionId: string, options: SessionDetailLoadOptions = {}): Promise<void> {
    if (!options.silent) {
      setSessionDetailLoading(true);
    }

    try {
      const currentDetail = sessionDetail?.session.id === sessionId ? sessionDetail : null;
      const detail = await unwrap(
        window.lelio.getSessionDetail({
          id: sessionId,
          includeGitSummary: options.includeGitSummary,
          sinceSequenceNumbers: options.append && currentDetail ? messageCursors(currentDetail) : undefined,
          sinceEventCreatedAt: options.append && currentDetail ? latestEventCreatedAt(currentDetail) : undefined
        })
      );
      setSessionDetail((current) => mergeSessionDetail(current, detail, Boolean(options.append)));
      upsertSession(detail.session);
    } catch {
      // Visible error is set by unwrap.
    } finally {
      if (!options.silent) {
        setSessionDetailLoading(false);
      }
    }
  }

  async function loadProjectMemory(projectId: string): Promise<void> {
    setMemoryLoading(true);
    try {
      const memory = await unwrap(window.lelio.getProjectMemory({ id: projectId }));
      setProjectMemory(memory);
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setMemoryLoading(false);
    }
  }

  async function refreshProjectMemory(projectId: string): Promise<void> {
    setMemoryLoading(true);
    try {
      const memory = await unwrap(window.lelio.refreshProjectMemory({ id: projectId }));
      setProjectMemory(memory);
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setMemoryLoading(false);
    }
  }

  async function loadTaskMemory(taskId: string): Promise<void> {
    try {
      const memory = await unwrap(window.lelio.getTaskMemory({ id: taskId }));
      setTaskMemory(memory);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function createSkill(input: { name: string; description?: string | null; content: string }): Promise<void> {
    try {
      const skill = await unwrap(window.lelio.createSkill(input));
      setState((current) => ({ ...current, skills: [skill, ...current.skills.filter((candidate) => candidate.id !== skill.id)] }));
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function deleteSkill(skillId: string): Promise<void> {
    try {
      await unwrap(window.lelio.deleteSkill({ skillId }));
      setState((current) => ({ ...current, skills: current.skills.filter((skill) => skill.id !== skillId) }));
      if (selectedMemoryProjectId) {
        await loadProjectMemory(selectedMemoryProjectId);
      }
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function attachSkillToProject(projectId: string, skillId: string, mountApproved: boolean): Promise<void> {
    try {
      const memory = await unwrap(window.lelio.attachSkillToProject({ projectId, skillId, mountApproved }));
      setProjectMemory(memory);
      if (selectedTaskId) {
        await loadTaskMemory(selectedTaskId);
      }
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function detachSkillFromProject(projectId: string, skillId: string): Promise<void> {
    try {
      const memory = await unwrap(window.lelio.detachSkillFromProject({ projectId, skillId }));
      setProjectMemory(memory);
      if (selectedTaskId) {
        await loadTaskMemory(selectedTaskId);
      }
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function summarizeSession(sessionId: string): Promise<void> {
    setSavingSummaryIds((current) => new Set(current).add(sessionId));
    try {
      await unwrap(window.lelio.summarizeSession({ sessionId }));
      const projectId = sessionDetail?.session.projectId ?? selectedMemoryProjectId;
      if (projectId) {
        await loadProjectMemory(projectId);
      }
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setSavingSummaryIds((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
  }

  async function loadChannelMessages(channelId: string): Promise<void> {
    try {
      const messages = await unwrap(window.lelio.listChannelMessages({ channelId, limit: 100 }));
      setChannelMessages(messages);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function loadReviewMessages(channelId: string): Promise<void> {
    try {
      const messages = await unwrap(window.lelio.listChannelMessages({ channelId, limit: 160 }));
      setReviewMessages(messages);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function loadTaskComments(taskId: string): Promise<void> {
    try {
      const comments = await unwrap(window.lelio.listTaskComments({ id: taskId }));
      setTaskComments(comments);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function loadApprovals(): Promise<void> {
    try {
      const loadedApprovals = await unwrap(window.lelio.listApprovals({ limit: 120 }));
      setApprovals(loadedApprovals);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function loadPolishData(): Promise<void> {
    try {
      const [loadedBackups, strategy, cleanup] = await Promise.all([
        unwrap(window.lelio.listBackups()),
        unwrap(window.lelio.getUpdateStrategy()),
        unwrap(window.lelio.previewCleanup())
      ]);
      setBackups(loadedBackups);
      setUpdateStrategy(strategy);
      setCleanupPreview(cleanup);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function createBackup(): Promise<void> {
    setPhase9Busy(true);
    try {
      const backup = await unwrap(window.lelio.createBackup());
      setBackups((current) => [backup, ...current.filter((candidate) => candidate.backupPath !== backup.backupPath)]);
      setPhase9Notice(`Backup created at ${backup.backupPath}`);
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setPhase9Busy(false);
    }
  }

  async function restoreBackup(backupPath: string): Promise<void> {
    setPhase9Busy(true);
    try {
      const result = await unwrap(window.lelio.restoreBackup({ backupPath }));
      setPhase9Notice(result.restartRequired ? "Restore is scheduled. Restart Lelio to apply it." : "Restore completed.");
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setPhase9Busy(false);
    }
  }

  async function sendTestNotification(): Promise<void> {
    setPhase9Busy(true);
    try {
      const result = await unwrap(window.lelio.sendTestNotification());
      setPhase9Notice(result.shown ? "Test notification sent." : result.reason ?? "Notification was requested but not shown.");
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setPhase9Busy(false);
    }
  }

  async function createSampleProject(): Promise<void> {
    setPhase9Busy(true);
    try {
      const result = await unwrap(window.lelio.createSampleProject());
      setState((current) => ({
        ...current,
        projects: [result.project, ...current.projects.filter((project) => project.id !== result.project.id)],
        error: null,
        correlationId: null
      }));
      setPhase9Notice(result.alreadyExisted ? "Sample project is already registered." : "Sample project created and registered.");
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setPhase9Busy(false);
    }
  }

  async function executeCleanup(taskIds: string[]): Promise<void> {
    setPhase9Busy(true);
    try {
      const result = await unwrap(window.lelio.executeCleanup({ taskIds }));
      setPhase9Notice(`Cleaned ${formatBytes(result.deletedBytes)} from ${result.deletedCandidates.length} task worktree(s).`);
      const cleanup = await unwrap(window.lelio.previewCleanup());
      setCleanupPreview(cleanup);
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setPhase9Busy(false);
    }
  }

  async function sendQuickChat(message: string, projectId: string | null): Promise<void> {
    const requestId = window.lelio.createCorrelationId();
    setSendingQuickChat(true);
    setStreamingDraft({ requestId, messageId: "", content: "" });
    try {
      const result = await unwrap(
        window.lelio.sendQuickChat({
          message,
          channelId: selectedChatChannelId,
          agentId: selectedChatAgentId || undefined,
          projectId,
          clientRequestId: requestId
        })
      );
      setChannelMessages((current) => mergeById(current, [result.userMessage, result.assistantMessage]).sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
      setState((current) => ({ ...current, error: result.errorMessage, correlationId: result.errorMessage ? result.assistantMessage.id : null }));
    } catch {
      // Visible error is set by unwrap; misconfiguration does not persist messages.
    } finally {
      setSendingQuickChat(false);
      setStreamingDraft(null);
    }
  }

  async function updateProviderSettings(patch: AppSettingsPatch): Promise<void> {
    try {
      const settings = await unwrap(window.lelio.updateSettings(patch));
      setState((current) => ({ ...current, settings, error: null, correlationId: null }));
      setSelectedChatChannelId(settings.quickChatChannelId);
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function runReviewRound(prompt: string, taskId: string | null, agentIds: string[]): Promise<void> {
    const requestId = window.lelio.createCorrelationId();
    setRunningReviewRound(true);
    try {
      const task = taskId ? state.tasks.find((candidate) => candidate.id === taskId) ?? null : null;
      const result = await unwrap(
        window.lelio.runReviewRound({
          channelId: selectedReviewChannelId,
          prompt,
          agentIds,
          taskId,
          projectId: task?.projectId ?? null,
          clientRequestId: requestId
        })
      );
      const replyMessages = result.replies.map((reply) => reply.message);
      setReviewMessages((current) =>
        mergeById(current, [result.requestMessage, ...replyMessages]).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      );
      if (taskId) {
        setSelectedReviewTaskId(taskId);
      }
      setState((current) => ({ ...current, error: null, correlationId: null }));
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setRunningReviewRound(false);
    }
  }

  async function synthesizeReview(taskId: string, instructions: string | null): Promise<void> {
    setSynthesizingReview(true);
    try {
      const result = await unwrap(
        window.lelio.synthesizeReview({
          channelId: selectedReviewChannelId,
          taskId,
          instructions
        })
      );
      setReviewMessages((current) => mergeById(current, [result.synthesisMessage]).sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
      if (result.taskComment) {
        const taskComment = result.taskComment;
        setTaskComments((current) =>
          [taskComment, ...current.filter((comment) => comment.id !== taskComment.id)].sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt)
          )
        );
      }
      setState((current) => ({ ...current, error: result.errorMessage, correlationId: result.errorMessage ? result.synthesisMessage.id : null }));
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setSynthesizingReview(false);
    }
  }

  async function decideApproval(approvalId: string, decision: "approve" | "deny", feedback: string | null): Promise<void> {
    try {
      const result = await unwrap(window.lelio.decideApproval({ approvalId, decision, feedback }));
      setApprovals((current) =>
        [result.approval, ...current.filter((approval) => approval.id !== result.approval.id)].sort((left, right) =>
          right.requestedAt.localeCompare(left.requestedAt)
        )
      );
      if (result.approval.sessionId && result.approval.sessionId === selectedSessionId) {
        await loadSessionDetail(result.approval.sessionId, { append: true, silent: true });
      }
    } catch {
      // Visible error is set by unwrap.
    }
  }

  async function addProject(input: ProjectCreateInput): Promise<void> {
    setAddingProject(true);
    try {
      const project = await unwrap(window.lelio.addProject(input));
      setState((current) => ({
        ...current,
        projects: [project, ...current.projects.filter((candidate) => candidate.id !== project.id)],
        error: null,
        correlationId: null
      }));
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setAddingProject(false);
    }
  }

  async function updateProject(input: ProjectUpdateInput): Promise<void> {
    await withBusyProject(input.id, async () => {
      const project = await unwrap(window.lelio.updateProject(input));
      replaceProject(project);
    });
  }

  async function removeProject(id: string): Promise<void> {
    await withBusyProject(id, async () => {
      await unwrap(window.lelio.removeProject({ id }));
      setState((current) => ({
        ...current,
        projects: current.projects.filter((project) => project.id !== id),
        error: null,
        correlationId: null
      }));
    });
  }

  async function refreshProjectGitStatus(id: string): Promise<void> {
    await withBusyProject(id, async () => {
      const project = await unwrap(window.lelio.refreshProjectGitStatus({ id }));
      replaceProject(project);
      const tasks = await unwrap(window.lelio.listTasks());
      setState((current) => ({ ...current, tasks, error: null, correlationId: null }));
    });
  }

  async function createTask(input: TaskCreateInput): Promise<void> {
    setAddingTask(true);
    try {
      const task = await unwrap(window.lelio.createTask(input));
      setState((current) => ({
        ...current,
        tasks: [task, ...current.tasks.filter((candidate) => candidate.id !== task.id)],
        error: null,
        correlationId: null
      }));
      setSelectedTaskId(task.id);
      setView("tasks");
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setAddingTask(false);
    }
  }

  async function updateTask(input: TaskUpdateInput): Promise<void> {
    await withBusyTask(input.id, async () => {
      const task = await unwrap(window.lelio.updateTask(input));
      replaceTask(task);
    });
  }

  async function deleteTask(id: string): Promise<void> {
    await withBusyTask(id, async () => {
      await unwrap(window.lelio.deleteTask({ id }));
      setState((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== id),
        sessions: current.sessions.filter((session) => session.taskId !== id),
        error: null,
        correlationId: null
      }));
      setSelectedTaskId((current) => (current === id ? null : current));
      setSelectedReviewTaskId((current) => (current === id ? "" : current));
      setTaskComments((current) => current.filter((comment) => comment.taskId !== id));
      setApprovals((current) => current.filter((approval) => approval.taskId !== id));
    });
  }

  async function startTaskSession(taskId: string): Promise<void> {
    await withBusyTask(taskId, async () => {
      const result = await unwrap(window.lelio.startTaskSession({ taskId }));
      replaceTask(result.task);
      upsertSession(result.session);
      setSelectedSessionId(result.session.id);
    });
  }

  async function resumeTaskSession(taskId: string): Promise<void> {
    await withBusyTask(taskId, async () => {
      const result = await unwrap(window.lelio.resumeTaskSession({ taskId }));
      replaceTask(result.task);
      upsertSession(result.session);
      setSelectedSessionId(result.session.id);
    });
  }

  async function disconnectSession(sessionId: string): Promise<void> {
    await withBusySession(sessionId, async () => {
      const result = await unwrap(window.lelio.disconnectSession({ sessionId }));
      replaceTask(result.task);
      upsertSession(result.session);
      setSessionDetail((current) => (current?.session.id === result.session.id ? { ...current, session: result.session } : current));
    });
  }

  async function abortSession(sessionId: string): Promise<void> {
    await withBusySession(sessionId, async () => {
      const result = await unwrap(window.lelio.abortSession({ sessionId }));
      replaceTask(result.task);
      upsertSession(result.session);
      setSessionDetail((current) => (current?.session.id === result.session.id ? { ...current, session: result.session } : current));
    });
  }

  function replaceProject(project: Project): void {
    setState((current) => ({
      ...current,
      projects: current.projects.map((candidate) => (candidate.id === project.id ? project : candidate)),
      error: null,
      correlationId: null
    }));
  }

  function replaceTask(task: Task): void {
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)),
      error: null,
      correlationId: null
    }));
  }

  function upsertSession(session: SessionRecord): void {
    setState((current) => ({
      ...current,
      sessions: [session, ...current.sessions.filter((candidate) => candidate.id !== session.id)],
      error: null,
      correlationId: null
    }));
  }

  async function withBusyProject(id: string, work: () => Promise<void>): Promise<void> {
    setBusyProjectIds((current) => new Set(current).add(id));
    try {
      await work();
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setBusyProjectIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function withBusyTask(id: string, work: () => Promise<void>): Promise<void> {
    setBusyTaskIds((current) => new Set(current).add(id));
    try {
      await work();
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setBusyTaskIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function withBusySession(id: string, work: () => Promise<void>): Promise<void> {
    setBusySessionIds((current) => new Set(current).add(id));
    try {
      await work();
    } catch {
      // Visible error is set by unwrap.
    } finally {
      setBusySessionIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="app-shell">
      <aside className="left-rail" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <div className="brand-name">Lelio</div>
            <div className="brand-subtitle">Local agent OS</div>
          </div>
        </div>

        <nav className="rail-nav">
          <button className={view === "dashboard" ? "rail-item active" : "rail-item"} onClick={() => setView("dashboard")}>
            <Home size={16} />
            Dashboard
          </button>
          {railItems.map((item) => (
            <button
              className={item.view === view ? "rail-item active" : "rail-item"}
              key={item.label}
              onClick={item.view ? () => setView(item.view as View) : undefined}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </nav>

        <button className={view === "settings" ? "rail-item active settings-link" : "rail-item settings-link"} onClick={() => setView("settings")}>
          <Settings size={16} />
          Settings
        </button>
      </aside>

      <main className="workspace">
        <header className="top-bar">
          <div>
            <div className="eyebrow">Command center</div>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="status-strip">
            <span>{state.projects.length} projects</span>
            <span>{activeTaskCount} active tasks</span>
            <span>{activeSessionCount} live sessions</span>
            <span>{activeProviders} providers available</span>
            <span>{state.health?.ok ? "SQLite ready" : "SQLite loading"}</span>
          </div>
        </header>

        {state.error ? (
          <section className="error-banner">
            <Bug size={18} />
            <div>
              <strong>{state.error}</strong>
              {state.correlationId ? <span>Correlation ID: {state.correlationId}</span> : null}
            </div>
          </section>
        ) : null}

        {view === "settings" ? (
          <SettingsView
            settings={state.settings}
            health={state.health}
            backups={backups}
            updateStrategy={updateStrategy}
            cleanupPreview={cleanupPreview}
            busy={phase9Busy}
            notice={phase9Notice}
            onCreateBackup={() => void createBackup()}
            onRestoreBackup={(backupPath) => void restoreBackup(backupPath)}
            onTestNotification={() => void sendTestNotification()}
            onCreateSampleProject={() => void createSampleProject()}
            onRefreshPolish={() => void loadPolishData()}
            onExecuteCleanup={(taskIds) => void executeCleanup(taskIds)}
          />
        ) : view === "tasks" ? (
          <TaskBoardView
            agents={state.agents}
            projects={state.projects}
            sessions={state.sessions}
            tasks={state.tasks}
            addingTask={addingTask}
            busyTaskIds={busyTaskIds}
            selectedTaskId={selectedTaskId}
            onCreateTask={(input) => void createTask(input)}
            onUpdateTask={(input) => void updateTask(input)}
            onDeleteTask={(id) => void deleteTask(id)}
            onStartTaskSession={(id) => void startTaskSession(id)}
            onResumeTaskSession={(id) => void resumeTaskSession(id)}
            onDisconnectSession={(id) => void disconnectSession(id)}
            onAbortSession={(id) => void abortSession(id)}
            onSelectTask={setSelectedTaskId}
            taskMemory={taskMemory?.taskId === selectedTaskId ? taskMemory : null}
            taskComments={selectedTaskId ? taskComments.filter((comment) => comment.taskId === selectedTaskId) : []}
            approvals={selectedTaskId ? approvals.filter((approval) => approval.taskId === selectedTaskId) : []}
            onRefreshTaskMemory={(id) => void loadTaskMemory(id)}
          />
        ) : view === "sessions" ? (
          <SessionMonitorView
            agents={state.agents}
            projects={state.projects}
            tasks={state.tasks}
            sessions={state.sessions}
            selectedSessionId={selectedSessionId}
            sessionDetail={sessionDetail}
            loading={sessionDetailLoading}
            busySessionIds={busySessionIds}
            onSelectSession={setSelectedSessionId}
            onRefreshSelected={(id) => void loadSessionDetail(id, { includeGitSummary: true })}
            onDisconnectSession={(id) => void disconnectSession(id)}
            onAbortSession={(id) => void abortSession(id)}
            onSummarizeSession={(id) => void summarizeSession(id)}
            savingSummaryIds={savingSummaryIds}
          />
        ) : view === "memory" ? (
          <MemoryView
            projects={state.projects}
            skills={state.skills}
            selectedProjectId={selectedMemoryProjectId}
            projectMemory={projectMemory}
            loading={memoryLoading}
            onSelectProject={setSelectedMemoryProjectId}
            onRefreshProject={(id) => void refreshProjectMemory(id)}
            onCreateSkill={(input) => void createSkill(input)}
            onDeleteSkill={(id) => void deleteSkill(id)}
            onAttachSkill={(projectId, skillId, mountApproved) => void attachSkillToProject(projectId, skillId, mountApproved)}
            onDetachSkill={(projectId, skillId) => void detachSkillFromProject(projectId, skillId)}
          />
        ) : view === "chat" ? (
          <QuickChatView
            agents={state.agents}
            channels={state.channels}
            projects={state.projects}
            settings={state.settings}
            messages={channelMessages}
            selectedChannelId={selectedChatChannelId}
            selectedAgentId={selectedChatAgentId}
            sending={sendingQuickChat}
            streamingDraft={streamingDraft?.content ?? ""}
            onSelectChannel={setSelectedChatChannelId}
            onSelectAgent={setSelectedChatAgentId}
            onSend={(message, projectId) => void sendQuickChat(message, projectId)}
            onUpdateSettings={(patch) => void updateProviderSettings(patch)}
          />
        ) : view === "reviews" ? (
          <ReviewChannelsView
            agents={state.agents}
            channels={state.channels}
            tasks={state.tasks}
            messages={reviewMessages}
            selectedChannelId={selectedReviewChannelId}
            selectedTaskId={selectedReviewTaskId}
            selectedAgentIds={selectedReviewAgentIds}
            running={runningReviewRound}
            synthesizing={synthesizingReview}
            onSelectChannel={setSelectedReviewChannelId}
            onSelectTask={setSelectedReviewTaskId}
            onSelectAgents={setSelectedReviewAgentIds}
            onRunRound={(prompt, taskId, agentIds) => void runReviewRound(prompt, taskId, agentIds)}
            onSynthesize={(taskId, instructions) => void synthesizeReview(taskId, instructions)}
          />
        ) : view === "approvals" ? (
          <ApprovalsView
            approvals={approvals}
            tasks={state.tasks}
            sessions={state.sessions}
            onDecide={(approvalId, decision, feedback) => void decideApproval(approvalId, decision, feedback)}
            onRefresh={() => void loadApprovals()}
          />
        ) : (
          <DashboardView
            agents={state.agents}
            channels={state.channels}
            projects={state.projects}
            runtimes={state.runtimes}
            tasks={state.tasks}
            refreshing={refreshing}
            addingProject={addingProject}
            busyProjectIds={busyProjectIds}
            onAddProject={(input) => void addProject(input)}
            onUpdateProject={(input) => void updateProject(input)}
            onRemoveProject={(id) => void removeProject(id)}
            onRefreshProjectGitStatus={(id) => void refreshProjectGitStatus(id)}
            onRefreshRuntimes={() => void refreshRuntimes()}
            onOpenTasks={() => setView("tasks")}
          />
        )}
      </main>
    </div>
  );
}

function DashboardView(props: {
  projects: Project[];
  tasks: Task[];
  agents: AgentProfile[];
  channels: Channel[];
  runtimes: RuntimeRecord[];
  refreshing: boolean;
  addingProject: boolean;
  busyProjectIds: Set<string>;
  onAddProject: (input: ProjectCreateInput) => void;
  onUpdateProject: (input: ProjectUpdateInput) => void;
  onRemoveProject: (id: string) => void;
  onRefreshProjectGitStatus: (id: string) => void;
  onRefreshRuntimes: () => void;
  onOpenTasks: () => void;
}): JSX.Element {
  const recentProjects = props.projects.filter((project) => project.lastActivityAt).slice(0, 5);
  const blockedTasks = props.tasks.filter((task) => task.status === "blocked").slice(0, 5);

  return (
    <div className="dashboard-grid">
      <section className="panel project-registry">
        <div className="section-header">
          <div>
            <h2>Projects</h2>
            <p>Cached registry. Git state updates only when you refresh a project.</p>
          </div>
        </div>
        <ProjectAddForm adding={props.addingProject} onAdd={props.onAddProject} />
        {props.projects.length === 0 ? (
          <div className="empty-state inline-empty">
            <div className="empty-icon">
              <Database size={28} />
            </div>
            <h2>No projects yet</h2>
            <p>Add a local project path above. Startup reads cached rows and does not scan repositories.</p>
          </div>
        ) : (
          <div className="project-list">
            {props.projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={props.busyProjectIds.has(project.id)}
                onUpdate={props.onUpdateProject}
                onRemove={props.onRemoveProject}
                onRefreshGit={props.onRefreshProjectGitStatus}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Task pulse</h2>
            <p>Cached task counts from SQLite. Runtime sessions are not started here.</p>
          </div>
          <button className="icon-button" onClick={props.onOpenTasks} title="Open task board">
            <Columns3 size={16} />
          </button>
        </div>
        <div className="task-count-grid">
          {taskStatusColumns.map((column) => (
            <div className="task-count-cell" key={column.status}>
              <strong>{props.tasks.filter((task) => task.status === column.status).length}</strong>
              <span>{column.label}</span>
            </div>
          ))}
        </div>
        <div className="activity-list compact-activity">
          {blockedTasks.length === 0 ? (
            <p className="muted">No blocked tasks.</p>
          ) : (
            blockedTasks.map((task) => (
              <div className="activity-row" key={task.id}>
                <ClipboardList size={15} />
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.projectName ?? "No project"} - {task.assigneeAgentName ?? "Unassigned"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Recent activity</h2>
            <p>Manual refreshes, project edits, and task work appear here from cached metadata.</p>
          </div>
        </div>
        <div className="activity-list">
          {recentProjects.length === 0 ? (
            <p className="muted">No recent project activity.</p>
          ) : (
            recentProjects.map((project) => (
              <div className="activity-row" key={project.id}>
                <GitBranch size={15} />
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.gitStatus} at {formatDate(project.lastActivityAt)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Runtime inventory</h2>
            <p>Cached local CLI availability. Refresh uses short bounded checks only.</p>
          </div>
          <button className="icon-button" onClick={props.onRefreshRuntimes} disabled={props.refreshing} title="Refresh runtimes">
            <RefreshCw size={16} className={props.refreshing ? "spinning" : undefined} />
          </button>
        </div>
        <div className="runtime-list">
          {props.runtimes.map((runtime) => (
            <div className="runtime-row" key={runtime.id}>
              <div>
                <strong>{runtime.name}</strong>
                <span>{runtime.cliPath ?? "Not detected"}</span>
              </div>
              <div className={`pill ${runtime.health}`}>{runtime.health}</div>
              <code>{runtime.version ?? "no version"}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="panel compact-panel">
        <h2>Default agents</h2>
        <div className="chip-grid">
          {props.agents.map((agent) => (
            <span key={agent.id}>{agent.name}</span>
          ))}
        </div>
      </section>

      <section className="panel compact-panel">
        <h2>Default channels</h2>
        <div className="chip-grid">
          {props.channels.map((channel) => (
            <span key={channel.id}>{channel.name}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function QuickChatView(props: {
  agents: AgentProfile[];
  channels: Channel[];
  projects: Project[];
  settings: AppSettings | null;
  messages: MessageRecord[];
  selectedChannelId: string;
  selectedAgentId: string;
  sending: boolean;
  streamingDraft: string;
  onSelectChannel: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onSend: (message: string, projectId: string | null) => void;
  onUpdateSettings: (patch: AppSettingsPatch) => void;
}): JSX.Element {
  const openAiAgents = props.agents.filter((agent) => agent.enabled && agent.providerType === "openai-compatible");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [settingsDraft, setSettingsDraft] = useState({
    corporateProviderName: props.settings?.corporateProviderName ?? "OpenAI-compatible",
    openAiCompatibleBaseUrl: props.settings?.openAiCompatibleBaseUrl ?? "",
    openAiCompatibleModel: props.settings?.openAiCompatibleModel ?? "gpt-4o-mini",
    openAiCompatibleApiKey: "",
    openAiCompatibleUseStreaming: props.settings?.openAiCompatibleUseStreaming ?? true
  });

  useEffect(() => {
    setSettingsDraft({
      corporateProviderName: props.settings?.corporateProviderName ?? "OpenAI-compatible",
      openAiCompatibleBaseUrl: props.settings?.openAiCompatibleBaseUrl ?? "",
      openAiCompatibleModel: props.settings?.openAiCompatibleModel ?? "gpt-4o-mini",
      openAiCompatibleApiKey: "",
      openAiCompatibleUseStreaming: props.settings?.openAiCompatibleUseStreaming ?? true
    });
  }, [props.settings]);

  function submit(): void {
    if (!message.trim()) {
      return;
    }
    props.onSend(message, projectId || null);
    setMessage("");
  }

  function saveSettings(): void {
    props.onUpdateSettings({
      corporateProviderName: settingsDraft.corporateProviderName,
      openAiCompatibleBaseUrl: settingsDraft.openAiCompatibleBaseUrl.trim() || null,
      openAiCompatibleModel: settingsDraft.openAiCompatibleModel,
      openAiCompatibleApiKey: settingsDraft.openAiCompatibleApiKey.trim() || undefined,
      openAiCompatibleUseStreaming: settingsDraft.openAiCompatibleUseStreaming,
      quickChatChannelId: props.selectedChannelId
    });
    setSettingsDraft((current) => ({ ...current, openAiCompatibleApiKey: "" }));
  }

  return (
    <div className="quick-chat-layout">
      <section className="panel quick-chat-panel">
        <div className="section-header">
          <div>
            <h2>Quick chat</h2>
            <p>Ask a non-coding question through an OpenAI-compatible provider. Responses are saved to the selected channel.</p>
          </div>
        </div>

        <div className="quick-chat-controls">
          <label>
            Channel
            <select value={props.selectedChannelId} onChange={(event) => props.onSelectChannel(event.target.value)}>
              {props.channels.map((channel) => (
                <option value={channel.id} key={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent profile
            <select value={props.selectedAgentId} onChange={(event) => props.onSelectAgent(event.target.value)}>
              {openAiAgents.map((agent) => (
                <option value={agent.id} key={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project context
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">No project</option>
              {props.projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="chat-timeline">
          {props.messages.length === 0 ? (
            <p className="muted">No messages in this channel yet.</p>
          ) : (
            props.messages.map((chatMessage) => (
              <div className={`chat-message ${chatMessage.authorType}`} key={chatMessage.id}>
                <strong>{chatMessage.authorType}</strong>
                <p>{chatMessage.content}</p>
                <span>{formatDate(chatMessage.createdAt)}</span>
              </div>
            ))
          )}
          {props.streamingDraft ? (
            <div className="chat-message assistant streaming">
              <strong>assistant</strong>
              <p>{props.streamingDraft}</p>
              <span>streaming...</span>
            </div>
          ) : null}
        </div>

        <div className="quick-chat-compose">
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask a quick non-coding question..." />
          <button className="primary-action" onClick={submit} disabled={props.sending || !message.trim()}>
            <MessageSquare size={15} />
            Send
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Provider settings</h2>
            <p>Base URL should include the provider API prefix, such as /v1. The API key is stored only in the main process settings file.</p>
          </div>
        </div>
        <div className="provider-settings-form">
          <label>
            Provider name
            <input value={settingsDraft.corporateProviderName} onChange={(event) => setSettingsDraft({ ...settingsDraft, corporateProviderName: event.target.value })} />
          </label>
          <label>
            Base URL
            <input value={settingsDraft.openAiCompatibleBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, openAiCompatibleBaseUrl: event.target.value })} placeholder="https://provider.example.com/v1" />
          </label>
          <label>
            Model
            <input value={settingsDraft.openAiCompatibleModel} onChange={(event) => setSettingsDraft({ ...settingsDraft, openAiCompatibleModel: event.target.value })} />
          </label>
          <label>
            API key {props.settings?.openAiCompatibleApiKeySet ? "(configured)" : "(not configured)"}
            <input
              type="password"
              value={settingsDraft.openAiCompatibleApiKey}
              onChange={(event) => setSettingsDraft({ ...settingsDraft, openAiCompatibleApiKey: event.target.value })}
              placeholder={props.settings?.openAiCompatibleApiKeySet ? "Leave blank to keep existing key" : "Required"}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settingsDraft.openAiCompatibleUseStreaming}
              onChange={(event) => setSettingsDraft({ ...settingsDraft, openAiCompatibleUseStreaming: event.target.checked })}
            />
            Stream responses when supported
          </label>
          <button className="primary-action" onClick={saveSettings}>
            <Save size={15} />
            Save provider
          </button>
        </div>
      </section>
    </div>
  );
}

function ReviewChannelsView(props: {
  agents: AgentProfile[];
  channels: Channel[];
  tasks: Task[];
  messages: MessageRecord[];
  selectedChannelId: string;
  selectedTaskId: string;
  selectedAgentIds: string[];
  running: boolean;
  synthesizing: boolean;
  onSelectChannel: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectAgents: (ids: string[]) => void;
  onRunRound: (prompt: string, taskId: string | null, agentIds: string[]) => void;
  onSynthesize: (taskId: string, instructions: string | null) => void;
}): JSX.Element {
  const openAiAgents = props.agents.filter((agent) => agent.enabled && agent.providerType === "openai-compatible");
  const selectedAgents = openAiAgents.filter((agent) => props.selectedAgentIds.includes(agent.id));
  const selectedTask = props.tasks.find((task) => task.id === props.selectedTaskId) ?? null;
  const taskById = useMemo(() => new Map(props.tasks.map((task) => [task.id, task])), [props.tasks]);
  const [prompt, setPrompt] = useState("Review this plan for correctness, missing steps, risks, and test coverage.");
  const [synthesisInstructions, setSynthesisInstructions] = useState("Turn the review replies into a concise implementation checklist.");

  function toggleAgent(agentId: string): void {
    if (props.selectedAgentIds.includes(agentId)) {
      props.onSelectAgents(props.selectedAgentIds.filter((id) => id !== agentId));
      return;
    }
    props.onSelectAgents([...props.selectedAgentIds, agentId]);
  }

  function runRound(): void {
    if (!prompt.trim() || selectedAgents.length < 3) {
      return;
    }
    props.onRunRound(prompt, props.selectedTaskId || null, selectedAgents.map((agent) => agent.id));
    setPrompt("");
  }

  function synthesize(): void {
    if (!selectedTask) {
      return;
    }
    props.onSynthesize(selectedTask.id, synthesisInstructions.trim() || null);
  }

  return (
    <div className="review-layout">
      <section className="panel review-controls-panel">
        <div className="section-header">
          <div>
            <h2>Group review channels</h2>
            <p>Request parallel feedback from OpenAI-compatible teammates and synthesize output back to a task.</p>
          </div>
        </div>

        <div className="review-controls-grid">
          <label>
            Channel
            <select value={props.selectedChannelId} onChange={(event) => props.onSelectChannel(event.target.value)}>
              {props.channels.map((channel) => (
                <option value={channel.id} key={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Linked task
            <select value={props.selectedTaskId} onChange={(event) => props.onSelectTask(event.target.value)}>
              <option value="">No task link</option>
              {props.tasks.map((task) => (
                <option value={task.id} key={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="agent-mention-grid">
          {openAiAgents.map((agent) => (
            <label className="checkbox-row agent-checkbox" key={agent.id}>
              <input type="checkbox" checked={props.selectedAgentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
              <span>@{agent.slug}</span>
              <small>{agent.role}</small>
            </label>
          ))}
        </div>
        <p className="muted">Mentions: {selectedAgents.length > 0 ? selectedAgents.map((agent) => `@${agent.slug}`).join(" ") : "select at least three agents"}</p>

        <label>
          Review request
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask the group to review a plan, implementation, or decision..." />
        </label>
        <button className="primary-action" onClick={runRound} disabled={props.running || selectedAgents.length < 3 || !prompt.trim()}>
          <FileCheck2 size={15} />
          {props.running ? "Running review..." : "Run review round"}
        </button>

        <div className="review-synthesis-box">
          <div className="detail-subsection-header">
            <h2>Synthesis</h2>
            <span className="pill muted-pill">{selectedTask ? selectedTask.title : "Task required"}</span>
          </div>
          <label>
            Synthesis instructions
            <textarea value={synthesisInstructions} onChange={(event) => setSynthesisInstructions(event.target.value)} />
          </label>
          <button className="primary-action" onClick={synthesize} disabled={props.synthesizing || !selectedTask}>
            <MessageSquare size={15} />
            {props.synthesizing ? "Synthesizing..." : "Synthesize to task"}
          </button>
        </div>
      </section>

      <section className="panel review-timeline-panel">
        <div className="section-header">
          <div>
            <h2>Timeline</h2>
            <p>Only this selected review channel renders the full timeline.</p>
          </div>
          <span className="pill muted-pill">{props.messages.length} messages</span>
        </div>
        <div className="chat-timeline review-timeline">
          {props.messages.length === 0 ? (
            <p className="muted">No review messages in this channel yet.</p>
          ) : (
            props.messages.map((message) => {
              const linkedTask = message.taskId ? taskById.get(message.taskId) : null;
              return (
                <div className={`chat-message ${message.authorType}`} key={message.id}>
                  <strong>{messageAuthorLabel(message, props.agents)}</strong>
                  <p>{message.content}</p>
                  <span>
                    {formatDate(message.createdAt)}
                    {linkedTask ? ` - ${linkedTask.title}` : ""}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function ApprovalsView(props: {
  approvals: ApprovalRecord[];
  tasks: Task[];
  sessions: SessionRecord[];
  onDecide: (approvalId: string, decision: "approve" | "deny", feedback: string | null) => void;
  onRefresh: () => void;
}): JSX.Element {
  const taskById = useMemo(() => new Map(props.tasks.map((task) => [task.id, task])), [props.tasks]);
  const sessionById = useMemo(() => new Map(props.sessions.map((session) => [session.id, session])), [props.sessions]);
  const pending = props.approvals.filter((approval) => approval.status === "pending");
  const resolved = props.approvals.filter((approval) => approval.status !== "pending");

  return (
    <div className="approvals-layout">
      <section className="panel approvals-panel">
        <div className="section-header">
          <div>
            <h2>Approval cards</h2>
            <p>High-risk runtime actions stay blocked here until you allow or deny them.</p>
          </div>
          <button className="icon-button" onClick={props.onRefresh} title="Refresh approvals">
            <RefreshCw size={15} />
          </button>
        </div>
        {pending.length === 0 ? (
          <div className="empty-state inline-empty">
            <div className="empty-icon">
              <ShieldAlert size={28} />
            </div>
            <h2>No pending approvals</h2>
            <p>Copilot permission requests will appear here when a task session asks to run a guarded action.</p>
          </div>
        ) : (
          <div className="approval-card-list">
            {pending.map((approval) => (
              <ApprovalCard
                approval={approval}
                task={approval.taskId ? taskById.get(approval.taskId) ?? null : null}
                session={approval.sessionId ? sessionById.get(approval.sessionId) ?? null : null}
                key={approval.id}
                onDecide={props.onDecide}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel approvals-panel">
        <div className="section-header">
          <div>
            <h2>Audit trail</h2>
            <p>Recent approval decisions are persisted and linked to task/session timelines.</p>
          </div>
          <span className="pill muted-pill">{resolved.length} resolved</span>
        </div>
        <div className="approval-audit-list">
          {resolved.length === 0 ? (
            <p className="muted">No approval decisions yet.</p>
          ) : (
            resolved.map((approval) => (
              <div className="approval-audit-row" key={approval.id}>
                <span className={`pill approval-status-${approval.status}`}>{approval.status}</span>
                <div>
                  <strong>{approval.summary}</strong>
                  <span>
                    {approval.taskId ? taskById.get(approval.taskId)?.title ?? approval.taskId : "No task"} - {formatDate(approval.resolvedAt ?? approval.requestedAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ApprovalCard(props: {
  approval: ApprovalRecord;
  task: Task | null;
  session: SessionRecord | null;
  onDecide: (approvalId: string, decision: "approve" | "deny", feedback: string | null) => void;
}): JSX.Element {
  const [feedback, setFeedback] = useState("");
  return (
    <article className={`approval-card approval-risk-${props.approval.riskLevel}`}>
      <div className="approval-card-header">
        <div>
          <span className={`pill approval-risk-${props.approval.riskLevel}`}>{props.approval.riskLevel} risk</span>
          <h2>{props.approval.summary}</h2>
        </div>
        <span className={`pill approval-status-${props.approval.status}`}>{props.approval.status}</span>
      </div>
      <div className="approval-card-meta">
        <span>Task: {props.task?.title ?? props.approval.taskId ?? "none"}</span>
        <span>Session: {props.session ? formatSessionId(props.session.id) : props.approval.sessionId ?? "none"}</span>
        <span>Action: {props.approval.actionType}</span>
        <span>Requested: {formatDate(props.approval.requestedAt)}</span>
      </div>
      <pre>{formatApprovalDetails(props.approval)}</pre>
      <label>
        Denial feedback
        <input value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Optional reason shown to the agent/session" />
      </label>
      <div className="approval-actions">
        <button className="primary-action" onClick={() => props.onDecide(props.approval.id, "approve", null)}>
          Allow once
        </button>
        <button className="danger-action" onClick={() => props.onDecide(props.approval.id, "deny", feedback.trim() || "Denied by user")}>
          Deny
        </button>
      </div>
    </article>
  );
}

function SessionMonitorView(props: {
  projects: Project[];
  tasks: Task[];
  sessions: SessionRecord[];
  agents: AgentProfile[];
  selectedSessionId: string | null;
  sessionDetail: SessionDetail | null;
  loading: boolean;
  busySessionIds: Set<string>;
  onSelectSession: (id: string) => void;
  onRefreshSelected: (id: string) => void;
  onDisconnectSession: (id: string) => void;
  onAbortSession: (id: string) => void;
  onSummarizeSession: (id: string) => void;
  savingSummaryIds: Set<string>;
}): JSX.Element {
  const projectById = useMemo(() => new Map(props.projects.map((project) => [project.id, project])), [props.projects]);
  const taskById = useMemo(() => new Map(props.tasks.map((task) => [task.id, task])), [props.tasks]);
  const agentById = useMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])), [props.agents]);
  const groupedSessions = useMemo(() => {
    const groups = new Map<string, { label: string; sessions: SessionRecord[] }>();
    for (const session of props.sessions) {
      const key = session.projectId ?? "unassigned";
      const label = session.projectId ? projectById.get(session.projectId)?.name ?? "Unknown project" : "No project";
      const group = groups.get(key) ?? { label, sessions: [] };
      group.sessions.push(session);
      groups.set(key, group);
    }
    return Array.from(groups.values());
  }, [projectById, props.sessions]);

  const selectedSession =
    props.sessionDetail?.session.id === props.selectedSessionId
      ? props.sessionDetail.session
      : props.sessions.find((session) => session.id === props.selectedSessionId) ?? null;
  const selectedTask = selectedSession?.taskId ? taskById.get(selectedSession.taskId) ?? null : null;
  const selectedAgent = selectedSession?.agentId ? agentById.get(selectedSession.agentId) ?? null : null;
  const busy = selectedSession ? props.busySessionIds.has(selectedSession.id) : false;

  return (
    <div className="session-monitor-layout">
      <section className="panel session-list-panel">
        <div className="section-header">
          <div>
            <h2>Sessions</h2>
            <p>Compact background state grouped by project. Full output loads only for the selected session.</p>
          </div>
        </div>

        {props.sessions.length === 0 ? (
          <div className="empty-state inline-empty">
            <div className="empty-icon">
              <TerminalSquare size={28} />
            </div>
            <h2>No sessions yet</h2>
            <p>Start a task session from the task detail panel to monitor it here.</p>
          </div>
        ) : (
          <div className="session-group-list">
            {groupedSessions.map((group) => (
              <div className="session-group" key={group.label}>
                <div className="session-group-header">
                  <h2>{group.label}</h2>
                  <span>{group.sessions.length}</span>
                </div>
                <div className="session-card-list">
                  {group.sessions.map((session) => {
                    const task = session.taskId ? taskById.get(session.taskId) : null;
                    const agent = session.agentId ? agentById.get(session.agentId) : null;
                    return (
                      <button
                        className={session.id === selectedSession?.id ? "session-card selected" : "session-card"}
                        key={session.id}
                        onClick={() => props.onSelectSession(session.id)}
                      >
                        <span className={`pill session-status-${session.status}`}>{session.status}</span>
                        <strong>{task?.title ?? formatSessionId(session.id)}</strong>
                        <span>{agent?.name ?? session.providerType} - {formatDate(session.lastEventAt ?? session.startedAt)}</span>
                        <span>{session.runs.length} runs - {session.runs.reduce((sum, run) => sum + run.lastSequenceNumber, 0)} messages</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel session-detail-panel">
        {!selectedSession ? (
          <div className="empty-state">
            <div className="empty-icon">
              <TerminalSquare size={28} />
            </div>
            <h2>No session selected</h2>
            <p>Select a session to view live output, status, git changes, and controls.</p>
          </div>
        ) : (
          <>
            <div className="section-header">
              <div>
                <h2>Session detail monitor</h2>
                <p>{selectedTask?.title ?? formatSessionId(selectedSession.id)} - Last activity {formatDate(selectedSession.lastEventAt ?? selectedSession.startedAt)}</p>
              </div>
              <div className="project-actions">
                <button
                  className="icon-button"
                  onClick={() => props.onRefreshSelected(selectedSession.id)}
                  disabled={props.loading || busy}
                  title="Refresh selected session and git changes"
                >
                  <RefreshCw size={15} className={props.loading ? "spinning" : undefined} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => props.onDisconnectSession(selectedSession.id)}
                  disabled={busy || isTerminalSessionStatus(selectedSession.status)}
                  title="Disconnect selected session"
                >
                  <PauseCircle size={15} />
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => props.onAbortSession(selectedSession.id)}
                  disabled={busy || isTerminalSessionStatus(selectedSession.status)}
                  title="Abort selected session"
                >
                  <X size={15} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => props.onSummarizeSession(selectedSession.id)}
                  disabled={props.savingSummaryIds.has(selectedSession.id)}
                  title="Save session summary"
                >
                  <Save size={15} />
                </button>
              </div>
            </div>

            <div className="session-detail-grid">
              <div>
                <span className={`pill session-status-${selectedSession.status}`}>{selectedSession.status}</span>
                <strong>Status</strong>
              </div>
              <div>
                <span>{selectedAgent?.name ?? selectedSession.providerType}</span>
                <strong>Agent</strong>
              </div>
              <div>
                <span>{selectedSession.model ?? "default"}</span>
                <strong>Model</strong>
              </div>
              <div>
                <span>{selectedSession.cwd ?? "Not cached"}</span>
                <strong>Working directory</strong>
              </div>
              <div>
                <span>{selectedSession.runs.reduce((sum, run) => sum + run.mountedSkills.length, 0)} mounted</span>
                <strong>Skills</strong>
              </div>
            </div>

            <div className="detail-subsection">
              <div className="detail-subsection-header">
                <h2>Changed files</h2>
                <span className="pill muted-pill">{props.sessionDetail?.changedFiles ? formatDate(props.sessionDetail.changedFiles.checkedAt) : "not checked"}</span>
              </div>
              <ChangedFilesSummary summary={props.sessionDetail?.changedFiles ?? null} />
            </div>

            <div className="detail-subsection">
              <div className="detail-subsection-header">
                <h2>Live output</h2>
                <span className="pill muted-pill">{props.sessionDetail?.messages.length ?? 0} loaded</span>
              </div>
              <div className="live-output" aria-live="polite">
                {!props.sessionDetail || props.sessionDetail.messages.length === 0 ? (
                  <p className="muted">No run messages recorded yet.</p>
                ) : (
                  props.sessionDetail.messages.map((message) => (
                    <div className={`live-message ${message.authorType}`} key={message.id}>
                      <div>
                        <strong>{message.authorType}</strong>
                        <span>Attempt {message.attemptNumber} #{message.sequenceNumber} - {message.contentType}</span>
                      </div>
                      <pre>{message.content}</pre>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="detail-subsection">
              <div className="detail-subsection-header">
                <h2>Events</h2>
                <span className="pill muted-pill">{props.sessionDetail?.events.length ?? 0} loaded</span>
              </div>
              <div className="session-event-list">
                {!props.sessionDetail || props.sessionDetail.events.length === 0 ? (
                  <p className="muted">No session events recorded yet.</p>
                ) : (
                  props.sessionDetail.events.map((event) => (
                    <div className="session-event-row" key={event.id}>
                      <div>
                        <strong>{event.eventType}</strong>
                        <span>{formatDate(event.createdAt)}</span>
                      </div>
                      <p>{event.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ChangedFilesSummary(props: { summary: SessionDetail["changedFiles"] }): JSX.Element {
  if (!props.summary) {
    return <p className="muted">Refresh the selected session to read a bounded git status summary.</p>;
  }

  return (
    <div className="changed-files-summary">
      <div className="session-summary">
        <span>Status: {props.summary.status}</span>
        <span>Branch: {props.summary.branch ?? "unknown"}</span>
        <span>{props.summary.totalCount} changed entries{props.summary.truncated ? " (truncated)" : ""}</span>
      </div>
      {props.summary.error ? <p className="muted">{props.summary.error}</p> : null}
      {props.summary.files.length === 0 ? (
        <p className="muted">No changed files reported.</p>
      ) : (
        <div className="changed-file-list">
          {props.summary.files.map((file) => (
            <div className="changed-file-row" key={`${file.status}:${file.path}`}>
              <code>{file.status}</code>
              <span>{file.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryView(props: {
  projects: Project[];
  skills: LocalSkill[];
  selectedProjectId: string | null;
  projectMemory: ProjectMemory | null;
  loading: boolean;
  onSelectProject: (id: string) => void;
  onRefreshProject: (id: string) => void;
  onCreateSkill: (input: { name: string; description?: string | null; content: string }) => void;
  onDeleteSkill: (id: string) => void;
  onAttachSkill: (projectId: string, skillId: string, mountApproved: boolean) => void;
  onDetachSkill: (projectId: string, skillId: string) => void;
}): JSX.Element {
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId) ?? null;
  const attachedSkillIds = new Set(props.projectMemory?.attachedSkills.map((skill) => skill.id) ?? []);

  return (
    <div className="memory-layout">
      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Project memory</h2>
            <p>Bounded checks for known instruction files. Refresh is manual and stores a local capsule snapshot.</p>
          </div>
          {selectedProject ? (
            <button className="icon-button" onClick={() => props.onRefreshProject(selectedProject.id)} disabled={props.loading} title="Refresh memory">
              <RefreshCw size={15} className={props.loading ? "spinning" : undefined} />
            </button>
          ) : null}
        </div>
        <label>
          Project
          <select value={props.selectedProjectId ?? ""} onChange={(event) => props.onSelectProject(event.target.value)} disabled={props.projects.length === 0}>
            {props.projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        {!props.projectMemory ? (
          <div className="empty-state inline-empty">
            <div className="empty-icon">
              <Archive size={28} />
            </div>
            <h2>No memory loaded</h2>
            <p>Select a project to view detected instructions and local memory.</p>
          </div>
        ) : (
          <div className="memory-stack">
            <div className="memory-stat-grid">
              <span>{props.projectMemory.detectedInstructionFiles.length} instruction files</span>
              <span>{props.projectMemory.warnings.length} warnings</span>
              <span>{props.projectMemory.attachedSkills.length} attached skills</span>
              <span>Snapshot {formatDate(props.projectMemory.latestSnapshotAt)}</span>
            </div>

            <div className="detail-subsection">
              <div className="detail-subsection-header">
                <h2>Detected instruction files</h2>
                <span className="pill muted-pill">{formatDate(props.projectMemory.checkedAt)}</span>
              </div>
              {props.projectMemory.detectedInstructionFiles.length === 0 ? (
                <p className="muted">No supported instruction files detected.</p>
              ) : (
                <div className="instruction-file-list">
                  {props.projectMemory.detectedInstructionFiles.map((file) => (
                    <div className="instruction-file-row" key={`${file.kind}:${file.path}`}>
                      <strong>{file.path}</strong>
                      <span>{file.kind} - {file.sizeBytes} bytes - {formatDate(file.modifiedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="detail-subsection">
              <h2>Coverage warnings</h2>
              {props.projectMemory.warnings.length === 0 ? (
                <p className="muted">No warnings.</p>
              ) : (
                <div className="instruction-file-list">
                  {props.projectMemory.warnings.map((warning) => (
                    <div className={`instruction-file-row ${warning.severity}`} key={warning.code}>
                      <strong>{warning.message}</strong>
                      <span>{warning.code}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="detail-subsection">
              <h2>Context capsule</h2>
              <pre className="memory-capsule">{props.projectMemory.contextCapsule}</pre>
            </div>

            <div className="detail-subsection">
              <h2>Session summaries</h2>
              {props.projectMemory.sessionSummaries.length === 0 ? (
                <p className="muted">No saved summaries yet. Save one from the Sessions view.</p>
              ) : (
                <div className="instruction-file-list">
                  {props.projectMemory.sessionSummaries.map((summary) => (
                    <div className="instruction-file-row" key={summary.id}>
                      <strong>{formatDate(summary.createdAt)}</strong>
                      <span>{summary.summary.slice(0, 260)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Local skill library</h2>
            <p>Repo skill mounts require explicit approval when attaching a skill to a project.</p>
          </div>
        </div>
        <SkillCreateForm onCreate={props.onCreateSkill} />
        <div className="skill-library-list">
          {props.skills.length === 0 ? (
            <p className="muted">No local skills yet.</p>
          ) : (
            props.skills.map((skill) => {
              const attached = attachedSkillIds.has(skill.id);
              return (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  attached={attached}
                  selectedProjectId={selectedProject?.id ?? null}
                  attachedSkill={props.projectMemory?.attachedSkills.find((candidate) => candidate.id === skill.id) ?? null}
                  onAttach={props.onAttachSkill}
                  onDetach={props.onDetachSkill}
                  onDelete={props.onDeleteSkill}
                />
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function SkillCreateForm(props: { onCreate: (input: { name: string; description?: string | null; content: string }) => void }): JSX.Element {
  const [form, setForm] = useState({ name: "", description: "", content: "" });

  function submit(): void {
    if (!form.name.trim() || !form.content.trim()) {
      return;
    }
    props.onCreate({
      name: form.name,
      description: form.description.trim() || null,
      content: form.content
    });
    setForm({ name: "", description: "", content: "" });
  }

  return (
    <div className="skill-form">
      <label>
        Name
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Testing checklist" />
      </label>
      <label>
        Description
        <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Optional" />
      </label>
      <label className="wide-field">
        Skill instructions
        <textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="# Skill\nUse this skill when..." />
      </label>
      <button className="primary-action" onClick={submit} disabled={!form.name.trim() || !form.content.trim()}>
        <Save size={15} />
        Save skill
      </button>
    </div>
  );
}

function SkillCard(props: {
  skill: LocalSkill;
  attached: boolean;
  attachedSkill: ProjectMemory["attachedSkills"][number] | null;
  selectedProjectId: string | null;
  onAttach: (projectId: string, skillId: string, mountApproved: boolean) => void;
  onDetach: (projectId: string, skillId: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const [mountApproved, setMountApproved] = useState(false);

  useEffect(() => {
    setMountApproved(Boolean(props.attachedSkill?.mountApproved));
  }, [props.attachedSkill]);

  return (
    <article className="skill-card">
      <div className="project-card-header">
        <div className="project-title">
          <h3>{props.skill.name}</h3>
          <span>{props.skill.description ?? props.skill.slug}</span>
        </div>
        <button className="icon-button danger" onClick={() => props.onDelete(props.skill.id)} title="Delete skill">
          <Trash2 size={15} />
        </button>
      </div>
      <pre>{props.skill.content.slice(0, 500)}</pre>
      <label className="checkbox-row">
        <input type="checkbox" checked={mountApproved} onChange={(event) => setMountApproved(event.target.checked)} />
        Approve provider-native repo mount for this project
      </label>
      <div className="disabled-control-row">
        {props.attached && props.selectedProjectId ? (
          <button onClick={() => props.onDetach(props.selectedProjectId as string, props.skill.id)}>Detach</button>
        ) : (
          <button
            onClick={() => props.selectedProjectId && props.onAttach(props.selectedProjectId, props.skill.id, mountApproved)}
            disabled={!props.selectedProjectId}
          >
            Attach
          </button>
        )}
        {props.attached && props.selectedProjectId ? (
          <button onClick={() => props.onAttach(props.selectedProjectId as string, props.skill.id, mountApproved)}>Update approval</button>
        ) : null}
      </div>
    </article>
  );
}

function TaskBoardView(props: {
  projects: Project[];
  tasks: Task[];
  sessions: SessionRecord[];
  agents: AgentProfile[];
  addingTask: boolean;
  busyTaskIds: Set<string>;
  selectedTaskId: string | null;
  taskMemory: TaskMemory | null;
  taskComments: TaskCommentRecord[];
  approvals: ApprovalRecord[];
  onCreateTask: (input: TaskCreateInput) => void;
  onUpdateTask: (input: TaskUpdateInput) => void;
  onDeleteTask: (id: string) => void;
  onStartTaskSession: (id: string) => void;
  onResumeTaskSession: (id: string) => void;
  onDisconnectSession: (id: string) => void;
  onAbortSession: (id: string) => void;
  onSelectTask: (id: string | null) => void;
  onRefreshTaskMemory: (id: string) => void;
}): JSX.Element {
  const [filters, setFilters] = useState<TaskFilters>({
    projectId: "all",
    status: "all",
    priority: "all",
    assigneeAgentId: "all"
  });

  const filteredTasks = useMemo(
    () =>
      props.tasks.filter((task) => {
        return (
          (filters.projectId === "all" || task.projectId === filters.projectId) &&
          (filters.status === "all" || task.status === filters.status) &&
          (filters.priority === "all" || task.priority === filters.priority) &&
          (filters.assigneeAgentId === "all" ||
            (filters.assigneeAgentId === "" ? task.assigneeAgentId === null : task.assigneeAgentId === filters.assigneeAgentId))
        );
      }),
    [filters, props.tasks]
  );

  const visibleColumns =
    filters.status === "all" ? taskStatusColumns : taskStatusColumns.filter((column) => column.status === filters.status);
  const selectedTask = props.tasks.find((task) => task.id === props.selectedTaskId) ?? filteredTasks[0] ?? null;

  return (
    <div className="task-layout">
      <section className="panel task-controls">
        <div className="section-header">
          <div>
            <h2>New task</h2>
            <p>Create cached task records only. Sessions, branches, worktrees, and scans remain manual future actions.</p>
          </div>
        </div>
        <TaskCreateForm
          agents={props.agents}
          projects={props.projects}
          adding={props.addingTask}
          onCreate={props.onCreateTask}
        />
      </section>

      <section className="panel task-filters">
        <div className="section-header">
          <div>
            <h2>Board filters</h2>
            <p>Filters run in the renderer over cached task rows.</p>
          </div>
        </div>
        <div className="filter-grid">
          <label>
            Project
            <select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}>
              <option value="all">All projects</option>
              {props.projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as TaskStatus | "all" })}>
              <option value="all">All statuses</option>
              {taskStatusColumns.map((column) => (
                <option value={column.status} key={column.status}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value as TaskPriority | "all" })}>
              <option value="all">All priorities</option>
              {taskPriorities.map((priority) => (
                <option value={priority.priority} key={priority.priority}>
                  {priority.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select value={filters.assigneeAgentId} onChange={(event) => setFilters({ ...filters, assigneeAgentId: event.target.value })}>
              <option value="all">All agents</option>
              <option value="">Unassigned</option>
              {props.agents.map((agent) => (
                <option value={agent.id} key={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="kanban-board" aria-label="Task board">
        {props.projects.length === 0 ? (
          <div className="panel empty-state inline-empty">
            <div className="empty-icon">
              <ClipboardList size={28} />
            </div>
            <h2>No project registered</h2>
            <p>Add a project before creating tasks so work can stay linked to a local repository record.</p>
          </div>
        ) : (
          visibleColumns.map((column) => {
            const columnTasks = filteredTasks.filter((task) => task.status === column.status);
            return (
              <div className="kanban-column" key={column.status}>
                <div className="kanban-column-header">
                  <h2>{column.label}</h2>
                  <span>{columnTasks.length}</span>
                </div>
                <div className="task-card-list">
                  {columnTasks.length === 0 ? (
                    <p className="muted empty-column">No tasks</p>
                  ) : (
                    columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        selected={selectedTask?.id === task.id}
                        busy={props.busyTaskIds.has(task.id)}
                        onSelect={() => props.onSelectTask(task.id)}
                        onMove={(status) => props.onUpdateTask({ id: task.id, status })}
                        onDelete={() => props.onDeleteTask(task.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      <TaskDetailView
        agents={props.agents}
        projects={props.projects}
        sessions={props.sessions.filter((session) => session.taskId === selectedTask?.id)}
        task={selectedTask}
        busy={selectedTask ? props.busyTaskIds.has(selectedTask.id) : false}
        onUpdate={props.onUpdateTask}
        onDelete={props.onDeleteTask}
        onStartSession={props.onStartTaskSession}
        onResumeSession={props.onResumeTaskSession}
        onDisconnectSession={props.onDisconnectSession}
        onAbortSession={props.onAbortSession}
        taskMemory={props.taskMemory}
        taskComments={props.taskComments}
        approvals={props.approvals}
        onRefreshTaskMemory={props.onRefreshTaskMemory}
      />
    </div>
  );
}

function TaskCreateForm(props: {
  projects: Project[];
  agents: AgentProfile[];
  adding: boolean;
  onCreate: (input: TaskCreateInput) => void;
}): JSX.Element {
  const defaultProjectId = props.projects[0]?.id ?? "";
  const defaultAgentId = props.agents.find((agent) => agent.enabled)?.id ?? "";
  const [form, setForm] = useState({
    projectId: defaultProjectId,
    title: "",
    priority: "medium" as TaskPriority,
    assigneeAgentId: defaultAgentId,
    dueAt: ""
  });

  useEffect(() => {
    setForm((current) => ({
      ...current,
      projectId: current.projectId || defaultProjectId,
      assigneeAgentId: current.assigneeAgentId || defaultAgentId
    }));
  }, [defaultAgentId, defaultProjectId]);

  function submit(): void {
    if (!form.projectId || !form.title.trim()) {
      return;
    }

    props.onCreate({
      projectId: form.projectId,
      title: form.title,
      priority: form.priority,
      assigneeAgentId: form.assigneeAgentId || null,
      dueAt: form.dueAt || null
    });
    setForm({ projectId: form.projectId, title: "", priority: "medium", assigneeAgentId: form.assigneeAgentId, dueAt: "" });
  }

  return (
    <div className="task-form">
      <label>
        Project
        <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} disabled={props.projects.length === 0}>
          {props.projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Implement task board" />
      </label>
      <label>
        Priority
        <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })}>
          {taskPriorities.map((priority) => (
            <option value={priority.priority} key={priority.priority}>
              {priority.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select value={form.assigneeAgentId} onChange={(event) => setForm({ ...form, assigneeAgentId: event.target.value })}>
          <option value="">Unassigned</option>
          {props.agents.map((agent) => (
            <option value={agent.id} key={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input type="date" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
      </label>
      <button className="primary-action" disabled={props.adding || !form.projectId || !form.title.trim()} onClick={submit}>
        <ClipboardList size={16} />
        Create
      </button>
    </div>
  );
}

function TaskCard(props: {
  task: Task;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onMove: (status: TaskStatus) => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <article className={props.selected ? "task-card selected" : "task-card"} onClick={props.onSelect}>
      <div className="task-card-header">
        <div>
          <span className="task-id">{formatTaskId(props.task.id)}</span>
          <h3>{props.task.title}</h3>
        </div>
        <button
          className="icon-button danger small-icon-button"
          onClick={(event) => {
            event.stopPropagation();
            props.onDelete();
          }}
          disabled={props.busy}
          title="Delete task"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="task-card-pills">
        <span className={`pill task-status-${props.task.status}`}>{statusLabel(props.task.status)}</span>
        <span className={`pill priority-${props.task.priority}`}>{priorityLabel(props.task.priority)}</span>
      </div>

      <div className="task-card-meta">
        <span><ClipboardList size={13} />{props.task.projectName ?? "No project"}</span>
        <span><UserRound size={13} />{props.task.assigneeAgentName ?? "Unassigned"}</span>
        <span><CalendarDays size={13} />{props.task.dueAt ? formatDateOnly(props.task.dueAt) : "No due date"}</span>
        <span><GitBranch size={13} />{props.task.branch ?? "No branch"}</span>
        <span><Archive size={13} />{props.task.worktreePath ?? "No worktree"}</span>
        <span><TerminalSquare size={13} />{props.task.sessionId ?? "No session"}</span>
        <span><FileCheck2 size={13} />{props.task.testStatus ?? "Not run"}</span>
        <span><Columns3 size={13} />{props.task.changedFilesCount === null ? "Files cached later" : `${props.task.changedFilesCount} changed`}</span>
        <span><RefreshCw size={13} />{formatDate(props.task.lastActivityAt)}</span>
      </div>

      <label className="inline-select">
        Move
        <select
          value={props.task.status}
          disabled={props.busy}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => props.onMove(event.target.value as TaskStatus)}
        >
          {taskStatusColumns.map((column) => (
            <option value={column.status} key={column.status}>
              {column.label}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

function TaskDetailView(props: {
  projects: Project[];
  agents: AgentProfile[];
  sessions: SessionRecord[];
  task: Task | null;
  busy: boolean;
  onUpdate: (input: TaskUpdateInput) => void;
  onDelete: (id: string) => void;
  onStartSession: (id: string) => void;
  onResumeSession: (id: string) => void;
  onDisconnectSession: (id: string) => void;
  onAbortSession: (id: string) => void;
  taskMemory: TaskMemory | null;
  taskComments: TaskCommentRecord[];
  approvals: ApprovalRecord[];
  onRefreshTaskMemory: (id: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState({
    projectId: "",
    title: "",
    description: "",
    status: "open" as TaskStatus,
    priority: "medium" as TaskPriority,
    assigneeAgentId: "",
    dueAt: "",
    branch: "",
    worktreePath: ""
  });

  useEffect(() => {
    if (!props.task) {
      return;
    }

    setDraft({
      projectId: props.task.projectId ?? "",
      title: props.task.title,
      description: props.task.description ?? "",
      status: props.task.status,
      priority: props.task.priority,
      assigneeAgentId: props.task.assigneeAgentId ?? "",
      dueAt: props.task.dueAt?.slice(0, 10) ?? "",
      branch: props.task.branch ?? "",
      worktreePath: props.task.worktreePath ?? ""
    });
  }, [props.task]);

  if (!props.task) {
    return (
      <section className="panel task-detail">
        <div className="empty-state">
          <div className="empty-icon">
            <ClipboardList size={28} />
          </div>
          <h2>No task selected</h2>
          <p>Create or select a task to view branch, worktree, and timeline placeholders.</p>
        </div>
      </section>
    );
  }

  const task = props.task;
  const activeSession = props.sessions[0] ?? null;
  const latestRuns = activeSession?.runs ?? [];

  function save(): void {
    if (!draft.title.trim()) {
      return;
    }

    props.onUpdate({
      id: task.id,
      projectId: draft.projectId || null,
      title: draft.title,
      description: draft.description.trim() || null,
      status: draft.status,
      priority: draft.priority,
      assigneeAgentId: draft.assigneeAgentId || null,
      dueAt: draft.dueAt || null,
      branch: draft.branch.trim() || null,
      worktreePath: draft.worktreePath.trim() || null
    });
  }

  return (
    <section className="panel task-detail">
      <div className="section-header">
        <div>
          <h2>Task detail</h2>
          <p>{formatTaskId(task.id)} - Last activity {formatDate(task.lastActivityAt)}</p>
        </div>
        <div className="project-actions">
          <button className="icon-button" onClick={save} disabled={props.busy || !draft.title.trim()} title="Save task">
            <Save size={15} />
          </button>
          <button className="icon-button danger" onClick={() => props.onDelete(task.id)} disabled={props.busy} title="Delete task">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="task-detail-form">
        <label>
          Title
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <label>
          Project
          <select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
            <option value="">No project</option>
            {props.projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TaskStatus })}>
            {taskStatusColumns.map((column) => (
              <option value={column.status} key={column.status}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>
            {taskPriorities.map((priority) => (
              <option value={priority.priority} key={priority.priority}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignee
          <select value={draft.assigneeAgentId} onChange={(event) => setDraft({ ...draft, assigneeAgentId: event.target.value })}>
            <option value="">Unassigned</option>
            {props.agents.map((agent) => (
              <option value={agent.id} key={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <input type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} />
        </label>
        <label>
          Branch
          <input value={draft.branch} onChange={(event) => setDraft({ ...draft, branch: event.target.value })} placeholder="lelio/task-id-title" />
        </label>
        <label>
          Worktree
          <input value={draft.worktreePath} onChange={(event) => setDraft({ ...draft, worktreePath: event.target.value })} placeholder="~/Library/Application Support/Lelio/worktrees/..." />
        </label>
        <label className="wide-field">
          Description
          <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
      </div>

      <div className="detail-subsection">
        <div className="detail-subsection-header">
          <h2>Session foundation</h2>
          <span className="pill muted-pill">{activeSession?.externalSessionId ?? task.sessionId ?? "No session yet"}</span>
        </div>
        <div className="disabled-control-row">
          <button
            disabled={props.busy || Boolean(activeSession)}
            onClick={() => props.onStartSession(task.id)}
          >
            <Play size={14} />Start
          </button>
          <button
            disabled={props.busy || !activeSession}
            onClick={() => props.onResumeSession(task.id)}
          >
            <RefreshCw size={14} />Resume
          </button>
          <button
            disabled={props.busy || !activeSession || isTerminalSessionStatus(activeSession.status)}
            onClick={() => props.onDisconnectSession(activeSession.id)}
          >
            <PauseCircle size={14} />Disconnect
          </button>
          <button
            disabled={props.busy || !activeSession || isTerminalSessionStatus(activeSession.status)}
            onClick={() => props.onAbortSession(activeSession.id)}
          >
            <X size={14} />Abort
          </button>
          <button disabled><Archive size={14} />Archive</button>
        </div>
        {activeSession ? (
          <div className="session-summary">
            <span>Status: {activeSession.status}</span>
            <span>CWD: {activeSession.cwd ?? "Not cached"}</span>
            <span>Last event: {formatDate(activeSession.lastEventAt)}</span>
          </div>
        ) : null}
      </div>

      <div className="detail-subsection">
        <div className="detail-subsection-header">
          <h2>Project memory</h2>
          <button className="icon-button" onClick={() => props.onRefreshTaskMemory(task.id)} title="Refresh task memory">
            <RefreshCw size={15} />
          </button>
        </div>
        {props.taskMemory?.projectMemory ? (
          <div className="memory-task-summary">
            <span>{props.taskMemory.projectMemory.detectedInstructionFiles.length} instruction files</span>
            <span>{props.taskMemory.projectMemory.warnings.length} warnings</span>
            <span>{props.taskMemory.mountableSkills.length} approved skill mounts</span>
            <pre>{props.taskMemory.projectMemory.contextCapsule.slice(0, 700)}</pre>
          </div>
        ) : (
          <p className="muted">No project memory loaded for this task.</p>
        )}
      </div>

      <div className="detail-subsection">
        <div className="detail-subsection-header">
          <h2>Review output</h2>
          <span className="pill muted-pill">{props.taskComments.length} comments</span>
        </div>
        {props.taskComments.length === 0 ? (
          <p className="muted">No synthesized review comments linked to this task yet.</p>
        ) : (
          <div className="task-comment-list">
            {props.taskComments.map((comment) => (
              <article className="task-comment" key={comment.id}>
                <div className="task-comment-header">
                  <strong>{comment.authorType}</strong>
                  <span>{formatDate(comment.createdAt)}</span>
                </div>
                <p>{comment.content}</p>
                {comment.checklist.length > 0 ? (
                  <ul>
                    {comment.checklist.map((item, index) => (
                      <li key={`${comment.id}-${index}`}>
                        <input type="checkbox" checked={item.checked} readOnly />
                        <span>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="detail-subsection">
        <div className="detail-subsection-header">
          <h2>Approval audit</h2>
          <span className="pill muted-pill">{props.approvals.length} records</span>
        </div>
        {props.approvals.length === 0 ? (
          <p className="muted">No guardrail approvals have been requested for this task.</p>
        ) : (
          <div className="approval-mini-list">
            {props.approvals.map((approval) => (
              <div className="approval-mini-row" key={approval.id}>
                <span className={`pill approval-status-${approval.status}`}>{approval.status}</span>
                <div>
                  <strong>{approval.summary}</strong>
                  <span>{approval.riskLevel} risk - {formatDate(approval.requestedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="detail-subsection">
        <div className="detail-subsection-header">
          <h2>Runs</h2>
          <span className="pill muted-pill">{latestRuns.length} attempts</span>
        </div>
        {latestRuns.length === 0 ? (
          <div className="timeline-placeholder">
            <div className="timeline-dot" />
            <div>
              <strong>Task record created</strong>
              <span>{formatDate(task.createdAt)}</span>
            </div>
          </div>
        ) : (
          <div className="run-list">
            {latestRuns.map((run) => (
              <div className="run-row" key={run.id}>
                <div>
                  <strong>Attempt {run.attemptNumber}</strong>
                  <span>{run.status} - {run.lastSequenceNumber} messages</span>
                  {run.mountedSkills.length > 0 ? (
                    <span>Mounted skills: {run.mountedSkills.map((skill) => skill.skillName).join(", ")}</span>
                  ) : null}
                </div>
                <span>{formatDate(run.startedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectAddForm(props: { adding: boolean; onAdd: (input: ProjectCreateInput) => void }): JSX.Element {
  const [form, setForm] = useState({
    path: "",
    name: "",
    packageManager: "",
    testCommand: "",
    buildCommand: ""
  });

  function submit(): void {
    if (!form.path.trim()) {
      return;
    }
    props.onAdd({
      path: form.path,
      name: form.name.trim() || undefined,
      packageManager: form.packageManager.trim() || undefined,
      testCommand: form.testCommand.trim() || undefined,
      buildCommand: form.buildCommand.trim() || undefined
    });
    setForm({ path: "", name: "", packageManager: "", testCommand: "", buildCommand: "" });
  }

  return (
    <div className="project-form">
      <label>
        Path
        <input value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} placeholder="/Users/me/project" />
      </label>
      <label>
        Name
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Auto from folder" />
      </label>
      <label>
        Package manager
        <input value={form.packageManager} onChange={(event) => setForm({ ...form, packageManager: event.target.value })} placeholder="Auto detect" />
      </label>
      <label>
        Test command
        <input value={form.testCommand} onChange={(event) => setForm({ ...form, testCommand: event.target.value })} placeholder="npm test" />
      </label>
      <label>
        Build command
        <input value={form.buildCommand} onChange={(event) => setForm({ ...form, buildCommand: event.target.value })} placeholder="npm run build" />
      </label>
      <button className="primary-action" disabled={props.adding || !form.path.trim()} onClick={submit}>
        <FolderPlus size={16} />
        Add
      </button>
    </div>
  );
}

function ProjectCard(props: {
  project: Project;
  busy: boolean;
  onUpdate: (input: ProjectUpdateInput) => void;
  onRemove: (id: string) => void;
  onRefreshGit: (id: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: props.project.name,
    packageManager: props.project.packageManager ?? "",
    testCommand: props.project.testCommand ?? "",
    buildCommand: props.project.buildCommand ?? ""
  });

  function save(): void {
    props.onUpdate({
      id: props.project.id,
      name: draft.name,
      packageManager: draft.packageManager.trim() || null,
      testCommand: draft.testCommand.trim() || null,
      buildCommand: draft.buildCommand.trim() || null
    });
    setEditing(false);
  }

  return (
    <article className="project-card">
      <div className="project-card-header">
        <div className="project-title">
          {editing ? (
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          ) : (
            <h3>{props.project.name}</h3>
          )}
          <span>{props.project.path}</span>
        </div>
        <div className="project-actions">
          <button className="icon-button" onClick={() => props.onRefreshGit(props.project.id)} disabled={props.busy} title="Refresh git status">
            <RefreshCw size={15} className={props.busy ? "spinning" : undefined} />
          </button>
          <button className="icon-button" onClick={() => setEditing(!editing)} disabled={props.busy} title={editing ? "Cancel edit" : "Edit project"}>
            {editing ? <X size={15} /> : <Pencil size={15} />}
          </button>
          <button className="icon-button danger" onClick={() => props.onRemove(props.project.id)} disabled={props.busy} title="Remove project">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="project-meta">
        <span className={`pill ${props.project.gitStatus}`}>{gitStatusLabel(props.project)}</span>
        <span>{props.project.gitBranch ?? props.project.defaultBranch ?? "No branch cached"}</span>
        <span>{props.project.packageManager ?? "No package manager"}</span>
        <span>{props.project.gitLastCheckedAt ? `Checked ${formatDate(props.project.gitLastCheckedAt)}` : "Not checked"}</span>
      </div>

      {editing ? (
        <div className="project-edit-grid">
          <label>
            Package manager
            <input value={draft.packageManager} onChange={(event) => setDraft({ ...draft, packageManager: event.target.value })} />
          </label>
          <label>
            Test command
            <input value={draft.testCommand} onChange={(event) => setDraft({ ...draft, testCommand: event.target.value })} />
          </label>
          <label>
            Build command
            <input value={draft.buildCommand} onChange={(event) => setDraft({ ...draft, buildCommand: event.target.value })} />
          </label>
          <button className="primary-action" onClick={save} disabled={props.busy || !draft.name.trim()}>
            <Save size={15} />
            Save
          </button>
        </div>
      ) : (
        <div className="command-row">
          <code>{props.project.testCommand ?? "No test command"}</code>
          <code>{props.project.buildCommand ?? "No build command"}</code>
        </div>
      )}
    </article>
  );
}

function gitStatusLabel(project: Project): string {
  if (project.gitStatus === "dirty") {
    return `${project.gitChangedFilesCount} changed`;
  }
  if (project.gitStatus === "clean") {
    return "clean";
  }
  if (project.gitStatus === "not-git") {
    return "not git";
  }
  if (project.gitStatus === "error") {
    return "git error";
  }
  return "unknown";
}

function isActiveSessionStatus(status: SessionStatus): boolean {
  return ["running", "idle", "waiting", "blocked"].includes(status);
}

function isTerminalSessionStatus(status: SessionStatus): boolean {
  return ["completed", "failed", "aborted", "disconnected"].includes(status);
}

function messageCursors(detail: SessionDetail): Record<string, number> {
  const cursors = detail.session.runs.reduce<Record<string, number>>((current, run) => {
    if (run.id) {
      current[run.id] = run.lastSequenceNumber;
    }
    return current;
  }, {});

  return detail.messages.reduce<Record<string, number>>((cursors, message) => {
    cursors[message.runId] = Math.max(cursors[message.runId] ?? 0, message.sequenceNumber);
    return cursors;
  }, cursors);
}

function latestEventCreatedAt(detail: SessionDetail): string | undefined {
  return detail.events.length > 0 ? detail.events[detail.events.length - 1].createdAt : undefined;
}

function mergeSessionDetail(current: SessionDetail | null, next: SessionDetail, append: boolean): SessionDetail {
  const changedFiles = next.changedFiles ?? (current?.session.id === next.session.id ? current.changedFiles : null);
  if (!append || current?.session.id !== next.session.id) {
    return { ...next, changedFiles };
  }

  return {
    ...next,
    changedFiles,
    messages: mergeById(current.messages, next.messages).sort(
      (left, right) => left.attemptNumber - right.attemptNumber || left.sequenceNumber - right.sequenceNumber
    ),
    events: mergeById(current.events, next.events).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  };
}

function mergeById<T extends { id: string }>(current: T[], next: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of next) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function statusLabel(status: TaskStatus): string {
  return taskStatusColumns.find((column) => column.status === status)?.label ?? status;
}

function priorityLabel(priority: TaskPriority): string {
  return taskPriorities.find((candidate) => candidate.priority === priority)?.label ?? priority;
}

function messageAuthorLabel(message: MessageRecord, agents: AgentProfile[]): string {
  const metadataName = typeof message.metadata.agentName === "string" ? message.metadata.agentName : null;
  const agentName = message.authorId ? agents.find((agent) => agent.id === message.authorId)?.name ?? null : null;
  if (metadataName || agentName) {
    return message.authorType === "system" ? `System / ${metadataName ?? agentName}` : metadataName ?? agentName ?? message.authorType;
  }
  return message.authorType;
}

function formatApprovalDetails(approval: ApprovalRecord): string {
  const permissionRequest = approval.request.permissionRequest;
  if (permissionRequest && typeof permissionRequest === "object") {
    return JSON.stringify(permissionRequest, null, 2);
  }
  return JSON.stringify(approval.request, null, 2);
}

function viewTitle(view: View): string {
  if (view === "settings") {
    return "Settings";
  }
  if (view === "tasks") {
    return "Tasks";
  }
  if (view === "sessions") {
    return "Sessions";
  }
  if (view === "memory") {
    return "Memory";
  }
  if (view === "chat") {
    return "Quick Chat";
  }
  if (view === "reviews") {
    return "Reviews";
  }
  if (view === "approvals") {
    return "Approvals";
  }
  return "Dashboard";
}

function formatTaskId(id: string): string {
  return id.replace(/^task-/, "").slice(0, 8);
}

function formatSessionId(id: string): string {
  return id.replace(/^session-/, "").slice(0, 12);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "never";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function SettingsView(props: {
  settings: AppSettings | null;
  health: DatabaseHealth | null;
  backups: LocalBackup[];
  updateStrategy: UpdateStrategy | null;
  cleanupPreview: CleanupPreview | null;
  busy: boolean;
  notice: string | null;
  onCreateBackup: () => void;
  onRestoreBackup: (backupPath: string) => void;
  onTestNotification: () => void;
  onCreateSampleProject: () => void;
  onRefreshPolish: () => void;
  onExecuteCleanup: (taskIds: string[]) => void;
}): JSX.Element {
  const settings = props.settings;
  const deletableCleanup = props.cleanupPreview?.candidates.filter((candidate) => candidate.safeToDelete) ?? [];
  return (
    <div className="settings-layout">
      <section className="panel">
        <h2>Runtime defaults</h2>
        <dl className="settings-list">
          <dt>Copilot CLI path</dt>
          <dd>{settings?.copilotCliPath ?? "Auto-detect on refresh"}</dd>
          <dt>Worktree root</dt>
          <dd>{settings?.worktreeRoot ?? "Loading"}</dd>
          <dt>Max coding sessions</dt>
          <dd>{settings?.maxConcurrentCodingSessions ?? 3}</dd>
          <dt>Max review and research calls</dt>
          <dd>{settings?.maxConcurrentReviewSessions ?? 4}</dd>
        </dl>
      </section>

      <section className="panel">
        <h2>Diagnostics</h2>
        <dl className="settings-list">
          <dt>Log level</dt>
          <dd>{settings?.logLevel ?? "info"}</dd>
          <dt>Log retention</dt>
          <dd>{settings?.logRetentionDays ?? 14} days</dd>
          <dt>Database</dt>
          <dd>{props.health?.databasePath ?? "Loading"}</dd>
          <dt>Diagnostics export</dt>
          <dd>{settings?.diagnosticsExportLocation ?? "Desktop folder stub"}</dd>
        </dl>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Packaging and updates</h2>
            <p>Manual local distribution until a signed update feed is configured.</p>
          </div>
          <Box size={18} />
        </div>
        <dl className="settings-list">
          <dt>Version</dt>
          <dd>{props.updateStrategy?.currentVersion ?? "Loading"}</dd>
          <dt>Update mode</dt>
          <dd>{props.updateStrategy ? `${props.updateStrategy.mode} (${props.updateStrategy.channel})` : "Loading"}</dd>
          <dt>Auto checks</dt>
          <dd>{props.updateStrategy?.automaticChecksEnabled ? "enabled" : "disabled"}</dd>
          <dt>Quick open</dt>
          <dd>
            {props.updateStrategy
              ? `${props.updateStrategy.globalQuickOpen.accelerator} - ${
                  props.updateStrategy.globalQuickOpen.registered ? "registered" : props.updateStrategy.globalQuickOpen.reason ?? "unavailable"
                }`
              : "Loading"}
          </dd>
        </dl>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Backups and restore</h2>
            <p>Creates an online-safe SQLite backup with redacted settings and recent redacted logs.</p>
          </div>
          <div className="button-row">
            <button className="secondary-button" disabled={props.busy} onClick={props.onRefreshPolish}>
              <RefreshCw size={14} />
              Refresh
            </button>
            <button className="primary-button" disabled={props.busy} onClick={props.onCreateBackup}>
              <Download size={14} />
              Create backup
            </button>
          </div>
        </div>
        {props.backups.length === 0 ? (
          <p className="muted">No backups yet.</p>
        ) : (
          <div className="activity-list">
            {props.backups.slice(0, 5).map((backup) => (
              <div className="activity-row" key={backup.backupPath}>
                <Database size={15} />
                <div>
                  <strong>{formatDate(backup.createdAt)} - {formatBytes(backup.sizeBytes)}</strong>
                  <span>{backup.backupPath}</span>
                </div>
                <button className="secondary-button compact-button" disabled={props.busy} onClick={() => props.onRestoreBackup(backup.backupPath)}>
                  <Upload size={14} />
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Notifications and onboarding</h2>
            <p>Generic local notifications avoid leaking task details on screen.</p>
          </div>
          <div className="button-row">
            <button className="secondary-button" disabled={props.busy} onClick={props.onTestNotification}>
              <Bell size={14} />
              Test notification
            </button>
            <button className="secondary-button" disabled={props.busy} onClick={props.onCreateSampleProject}>
              <Sparkles size={14} />
              Sample project
            </button>
          </div>
        </div>
        {props.notice ? <p className="phase9-notice">{props.notice}</p> : <p className="muted">Create a sample project to try Lelio without touching existing repos.</p>}
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Workspace cleanup</h2>
            <p>Dry-run preview only lists completed/cancelled task worktrees inside Lelio's worktree root and refuses `.git` or symlink paths.</p>
          </div>
          <button
            className="danger-button"
            disabled={props.busy || deletableCleanup.length === 0}
            onClick={() => props.onExecuteCleanup(deletableCleanup.map((candidate) => candidate.taskId))}
          >
            <Trash2 size={14} />
            Clean safe items
          </button>
        </div>
        {!props.cleanupPreview || props.cleanupPreview.candidates.length === 0 ? (
          <p className="muted">No completed task worktrees are eligible for cleanup.</p>
        ) : (
          <div className="activity-list">
            {props.cleanupPreview.candidates.slice(0, 8).map((candidate) => (
              <div className="activity-row" key={`${candidate.taskId}:${candidate.path}`}>
                <Trash2 size={15} />
                <div>
                  <strong>{candidate.taskTitle} - {formatBytes(candidate.sizeBytes)}</strong>
                  <span>{candidate.safeToDelete ? candidate.path : `${candidate.reason ?? "Unsafe"} - ${candidate.path}`}</span>
                </div>
                <div className={`pill ${candidate.safeToDelete ? "clean" : "error"}`}>
                  {candidate.safeToDelete ? "safe" : "refused"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
