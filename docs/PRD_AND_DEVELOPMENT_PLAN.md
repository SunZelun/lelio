# Lelio PRD and Development Plan

Status: Draft v1  
Owner: Lex  
Last updated: 2026-05-19  
Product posture: Local-first personal agent OS for coding workflows

## 1. Product Summary

Lelio is a local-first macOS desktop command center for managing multiple coding projects, AI agent sessions, task progress, and multi-agent review conversations from one place.

The product is inspired by Helio's agent chat, agent task board, and group chat patterns, but it is intentionally scoped for personal coding operations rather than SaaS collaboration. The first build should focus on the workflows that currently create friction:

- Supporting 5-8 local projects with frequent context switching.
- Running multiple GitHub Copilot CLI or SDK-backed coding sessions at the same time.
- Seeing the current state, blocker, task, branch, changed files, and last activity for every active session.
- Reusing project-specific context instead of forcing every new agent session to rediscover the codebase.
- Running lightweight multi-agent plan/review discussions across Copilot and corporate LLM endpoints.
- Asking quick research or Q&A questions without opening a new terminal session.

The product should not become a hosted workspace, team SaaS, email client, calendar system, or general meeting automation product in v1.

## 1.1 Multica-Inspired Adjustments

Multica validates several product primitives that fit Lelio, but its full architecture is heavier than needed for a personal local-first app. Lelio should borrow the following ideas:

- Agents as first-class assignees with profiles, status, task history, comments, and reusable skills.
- Runtime inventory that detects available local agent CLIs and reports path, version, health, and active work.
- Execution runs as distinct records under a task, so retries, resumes, failures, and logs remain auditable.
- Incremental run-message loading using sequence numbers, so active sessions can stream without loading full transcripts.
- Conservative workspace garbage collection for old worktrees and regenerable build artifacts.
- Skill mounting into provider-native locations, especially `.github/skills/{name}/SKILL.md` for GitHub Copilot.

Lelio should not copy Multica's multi-tenant workspace, hosted server, Postgres/pgvector, cloud runtime, or broad team-management model for v1.

## 2. Goals and Success Criteria

### Goals

- Give one dashboard for all active projects, tasks, and AI coding sessions.
- Make Copilot-backed coding sessions visible, resumable, and tied to specific tasks.
- Preserve project context through managed instructions, memory notes, and session summaries.
- Support individual agent chat, per-agent task boards, and group agent review channels.
- Keep the app fast and quiet while many projects and agent processes exist.
- Use GitHub Copilot subscription value for coding tasks while allowing corporate LLM endpoints for research, review, and general chat.
- Provide comprehensive local diagnostics so bugs can be traced from UI symptom to IPC call, runtime action, database operation, git command, and provider response.

### Success Criteria

- The app can register at least 8 local projects and show useful state without continuously indexing every repo.
- A task can launch or resume a Copilot-backed session with a stable session ID.
- Multiple sessions in the same project are distinguishable by task, branch, worktree, status, and last activity.
- The user can open one project and immediately see active tasks, blocked tasks, changed files, and latest agent summaries.
- A group chat can ask multiple agents for plan review and store each response in the same channel timeline.
- Inactive sessions and historical transcripts do not noticeably slow app startup or project switching.
- The user can recover context after restarting the desktop app.
- Every user-visible error has a correlation ID that can be found in local logs.
- A diagnostic export bundle can be created without exposing secrets.

## 3. Non-Goals

- No hosted SaaS backend in v1.
- No multi-user workspace, billing, org management, or role-based access control.
- No calendar, meeting bot, email automation, or CRM-style workflows.
- No full-codebase semantic indexing by default.
- No hidden use of private Copilot APIs.
- No attempt to replace IDEs or terminals entirely.
- No automatic git push, deploy, destructive shell command, or secret access without explicit approval.

## 4. Target User and Primary Workflows

The target user is a solo developer maintaining several local applications. Some projects are active daily, while others are in support mode. The user commonly has several AI coding sessions running in terminals and wants a central place to supervise progress.

### Workflow A: Daily Command Center

1. Open Lelio.
2. See all registered projects with badges for active sessions, dirty git state, blocked tasks, and recent activity.
3. Open a project.
4. See current tasks, running Copilot sessions, latest summaries, changed files, and suggested next actions.

### Workflow B: Start a Coding Task

1. Create a task from the dashboard or project view.
2. Choose project, title, priority, and optional due date.
3. Lelio creates or associates a branch/worktree.
4. Lelio starts a Copilot SDK-backed session with deterministic session ID.
5. The session output streams into the session monitor and task timeline.

### Workflow C: Resume Work

1. Select a task with an existing session.
2. Lelio resumes the prior Copilot session if available.
3. Lelio shows the last summary, current branch/worktree, changed files, tests, and open questions.
4. The user sends follow-up instructions without reconstructing prior context manually.

### Workflow D: Group Plan Review

