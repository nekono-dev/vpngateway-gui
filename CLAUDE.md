# Agentic SDLC and Spec-Driven Development

Kiro-style Spec-Driven Development on an agentic SDLC

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`
- Skills: `.claude/skills/kiro-*/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `/kiro-spec-status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in Japanese. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Codex as a Child Agent (MCP)

Codex CLI is registered as the MCP server `codex`. Its tool `codex_exec` runs a task with Codex inside this repository and returns the result. Use it proactively as a child agent. Claude stays the owner of the work: Claude decides, delegates, verifies, and reports.

### When to delegate to Codex
- **Independent review**: a second opinion on a diff, a design draft, or a task's implementation (`sandbox: "read-only"`). Use it as the reviewer input in `kiro-review` when a fresh reviewer is needed.
- **Bounded implementation**: a well-scoped change with named files and tests (`sandbox: "workspace-write"`). Claude then verifies the result (see below).
- **Broad exploration**: searches across many files, or tracing a behavior through the codebase (`sandbox: "read-only"`). Ask for a short summary, not raw dumps.
- **Parallel work**: when two or more subtasks have no dependency on each other, send their `codex_exec` calls in the same turn.

### When not to delegate
- Spec approvals, requirement or design decisions that need the user, and anything that changes approval state in spec.json.
- Git commits, pushes, and pull requests unless the user asked for them.
- Destructive operations (reset, force removal, deleting logins or volumes), and any action that reaches an outward-facing system.
- Handling secrets or credentials. Never put tokens, passwords, or account identifiers in a prompt.

### How to write a Codex prompt
- Make it self-contained: the goal, the exact file paths, the constraints (boundary, language rules, no git operations), the expected output format, and the command that proves the result.
- State the sandbox choice in the call. Use `read-only` unless the task must edit files.
- Give the spec references (requirement and design section numbers) when the task belongs to a spec. Do not paste the whole conversation.

### Verifying Codex output
- Treat Codex's claims as unverified until checked. Before reporting success, read `git diff` for the changed files and run the relevant tests yourself.
- If Codex's result is wrong or incomplete, correct it with a follow-up `codex_exec` call that names the exact defect, or fix it directly.
- Report to the user what Codex did, what Claude verified, and what remains unverified. Follow `kiro-verify-completion` before any completion claim.

## Minimal Workflow
- Phase 0 (optional): `/kiro-steering`, `/kiro-steering-custom`
- Discovery: `/kiro-discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `/kiro-spec-quick {feature} [--auto]` or step by step:
    - `/kiro-spec-init "description"`
    - `/kiro-spec-requirements {feature}`
    - `/kiro-validate-gap {feature}` (optional: for existing codebase)
    - `/kiro-spec-design {feature} [-y]`
    - `/kiro-validate-design {feature}` (optional: design review)
    - `/kiro-spec-tasks {feature} [-y]`
  - Multi-spec: `/kiro-spec-batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `/kiro-impl {feature} [tasks] [--review required|inline|off]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `--review off` skips task-local review; use it intentionally and keep `/kiro-validate-impl {feature}` as the final quality gate
  - `/kiro-validate-impl {feature}` (standalone re-validation)
- Progress check: `/kiro-spec-status {feature}` (use anytime)

## Skills Structure
Skills are located in `.claude/skills/kiro-*/SKILL.md`
- Each skill is a directory with a `SKILL.md` file
- Skills run inline with access to conversation context
- Skills may delegate parallel research to subagents, or to Codex through `codex_exec` (see the Codex section)
- Additional files (templates, examples) can be added to skill directories
- `kiro-review` — task-local adversarial review protocol used by reviewer subagents
- `kiro-debug` — root-cause-first debug protocol used by debugger subagents
- `kiro-verify-completion` — fresh-evidence gate before success or completion claims
- Use skills explicitly requested by the user and skills relevant to the task's domain, including design, accessibility, and UX.
- Select skills from their descriptions or metadata first, then read only the selected skills and the references needed for the task.
- Follow explicit host and project rules and retain required workflow checks. Do not skip relevant skills just because the task is small.

## Skill Updates
- At session start, the SessionStart hook in `.claude/settings.json` runs `scripts/cc-sdd-session-start.sh`. It installs or updates the skills and settings with cc-sdd (`--overwrite force`), and it restores this file afterwards, so the content of CLAUDE.md is never overwritten.
- Do not use `--overwrite skip`: it also blocks the creation of new files, so a fresh environment would get no skills.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- For spec and implementation work, load the core steering files below from `.kiro/steering/`. Reuse current context rather than rereading unchanged files.
- Load additional steering only when required by project rules or relevant to the task.
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/kiro-steering-custom`)
