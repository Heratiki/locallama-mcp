# Patch tasks run in git worktrees and use search/replace edit blocks

A new MCP tool, `patch_task`, grinds on a coding goal until a Check passes or the budget ends. It returns a diff or a Diagnosis. It never writes the user's working tree. PRD: `docs/prd/01-verified-patch-and-grind-loop.md`. Roadmap: `docs/prd/00-goals-roadmap.md`.

## Decision

- **Ruling 5 (git worktree, backend seam).** Each Patch Task runs in a Scratch Workspace: a `git worktree` made from a Snapshot commit. The worker uses only the `WorkspaceBackend` interface (`snapshot`, `create`, `reset`, `diff`, `dispose`). A different backend can replace git later without a change to the worker.
- **Git is required.** Ruling 5 replaces the grounding map's "no dependency on `git apply`". Patch tasks need `git` on PATH and a git repo as the target. A request without them is refused at submit.
- **R-A (edit blocks).** The model writes search/replace Edit Blocks. LocalLama applies them and makes the real diff with git. Whole-file output is the fallback for a new file and for a small file only.
- **R-B (new tool).** `patch_task` is a new tool. It uses the persistent Task and Job tables and returns `task_id` at once. The client polls `get_task_status` and stops a task with `cancel_task`. `route_task` does not change.
- **R-D (own model path).** The patch worker calls providers through `ProviderRegistry` directly. It does not use `executeRouteTaskBlocking`, `codeTaskCoordinator` or `buildRankedTrio`.

## Reason

- A worktree keeps the user's tree, index, stash list and branches unchanged. Checks run on a real copy, with the user's `node_modules` linked in, not installed again.
- Edit blocks are short. Small local models make fewer errors when they write a few lines than when they write a whole file. A diff from git is exact.
- A separate tool keeps `route_task` stable and gives patch work its own state and budgets.
- The live run of 2026-11-01 showed two faults in the `route_task` path (findings F1, F2): it drops llama.cpp models, and it can give a subtask a wrong provider. The patch worker avoids that path.

## Considered options

**Whole-file output as the main format** — the model returns each changed file in full. Rejected: it wastes tokens, small models drop or change unrelated lines, and large files exceed the output cap. It stays as a fallback for new and small files.

**Reuse `executeRouteTaskBlocking`, `codeTaskCoordinator` and `buildRankedTrio`** — less new code. Rejected: findings F1 and F2 of the 2026-11-01 live run. This path drops llama.cpp models and can give a subtask a wrong provider. The existing "give the whole implementation" prompt also conflicts with edit blocks.

**No git dependency (apply a model diff with a custom patcher)** — rejected under Ruling 5. Git gives the snapshot, the worktree and the exact diff. The cost is that `git` must be on PATH.
