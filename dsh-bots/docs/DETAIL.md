# DSH Bots

Persistent multi-bot organization for DeepSeek Harness. Every bot is a long-lived
identity bound to a real DSH **Agent Preset**; conversations run in native DSH
sessions (`ctx.agents` create/resume), and history stays in the native session log.

## What it does (Milestone 1)

- **Bots**: create, edit, soft-delete bot identities with `presetId`, optional
  workspace and model override. Changing a bot's preset never touches existing
  sessions — old sessions keep the composition they were created with (enforced
  by the host's `agent-preset/locked` rule).
- **Direct chat**: one native session per bot, driven through the agent runtime;
  a per-bot JSONL transcript mirrors the collaboration view under
  `~/.dsh/bots/transcripts/dm/<botId>.jsonl`.
- **Preset fork**: `POST /api/plugins/bots/presets/copy` reads the source preset's
  composition and generates an installable bundle under `~/.dsh/bots/forks/<id>/`
  (the registry only accepts patch rows, not directories).
- **REST API** under `/api/plugins/bots` (bots CRUD, chat, sessions, messages,
  presets, status).
- **Web UI**: a "🤖 Bots" dock entry under the composer opens the Bot Workbench
  overlay (list, create with Reference/Fork, chat).

## Storage

`~/.dsh/bots/` (configurable via the plugin row's `stateDir`): storageDomain data,
JSONL transcripts, fork bundles, bot workspaces. Native session logs are never
duplicated or deleted by this plugin.

## Limitations

- Bot execution depends on host-internal APIs (`ctx.agents`, `sessionQuery`);
  verified against DSH 0.2.2-rc.3.
- Auto-install of fork bundles needs the plugin-manager service; otherwise the
  generated bundle directory is returned for manual installation.
- Group chat and task delegation arrive in Milestones 2–3.
