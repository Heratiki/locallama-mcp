# Git scratch workspaces

`GitWorkspaceBackend` implements `WorkspaceBackend` from `../types.ts`.
Construct one backend per target repository, passing the existing config fields:

```ts
const backend = new GitWorkspaceBackend(repoPath, {
  rootDir: config.rootDir,
  scratchDir: config.scratchDir,
});
const base = await backend.snapshot(repoPath, fileHints, jobId);
const workspace = await backend.create(base, jobId);
```

The repository must be a git working-tree root with a `HEAD` commit. Job IDs
must contain only ASCII letters, digits, underscores and hyphens, starting
with a letter or digit. Scratch defaults to `rootDir/scratch`; relative overrides
are resolved against `rootDir`. Canonical paths, including symlink aliases,
are checked to keep scratch outside the repository.

Snapshot uses a temporary index, includes current bytes of tracked paths
(including newly staged files) and explicitly hinted untracked files, and
retains the commit in `refs/locallama/base/<jobId>`. It leaves the source index,
working tree, branches and stash unchanged. Checkout hooks and fsmonitor are
disabled for backend git commands. Dependency links come from the snapshot's
`.locallama/checks.json`; absent `links` defaults to existing `node_modules`
and `.venv`. Explicit `links: []` disables links. Explicit paths are linked
even if their source does not yet exist. Links must be safe, non-overlapping,
repository-relative paths whose destination parents are real workspace
directories. The backend never installs dependencies.

`create(base, jobId)` also works after restart: a new backend instance locates
B using the bound repo and the base ref, and resets an existing owned worktree
to B. If its directory disappeared, it recreates the worktree from B. It never
re-snapshots the current source repo during recovery. Creation failures remove
newly created worktrees while retaining B for retry or terminal-job cleanup.

Before dispatch, call `await backend.cleanupOrphans(ownedJobIds)` for every
repository known to patch job persistence. Pass the set of job IDs owned by
non-terminal patch Jobs. Cleanup removes this repo's unowned worktrees directly
under its configured scratch directory, prunes worktree metadata, and deletes
unowned base refs, including refs whose worktree was never created. It preserves
owned jobs and worktrees outside this scratch namespace. Call it again after
terminal submission/creation failures that have no `Workspace` to dispose.

The worker should call `dispose(workspace)` after its processes exit. Reset,
diff and dispose validate handles before mutating worktrees. Diff stages new
files, excludes dependency links, and emits binary patches with stable prefixes
and no color or external diff/text conversion. Dispose removes the worktree,
prunes metadata and deletes its base ref. This module requires git on PATH;
a copy backend and a container backend remain out of scope.