1. Open a project or global group channel.
2. Ask for a plan review before implementation.
3. Lelio routes the request to named agent profiles such as Planner, Copilot Engineer, Code Reviewer, Researcher, and Critic.
4. Responses appear in a shared timeline.
5. Lelio produces a final synthesized plan or task checklist for user approval.

### Workflow E: Quick Q&A

1. Open a quick chat.
2. Ask a non-coding or research question.
3. Lelio uses a corporate LLM endpoint by default unless the user explicitly chooses Copilot.
4. The answer is saved to the appropriate channel or direct message thread if useful.

## 5. Product Surface

### 5.1 App Shell

Use a dense, work-focused desktop layout inspired by the screenshots:

- Left rail:
  - Inbox
  - Projects
  - Tasks
  - Channels
  - AI teammates
  - Direct messages
  - Settings
- Main header:
  - Current project, channel, or agent name
  - Status indicators for running sessions and active providers
  - Compact controls for new task, new chat, refresh, and settings
- Main content:
  - Tabs appropriate to the current object: Chat, Tasks, Activity, Workspace, Skills, Memory, Settings
- Bottom composer:
  - Message field
  - Send button
  - Agent selector
  - Optional attach/context controls

The UI should be functional first: compact typography, stable dimensions, dark mode by default, no decorative hero sections, no marketing page.

### 5.2 Dashboard

The dashboard is the first screen. It should show:

- Project list with path, branch, dirty state, active sessions, and last activity.
- Active session cards grouped by project.
- Blocked tasks and tasks waiting for user input.
- Recent group review conversations.
- Quick actions:
  - Add project
  - New task
  - Resume last session
  - Open quick chat

### 5.3 Project View

Each project view should include:

- Project overview: path, default branch, package manager, test command, build command.
- Active tasks.
- Active and idle sessions.
- Git status summary.
- Project memory summary.
- Recent messages and artifacts.
- Buttons to open in Finder, terminal, editor, or git diff.

### 5.4 Agent Chat

Each agent has a direct chat surface. Initial default agents:

- Software Engineer: coding task execution, Copilot-backed by default.
- Code Reviewer: reviews diffs, tests, architecture risks, and missing coverage.
- Researcher: web or source-backed research through corporate LLM endpoint.
- Planner: turns vague requests into implementation plans.
- Critic: challenges assumptions and finds failure modes.

Agent pages should have tabs:

- Chat
- Tasks
- Activity
- Workspace
- Skills
- Memory
- Settings

V1 can implement all tabs as real navigation but only needs full functionality for Chat, Tasks, Activity, Memory, and Settings.

### 5.5 Task Board

Task columns:

- Open
- In progress
- Blocked
- Review
- Done
- Cancelled

Task card fields:

- ID
- Title
- Project
- Status
- Priority
- Assigned agent
- Due date
- Branch
- Worktree
- Session ID
- Last activity
- Changed files count
- Test status

Task detail view:

- Timeline of messages, session events, decisions, approvals, and artifacts.
- Current branch/worktree.
- Session controls: start, resume, pause/disconnect, abort, archive.
- Review controls: request plan review, request code review, summarize.

### 5.6 Session Monitor

The session monitor is the replacement for a wall of terminal windows.

It should show:

- Running, idle, waiting, blocked, completed, failed, or aborted status.
- Provider and model.
- Session ID.
- Project path and working directory.
- Branch and worktree.
- Latest streamed output.
- Last assistant message.
- Changed files.
- Latest test command and result.
- Pending approval request, if any.
- Resource hints: session age, last event time, estimated premium request count when available.
- Execution run history for retries, resumed attempts, failures, and completed runs.

The app should not render all terminal output for every session continuously. It should render live output for selected sessions and keep compact summaries for inactive sessions.

Run messages should support incremental loading by sequence number. This allows the UI to fetch only new messages for active runs and lazy-load older logs when the user opens a run detail view.

### 5.7 Group Channels

Group channels are for multi-agent alignment. They should support:

- Human messages.
- Agent replies with clear author identity.
- Mentions such as `@reviewer`, `@planner`, `@researcher`.
- A "run review round" action that sends one request to selected agents.
- A synthesis action that converts replies into a decision or task plan.

Default channels:

- `#explore`: general brainstorming and research.
- `#planning`: plan review and architecture alignment.
- `#reviews`: code review and post-change checks.
- `#ops`: debugging, release, and operational tasks.

### 5.8 Runtime Inventory

Runtime inventory shows what local execution engines are available. It is a personal, local equivalent of Multica's runtime view.

Runtime cards should show:

- Provider name.
- Detected CLI path.
- Version, if available.
- Health: available, unavailable, auth needed, error, running.
- Active sessions and queued tasks.
- Last check time.
- Default model or provider profile.
- Settings shortcut.

Initial runtime detection should include:

- GitHub Copilot CLI: `copilot`
- Codex: `codex`
- Claude Code: `claude`
- Gemini CLI: `gemini`
- OpenCode: `opencode`
- Hermes: `hermes`

