#!/usr/bin/env bash
# The installer's own tests (specs/spec_kit.md §Verification): a scratch copy of
# the clone, a scratch HOME, every act asserted. Run from anywhere:
#   provisions/install.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vork-install-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"; mkdir -p "$HOME"

# a scratch clone: the committed tree plus a link to the real dependencies
CLONE="$WORK/vork"; mkdir -p "$CLONE"
(cd "$HERE" && git archive HEAD rules skills provisions apps/foundry/.env.example apps/foundry/package.json docs/conventions/templates) | tar -x -C "$CLONE"
(cd "$CLONE" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m t)
ln -s "$HERE/apps/foundry/node_modules" "$CLONE/apps/foundry/node_modules"
INSTALL="$CLONE/provisions/install"
ENV="$CLONE/apps/foundry/.env"
mkdir -p "$WORK/keys"; printf 'x\n' > "$WORK/keys/owner.token"; printf 'y\n' > "$WORK/keys/vork.token"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ok   $1"; }
ko() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
assert() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

echo "first install needs the four flags"
set +e; out="$("$INSTALL" --surface claude --owner-token "$WORK/keys/owner.token" 2>&1)"; code=$?; set -e
assert "exits 2 naming the missing flag" "[ $code -eq 2 ] && [[ \"$out\" == *'--vork-token'* ]]"
assert "writes nothing" "[ ! -f '$ENV' ] && [ ! -d '$HOME/.claude' ]"

echo "install --surface claude, first run"
out="$("$INSTALL" --surface claude --owner-token "$WORK/keys/owner.token" --vork-token "$WORK/keys/vork.token" --name "Vork Bot" --email "vork@example.com" --projects-root "$WORK/projects")"
assert "root created" "[ -d '$WORK/projects' ]"
assert ".env created with the five lines" "grep -q '^FOUNDRY_OWNER_TOKEN_PATH=$WORK/keys/owner.token$' '$ENV' && grep -q '^FOUNDRY_VORK_TOKEN_PATH=$WORK/keys/vork.token$' '$ENV' && grep -q '^FOUNDRY_VORK_NAME=Vork Bot$' '$ENV' && grep -q '^FOUNDRY_VORK_EMAIL=vork@example.com$' '$ENV' && grep -q '^FOUNDRY_PROJECT_STORAGE_PATH=$WORK/projects$' '$ENV'"
assert ".env value lines carry no placeholder" "! grep -qE '^[A-Z_]+=.*<' '$ENV'"
assert "rule byte-equal, no frontmatter" "cmp -s '$CLONE/rules/PROJECT.md' '$HOME/.claude/rules/PROJECT.md'"
assert "three skills byte-equal" "diff -r '$CLONE/skills' '$HOME/.claude/skills' >/dev/null"
assert "no codex surface touched" "[ ! -d '$HOME/.codex' ]"
assert "report names the surface and root" "[[ \"$out\" == *'installed claude from'* ]] && [[ \"$out\" == *\"root $WORK/projects\"* ]]"

echo "second run, no flags"
out="$("$INSTALL" --surface claude)"
assert "every path unchanged" "! grep -qE '^(updated|created|installed) ' <<<\"$out\""
assert ".env keeps its root without --projects-root" "grep -q '^FOUNDRY_PROJECT_STORAGE_PATH=$WORK/projects$' '$ENV'"

echo "--check"
set +e; "$INSTALL" --surface claude --check >/dev/null; code=$?; set -e
assert "clean exits 0" "[ $code -eq 0 ]"
printf 'edited\n' >> "$HOME/.claude/skills/release/SKILL.md"
set +e; out="$("$INSTALL" --surface claude --check)"; code=$?; set -e
assert "an edited landed file exits 1 naming it" "[ $code -eq 1 ] && [[ \"$out\" == *'drifted'*'skills/release/SKILL.md'* ]]"
"$INSTALL" --surface claude >/dev/null
assert "the next install restores it" "cmp -s '$CLONE/skills/release/SKILL.md' '$HOME/.claude/skills/release/SKILL.md'"

echo "install --surface codex on the installed machine"
mkdir -p "$HOME/.codex"; printf '# my own notes\nkeep me\n' > "$HOME/.codex/AGENTS.md"
before="$(cat "$ENV")"
"$INSTALL" --surface codex >/dev/null
assert ".env byte-identical" "[ \"\$(cat '$ENV')\" = \"\$before\" ]"
assert "rule byte-equal" "cmp -s '$CLONE/rules/PROJECT.md' '$HOME/.codex/rules/PROJECT.md'"
assert "skills byte-equal" "diff -r '$CLONE/skills' '$HOME/.codex/skills' >/dev/null"
assert "pointer block present once with the root" "[ \$(grep -c '<!-- vork:start' '$HOME/.codex/AGENTS.md') -eq 1 ] && grep -q 'Projects under .$WORK/projects/' '$HOME/.codex/AGENTS.md'"
assert "operator content preserved" "head -2 '$HOME/.codex/AGENTS.md' | grep -q 'keep me'"
snap="$(cat "$HOME/.codex/AGENTS.md")"
"$INSTALL" --surface codex >/dev/null
assert "second codex run leaves AGENTS.md byte-identical" "[ \"\$(cat '$HOME/.codex/AGENTS.md')\" = \"\$snap\" ]"

echo "a different root rewrites the block and the .env line; --check with the first value reports drift"
"$INSTALL" --surface codex --projects-root "$WORK/other" >/dev/null
assert "block rewritten in place, once" "[ \$(grep -c '<!-- vork:start' '$HOME/.codex/AGENTS.md') -eq 1 ] && grep -q 'Projects under .$WORK/other/' '$HOME/.codex/AGENTS.md' && head -2 '$HOME/.codex/AGENTS.md' | grep -q 'keep me'"
assert ".env line rewritten" "grep -q '^FOUNDRY_PROJECT_STORAGE_PATH=$WORK/other$' '$ENV'"
set +e; "$INSTALL" --surface codex --projects-root "$WORK/projects" --check >/dev/null; code=$?; set -e
assert "--check with the first root exits 1" "[ $code -eq 1 ]"
"$INSTALL" --surface codex --name "Other Name" >/dev/null
assert "--name given again rewrites its line" "grep -q '^FOUNDRY_VORK_NAME=Other Name$' '$ENV'"

echo "usage"
set +e; "$INSTALL" --surface other >/dev/null 2>&1; c1=$?; "$INSTALL" >/dev/null 2>&1; c2=$?; "$INSTALL" --surface claude --bogus >/dev/null 2>&1; c3=$?; set -e
assert "unknown surface, no surface, unknown flag exit 2" "[ $c1 -eq 2 ] && [ $c2 -eq 2 ] && [ $c3 -eq 2 ]"
printf 'x {{other}}\n' > "$CLONE/provisions/codex/AGENTS.md"
set +e; "$INSTALL" --surface codex >/dev/null 2>&1; c4=$?; set -e
assert "an unknown variable in a surface file exits 2" "[ $c4 -eq 2 ]"

echo
echo "install tests: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
