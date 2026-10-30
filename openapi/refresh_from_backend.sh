#!/bin/bash
# refresh_from_backend.sh — copy the public API's OpenAPI document from the backend, where it is written.
#
# Since 2026-10-29 the source of truth is `voice_ai_rust/openapi/openapi.yaml`: the backend's tests hold it to the
# routes (every documented operation is served, every route an org API key reaches is documented or listed), so a
# route and its description change in one commit. This file (`openapi/openapi.yaml` here) is the published copy the
# generators and the SDK release read. Do not edit it here — edit the backend's and run this.
#
# Usage:
#   openapi/refresh_from_backend.sh [path to voice_ai_rust]          copy it (default: ../voice_ai_rust beside this repo)
#   openapi/refresh_from_backend.sh --check [path to voice_ai_rust]  exit 1 if the copy differs (for a release step)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
check=0
if [ "${1:-}" = "--check" ]; then check=1; shift; fi
backend="${1:-$here/../../voice_ai_rust}"
src="$backend/openapi/openapi.yaml"
dst="$here/openapi.yaml"
[ -f "$src" ] || { echo "no $src — pass the voice_ai_rust checkout as an argument" >&2; exit 2; }
if [ "$check" = 1 ]; then
  if cmp -s "$src" "$dst"; then echo "openapi.yaml == $src"; else echo "openapi.yaml differs from $src — run $0" >&2; exit 1; fi
else
  cp "$src" "$dst"
  echo "copied $src -> $dst ($(wc -l < "$dst" | tr -d ' ') lines)"
fi
