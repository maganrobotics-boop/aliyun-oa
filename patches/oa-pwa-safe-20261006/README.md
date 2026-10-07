# Aliyun OA safe PWA production overlay

The production OA source is ahead of repository main. This directory records the exact PWA-only overlay deployed on 2026-10-06 at 21:28 Asia/Shanghai, on top of the existing `oa-pwa-20261006` release. It must not be used to replace production with repository main.

The manifest uses standalone display, OA branding, versioned 192/512 icons, a separate opaque maskable icon with safe margins, and an opaque 180px Apple touch icon. The page includes theme-color and Apple launch metadata. Existing installation entry points remain intact; iPad desktop-mode detection now shows Safari instructions.

The worker retains its existing `/oa-sw.js` URL so installed clients update. Its cache is limited to four exact same-origin versioned PNG icon paths. Login, approval, API, HTML, navigation, RSC, application scripts, query-bearing URLs, Range and non-GET requests bypass it. Activation removes the previous OA cache (including its offline HTML) without clearing unrelated caches. Worker responses use no-cache/no-store and registration uses updateViaCache:none. There is no offline approval mode.

## Apply to a source copy

```bash
python3 apply.py /path/to/copied-production-source
python3 apply.py /path/to/copied-production-source --apply
cd /path/to/copied-production-source
npm run typecheck
node --test tests/pwa-safe.test.mjs
npm run build:aliyun
```

All original hashes are checked before any file is changed. Different/newer baselines abort rather than overwrite. Already-applied files are accepted. Deployment is a separate action through the existing Aliyun release symlink and systemd service.

## Verified deployment

- Production source copied from `oa-pwa-20261006`; all existing non-PWA source files compared byte-for-byte.
- Typecheck and Aliyun production build passed; five PWA tests passed.
- Isolated candidate HTTP checks passed before service switch.
- Production homepage, manifest, worker, four icons and unauthenticated session endpoint returned HTTP 200 with expected types; session remains private/no-store and worker is no-store.
- Cloud Chrome page inspection confirmed install entry, theme color, manifest and Apple touch metadata.
- Android prompt accepted/cancelled and Safari/iPhone/iPad fallback branches were tested using simulated install events/platform values.
- Physical Android installation and iPhone Safari Add to Home Screen were **not** exercised: these devices are unavailable in this session.
- No production approval records were created or changed for validation.
- Previous release retained at `oa-before-pwa-safe-20261006-v2` for rollback.
