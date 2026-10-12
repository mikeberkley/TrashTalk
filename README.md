# TrashTalk

Standalone Cloudflare sports meme app. Product authority: `Implementation Plan.md`. `reference/` is the extracted, unmodified FanLift snapshot; it is not part of the application build. All 39 manifest hashes are verified in `reports/source-verification.json` and in tests.

Preview: https://trashtalk-preview.berkleym.workers.dev

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior, acceptance evidence, image-text fidelity findings and remaining launch blockers.

## Development and checks

```sh
npm ci
npm run verify
npm run build
npx wrangler d1 migrations apply trashtalk-preview --env preview --local
npm run worker:dev
npm run dev
```

Use an ignored `.dev.vars.preview` with `OPENROUTER_API_KEY`. Never put keys in Vite variables. Local image transformations may require Cloudflare's remote Images binding; the deployed preview is the fully exercised environment. The preview runs real OpenRouter calls and consumes provider credits. There is no enabled unlimited bypass. Set `PREVIEW_UNLIMITED=true` only for local/preview; production requests fail closed if it is enabled there.

`npm run verify` performs TypeScript checks, deterministic tests using real SQLite transactions, and a frontend build. Paid endpoint probes and browser E2E commands are deliberately separate:

```sh
npx tsx scripts/probe.ts --images
npx tsx scripts/browser.ts
npx tsx scripts/browser-e2e.ts
npx tsx scripts/webkit-e2e.ts
npx tsx scripts/privacy-check.ts
```

**Approved prompt clarification:** the image prompt now appends “Show each supplied team’s actual logo clearly at least once, integrated into clothing, props, flags, or the scene. Do not substitute animal mascots for the logos.” The user approved this exception after comparative samples showed inconsistent logo visibility. No automatic visual review model or guarantee of perfect logo reproduction is added.

**Updated product decision:** one optional user photo (October 12 follow-up), enforced in both browser and API. The original plan’s two-photo maximum is superseded. Two team logos are always sent separately, in away/home order, then the optional photo.

Historical endpoint verification: the live image endpoint rejected four separate references. The earlier tested permitted adaptation was a deterministic transparent away-left/home-right logo sheet, followed by both user photos. Zero or one user photo retains separate away/home logo inputs. The combined-logo path is no longer used in the application. No active request drops a reference, and the models/settings remain unchanged. The provider can return JPEG despite requesting PNG; actual bytes are decoded and checked.

## Catalog preparation and maintenance

```sh
npm run catalog -- --dry-run
npm run catalog
npx tsx scripts/publish-fast.ts
npx wrangler d1 execute trashtalk-preview --env preview --remote --file catalog-cache/catalog.sql
```

`catalog-cache/` holds resumable downloads, originals, normalized 512px RGBA logos, metadata and SQL. `publish-fast.ts` uses the existing local Wrangler login without printing credentials, bounds concurrency to six, and verifies every remote normalized object by SHA-256 before D1 activation. For production use `--production` and the production database. Never import the activation SQL before successful asset readback. Catalog sources, checks, palette hashes, logo hashes, membership counts and sampled real schedules are in `reports/`.

All 12 competitions have source-verified primary/secondary palettes. There are 302 competition memberships and 281 canonical teams. Soccer teams share canonical identities across competitions. Authoritative palette values are never derived from UI styling. Source originals are private; the public branding route serves only normalized registered versions. Every generation pins team versions and palette/logo hashes. Neither optional season records nor injuries are imported as branding.

Daily Cron queues bounded per-league refreshes. Replacements are downloaded, normalized, transparency-checked and read back before activation. Failures retain prior valid versions and disable the affected league for review. The five-minute Cron reconciles durable queued work, stored images and expired leases, and removes expired uploads/sessions/cache. Runtime generation uses stored bytes only.

## Job and credit behavior

**Current score-context policy (October 12):** no LLM web research is performed. Game selection loads ESPN facts; generation bypasses the fact cache to fetch a fresh scoreboard. Live caption context requires ESPN in-progress status and `scheduled start <= now < start + 4 hours`. Verified final status supplies the final score even outside that window. Missing/invalid scores and snapshots older than 30 seconds are omitted. Caption requests allowlist team identities, rooting side, sport, and eligible scoreboard only; pregame facts, research, plays, and statistics are excluded. Eligible score snapshots are stored in the job context before caption generation. Explicit retries retain pinned user/team inputs but refresh facts and generate a new caption. This supersedes the original pregame research / recent-play prompting and saved-caption retry behavior.

D1 reservation triggers enforce available balances; a partial unique index enforces one active job per principal. Principal Durable Objects serialize admissions, game Durable Objects share ESPN feed captures. Queue messages contain IDs. Jobs persist context and validated captions before paid image work. A provider-call marker prevents automatic repetition after ambiguous outcomes. An image stored before a crash is decoded/read back before one atomic completion/capture batch. Explicit retry creates a new attempt with unchanged pinned inputs and reusable caption/context.

Three lifetime trial successes are recorded server-side. Google `sub` identifies accounts; tokens require Google signatures, issuer, audience and expiry. CSRF-protected session rotation links anonymous ownership without a second trial. Logout does not grant a fresh allowance. Deleted cookies and different devices cannot be perfectly identified as one human; bounded abuse signals limit mass session creation.