Only Copilot SDK is required for v1 execution. Other detected CLIs can appear as unavailable, experimental, or later-phase adapters.

### 5.9 Project Memory

Project memory is a managed view over project-specific guidance and local summaries.

Supported memory sources:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`
- `.github/agents/*.agent.md`
- `.github/skills/*/SKILL.md`
- Lelio local project notes stored outside the repo unless the user explicitly opts into repo-tracked notes.

Memory features:

- Show detected instruction files.
- Warn about conflicting or missing guidance.
- Generate a suggested project context capsule.
- Let the user approve before writing any repo-tracked instruction file.
- Store local session summaries in Lelio's SQLite database.

### 5.10 Skill Library

Skill library is a lightweight personal store of reusable operating instructions.

V1 should support:

- List local skills.
- Attach skills to an agent profile.
- Attach skills to a project profile.
- Mount selected skills into the task worktree before a run starts.
- Show which skills were mounted in the run timeline.

Provider-native mount targets:

- GitHub Copilot: `.github/skills/{name}/SKILL.md`
- Codex: `CODEX_HOME/skills/{name}/`
- Claude Code: `.claude/skills/{name}/SKILL.md`
- OpenCode: `.opencode/skills/{name}/SKILL.md`
- Fallback: `.agent_context/skills/{name}/SKILL.md`

Skill import from URLs and AI-generated skill extraction should be postponed until after v1.

## 6. Technical Architecture

### 6.1 Stack

- Desktop shell: Electron.
- Renderer: React + TypeScript.
- Build tooling: Vite.
- Main process: TypeScript.
- Database: SQLite.
- IPC: typed Electron IPC wrappers.
- Terminal/session display: xterm.js only for selected raw process views.
- Git integration: local git CLI wrapper with bounded commands and timeouts.

Electron is chosen because the first build needs strong Node.js integration for Copilot SDK, child processes, local filesystem, SQLite, process supervision, and streaming events. Tauri can be revisited later if memory footprint becomes the dominant constraint.

### 6.2 Process Model

- Renderer never spawns agent processes directly.
- Main process owns:
  - Agent runtime adapters.
  - Child process lifecycle.
  - SQLite access.
  - Git status snapshots.
  - Filesystem reads/writes.
  - Approval gating.
  - Structured logging and diagnostics.
- Renderer receives normalized events through IPC.
- Long-running agent sessions are represented as persisted session records.

### 6.2.1 Logging and Diagnostics

Logging is a first-class feature because Lelio will orchestrate many local processes, providers, git operations, and database writes. The system must make root-cause analysis possible without guessing.

Logging requirements:

- Write structured JSONL logs under `~/Library/Logs/Lelio`.
- Use daily log files with rotation and retention.
- Default retention: 14 days.
- Support log levels: `debug`, `info`, `warn`, `error`.
- Default level: `info`.
- Allow temporary debug logging from Settings.
- Attach a correlation ID to every user action, IPC request, runtime call, git command, database write, approval decision, and session event.
- Surface correlation IDs in user-visible error toasts/dialogs.
- Redact secrets, tokens, auth headers, API keys, environment variables that look sensitive, and local keychain values.
- Log child process command, cwd, exit code, duration, and stderr summary, but never log full secrets or huge stdout by default.
- Log provider request metadata such as provider type, model, session ID, duration, status, and error class.
- Log database migration version, query failures, and transaction failures.
- Log renderer errors and unhandled promise rejections through IPC into the main logger.
- Log crash breadcrumbs: last route, selected project, selected task, selected session, last IPC channel, and last runtime action.
- Store large raw session output as `RunMessage` records, not as unbounded application logs.

Diagnostic export bundle:

- User-triggered only.
- Writes a zip or folder under `~/Desktop` or a user-selected destination.
- Includes recent redacted logs, app settings without secrets, database health summary, runtime inventory, migration version, and selected task/session metadata.
- Excludes API keys, auth tokens, full environment dumps, keychain values, and full repo contents.
- Includes a `README.txt` explaining how to inspect correlation IDs.

Root-cause workflow:

1. User reports or sees an error with a correlation ID.
2. Search local logs for that correlation ID.
3. Follow linked events across renderer, IPC, main process, runtime adapter, git/database, and provider calls.
4. Use the diagnostic bundle when a future agent needs the evidence to fix the bug.

### 6.3 Local Data Model

Minimum entities:

- `Project`
  - id, name, slug, path, defaultBranch, packageManager, testCommand, buildCommand, createdAt, updatedAt
- `AgentProfile`
  - id, name, slug, role, providerType, model, instructions, enabled, createdAt, updatedAt
- `Channel`
  - id, type, name, projectId, createdAt, updatedAt
- `Message`
  - id, channelId, taskId, sessionId, authorType, authorId, content, metadataJson, createdAt
- `Task`
  - id, projectId, title, description, status, priority, assigneeAgentId, dueAt, branch, worktreePath, createdAt, updatedAt
- `Session`
  - id, taskId, projectId, agentId, providerType, model, externalSessionId, cwd, status, startedAt, endedAt, lastEventAt
- `ExecutionRun`
  - id, taskId, sessionId, attemptNumber, worktreePath, status, startedAt, endedAt, exitReason, lastSequenceNumber
- `RunMessage`
  - id, runId, sequenceNumber, authorType, contentType, content, metadataJson, createdAt
- `Runtime`
  - id, providerType, name, cliPath, version, health, lastCheckedAt, lastHeartbeatAt, metadataJson
- `LogEvent`
  - id, correlationId, level, source, eventName, message, metadataJson, createdAt
- `SessionEvent`
  - id, sessionId, eventType, content, metadataJson, createdAt
- `Approval`
  - id, sessionId, taskId, actionType, summary, riskLevel, status, requestedAt, resolvedAt
- `Artifact`
  - id, projectId, taskId, sessionId, type, title, path, contentSummary, createdAt

### 6.4 Session ID Policy

Use deterministic session IDs:

```text
lelio-{projectSlug}-{taskId}-{agentSlug}
```

This makes Copilot SDK session persistence auditable and resumable. A session may be disconnected to free resources while keeping persisted session state.

### 6.5 Runtime Adapter Interface

All model providers implement one local interface:

```ts
interface AgentRuntimeAdapter {
  kind: "copilot-sdk" | "copilot-acp" | "copilot-cli" | "openai-compatible" | "anthropic" | "gemini";
  startSession(input: StartSessionInput): Promise<RuntimeSessionHandle>;
  resumeSession(input: ResumeSessionInput): Promise<RuntimeSessionHandle>;
  sendMessage(input: SendMessageInput): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  disconnectSession(sessionId: string): Promise<void>;
  listSessions?(): Promise<RuntimeSessionSummary[]>;
}
```

Adapter priorities:

1. Copilot SDK local CLI for primary coding sessions.
2. Copilot ACP for custom frontend and protocol-based experiments.
3. Corporate OpenAI-compatible/Azure/Anthropic/Gemini adapters for research, review, and general chat.
4. Raw `copilot` CLI process mode only as fallback for features not exposed by SDK or ACP.

### 6.5.1 Runtime Registry

Maintain a local runtime registry that periodically, but conservatively, detects available CLIs. Runtime detection should be explicit and cheap:

- Run path checks on startup.
- Run version checks only on manual refresh or low-frequency background refresh.
- Mark auth-required states separately from missing binary states.
- Never start a long-running agent process merely to populate the runtime list.
- Store runtime status in SQLite so the dashboard can render from cached data.

### 6.6 Copilot Integration

Use official surfaces only.

Copilot SDK local CLI path:

- Best for personal local use.
- Uses locally signed-in Copilot CLI credentials.
- Communicates over stdio.
- Supports named/resumable sessions.
- Stores session state under `~/.copilot/session-state/{sessionId}/`.

ACP path:

- Start with `copilot --acp --stdio`.
- Use for protocol-level custom frontend experiments and multi-agent coordination.
- Treat ACP as preview and keep it behind an adapter boundary.

CLI fallback:

- Use only when SDK/ACP cannot expose a required feature.
- Do not scrape terminal output as the main architecture.

### 6.7 Corporate LLM Integration

Corporate endpoint adapters should support:

- OpenAI-compatible `/v1` endpoints.
- Azure OpenAI or Azure AI Foundry endpoints.
- Anthropic-compatible endpoints if exposed.
- Gemini-compatible endpoints if exposed.

Secrets:

- Store API keys in macOS Keychain or read from environment variables.
- Never persist raw keys in SQLite.
- Show endpoint/model names in settings, not secrets.

Default routing:

- Coding implementation: Copilot SDK.
- Code review: corporate Claude/GPT model or Copilot reviewer, user-selectable.
- Research: corporate model with browsing/tool support when available.
- Planning: corporate GPT/Claude/Gemini model or Copilot if coding-specific.
- Quick Q&A: corporate endpoint by default.

### 6.8 Git and Worktree Strategy

Default behavior:

- One task gets one branch and one worktree.
- Existing worktree can be reused only after explicit user choice.
- Branch naming:

```text
lelio/{taskId}-{slug}
```

Worktree location:

```text
~/Library/Application Support/Lelio/worktrees/{projectSlug}/{taskId}
```

Git operations:

- Read-only git status snapshots can run automatically.
- Mutating operations require explicit action and approval.
- `git push`, force operations, reset, clean, destructive checkout, and deploy commands require approval.

### 6.9 Workspace Garbage Collection

Lelio should include conservative cleanup for task worktrees and regenerable artifacts.

Defaults:

- GC disabled for active, blocked, review, or recently updated tasks.
- Completed or cancelled task worktrees become cleanup candidates after 7 days.
- Regenerable artifact cleanup may run after 24 hours for completed tasks.
- Default artifact patterns: `node_modules`, `.next`, `.turbo`, `target`, `dist`, `build`, `__pycache__`.
- Never delete `.git`, source changes, logs, output artifacts, or task metadata without explicit approval.
- Always show a dry-run preview before deleting anything in v1.

## 7. Performance Requirements

Performance is a product requirement, not an optimization phase.

### Startup

- App shell should render before any project scan completes.
- Load only project metadata and active task/session summaries on startup.
- Do not load full transcripts until the user opens a channel, task, or session.

### Project Scanning

- No full-codebase indexing by default.
- No recursive watcher across every project by default.
- Git status snapshots should be manual or low-frequency.
- Active selected project may use short-lived targeted checks.
- Background scans must have timeouts and cancellation.

### Session Monitoring

- Only selected running session streams full output into the renderer.
- Non-selected sessions update compact metadata: status, last event, last summary, changed files count.
- Persist raw event logs in append-only form and derive summaries for UI.
- Store run messages with monotonic sequence numbers.
- Fetch incremental run updates using `sinceSequenceNumber`.
- Lazy-load historical run messages only when a run is opened.

### Concurrency

Defaults:

- Max active coding sessions: 3.
- Max active review/research calls: 4.
- Additional tasks enter queued state.
- User can override limits in settings.

### Resource Safety

- Disconnect idle SDK sessions when possible while preserving resumability.
- Avoid long-running shell commands without timeouts.
- Use backpressure for streaming events.
- Use virtualized lists for messages, tasks, and logs.
- Keep app responsive even when agent processes are busy.

## 8. Safety and Approval Model

Approval cards should appear for:

- Shell commands that write files outside the task worktree.
- Destructive commands such as delete, reset, clean, force push, or migration.
- Git push or release/deploy commands.
- Secret access.
- Network calls to unconfigured endpoints.
- Any agent request to modify repo instruction files.

Approval outcomes:

- Approve once.
- Deny once.
- Approve for this project/session when safe.

All approval decisions are logged in the task timeline.

## 9. Settings

Required settings:

- Copilot CLI path.
- Default Copilot model.
- Default corporate endpoint provider.
- Corporate endpoint base URL and auth source.
- Default reviewer model.
- Default planner model.
- Max concurrent coding sessions.
- Max concurrent review/research sessions.
- Worktree root.
- Git auto-refresh interval.
- Approval strictness.
- Transcript retention.
- Runtime refresh interval.
- Log level.
- Log retention days.
- Diagnostics export location.
- Worktree GC enabled/disabled.
- Worktree GC retention.
- Artifact GC patterns.

## 10. Development Plan

### Phase 0: Foundation

Deliverables:

- Electron + Vite + React + TypeScript project.
- Main/renderer/preload process structure.
- SQLite setup and migrations.
- Typed IPC layer.
- Structured local logging and diagnostics foundation.
- Dark desktop app shell.
- Local settings store.

Acceptance:

- App launches without starting any agent process.
- Empty-state dashboard renders.
- SQLite database initializes locally.
- Logs are written to `~/Library/Logs/Lelio` with correlation IDs and redaction.

### Phase 0 Implementation Handoff

Use this section as the starting context for the first coding session.

First-session goal:

- Scaffold the desktop app and make it launchable.
- Do not implement real Copilot execution yet.
- Create enough local infrastructure that Phase 1 can add projects and runtime inventory without reworking the foundation.

Locked technical choices:

- Package manager: npm.
- App framework: Electron + Vite + React + TypeScript.
- Renderer styling: plain CSS modules or a small global CSS file; do not add a heavy UI framework in Phase 0.
- Database: SQLite through a synchronous Node-friendly library such as `better-sqlite3`.
- Validation: Zod for IPC payloads and settings schemas.
- Tests: Vitest for unit/integration tests.
- Icons: lucide-react.
- App data root: `~/Library/Application Support/Lelio`.
- SQLite path: `~/Library/Application Support/Lelio/lelio.sqlite`.
- Logs path: `~/Library/Logs/Lelio`.
- Log format: JSONL.
- Default log retention: 14 days.
- Default log level: `info`.

Initial repository layout:

```text
package.json
vite.config.ts
tsconfig.json
src/
  main/
    main.ts
    db/
      connection.ts
      migrations.ts
      schema.ts
    ipc/
      channels.ts
      handlers.ts
    settings/
      settingsStore.ts
    logging/
      logger.ts
      redaction.ts
      diagnosticsExport.ts
    runtime/
      runtimeRegistry.ts
  preload/
    preload.ts
  renderer/
    App.tsx
    main.tsx
    styles.css
    components/
    views/
  shared/
    types.ts
    schemas.ts
