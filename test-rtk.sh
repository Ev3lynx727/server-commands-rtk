#!/bin/bash
set -euo pipefail

# test-rtk.sh — MCP stdio protocol smoke test
# Usage: ./test-rtk.sh | node dist/index.js
# Sends JSON-RPC messages with Content-Length framing to MCP server stdin.

NMSG=0

msg() {
  NMSG=$((NMSG + 1))
  local body="$1"
  echo "Content-Length: ${#body}"
  echo
  echo "$body"
}

schema_fail() {
  local id="$1" desc="$2"
  echo "  TG: schema-fail  $desc" >&2
  msg '{"jsonrpc":"2.0","id":"'"$id"'","method":"tools/call","params":{"name":"run_process","arguments":{"command":""}}}'
}

command_test() {
  local id="$1" cmd="$2"
  echo "  TG: command-test \"$cmd\"" >&2
  msg '{"jsonrpc":"2.0","id":"'"$id"'","method":"tools/call","params":{"name":"run_process","arguments":{"command":"'"$cmd"'"}}}'
}

cache_stats() {
  local id="$1"
  echo "  TG: get_cache_stats" >&2
  msg '{"jsonrpc":"2.0","id":"'"$id"'","method":"tools/call","params":{"name":"get_cache_stats","arguments":{}}}'
}

init_test() {
  echo "  TG: initialize" >&2
  msg '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
}

echo "###########################################" >&2
echo "# test-rtk.sh — MCP stdio smoke test       #" >&2
echo "# Pipe: ./test-rtk.sh | node dist/index.js #" >&2
echo "###########################################" >&2
echo >&2

init_test

command_test 2 "echo hello world"
command_test 3 "nonexistent-command-12345"
command_test 4 "git status -c /tmp"
cache_stats  5

schema_fail 6 "empty command (must return Zod error)"
command_test 7 "echo cached-hit (repeat, expect fast cache)"
command_test 8 "echo cached-hit (repeat, expect fast cache)"
command_test 9 "exit 42"
command_test 10 "ls /nonexist/foo"
command_test 11 "cd /nonexist && echo fail"

echo >&2
echo "# Sent $NMSG messages (ids: 1-11)" >&2
echo "# Expect: 2 echo ok, 1 not_found, 1 git error, 1 schema error, 2 cached, 1 exit code, 1 not_found, 1 not_found" >&2
