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

### Delegation Rules (Mandatory)
- **Thinking-first**: Delegate work that requires thinking to Codex: design, analysis, requirements review, new implementation or modification, root-cause investigation during debugging, review, and broad exploration via `codex_exec`. Claude (the main agent) focuses on instructing the delegate, verifying results, reporting to the user, changing approval state, and handling questions for the user.
- **Subagent-first**: For the work above, delegate to `codex_exec` before Claude works on it directly. Independent reviews and mutually independent tasks are also delegation targets.
- **Review is never self-review**: Claude, as the author, does not reach the conclusion of an independent review of a spec or implementation. Always have a `codex_exec` call with `sandbox: "read-only"` do the review, and use its findings as the input.
- **Parallel by default**: Send independent `codex_exec` calls side by side in the same turn.
- **Report the delegation**: The final report states which work was delegated to Codex and what Claude verified. If delegation was skipped, state the reason.
- **Direct-handling exceptions**: Claude may handle directly: mechanical one-to-few-line fixes (typos, swapping a config value, etc.), items awaiting the user's decision, changes to the approval flag in `spec.json`, git operations, and handling of secrets. When applicable, state the reason in the report. Never include secrets in a Codex prompt.
- **On MCP failure**: If `codex_exec` errors, you may run the same request with `codex -a never exec --sandbox read-only --cd <repository> - < <prompt-file>` (the approval flag goes before `exec`). Report that this fallback was used.
- Make each prompt self-contained (target files, requirement/design/task numbers, constraints, output format). Put prompt files in the session scratchpad, not in `/tmp`.

### When to Delegate to Codex
- **Design, analysis, requirements review**: Delegate analysis of issues, organizing options, and review of designs or requirements (`sandbox: "read-only"`).
- **Implementation**: Delegate new creation or changes with `sandbox: "workspace-write"`. The prompt must include target files, requirement/design/task numbers, the test command, and completion criteria.
- **Debugging**: Delegate root-cause investigation and fix proposals. Use `workspace-write` if file changes are needed.
- **Review**: Request independent reviews of diffs, design proposals, and task implementations with `sandbox: "read-only"`. Feed them into the review input of `kiro-review` as needed.
- **Broad exploration**: Delegate searches across many files and tracing behavior through the codebase with `sandbox: "read-only"`, asking for a summary rather than raw output.
- **Parallel work**: When there are multiple independent tasks, send their `codex_exec` calls side by side in the same turn.

### When Not to Delegate
- Items that need the user's judgment or approval: do not delegate the decision; wait for confirmation.
- Changes to approval flags in `spec.json` and git operations: Claude does these directly.
- Work involving secrets or credentials: Claude does this directly and never includes tokens, passwords, or account identifiers in a prompt.
- Destructive operations (reset, forced removal, deleting logins or volumes) and operations that act on external systems: do not delegate.

### How to Write a Codex Prompt
- Make the prompt self-contained: state the goal, target files, requirement/design/task numbers, constraints such as boundaries and language rules, and the output format. Do not paste the whole conversation.
- For implementation requests, include the test command and completion criteria.
- Specify the sandbox at call time. Use `read-only` for reading, investigation, and review; use `workspace-write` for implementation that modifies files.

### Verifying Codex Output
- Treat Codex's report as unverified until checked. After implementation, check the changes with `git diff` and run the tests named in the prompt. This confirms the scope of changes and behavior; it is not a review by Claude. Reviews are requested from `codex_exec` with `sandbox: "read-only"`.
- If the result is wrong or incomplete, name the specific defect and re-request from `codex_exec`.
- Report to the user what Codex did, what Claude verified, and what remains unverified. Follow `kiro-verify-completion` before reporting completion.

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