```

Initial scripts:

- `npm run dev`: start Electron/Vite development mode.
- `npm run build`: typecheck and build renderer/main bundles.
- `npm test`: run Vitest.
- `npm run lint`: optional in Phase 0; add only if it does not slow scaffold work.

Initial UI:

- Render the left rail, header, empty dashboard, and placeholder tabs.
- Show "No projects yet" empty state with actions for Add project, New task, and Open quick chat.
- Show a Settings placeholder with Copilot CLI path, worktree root, and concurrency defaults.
- Show Settings controls/placeholders for log level, log retention, and diagnostics export.
- Do not start Copilot, scan all repos, or create watchers on app launch.

Initial database:

- Create migration table.
- Create tables for `Project`, `AgentProfile`, `Channel`, `Message`, `Task`, `Session`, `ExecutionRun`, `RunMessage`, `Runtime`, `LogEvent`, `Approval`, and `Artifact`.
- Seed default agent profiles: Software Engineer, Code Reviewer, Researcher, Planner, Critic.
- Seed default channels: `#explore`, `#planning`, `#reviews`, `#ops`.

Initial logging:

- Initialize the main-process logger before database initialization.
- Generate a correlation ID for every IPC request.
- Include correlation ID, source, event name, level, timestamp, and redacted metadata in every log entry.
- Forward renderer errors and unhandled promise rejections to the main logger.
- Redact tokens, API keys, auth headers, and sensitive environment-style values before writing logs.
- Implement a diagnostics export stub that creates a redacted folder with logs, settings summary, runtime inventory, and database health summary.

