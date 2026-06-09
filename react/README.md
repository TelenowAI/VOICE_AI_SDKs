# @telenow/react

React bindings for the Telenow Voice SDK.

```bash
npm install @telenow/react @telenow/client react
```

```tsx
import { useVoiceCall } from '@telenow/react';

function CallButton({ token }: { token: string }) {
  const { state, transcript, muted, start, stop, mute } = useVoiceCall({
    token,                                  // minted by your backend (@telenow/server)
    audio: { encoding: 'pcm16', targetSampleRate: 16000, noiseSuppression: true },
  });
  return (
    <div>
      <button onClick={state === 'live' ? stop : start}>
        {state === 'live' ? 'End' : 'Call'}
      </button>
      {state === 'live' && <button onClick={() => mute(!muted)}>{muted ? 'Unmute' : 'Mute'}</button>}
      <ul>{transcript.map((t, i) => <li key={i}><b>{t.role}:</b> {t.text}</li>)}</ul>
    </div>
  );
}
```

Build: `npm install && npm run build`. Publish: see `../RELEASING.md`.
