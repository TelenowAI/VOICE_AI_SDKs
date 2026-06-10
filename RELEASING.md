# Publishing the Telenow SDK — every package manager

Complete, copy-pasteable steps to publish each package. **Nothing is published
yet.** Publishing is irreversible (a version can't be reused), so always
`--dry-run` first.

## 0. Readiness — what can ship today vs. needs work first
| Package | Registry | Ready now? |
|---|---|---|
| `@telenow/client` | npm | ✅ builds + install-smoke verified |
| `@telenow/server` | npm | ✅ builds + tests |
| `@telenow/react` | npm | ✅ builds (publish **after** `@telenow/client`) |
| `telenow` | PyPI | ✅ tests pass |
| `telenow-audio-core` | crates.io | ✅ tests pass |
| `@telenow/react-native` | npm | ✅ packaged (dist build + podspec + gradle autolink); smoke-test in a real RN app before tagging stable |
| `TelenowSDK` | SwiftPM | ✅ via git tag in its **own public repo** (Package.swift must be at the repo ROOT — see §8) · CocoaPods optional |
| `ai.telenow:sdk` | Maven | ⚠️ build the Rust core to `.so` (cargo-ndk) + AAR first |
| `telenow` (Flutter) | pub.dev | ⚠️ add the native plugin impl (`android/`,`ios/`) first |

## 1. One-time setup (accounts + ownership)
| Registry | Need |
|---|---|
| **npm** | account; create/own the **`@telenow` org/scope**; `npm login` or an automation `NPM_TOKEN`; enable 2FA |
| **PyPI** | account; the `telenow` project name; an API token (`__token__` / `PYPI_TOKEN`) — or set up Trusted Publishing (OIDC) |
| **crates.io** | account (GitHub login); `cargo login <token>`; own the crate names |
| **Maven Central** | Sonatype **Central Portal** namespace `ai.telenow` (verify the `telenow.ai` domain) + a **GPG** signing key — or use **GitHub Packages** (no domain/GPG) |
| **CocoaPods** | `pod trunk register <email>` (SwiftPM needs only a git tag) |
| **pub.dev** | a Google account with publish rights |

> **Names are FINAL** (they match the telenow.ai brand) — register exactly
> these: npm org **`@telenow`**, PyPI project **`telenow`**, crate
> **`telenow-audio-core`**, Swift **`TelenowSDK`**, Maven **`ai.telenow`**.
> If a registry name is already taken, fall back to `@telenow-ai` (npm) /
> `telenow-sdk` (PyPI) and update the manifests + docs branch to match.

### 1.5 Public repos to create (metadata already points at them)
| Repo | Contents | Why |
|---|---|---|
| `MettyAI/VOICE_AI_SDKs` (public) | a copy/subtree of `voice_ai/sdk/` | npm `repository`/`bugs` links, PyPI/crates `Source` links, the RN podspec `s.source`, provenance |
| `MettyAI/telenow-swift` (public) | `sdk/swift/` contents with `Package.swift` at the repo **root** | SwiftPM can only consume a package whose manifest is at the repo root |

## 2. Versioning
- **SemVer** everywhere. Pre-1.0 (`0.x`) lets you iterate; breaking → bump minor.
- npm: use [Changesets](https://github.com/changesets/changesets) — `npx changeset`
  to record, `npx changeset version` to bump, `npx changeset publish` to release
  the whole npm set in one go (handles order + tags).
- Keep `@telenow/react` and `@telenow/react-native` aligned with the
  `@telenow/client` major they depend on.

## 3. Publish ORDER (dependents last)
```
telenow-audio-core ─▶ (native packages that embed it)
@telenow/client    ─▶ @telenow/react , @telenow/react-native
@telenow/server, telenow(py), telenow-audio-core   — independent
```
`@telenow/react` (peerDependency) and `@telenow/react-native` (dependency) declare
`@telenow/client@^0.1.0`, which only resolves once `@telenow/client` is on npm —
so publish it **first**.

---

## 4. npm — `@telenow/client`, `@telenow/server`, `@telenow/react`, `@telenow/react-native`

Auth: `npm login` (interactive) **or** CI token:
```bash
npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN
```

> **Two gotchas already handled / to remember:**
> 1. Run **`npm install`** (or `npm ci`) in the package first — `prepublishOnly`
>    runs `tsc`, which needs the local `typescript` devDep present.
> 2. The compiled ESM uses **`.js` import specifiers** (required by Node's ESM
>    resolver). Keep it that way; don't strip extensions.

```bash
# 1) @telenow/client  (publish FIRST)
cd sdk/client-web
npm install
npm publish --dry-run            # inspect the tarball (dist/*.js + *.d.ts + README)
npm publish --access public      # add --otp=<code> if 2FA prompts

# 2) @telenow/server  (independent)
cd ../server-node && npm install && npm test
npm publish --access public

# 3) @telenow/react   (after @telenow/client is live)
cd ../react && npm install && npm run build
npm publish --access public

# 4) @telenow/react-native  (after @telenow/client; autolink packaging included)
cd ../react-native && npm install && npm run build
npm publish --access public      # ships dist + src + ios (podspec/bridge) + android (gradle/package)
```
- `--access public` is required the first time for a scoped package (the
  `publishConfig.access:"public"` in each manifest also covers this).
- **Supply-chain provenance** (recommended, from CI): `npm publish --provenance --access public`.
- **Verify:** `npm view @telenow/client version` and install into a temp dir
  (`npm i @telenow/client` → `node -e "import('@telenow/client')"`).

---

## 5. PyPI — `telenow`
```bash
cd sdk/server-python
python -m unittest discover -s tests        # 13 tests
python -m pip install --upgrade build twine
python -m build                              # → dist/telenow-0.1.0-py3-none-any.whl + .tar.gz
twine check dist/*                           # metadata sanity
twine upload dist/*                          # auth: username __token__ / password $PYPI_TOKEN
```
- **Verify:** `pip install telenow` in a fresh venv → `python -c "import telenow"`.
- **Trusted Publishing (better for CI):** configure a PyPI "trusted publisher"
  for the GitHub repo, then `pypa/gh-action-pypi-publish` uploads via OIDC — no
  token stored.

---

## 6. crates.io — `telenow-audio-core` (+ optional internals)
```bash
cargo login <crates.io-token>
cd sdk/audio-core
cargo test
cargo publish --dry-run
cargo publish
```
- The other crates (`telenow-client-token`, `telenow-media-plane`,
  `voice_ai_rust/sdk_audio_core`) are mostly consumed as **path/git deps** by the
  backend — publish them only if you want them standalone. If a crate depends on
  another, publish the dependency first (crates.io requires real version deps, not
  `path`).

---

## 7. Maven — `ai.telenow:sdk` (Android)
Prereq: build the Rust core for Android and assemble the AAR (see
`android/README.md` — `cargo ndk` → `.so` in `jniLibs/`).

**Option A — Maven Central (public):**
1. Register the `ai.telenow` namespace on the Sonatype **Central Portal** and
   verify the `telenow.ai` domain.
2. Add signing + the publish repo to `android/build.gradle.kts` (GPG key in CI).
3. Publish:
   ```bash
   cd sdk/android
   ./gradlew publish               # uploads signed AAR + POM
   ```
   Then release the staging repo in the Central Portal.

**Option B — GitHub Packages (simplest, private/org):** point the `publishing`
repository at `https://maven.pkg.github.com/<org>/<repo>` with a `GITHUB_TOKEN`;
`./gradlew publish`. No domain/GPG.

---

## 8. Swift — `TelenowSDK` (SwiftPM + optional CocoaPods)
The package is **pure Swift** (no binary dependency), so SwiftPM publishing is
a git tag — but in a **dedicated public repo with `Package.swift` at the root**
(SwiftPM cannot consume a subdirectory of a monorepo):
```bash
cd sdk/swift && swift build                      # sanity
# one-time: create the public repo and push the swift package as its root
git init /tmp/telenow-swift && cp -R . /tmp/telenow-swift && cd /tmp/telenow-swift
git add -A && git commit -m "TelenowSDK v0.1.0"
git remote add origin git@github.com:MettyAI/telenow-swift.git
git push -u origin main
git tag v0.1.0 && git push origin v0.1.0
```
Consumers then add `https://github.com/MettyAI/telenow-swift` in Xcode
(*File → Add Package Dependencies*) or in `Package.swift`.

**CocoaPods (optional):** create `TelenowSDK.podspec` (name, version, source git
tag, `source_files = "Sources/**/*.swift"`, platforms), then:
```bash
pod lib lint
pod trunk push TelenowSDK.podspec
```

---

## 9. pub.dev — `telenow` (Flutter)
Prereq: add the native plugin implementations (`android/` Kotlin + `ios/` Swift)
to the package — it currently ships `lib/` + `pubspec.yaml` only.
```bash
cd sdk/flutter
flutter pub publish --dry-run        # validates pubspec + plugin layout
flutter pub publish                  # Google-account auth in the browser
```

---

## 10. CI (GitHub Actions) — automated, on a version tag
```yaml
# .github/workflows/release.yml  (outline)
on: { push: { tags: ['v*'] } }
permissions: { id-token: write, contents: read }   # OIDC for npm provenance + PyPI trusted publish
jobs:
  npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { registry-url: 'https://registry.npmjs.org' }
      - run: cd sdk/client-web  && npm ci && npm publish --provenance --access public
      - run: cd sdk/server-node && npm ci && npm publish --provenance --access public
      - run: cd sdk/react       && npm ci && npm publish --provenance --access public
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
  pypi:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - run: cd sdk/server-python && python -m build
      - uses: pypa/gh-action-pypi-publish@release/v1    # OIDC, no token
        with: { packages-dir: sdk/server-python/dist }
  crate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd sdk/audio-core && cargo publish --token ${{ secrets.CRATES_TOKEN }}
```
Gate every job on `bash sdk/test-all.sh` passing first.

## 11. Pre-publish checklist (per package)
- [ ] Registry name registered + manifest updated (no `@telenow` placeholder).
- [ ] `version` bumped; CHANGELOG noted.
- [ ] `npm install` done so `prepublishOnly` can build (npm packages).
- [ ] `--dry-run` tarball inspected — ships only `dist`/source + README (no `.env`, no source maps you don't want).
- [ ] Tests green (`bash sdk/test-all.sh`).
- [ ] Publish **order** respected (`@telenow/client` before react/react-native; crate deps before dependents).
- [ ] 2FA / signing / OIDC configured.

## 12. After ALL packages are live — ship the public docs
The customer-facing SDK documentation lives on the **`feat/sdk-docs`** branch of
`MettyAI/voice-frontend` (new `/docs` section: sdk-overview, sdk-web,
sdk-server, sdk-mobile + updated FAQ/api-overview answers). It is held back so
the live docs never advertise packages that aren't installable yet.

```bash
# only once every registry above has the packages live:
git checkout main && git pull
git merge --no-ff feat/sdk-docs
git push origin main          # then deploy the frontend as usual
```

If the final registry names differ from the `@telenow`/`telenow`/`ai.telenow`
placeholders, update the install commands on the branch **before** merging
(`src/docs/content/sdk-*.md`).