Initial IPC contracts:

- `app:getSettings`
- `app:updateSettings`
- `db:getHealth`
- `project:list`
- `agent:list`
- `channel:list`
- `runtime:listCached`
- `runtime:refresh`
- `diagnostics:export`

Phase 0 runtime behavior:

- `runtime:refresh` may detect binaries with `command -v`/equivalent and read versions with short timeouts.
- It must not authenticate providers, start long-running agent processes, or create coding sessions.
- Store runtime status in SQLite so the UI can render cached state on next launch.

Phase 0 logging behavior:

- Log app startup, database open/migration, IPC requests, settings reads/writes, runtime refresh checks, renderer errors, and export attempts.
- Do not log full message transcripts, full command stdout, API keys, auth tokens, or full environment dumps.
- Every error returned through IPC must include a correlation ID.

Phase 0 acceptance commands:

```bash
npm run build
npm test
```

Suggested first coding-session prompt:

```text
Use docs/PRD_AND_DEVELOPMENT_PLAN.md as the only product context. Implement Phase 0 only: scaffold Electron + Vite + React + TypeScript, SQLite initialization, structured JSONL logging with correlation IDs/redaction, typed IPC skeleton, default agents/channels, empty dashboard, settings placeholder, diagnostics export stub, and cached runtime inventory refresh. Do not implement real Copilot sessions yet. Keep startup lightweight and avoid repo-wide watchers.
```

