# Skills audit — `~/skyleigh-tools/.claude/skills/`

> Inventory of Skyleigh's existing skills, their hardcoded paths, and target ElevateOS agent owners. Tier 1 only copies the bold-name skills (referenced by Tier 1 crons). Everything else keeps running under her existing launchd jobs and is invisible to ElevateOS — no regression.
>
> Reviewed: 2026-04-29 against `~/skyleigh-tools/.claude/skills/` on Skyleigh's Mac at last contact.
> Path-templating via `data_roots` is Tier 2 — for v1 the hardcoded `/Users/admin/skyleigh-tools/...` paths inside each skill stay as-is, since they're correct on Skyleigh's Mac.

---

## Inventory

| # | Skill | Owner | Tier 1 copied | Hardcoded paths inside skill | Notes |
|---|---|---|---|---|---|
| 1 | **`gmail-doc-router`** | Avery | ✓ | `/Users/admin/skyleigh-tools/data/`, `/Users/admin/skyleigh-tools/Listings/` | Routes inbound Gmail attachments to listing folders. Reads OAuth from her existing token store. |
| 2 | **`weekly-listing`** | Avery | ✓ (best-effort, may not exist yet) | `/Users/admin/skyleigh-tools/data/listings/`, `/Users/admin/skyleigh-tools/data/brew/` | Weekly performance report — listings + showings + activity. |
| 3 | **`market-stats-watcher`** | Marlowe | ✓ | `/Users/admin/skyleigh-tools/data/marketing/`, `/Users/admin/skyleigh-tools/data/brew/` | Pulls Kamloops + Okanagan stats. Drops to brew. |
| 4 | **`draft-inbound`** | Reese | ✓ | `/Users/admin/skyleigh-tools/data/messages.db`, `/Users/admin/skyleigh-tools/data/approvals/` | Scans new iMessages, drafts replies, pushes to approval queue. |
| 5 | **`outreach`** | Reese | ✓ | `/Users/admin/skyleigh-tools/data/`, Lofty API | Pulls Lofty leads, drafts cold/re-engage texts to approval queue. |
| 6 | `outreach-send` | Reese | – (Tier 2) | Lofty API + iMessage send hooks | Send half of outreach. Tier 2 — paired with approval bridge. |
| 7 | `digisign` | Avery | – (Tier 2) | DocuSign API or vendor equivalent | Signature workflow. |
| 8 | `webforms` | Avery | – (Tier 2) | brokerage form endpoints | Auto-fills brokerage forms from listing data. |
| 9 | `showing-time` | Avery | – (Tier 2) | eXp / ShowingTime API | Showing schedule + reports. Blocked on eXp API creds. |
| 10 | `marketing` | Marlowe | – (Tier 2) | `/Users/admin/skyleigh-tools/data/marketing/` | Higher-level campaign orchestration. |
| 11 | `mlc` | Marlowe | – (Tier 2) | brokerage MLC endpoint | Multiple Listing Contract automation. |
| 12 | `humanizer` | Marlowe | – (Tier 2) | none (pure text transform) | Voice match utility — used inside outreach + draft-inbound. May want to copy earlier. |
| 13 | `cma` | Pierce | – (Tier 2) | comp data feeds, listing photos | CMA PDF generator. |
| 14 | `property-lookup` | Pierce | – (Tier 2) | BC Assessment + MLS lookup | Property fact retrieval. |
| 15 | `graphify` | Shared (Avery owns the cron) | – (Tier 2) | `/Users/admin/skyleigh-tools/knowledge/`, Graphify CLI | Knowledge graph ingestion — runs nightly. |

---

## Why we copy referenced skills BEFORE the first agent boot

The agent boot prompt restores crons on startup and the cron prompts themselves reference these skills by name. If a skill isn't present in `<agent>/.claude/skills/` when the daemon starts, the cron fires into nothing — no error, no log line, just a no-op.

INSTALL step 12 copies the bold-row skills above into the right per-agent `.claude/skills/` directory before PM2 starts the daemon. If any skill has been renamed on Skyleigh's Mac since this doc was written, that copy line will silently 404 — verify with `ls ~/skyleigh-tools/.claude/skills/` before running INSTALL step 12.

---

## `.claude/skills/` vs `skills/` — source inconsistency

- The bus list-skills command (`src/cli/bus.ts:1468-1474`) — which is what the running PTY agent reads — scans `<agentDir>/.claude/skills/`.
- The top-level CLI `list-skills` (`src/cli/list-skills.ts:113-116`) scans `<agentDir>/skills/` (no `.claude` prefix).

These are two different directories. v1 standardizes on `.claude/skills/` because that's what Claude Code actually reads at runtime. Documented in `docs/SOURCE_FIXES.md` item 8.

If you find yourself looking at `dist/cli.js list-skills` output and wondering why it's empty, that's why — the agent has skills, the top-level lister just doesn't see them.

---

## Tier 2 plan for the remaining skills

1. Move all 15 skills out of `~/skyleigh-tools/.claude/skills/` into `templates/<agent>/.claude/skills/` (in the repo, version-controlled).
2. Replace hardcoded `/Users/admin/skyleigh-tools/...` paths with `${data_roots.messages_db}`, `${data_roots.brew_dir}`, etc., reading from `orgs/<org>/config.json`.
3. Add a thin path-resolution helper at `src/utils/data-roots.ts` so skills don't each reinvent the env lookup.
4. Once skills are templated and version-controlled in ElevateOS, add a `cli.js skills sync` command that copies them per-agent from `templates/` to `orgs/<org>/agents/<name>/.claude/skills/` on demand.
5. After Tier 2 ships, Skyleigh's existing launchd jobs can be retired one-by-one as their elevate cron equivalents come online and prove out.
