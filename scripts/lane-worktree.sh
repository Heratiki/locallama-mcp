#!/usr/bin/env bash
# lane-worktree.sh
#
# Purpose: create, remove and list lane worktrees under .claude/worktrees,
# with the dependency dirs a lane needs symlinked from the main tree.
#
# Usage:
#   scripts/lane-worktree.sh add <name> [base]   # .claude/worktrees/<name>, new branch <name> from base (default main)
#   scripts/lane-worktree.sh rm <name> [--force] # remove worktree and delete branch; refuses if dirty or unmerged
#   scripts/lane-worktree.sh ls                  # lane worktrees: branch, HEAD, merged into main, dirty
#
# Settings: LINKS below (space-separated paths relative to the repo root,
# symlinked into each worktree; set by /bootstrap-orchestration from
# "worktree_links"); override per call with LANE_LINKS="a b". MAIN is the
# integration branch (LANE_MAIN overrides).
#
# Why: a relative path from the wrong cwd nests one worktree inside another,
# so every path here is absolute and rooted at the MAIN tree, even when run
# from inside a lane. This script never installs dependencies and copies
# nothing else.
set -euo pipefail

LINKS="${LANE_LINKS:-node_modules .venv}"
MAIN="${LANE_MAIN:-main}"

COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
ROOT="$(dirname "$COMMON")"
WT_DIR="$ROOT/.claude/worktrees"

usage() { sed -n 2,11p "$0" >&2; exit 2; }

is_merged() { git -C "$ROOT" merge-base --is-ancestor "$1" "$MAIN" 2>/dev/null; }

# Symlinked dirs show as untracked ("dir/" in .gitignore does not match a
# symlink), so they are not counted as changes.
is_dirty() {
  local status link
  status="$(git -C "$1" status --porcelain 2>/dev/null || true)"
  for link in $LINKS; do
    status="$(printf '%s\n' "$status" | grep -vxF "?? $link" || true)"
  done
  [ -n "$(printf '%s' "$status" | tr -d '[:space:]')" ]
}

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
  add)
    name="${1:-}"; base="${2:-$MAIN}"
    [ -n "$name" ] || usage
    path="$WT_DIR/$name"
    [ -e "$path" ] && { echo "exists: $path" >&2; exit 1; }
    git -C "$ROOT" worktree add -q "$path" -b "$name" "$base"
    for link in $LINKS; do
      if [ -e "$ROOT/$link" ]; then
        mkdir -p "$(dirname "$path/$link")"
        ln -s "$ROOT/$link" "$path/$link"
      else
        echo "warning: $ROOT/$link missing; no link made" >&2
      fi
    done
    echo "$path"
    ;;
  rm)
    name=""; force=0
    for a in "$@"; do
      if [ "$a" = "--force" ]; then force=1; else name="$a"; fi
    done
    [ -n "$name" ] || usage
    path="$WT_DIR/$name"
    [ -d "$path" ] || { echo "no such lane worktree: $path" >&2; exit 1; }
    if [ "$force" -eq 0 ]; then
      if is_dirty "$path"; then
        echo "refusing to remove $name: uncommitted changes in $path (--force overrides)" >&2
        exit 1
      fi
      if ! is_merged "$name"; then
        echo "refusing to remove $name: branch $name is not merged into $MAIN (--force overrides)" >&2
        exit 1
      fi
    fi
    # Unlink the symlinks first so git never follows them.
    for link in $LINKS; do
      if [ -L "$path/$link" ]; then rm "$path/$link"; fi
    done
    git -C "$ROOT" worktree remove --force "$path"
    git -C "$ROOT" branch -D "$name" >/dev/null
    git -C "$ROOT" worktree prune
    # A name like lane/x leaves an empty lane/ directory behind.
    rmdir -p --ignore-fail-on-non-empty "$(dirname "$path")" 2>/dev/null || true
    echo "removed $name"
    ;;
  ls)
    printf '%-40s %-32s %-8s %-7s %s\n' PATH BRANCH HEAD MERGED DIRTY
    wt=""; branch=""; head=""
    while IFS= read -r line; do
      case "$line" in
        "worktree "*) wt="${line#worktree }"; branch=""; head="" ;;
        "HEAD "*) head="${line#HEAD }" ;;
        "branch "*) branch="${line#branch refs/heads/}" ;;
        "")
          case "$wt" in
            "$WT_DIR"/*)
              m=no; d=no
              if [ -n "$branch" ] && is_merged "$branch"; then m=yes; fi
              if is_dirty "$wt"; then d=yes; fi
              printf '%-40s %-32s %-8s %-7s %s\n' "${wt#"$WT_DIR"/}" "${branch:-(detached)}" "${head:0:7}" "$m" "$d"
              ;;
          esac
          wt="" ;;
      esac
    done < <(git -C "$ROOT" worktree list --porcelain; echo)
    ;;
  *)
    usage
    ;;
esac