### Phase 1: Project Registry and Dashboard

Deliverables:

- Add/edit/remove local projects.
- Store project path, display name, commands, and metadata.
- Manual git status refresh.
- Dashboard cards for projects and recent activity.
- Cached runtime inventory cards for detected local CLIs.

Acceptance:

- User can add 8 local projects.
- App startup remains fast because project scans are not blocking render.
- Dirty/clean state is shown after manual refresh.
- Runtime cards show Copilot CLI path/version and auth/error state without starting an agent task.

### Phase 2: Tasks and Boards

Deliverables:

- Task CRUD.
- Kanban board with Open, In progress, Blocked, Review, Done, Cancelled.
- Task detail page.
- Link task to project and assigned agent.

Acceptance:

- User can create multiple tasks in one project.
- Task state persists after restart.
- Board filters by project, status, priority, and assignee.

### Phase 3: Copilot SDK Adapter

Deliverables:

- Detect Copilot CLI path and version.
- Create Copilot SDK client from local CLI.
- Create/resume/disconnect named sessions.
- Persist normalized session events.
- Create an `ExecutionRun` for every attempt under a task.
- Store run messages with monotonic sequence numbers.
- Surface SDK errors clearly.

Acceptance:

- A task can start a named Copilot session.
- App restart can resume the same session ID.
- Idle sessions can disconnect without deleting local state.
- Retried or resumed work appears as separate runs under the same task.

### Phase 4: Session Monitor

Deliverables:

- Session list grouped by project.
- Session detail monitor.
- Live selected-session output.
- Status and last activity tracking.
- Changed file summary from git.
- Abort/disconnect controls.

Acceptance:

- Multiple running sessions are visible at once.
- Only selected session renders full live stream.
- Inactive sessions show compact state without heavy rendering.

### Phase 5: Project Memory Manager

Deliverables:

- Detect `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.github/agents/*.agent.md`, and `.github/skills/*/SKILL.md`.
- Show instruction coverage and warnings.
- Generate local context capsule.
- Store session summaries in SQLite.
- Manage a local skill library and mount selected skills into provider-native paths.
- Optional approved writes to repo instruction files.

Acceptance:

