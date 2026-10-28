# Project Rules

## Stack and architecture
- Use TypeScript, npm, Vite, React, Hono on Node.js, native fetch, Cheerio, Dexie/IndexedDB, Tailwind CSS, Zod, and Vitest.
- Keep frontend in `client/`, backend in `server/`, and extractors modular by source.
- Never add Playwright, Puppeteer, Chromium, database servers, Redis, or paid services.
- Keep frontend and backend builds independently deployable.

## Security
- Validate untrusted URLs with Zod and strict hostname allowlists.
- Revalidate every redirect; reject private, loopback, link-local, and metadata-service addresses.
- Bound timeouts, redirects, response sizes, image counts, and content types.
- Never create an unrestricted open proxy or bypass authentication/CAPTCHA.
- Keep secrets out of source and frontend bundles. Consider DNS rebinding mitigation for hardened deployments.

## Sequential loading and cache
- Fetch, verify, and persist each image before starting the next image request in that chapter. Never use Promise.all for pages in the same chapter.
- Do not detect/prefetch the next chapter until the active chapter is complete.
- A chapter is complete only after all image Blobs have been persisted; use bounded retries and surface terminal errors.
- Keep at most 10 unique cached chapters with LRU eviction, excluding the active chapter.
- Prefetch at most five next chapters while the app is active; do not promise execution after tab suspension/closure.

## Testing and changes
- Use npm scripts for install and verification.
- Cover sequential ordering, retry/error status, cache eviction, URL validation, and extraction order.
- Inspect current files and Git status before editing. After meaningful changes run diagnostics, typecheck, tests, and production builds.
- Keep `.project/PROGRESS.md` up to date with verified status and exact next steps.

## Deployment
- Configure `HOST` and `PORT` via environment.
- Do not claim Wasmer compatibility without target-specific deployment and smoke test.
- Document ephemeral filesystem/background-work limitations.
