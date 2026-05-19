# Lelio

A local-first macOS desktop command center for managing multiple coding projects, AI agent sessions, task progress, and multi-agent review conversations from one place.

Built with Electron, React, TypeScript, SQLite, and Vite.

![macOS](https://img.shields.io/badge/platform-macOS-blue)
![Electron](https://img.shields.io/badge/electron-42-47848F)
![TypeScript](https://img.shields.io/badge/typescript-5.8-3178C6)
![License](https://img.shields.io/badge/license-private-lightgrey)

## Overview

Lelio is designed for solo developers maintaining several local applications who want a central dashboard to supervise AI coding sessions, manage tasks, preserve project context, and run multi-agent reviews — all without a cloud backend.

### Key Capabilities

- **Project Registry** — Register up to 8+ local projects with git status, branch info, and activity tracking
- **Task Board** — Kanban-style board with Open, In Progress, Blocked, Review, Done, and Cancelled columns
- **Copilot SDK Sessions** — Start, resume, and disconnect GitHub Copilot coding sessions tied to specific tasks with deterministic session IDs
- **Session Monitor** — Live-stream selected session output while showing compact state for inactive sessions
- **Project Memory** — Detect instruction files, manage local context capsules, store session summaries, and mount reusable skills
- **Quick Chat** — Ask non-coding questions via OpenAI-compatible endpoints with streaming responses
- **Group Reviews** — Run multi-agent plan reviews with 3+ agents in parallel and synthesize results into task checklists
- **Approval Guardrails** — Block high-risk actions (destructive commands, git push, secret access) until explicit user approval
- **Backup & Restore** — Export/import SQLite data with secret redaction
- **macOS Packaging** — Distributable `.app` bundle with app icon

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Renderer (React)                │
│   Dashboard · Tasks · Sessions · Memory · Chat  │
│   Reviews · Approvals · Settings                │
└───────────────────┬─────────────────────────────┘
                    │ Typed IPC (Zod-validated)
┌───────────────────┴─────────────────────────────┐
│               Main Process (Node.js)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ SQLite   │ │ Copilot  │ │ OpenAI-compat    │ │
│  │ Database │ │ SDK      │ │ Adapter          │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Logger   │ │ Approval │ │ Session/Task     │ │
│  │ (JSONL)  │ │ Store    │ │ Stores           │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────┘
```

- **Renderer** never spawns agent processes or accesses the filesystem directly
- **Main process** owns all SQLite access, git operations, child processes, provider secrets, and approval gating
- **IPC** is fully typed with Zod schemas and correlation IDs for every request
- **Logging** is structured JSONL with automatic secret redaction

## Getting Started

### Prerequisites

- **macOS** (tested on Apple Silicon)
- **Node.js** ≥ 22
- **npm** ≥ 10
- **GitHub Copilot CLI** installed at `/opt/homebrew/bin/copilot` (for coding sessions)

### Install & Run

```bash
git clone https://github.com/SunZelun/lelio.git
cd lelio
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Package for macOS

```bash
npm run package:mac
```

The packaged app is output to `release/mac-arm64/Lelio.app`.

To create a DMG installer:

```bash
npm run package:mac:dmg
```

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── approvals/          # Approval store and guardrails
│   ├── chat/               # Quick chat and review channel stores
│   ├── db/                 # SQLite connection, migrations, schema
│   ├── ipc/                # IPC handler registration
│   ├── logging/            # JSONL logger, redaction, diagnostics
│   ├── memory/             # Project memory and skill management
│   ├── polish/             # Packaging, backup, notifications, cleanup
│   ├── projects/           # Project store
│   ├── runtime/            # Runtime registry, Copilot SDK adapter, OpenAI adapter
│   ├── sessions/           # Session and execution run store
│   ├── settings/           # Settings store
│   ├── tasks/              # Task store
│   ├── main.ts             # App entry point
│   └── paths.ts            # App data paths
├── preload/                # Electron preload (context bridge)
├── renderer/               # React UI
│   ├── App.tsx             # Main application component
│   ├── main.tsx            # React entry point
│   └── styles.css          # Global styles
├── shared/                 # Shared types, schemas, IPC channel constants
│   ├── types.ts            # TypeScript type definitions
│   ├── schemas.ts          # Zod validation schemas
│   └── ipc.ts              # IPC channel constants
tests/                      # Vitest test suite
docs/                       # PRD and development plan
build/                      # App icon assets (svg, png, icns)
```

## Data Storage

All data is stored locally:

| Data | Location |
|------|----------|
| SQLite database | `~/Library/Application Support/Lelio/lelio.sqlite` |
| Application logs | `~/Library/Logs/Lelio/` |
| Settings | `~/Library/Application Support/Lelio/settings.json` |
| Backups | `~/Library/Application Support/Lelio/backups/` |
| Task worktrees | `~/Library/Application Support/Lelio/worktrees/` |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start in development mode (Vite + Electron) |
| `npm run build` | Typecheck and build main + renderer |
| `npm test` | Run Vitest test suite |
| `npm run typecheck` | TypeScript type checking only |
| `npm run build:electron` | Build main/preload bundles only |
| `npm run build:renderer` | Build renderer bundle only |
| `npm run package:mac` | Build and package as macOS `.app` |
| `npm run package:mac:dmg` | Build and package as macOS `.dmg` |

## Design Principles

- **Local-first** — No cloud backend, no telemetry, no remote data storage
- **Quiet startup** — No repo-wide scans, no implicit session creation, no aggressive watchers
- **Typed boundaries** — Every IPC call is Zod-validated with correlation IDs
- **Secret safety** — API keys stay in the main process; never persisted in SQLite or exposed to the renderer
- **Approval-gated** — Destructive operations and repo writes require explicit user approval
- **Auditable** — Every action has a correlation ID traceable through structured JSONL logs
- **Resumable sessions** — Deterministic session IDs (`lelio-{project}-{task}-{agent}`) for Copilot SDK session persistence

## Configuration

Settings are accessible from the Settings view in the app. Key options include:

- Copilot CLI path and default model
- OpenAI-compatible endpoint URL and model
- Max concurrent coding sessions (default: 3)
- Max concurrent review/research sessions (default: 4)
- Log level and retention
- Worktree root path
- Git auto-refresh interval

## License

Private. All rights reserved.
