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
  download_repository() {
    if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
      if curl --fail --silent --show-error --location \
        --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 120 \
        -H 'Accept: application/vnd.github+json' \
        -H 'User-Agent: doubao-seedance-installer' \
        "https://api.github.com/repos/$REPOSITORY/tarball/main" \
        --output "$TEMP_DIR/repository.tar.gz" &&
        tar -xzf "$TEMP_DIR/repository.tar.gz" -C "$TEMP_DIR"; then
        local skill_file
        skill_file="$(find "$TEMP_DIR" -type f -path '*/skills/doubao-seedance/SKILL.md' -print -quit)"
        if [ -n "$skill_file" ]; then
          SOURCE="${skill_file%/SKILL.md}"
          return 0
        fi
      fi
    fi

    if command -v git >/dev/null 2>&1; then
      if git -c http.version=HTTP/1.1 \
        -c http.connectTimeout=15 \
        -c http.lowSpeedLimit=1000 \
        -c http.lowSpeedTime=30 \
        clone --depth 1 --quiet "https://github.com/$REPOSITORY.git" "$TEMP_DIR/repository"; then
        SOURCE="$TEMP_DIR/repository/skills/doubao-seedance"
        return 0
      fi
    fi

    printf 'Unable to download %s. Check your network or proxy and retry.\n' "$REPOSITORY" >&2
    return 1
  }
  download_repository
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