- Project view shows detected instruction files.
- User can see memory used for a task.
- Run timeline shows which skills were mounted.
- Repo-tracked instruction writes require approval.

### Phase 6: Corporate LLM Adapters and Quick Chat

Deliverables:

- OpenAI-compatible endpoint adapter.
- Provider/model settings.
- Quick chat.
- Researcher, Planner, Reviewer, Critic profiles.
- Streaming responses where provider supports it.

Acceptance:

- User can ask a quick non-coding question.
- Response is stored in a channel or direct message.
- Provider failures do not crash the app.

### Phase 7: Group Review Channels

Deliverables:

- Group channel timeline.
- Agent mentions.
- "Run review round" action.
- Parallel requests to selected agents.
- Synthesis action.
- Link review output to tasks.

Acceptance:

- User can request plan review from at least three agents.
- All replies appear with author identity.
- Synthesis creates a task comment or checklist.

### Phase 8: Approval Cards and Guardrails

Deliverables:

- Approval entity and UI.
- Runtime hook for high-risk actions.
- Allow/deny handling.
- Audit trail in task timeline.

Acceptance:

- High-risk actions block until user decision.
- Decisions are persisted.
- Denied actions are reported clearly to the agent/session.

### Phase 9: Polish and Packaging

Deliverables:

- macOS packaging.
- App icon.
- Global quick open.
- Notifications for blocked/completed sessions.
- Export/import backup.
- Worktree and artifact cleanup with dry-run preview.
- Basic crash/error reporting to local logs only.

Acceptance:

- Packaged app runs on macOS.
- User receives notification when a session needs input.
- User can back up and restore local Lelio data.
- User can preview and clean old completed task worktrees without deleting source changes.

## 11. Testing Plan

### Unit Tests

- Runtime adapter normalization.
- Session ID generation.
- Task status transitions.
- Settings validation.
- Logger format, redaction, rotation policy, and correlation ID propagation.
- Git status parser.
- Approval risk classification.

### Integration Tests

- SQLite migrations.
- Project add/remove flow.
- Task create/update/persist flow.
- Session create/resume/disconnect flow with mocked Copilot SDK.
- Execution run creation and incremental message loading.
- Corporate LLM adapter with mocked streaming endpoint.
- IPC request/response contracts.
- Diagnostics export bundle generation with secrets redacted.

### End-to-End Tests

- Launch app and add a project.
- Create task and assign Software Engineer.
- Start mocked Copilot session and stream events.
- Move task through statuses.
- Run group review with mocked agents.
- Trigger approval request and resolve it.
- Trigger a mocked runtime failure and trace it by correlation ID through logs.
- Restart app and verify persisted state.

### Manual Acceptance Scenarios

- Add 8 real projects and confirm app remains responsive.
- Run 3 coding sessions and confirm dashboard state stays understandable.
- Open a large transcript and confirm only that view loads the transcript.
- Disconnect and resume a Copilot SDK session.
- Verify git mutation commands require approval.
- Verify corporate endpoint credentials are not stored in plaintext.
- Verify user-visible errors include correlation IDs.
- Verify diagnostic exports include useful redacted logs and runtime/database summaries.
- Verify GC dry-run never lists `.git`, source changes, logs, output artifacts, or metadata for deletion.

## 12. Progress Tracking