Stripe Checkout always creates a USD 99-cent, four-credit, one-time pack. Signed webhooks retrieve Checkout server-side and validate amount, currency, owner and paid state. Unique event/session business keys prevent duplicate fulfillment. Paid reservations allocate FIFO to purchase grants; refunds reverse only that pack's unspent credits and flag disputed/spent grants for review. Redirects grant nothing. Successful Checkout returns open a dedicated confirmation screen using the Checkout session reference. The app polls an owner-scoped purchase endpoint and confirms the purchased amount, credits added and updated paid balance only after the paid purchase and ledger grant exist. Pending fulfillment stays visible with retry/support options. Browser checks: `npx tsx scripts/check-purchase-confirmation.ts` (simulated API responses at 390px and 1440px). Tests exercise actual Stripe signature verification with fixtures; they are not Stripe account payment evidence.

## Privacy and sharing

Only session-owned upload/job routes expose private bytes. Uploads accept decoded PNG/JPEG, strip metadata via Cloudflare Images and fit within 1600px. HEIC currently returns an actionable conversion error. Unattached uploads expire after 24 hours, attached photos after seven days; finished images remain independent. No raw reference, context, account or private R2 key is published by the share page.

Completion prepares an unpublished share token. The explicit Share action publishes it and invokes native sharing synchronously with user activation. Public routes require publication. Downloads add `Shared from trashtalk.fanlift.ai` below the artwork, using a browser-generated file prepared before click. Physical iPhone sharing and saving were subsequently confirmed by the user in preview.

## External configuration and production

TrashTalk is live at **https://trashtalk.fanlift.ai** using dedicated Workers, D1, R2, Queues and Durable Objects. Both branding catalogs are populated and hash-verified. Production has both launch holds cleared and the unlimited bypass disabled. FanLift configuration, deployments, domains and secrets were not modified.

Google production-origin sign-in, anonymous image-history linkage, a real production generation, single-credit capture, private-image denial, and public share-page delivery are verified. Production research executed one web search with ESPN and official team sources. All 12 competitions are enabled. The public site was checked at 390px and 1440px without overflow. The user confirmed native Share and image saving on a physical iPhone in preview. Image actions are Save and Share: Save uses a prepared PNG through native sharing where supported, falling back to a file download; Share publishes the link and uses native sharing or the clipboard.

Stripe sandbox checks completed: $0.99/four-credit purchase, cancellation without a grant, preservation of the earlier five-credit pack, repeat purchase, manual webhook replay without duplicate credit, and Google sign-out/sign-in balance restoration. The live Checkout successfully displays four credits for $0.99, but no real charge or live-webhook fulfillment has been performed. Live Stripe Payments is active; Stripe's account-status page says identity verification remains under review and payouts will pause November 11, 2026 or at $600 volume if unresolved. Existing Stripe merchant branding remains FanLift.

`npx tsx scripts/deploy-production.ts` checks configuration, secret names, coverage, acceptance evidence, types, tests, build and migrations before deployment. For a deliberate emergency hold, set `LAUNCH_HOLD=true` and `PAUSE_GENERATION=true` and use `scripts/prepare-production.ts`. Preview must always use Stripe test mode. Never paste secret values into chat or commit them.

Evidence and limitations: `reports/production-launch.json`, `reports/production-deployments.json`, `reports/deployment-triggers-check.json`, and `IMPLEMENTATION_STATUS.md`. Cloudflare intermittently returned 504 errors while reapplying triggers; independent readback verifies both schedules and the queue consumer. A naturally scheduled daily branding refresh and generation during an actual in-progress game remain unobserved. ESPN feed availability/use and team-mark commercial rights are external dependencies identified by the plan; source metadata does not grant a license.

Public policies: https://trashtalk.fanlift.ai/privacy and https://trashtalk.fanlift.ai/terms. Operator: Mike Berkley; contact: mike@earthly.art. New packs are $0.99 for four credits; earlier five-credit packs retain their original entitlement and refund accounting.

## Private app stats

The footer's **App stats** button appears only for the Google account configured by `ADMIN_GOOGLE_SUB`. `/api/admin/stats?days=30` verifies that account on every request and returns private, uncached aggregate data; anonymous and other accounts receive 403. Periods are 7 days, 30 days, or all time. The dashboard covers Google accounts, image generation/retention/failures, paid purchases, review purchases, captured trial/paid credits, published shares, and daily activity. Purchase totals exclude review status and are not net revenue. Google-account periods use principal creation time, which may precede Google linking.

Traffic tracking began with this release. Public homepage and published meme HTML responses count as views, including bots. A random first-party cookie estimates browsers; only its hash is stored and visitor records expire after 90 days. Daily aggregate views persist; no IP addresses, user agents, or referrer URLs are stored by this tracking. Traffic periods use UTC calendar dates while other metrics use rolling timestamps. The privacy policy describes this storage. Browser verification: `npx tsx scripts/check-stats.ts` with local Vite at port 5175; API responses are mocked for layout checks. Access-control and aggregation tests use actual SQLite. Production returned 403 for unauthenticated stats access and recorded a homepage view after deployment.

Operator traffic is excluded before tracking: requests matching the comma-separated `STATS_EXCLUDED_IPS` setting, or a valid session for `ADMIN_GOOGLE_SUB`, do not increment views or browsers. IP addresses are compared during requests without being stored. The initial four home/testing views were archived outside reported totals in migration 0010 after the operator confirmed their source. This exclusion affects web traffic; account, image, credit, and purchase records retain their actual totals. Update the setting if the home IP changes (signed-in operator visits remain excluded).
