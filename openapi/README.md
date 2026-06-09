# Telenow Voice API — OpenAPI + generated clients

`openapi.yaml` is the control-plane contract (tokens, calls, agents). Generate a
typed **backend** client for almost any language from it — this is how you cover
the long tail (Kotlin/JVM, Go, Ruby, PHP, C#, …) without hand-writing each SDK.
(The ergonomic Node and Python clients are hand-written in `../server-node` and
`../server-python`; everything else is generated.)

## Generate

Using [`openapi-generator`](https://openapi-generator.tech) (no install — via npx):

```bash
# Kotlin / JVM server
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml -g kotlin -o ./generated/kotlin \
  --additional-properties=library=jvm-okhttp4,packageName=ai.telenow.client

# Go
npx @openapitools/openapi-generator-cli generate -i openapi.yaml -g go -o ./generated/go

# Ruby
npx @openapitools/openapi-generator-cli generate -i openapi.yaml -g ruby -o ./generated/ruby

# PHP
npx @openapitools/openapi-generator-cli generate -i openapi.yaml -g php -o ./generated/php

# C# / .NET
npx @openapitools/openapi-generator-cli generate -i openapi.yaml -g csharp -o ./generated/csharp
```

Run `npx @openapitools/openapi-generator-cli list` for all ~50 targets.

## Notes
- Auth: `X-API-Key` for server-to-server; `Authorization: Bearer <client-token>`
  for the browser/app session-init path.
- The `generated/` dir is build output — keep it git-ignored and regenerate in CI
  (see `../RELEASING.md`), or commit per-language if you prefer pinned clients.
- Webhook **signature verification** is not part of REST codegen; copy the small
  HMAC helper from `../server-node` / `../server-python` into each generated client.
- Audio runs over the `/ws/web-agent` WebSocket and is handled by the client
  audio SDKs, not these generated REST clients.