Use this section as the initial build tracker. Keep it updated in pull requests or implementation sessions.

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0: Foundation | Implemented | Electron/Vite/React/TypeScript scaffold, SQLite migrations/seeds, typed IPC, JSONL logging with redaction/correlation IDs, diagnostics export stub, cached runtime refresh, local settings, and empty dashboard are in place. Verified with `npm run build`, `npm test`, launch smoke test, and `npm audit`. |
| Phase 1: Project Registry | Implemented | Add/edit/remove local projects, cached project dashboard cards, manual bounded git status refresh, recent activity, and runtime cards are in place. Verified with `npm run build`, `npm test`, `npm audit`, and launch smoke test. |
| Phase 2: Tasks and Boards | Implemented | Task CRUD, typed IPC, SQLite persistence, project/agent links, Kanban columns, board filters, task cards, and task detail foundation are in place. Verified with `npm run build`, `npm test`, and a static check that no Copilot/session startup, repo-wide watcher, or startup repo scan path was added. |
| Phase 3: Copilot SDK Adapter | Implemented | Added `@github/copilot-sdk`, deterministic task session IDs, typed start/resume/disconnect IPC, Copilot SDK adapter boundary, persisted sessions, execution runs, normalized session events, run messages with sequence numbers, and task detail controls. Verified with `npm run build`, `npm test`, and a static check that Copilot session creation is only reachable from explicit task session actions. |
| Phase 4: Session Monitor | Implemented | Added project-grouped compact session monitor, selected-session detail view, incremental live output polling, status and last-activity tracking, selected-session git changed-file summary, and session-id abort/disconnect controls. Git summaries are fetched only for selected/manual detail refreshes; pending approvals and test-result surfacing remain future-phase work. Verified with `npm run build` and `npm test`. |
| Phase 5: Project Memory | Implemented | Added bounded known-path instruction detection, coverage warnings, local context capsules, SQLite session summaries, local skill library CRUD, approved project/agent skill attachments, provider-native skill mounts with repo-write audit records, Memory UI, task memory preview, and run timeline mounted-skill display. Repo instruction writes outside approved skill mounts remain deferred until the approvals phase. Verified with `npm run build` and `npm test`. |
| Phase 6: Corporate LLM + Quick Chat | Implemented | Added main-process OpenAI-compatible adapter with non-streaming and SSE streaming support, provider/model settings with main-only API key storage, typed quick chat IPC with visible delta events, channel message persistence, Quick Chat UI, default OpenAI-compatible Researcher/Planner/Reviewer/Critic profile usage, and provider failure persistence as system messages. Verified with `npm run build` and `npm test`. |
| Phase 7: Group Review Channels | Implemented | Added typed group review IPC, SQLite task comments, review channel store with 3+ unique enabled OpenAI-compatible agents, bounded parallel per-agent requests with persisted replies/failures and author identity, Reviews UI with channel timeline, agent mentions, review round controls, synthesis-to-task action, and task detail comment/checklist display. Verified with `npm run build` and `npm test`. |
| Phase 8: Approvals | Implemented | Added typed approval contracts/IPC, SQLite approval metadata migration, main-process approval store, Copilot SDK permission hook that blocks guarded actions until user allow/deny, persisted approval decisions/cancellations, denial feedback to the SDK, session/run audit messages, Approvals UI cards, and task detail approval audit display. Verified with `npm run build` and `npm test`. |
| Phase 9: Packaging | Implemented | Added electron-builder macOS packaging with app icon and package smoke path, local/manual no-network update strategy stub, global quick open registration, privacy-preserving notifications for approval/session state, online-safe SQLite backup with redacted settings/logs plus restart-applied restore, explicit onboarding sample project, conservative dry-run worktree cleanup, and local crash/error logging. Verified with `npm test`, `npm run build`, `npm run package:mac`, and packaged app launch smoke. |

## 13. Implementation Defaults

- Build locally only; no remote backend.
- Use Electron first; revisit Tauri only after working v1.
- Use SQLite; avoid Postgres for personal local use.
- Use Copilot SDK local CLI as the first coding runtime.
- Keep ACP behind an adapter because it is preview.
- Keep corporate LLM support pluggable from day one.
- Store secrets in macOS Keychain or environment variables, not SQLite.
- Require approval before writing repo-tracked instruction files.
- Cap active coding sessions at 3 by default.
- Prefer manual or low-frequency refresh over aggressive watchers.
- Prefer local summaries over loading large raw transcripts.
- Track execution attempts as runs under tasks, not as separate tasks.
- Use sequence-based incremental log/message loading.
- Treat logging as part of every feature's definition of done.
- Every IPC handler, runtime adapter, git wrapper, database migration, and diagnostics export path must emit structured logs with correlation IDs.
- Add worktree/artifact GC only with dry-run preview first.

## 14. Known Local Environment

Verified on 2026-05-19:

- Repository path: `/Users/sunzelun/Desktop/projects/lex/lelio`
- Repository state: empty before this document was created
- Copilot CLI path: `/opt/homebrew/bin/copilot`
- Copilot CLI version: `1.0.49`
- Node.js: `v25.8.1`
- npm: `11.7.0`
- git: `2.50.1 (Apple Git-155)`

The sandboxed `copilot --version` command hit a macOS keychain access error, but the command succeeded outside the sandbox.

## 15. External References

- Helio: https://www.helio.im/
- Multica repository: https://github.com/multica-ai/multica
- Multica CLI and daemon guide: https://raw.githubusercontent.com/multica-ai/multica/main/CLI_AND_DAEMON.md
- Multica product overview: https://raw.githubusercontent.com/multica-ai/multica/main/docs/product-overview.md
- GitHub Copilot SDK local CLI: https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/local-cli
- GitHub Copilot SDK session persistence: https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk/use-copilot-sdk/session-persistence
- GitHub Copilot CLI ACP server: https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server
- GitHub Copilot SDK BYOK: https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk/authenticate-copilot-sdk/bring-your-own-key
- GitHub Copilot CLI custom instructions: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
- GitHub Copilot CLI `/fleet`: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/fleet

## 16. Open Questions for Later

These should not block v1 planning or scaffold work:

- Whether to bundle Copilot CLI in packaged builds or require the local installed CLI.
- Whether to use a separate background daemon after v1 or keep orchestration inside Electron main.
- Whether to add semantic search over session summaries after the core session monitor works.
- Whether to support local model providers such as Ollama or Foundry Local.
- Whether to add GitHub issue/PR integration after local task tracking is stable.
- Whether lightweight scheduled autopilots such as daily bug triage are worth adding after manual task/session flows are stable.
