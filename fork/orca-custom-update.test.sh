#!/bin/zsh
# Unit tests for the pure(ish) helpers in orca-custom-update: failure-list diffing, version compare,
# and the quiet-install decision (ioreg/orca stubbed out). Does not touch the real repo/app/state.
#
#   zsh fork/orca-custom-update.test.sh
set -uo pipefail

SCRIPT_DIR="${0:A:h}"
export ORCA_CUSTOM_UPDATE_TEST=1
export ORCA_CUSTOM_UPDATE_COPY=test
TMP_STATE=$(mktemp -d)
export ORCA_CUSTOM_UPDATE_STATE="$TMP_STATE"
trap 'rm -rf "$TMP_STATE"' EXIT

source "$SCRIPT_DIR/orca-custom-update"

pass=0
fail=0

assert_eq() {
  local got=$1 want=$2 label=$3
  if [[ "$got" == "$want" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    print -r -- "FAIL $label: want [$want] got [$got]"
  fi
}

assert_true() {
  local label=$1; shift
  if "$@"; then pass=$((pass + 1)); else fail=$((fail + 1)); print -r -- "FAIL $label: expected success"; fi
}

assert_false() {
  local label=$1; shift
  if ! "$@"; then pass=$((pass + 1)); else fail=$((fail + 1)); print -r -- "FAIL $label: expected failure"; fi
}

# --- normalize_test_failures / diff_new_failures (failure-list diffing) ---

in=$(mktemp)
cat >"$in" <<'EOF'
 FAIL  a.test.ts > case one 12ms
 FAIL  a.test.ts > case one 12ms
 FAIL  b.test.ts > case two 340ms
ok other line
 FAIL  c.test.ts > case three
EOF
got=$(normalize_test_failures <"$in")
want=$' FAIL  a.test.ts > case one\n FAIL  b.test.ts > case two\n FAIL  c.test.ts > case three'
assert_eq "$got" "$want" "normalize_test_failures dedups and strips duration"
rm -f "$in"

cur=$(mktemp); base=$(mktemp); out=$(mktemp)
print -r -- $' FAIL  a.test.ts > case one\n FAIL  b.test.ts > case two\n FAIL  c.test.ts > case three' >"$cur"
print -r -- $' FAIL  a.test.ts > case one\n FAIL  b.test.ts > case two' >"$base"
diff_new_failures "$cur" "$base" "$out"
assert_eq "$(cat "$out")" " FAIL  c.test.ts > case three" "diff_new_failures: only non-baseline failure"
rm -f "$cur" "$base" "$out"

cur=$(mktemp); base=$(mktemp); out=$(mktemp)
print -r -- $' FAIL  a.test.ts > case one' >"$cur"
print -r -- $' FAIL  a.test.ts > case one' >"$base"
diff_new_failures "$cur" "$base" "$out"
assert_eq "$(cat "$out")" "" "diff_new_failures: identical to baseline -> empty"
rm -f "$cur" "$base" "$out"

# --- version_gt (version compare) ---

assert_true  "version_gt newer"   version_gt v1.4.230 v1.4.224
assert_false "version_gt older"   version_gt v1.4.200 v1.4.224
assert_false "version_gt equal"   version_gt v1.4.224 v1.4.224
assert_true  "version_gt minor"   version_gt v1.5.0 v1.4.237
assert_false "version_gt reverse" version_gt v1.4.224 v1.4.230

# --- quiet-install decision, with stubbed ioreg/orca ---

ioreg() { print -r -- '    | | |   "HIDIdleTime" = 3603005512291'; }
orca() { print -r -- '{"result":{"worktrees":[]}}'; }
assert_true  "quiet_time_ok: 3603s idle >= 15min" quiet_time_ok
assert_false "any_agent_working: no agents" any_agent_working
assert_true  "mac_quiet_for_install: idle, no agents" mac_quiet_for_install

ioreg() { print -r -- '    | | |   "HIDIdleTime" = 120000000000'; }  # 120s
assert_false "quiet_time_ok: 120s idle < 15min" quiet_time_ok
assert_false "mac_quiet_for_install: not idle enough" mac_quiet_for_install

ioreg() { print -r -- '    | | |   "HIDIdleTime" = 3603005512291'; }
orca() { print -r -- '{"result":{"worktrees":[{"agents":[{"state":"working"}]}]}}'; }
assert_true  "any_agent_working: one agent working" any_agent_working
assert_false "mac_quiet_for_install: idle but agent working" mac_quiet_for_install

unset -f orca
assert_true "any_agent_working: no orca CLI -> conservative true" any_agent_working

print -r -- "pass=$pass fail=$fail"
(( fail == 0 ))
