#!/usr/bin/env bash
# Shared pipeline utilities for frontend build scripts.

set -euo pipefail

log_info() {
  echo "[INFO] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

start_timer() {
  date +%s.%N
}

elapsed_seconds() {
  local start="$1"
  local end
  end="$(date +%s.%N)"
  awk -v start="$start" -v end="$end" 'BEGIN { printf "%.3f", end - start }'
}
