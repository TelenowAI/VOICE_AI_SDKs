#!/usr/bin/env bash
# Telenow SDK — run every test that's verifiable WITHOUT the live backend or a
# device. Usage:  bash sdk/test-all.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$ROOT/sdk"
TSC="$ROOT/voice_ai_frontend/node_modules/.bin/tsc"
PASS=0; FAIL=0; SKIP=0
have() { command -v "$1" >/dev/null 2>&1; }
step() { # step "name" "required-cmd" "command"
  echo; echo "▶ $1"
  if ! have "$2"; then echo "  ⊘ skipped (no $2)"; SKIP=$((SKIP+1)); return; fi
  if bash -c "$3" >/tmp/tn_test.log 2>&1; then echo "  ✓ pass"; PASS=$((PASS+1));
  else echo "  ✗ FAIL"; tail -15 /tmp/tn_test.log; FAIL=$((FAIL+1)); fi
}

# ---- Rust kernels (tested logic) ----
step "audio-core (rust)"        cargo "cd '$SDK/audio-core' && cargo test -q"
step "client-token-core (rust)" cargo "cd '$SDK/backend/client-token-core' && cargo test -q"
step "media-plane-core (rust)"  cargo "cd '$SDK/backend/media-plane-core' && cargo test -q"
step "sdk_audio_core (rust)"    cargo "cd '$ROOT/voice_ai_rust/sdk_audio_core' && cargo test -q"

# ---- TypeScript packages (build + tests) ----
step "client-web (build+reconnect)" node "cd '$SDK/client-web' && '$TSC' -p tsconfig.json && node --test"
step "server-node (build+webhooks)" node "cd '$SDK/server-node' && '$TSC' -p tsconfig.json && node --test"
step "frontend audio (vitest)"      npx  "cd '$ROOT/voice_ai_frontend' && npx vitest run src/voice-sdk"

# ---- Python ----
step "server-python (unittest)" python3 "cd '$SDK/server-python' && python3 -m unittest discover -s tests"

# ---- Swift (build = compile check; swift test needs Xcode XCTest) ----
step "swift (build)" swift "cd '$SDK/swift' && swift build"

# ---- Install smoke: pack + install into a clean project + import ----
step "install smoke (npm pack→install→import)" node "
  S=/tmp/tn-smoke; rm -rf \$S; mkdir -p \$S; cd \$S; npm init -y >/dev/null 2>&1
  C=\$(cd '$SDK/client-web' && npm pack 2>/dev/null | tail -1)
  V=\$(cd '$SDK/server-node' && npm pack 2>/dev/null | tail -1)
  npm i '$SDK/client-web/'\$C '$SDK/server-node/'\$V >/dev/null 2>&1
  node --input-type=module -e \"
    import * as c from '@telenow/client';
    import { verifyWebhook } from '@telenow/server';
    if (!c.CaptureEngine || !c.ReconnectingSocket) throw new Error('missing client exports');
    if (await verifyWebhook('x','sha256=bad','s') !== false) throw new Error('verify broken');
    console.log('install smoke ok:', Object.keys(c).length, 'client exports');
  \"
"

echo; echo "════════════════════════════════════════"
echo "  PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ]
