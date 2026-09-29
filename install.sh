#!/usr/bin/env bash

set -euo pipefail

REPOSITORY="selwen-0102/doubao-sp-skill"
CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
SKILLS_DIR="$CODEX_ROOT/skills"
TARGET="$SKILLS_DIR/doubao-seedance"
TEMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1; then
  printf 'Missing required command: node\n' >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  printf 'Node.js 18 or newer is required; found %s.\n' "$(node --version)" >&2
  exit 1
fi

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

SOURCE="$SCRIPT_DIR/skills/doubao-seedance"
if [ -z "$SCRIPT_DIR" ] || [ ! -f "$SOURCE/SKILL.md" ]; then
  if ! command -v git >/dev/null 2>&1; then
    printf 'Missing required command: git\n' >&2
    exit 1
  fi
  git clone --depth 1 --quiet "https://github.com/$REPOSITORY.git" "$TEMP_DIR/repository"
  SOURCE="$TEMP_DIR/repository/skills/doubao-seedance"
fi
if [ ! -f "$SOURCE/SKILL.md" ] || [ ! -f "$SOURCE/scripts/run.mjs" ]; then
  printf 'Repository does not contain the doubao-seedance skill.\n' >&2
  exit 1
fi
node --check "$SOURCE/scripts/run.mjs"

mkdir -p "$TARGET"
cp -R "$SOURCE"/. "$TARGET"/
chmod +x "$TARGET/scripts/run.mjs"

printf 'Installed doubao-seedance to %s\n' "$TARGET"
printf '%s\n' 'Restart Codex, then invoke it with $doubao-seedance.'
