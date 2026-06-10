# @telenow/react-native

Telenow voice AI SDK for React Native — real-time AI voice agent calls on iOS
and Android. The control plane + DSP run in JS (`src/index.ts`, reusing
`@telenow/client`'s pure modules); the native module (`ios/TelenowAudio.swift`,
`android/.../TelenowAudioModule.kt`) does only mic capture + PCM playback in
voice-communication mode (hardware echo cancellation).

**Status:** packaged for autolinking — compiled `dist/`, `telenow-react-native.podspec`
(+ `RCT_EXTERN_MODULE` bridge + bridging header), `android/build.gradle` +
`TelenowAudioPackage`. Smoke-test in a real RN app before tagging stable.

## Install

```bash
npm i @telenow/react-native @telenow/client
cd ios && pod install
```

Request the mic permission before starting a call: `RECORD_AUDIO` (Android,
runtime) and `NSMicrophoneUsageDescription` (iOS `Info.plist`).

## Use

```tsx
import { TelenowCall } from '@telenow/react-native';

const call = new TelenowCall({
  session,                    // { sessionId, websocketUrl } minted by YOUR backend (recommended)
  // publicSlug: 'my-agent',  // or a published agent
  baseUrl: 'https://api.telenow.ai',
});
call.onState = (s) => setCallState(s);
call.onTranscript = (role, text) => append({ role, text });
await call.start();
```

## Backend-minted session (recommended)

Have YOUR backend call init-web-call with its org API key (`@telenow/server`
`calls.createWeb` / Python `init_web_call`) and hand the resulting
`sessionId` + `websocketUrl` to the app — the SDK then skips on-device session
init, so no token or slug ships in the client. The SDK also answers server
`ping` events (powers the latency breakdown) and flushes queued agent audio on
`clear` (barge-in).

## Pre-stable device checklist
1. `npx react-native init` a scratch app, `npm i` this package (local tarball
   via `npm pack`), `pod install`, build to a real iPhone + Android phone.
2. Place a call against a published agent: confirm two-way audio, mute,
   barge-in (interrupt the agent mid-sentence), kill Wi-Fi briefly (reconnect),
   and speakerphone echo (the agent must not hear itself).
3. Optional (perf): swap the JS DSP for `telenow-audio-core` builds —
   Android `cargo ndk` → `.so` + JNI, iOS `.xcframework` (see
   `../audio-core/README.md`). Not required: the JS DSP is the verified
   reference and fast enough for a single call.

> Key gotcha: route agent playback **through the voice-processing unit** so the
> OS echo-canceller removes the agent's own voice from the mic (the native
> modules already do this — keep it that way).
