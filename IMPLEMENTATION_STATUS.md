# TrashTalk implementation and acceptance — October 12, 2026

Preview: https://trashtalk-preview.berkleym.workers.dev

Latest preview Worker version: `55cfa856-3877-4f2a-9f3c-0f31514f6ea1`.

The application is implemented and deployed in preview. Production is deployed behind a launch hold and is not open to users. Google sign-in and one real Stripe test Checkout are now observed in preview. Remote database verification confirms a paid 99-cent test session linked to a Google account, one five-credit grant, a five-credit paid balance, and a processed checkout.session.completed event. Repeat-login and broader payment acceptance remain pending. No production payment or production-domain behavior is claimed.

## Approved product changes

- One optional uploaded photo, which may contain people, pets, or both. Browser and API reject a second photo.
- Both stored team logos remain separate references. The exact endpoint accepted two logos plus one photo; four separate references returned an error. No runtime reference is silently omitted.
- User-approved image-prompt addition: “Show each supplied team’s actual logo clearly at least once, integrated into clothing, props, flags, or the scene. Do not substitute animal mascots for the logos.”
- Caption model remains `x-ai/grok-4.3`; image model remains `x-ai/grok-imagine-image-2.0`, with the original provider/settings. Frozen source prompt text is tested, with documented sport/personalization adaptations and the approved logo sentence.

## Verified implementation

| Area | Evidence and scope |
| --- | --- |
| Reference integrity | All 39 extracted source files match SOURCE_MANIFEST.json; `reports/source-verification.json` and automated test. |
| Team coverage | 302 competition memberships, 281 canonical teams, no reported logo/palette gaps. NFL 32, NBA 30, MLB 30, NHL 32, EPL 20, La Liga 20, Bundesliga 18, Serie A 20, Ligue 1 18, MLS 30, NWSL 16, Champions League 36. `reports/catalog-coverage.json`. |
| Stored branding | Versioned normalized team and league logos, provenance and hashes; all team logo hashes read back from dedicated preview and production R2. D1 catalogs populated. `reports/r2-preview-readback.json`, `reports/r2-production-readback.json`, `reports/league-assets.json`. |
| Discovery | Real ESPN schedule requests across all 12 competitions, no featured-game filter; participant selection required. Current coverage is observed coverage, maintained by repeatable ingestion rather than a promise that memberships never change. |
| Research | Exact caption model executed one real web search and returned sourced reporting including ESPN. Search-tool usage verified from provider response. `reports/search-probe.json`, `reports/verified-research.json`. |
| Automated verification | 64 passing tests, TypeScript check, frontend production build. Includes source/prompt preservation, one-photo limit, game context, real SQLite credit races and transaction rollback, stored-image recovery, ambiguous-call handling, corrupt-image release, pinned branding, Google token checks, signed webhook fixtures, payment idempotency and refund allocation. |
| Real preview generation | Queue/Durable Object/D1/R2 pipeline exercised with actual OpenRouter requests. NFL final, NBA pregame and EPL final examples; three successes exhausted a trial and exposed the sign-in gate. Earlier multi-photo evidence predates the approved one-photo change; `reports/webkit-job.json` is a subsequent one-photo generation. |
| Browser layouts | Chrome 390px and 1440px checks: 12 competitions, 13 NFL games on tested date, enabled generation after team selection, no horizontal overflow or page errors. `reports/browser-checks.json`. |
| Privacy/share/download | Cross-owner upload/image denial; CSRF, malformed input, deletion and private-prefix checks. WebKit iPhone 13 emulation: unpublished share 404, explicit share publishes to 200, focus restored, download saved. Native-share invocation captured with active user gesture using a test stub; actual OS share sheet not tested. `reports/privacy-checks.json`, `reports/webkit-e2e.json`. |
| Infrastructure | Dedicated preview Worker/static assets, D1, R2, Queue, SQLite Durable Object, Images binding and Cron schedules deployed. Dedicated production D1/R2/Queue provisioned; custom domain routed behind a launch hold. FanLift resources and project unchanged. |

## Known fidelity finding

The latest reviewed one-photo output visibly includes both team logos and the supplied person. Its requested caption ends “Our force field blinked!” but the rendered image says “Our force field winked!” (`reports/webkit-viewer.png`). Thus exact prompt delivery is verified, but perfect image-rendered text and logo fidelity are not guaranteed. The model can alter lettering despite the exact-caption instruction. No unauthorized replacement model, OCR guarantee, automatic paid regeneration or additional prompt change has been introduced.

## Remaining acceptance and launch blockers

1. **Google acceptance:** Client ID is configured in preview and prepared production variables. The deployed Google button opens the accounts.google.com account-entry screen with no browser errors (`reports/google-configuration-check.json`). Complete real-user sign-in, anonymous-history linkage and repeat-login tests. Signature/issuer/audience/expiry checks have unit coverage; the completed test purchase now confirms a Google-linked account; anonymous-history linkage and repeat-login remain to be checked.
2. **Stripe acceptance:** preview secret bindings are present. The pack price is now USD 0.99 for five credits (user-approved October 12); checkout creation and signed fulfillment tests validate 99 cents. Previously issued one-dollar sessions remain redeemable at their original price. One actual test Checkout and server-side five-credit fulfillment are verified. Complete cancellation, repeat purchase and webhook replay tests. Existing signed-fixture tests are not Stripe account evidence. Production requires separate live configuration.
3. **Physical iPhone Safari:** verify actual native share sheet and save/download behavior. Emulation is not a substitute for this check.
4. **Live game:** all queried competitions had no in-progress game during the recorded availability check. Captured feed fixtures test live period/scoring handling; actual live generation remains unverified.
5. **Scheduled maintenance:** Cron schedules are deployed and reconciliation is tested through direct execution/unit cases; a naturally scheduled daily branding refresh has not yet been observed.
6. **Production launch:** after configuration and acceptance, provision production secrets, clear the explicit generation pause, and run `scripts/deploy-production.ts`. Verify the custom domain and real production behavior after deployment. Source/brand-use launch dependencies listed in the product plan remain external to code verification.

See README.md for setup, ingestion, secure secret provisioning and execution commands. Secrets and local browser session state are excluded from source. The preview uses real provider credits; the unlimited-testing bypass is disabled.

## October 12 payment verification update

`reports/stripe-purchase-verification.json` records read-only remote D1 checks at 08:06 EDT. The only purchase is a Stripe test session, status paid, amount 99 cents, five credits, with a payment-intent reference and linked Google account. Exactly one purchase grant exists for five credits; the paid balance is five. A checkout.session.completed event was processed at 08:05:28 EDT. This verifies server-side fulfillment of the user-reported successful Checkout; it is not independent Stripe API readback or a webhook replay test. Remaining payment tests include cancellation, a second purchase, duplicate event replay, and refunds.

## October 12 production preparation

Dedicated `trashtalk-production` Worker is deployed at https://trashtalk.fanlift.ai with `LAUNCH_HOLD=true`, `PAUSE_GENERATION=true`, and unlimited bypass disabled. All routes execute the Worker before static assets. Home, static assets, account, checkout and generation return 503; the webhook remains reachable and rejects unsigned requests. The existing OpenRouter key is securely provisioned as a production secret. Stripe live secrets are provisioned. The production handler passes the live-key prefix guard and rejects unsigned webhook requests; Stripe API authentication and the signing secret match are not yet verified.

Public DNS resolution and HTTPS/browser checks passed using the public DNS address explicitly because the local system resolver retained a negative cache. Evidence: `reports/production-preparation.json` and `reports/production-hold.png`. `scripts/prepare-production.ts` provides repeatable held deployment; the separate launch script still requires acceptance reports and both holds explicitly cleared. This is production infrastructure verification, not verified live payment behavior.

Production secret-name verification and held-route checks repeated after live-secret configuration: `reports/production-secret-check.json`. No secret values were retrieved or printed; no live payment was initiated.

## October 12 policies and four-credit offer

Published Privacy Policy (`/privacy`) and Terms of Service (`/terms`), operated by Mike Berkley with contact mike@earthly.art. A public descriptive homepage and legal pages are available without login during the launch hold; all app actions remain blocked. New $0.99 packs contain four credits (`four-v1`). Earlier `five-v1` and `five-v2` sessions and already granted credits retain five credits. Refund calculation uses the original purchase quantity. Historical reports of five-credit test purchases remain accurate for those purchases.

Policy pages verified publicly at 390px and 1440px, including current four-credit pricing and mike@earthly.art; no overflow or login required. Checkout remains blocked in production. Preview deployment `52c36431-b287-49b7-8fcd-90a462125e30` verified with four-credit pricing. Production CLI encountered Cloudflare trigger API 504s after Worker upload; independent readback confirmed both cron schedules and the production queue consumer are intact. The new production content is verified through HTTP and browser checks. See `reports/legal-pages-check.json`, `reports/deployment-triggers-check.json`, and `reports/stripe-configuration-check.json`.

## October 12 launch acceptance follow-up (09:05 EDT)

New four-credit $0.99 sandbox Checkout completed in Chrome. Canceling the preceding Checkout granted nothing. The successful purchase added exactly four credits to the prior five-credit pack, leaving nine. Stripe Dashboard manual resend returned HTTP 200, and a subsequent remote D1 query still found one grant for that purchase. Google sign-out and account-chooser sign-in restored three free and nine paid credits. Google Audience was independently observed as In production / External. Evidence: `reports/stripe-test-e2e.json`, `reports/stripe-purchase-verification.json`, `reports/google-e2e.json`.

The live Stripe webhook is active at the production URL with checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded, and charge.dispute.created selected. Stripe Payments is active; its account-status page says identity verification remains under review and payouts will pause November 11, 2026 or at $600 volume if unresolved. No live charge or live fulfillment has been tested.

User confirmed native sharing on physical iPhone Safari, but Download saved a file rather than offering Photos. Added a separate Save image action using the already-prepared PNG and synchronous native file sharing; Download is now labeled Download file. The save action does not publish a public share link. Physical Photos-save validation is pending, so the launch gate remains closed. Preview version `c30f4ec8-5691-4138-a947-70a780e5e4e3` contains this fix; initial asset-upload 504 resolved on retry. All 64 tests, TypeScript and build pass. Chrome 390px and 1440px checks of this version show all 12 leagues and no horizontal overflow. Fresh discovery executed for all 12 competitions; none has a live game at check time. Privacy negative checks repeated and deployment schedules/queue consumer read back successfully.

## October 12 production launch (09:15 EDT)

**Live at https://trashtalk.fanlift.ai.** User confirmed the revised native image-saving buttons work on physical iPhone and requested only Save and Share. The extra Download control was removed; Save uses the prepared PNG share sheet where supported, with a file-download fallback. Share has a clipboard fallback when native sharing rejects. Production and local build serve asset `index-BEYU5YpF.js`; Cloudflare readback confirms version `b47e537e-a590-4cf8-a0cd-5bea512e142e` receives 100% traffic. Both launch holds are false and unlimited mode is disabled. CLI encountered trigger/configuration 504s after publishing; independent deployment, custom-domain HTTP, queue-consumer and both Cron readbacks establish the actual deployed state.

Production Chrome test created one Bills/Rams pregame image. Remote D1 confirms completed job, one captured trial reservation, remaining trial balance two, one actual web search, ESPN and official Rams sources, and the approved prompt version. Both recognizable team logos and the requested caption were visible in the image. Google account-chooser sign-in succeeded at the production origin and preserved the anonymously generated image. A sign-in attempted during the active job correctly refused until completion. Live Checkout displayed four image credits for $0.99 and a live session was recorded; returned through cancellation without submitting payment, with zero paid grants. Existing merchant branding remains FanLift. Public policies and shared page return 200; an unauthenticated private-image request returns 404. Production 390px and 1440px checks found all 12 competitions and no overflow. Screenshots: `reports/production-artwork.png`, `reports/production-mobile.png`, `reports/production-desktop.png`. Server evidence: `reports/production-launch.json`.

Verification limits: no real-money payment or live payment-webhook fulfillment, actual in-progress-game generation, or naturally scheduled daily branding refresh has been observed. Native share/save on physical iPhone was user-confirmed in preview. Chrome automation returned Permission denied for native sharing before the fallback patch; subsequent native-dialog/download automation was inconclusive (no captured download), so desktop native file saving is not claimed verified. Public-link publication is verified. All 64 automated tests, TypeScript and production build passed after the final changes. Stripe identity review/payout deadline remains an operator follow-up, not an observed payment-processing outage.

Final preview synchronization limitation: repeated Cloudflare management API 504s prevented publishing the last desktop fallback update to preview. HTTP readback shows preview still serves `index-BZDVO_Bs.js` (already has Save and Share); production serves final `index-BEYU5YpF.js`. This does not roll back or block the verified production launch. See `reports/preview-final-sync.json`.

## Progressive disclosure UI — October 12, 2026

Production now shows only the current creation step: supported-team autocomplete, that team's next five scheduled/live games, optional word/photo customization, then generation/result. The searched team is automatically the supported side. The result's Make another action returns to customization for the same game. Favorites persist locally before sign-in, merge into the Google-authenticated principal on sign-in, and use database storage thereafter. A migration adds favorites and principal merging preserves their union.

Game selection starts rate-limited background research through the same research Durable Object/cache used by generation. Research uses `google/gemini-3.1-flash-lite` with low reasoning effort and a single web-search call. Fenced provider JSON is parsed before existing event/source validation. Production readback confirmed one executed search and two source-linked cards for Jets/Patriots. No new image was generated during this UI verification.

Live Chrome checks at 390px and 1440px confirm keyboard autocomplete, five games, hidden later/previous steps, automatic loyalty, enabled generation, persistent anonymous favorites, no horizontal overflow, and no browser errors. Evidence: `reports/progressive-flow.json`, `reports/progressive-schedule-*.png`, `reports/progressive-personal-*.png`; rerun with `npx tsx scripts/check-progressive-flow.ts`. Account favorite merging is covered by real SQLite tests; new Google sign-in and cross-device favorite sync were not exercised interactively. Production deployment version: `2ac3ed25-ebed-40b6-b596-95b2b6422800`.

## Comic personality — October 12, 2026

Production version `e8b65ee4-aca3-4583-be9c-221b448fd9fb` adds locally hosted Bangers display typography (license retained), readable Barlow body text, a custom SVG yelling speech-bubble icon, a tilted wordmark, pink/lime accents, and playful creation/history copy. Step 1 remains “pick a game”; customization becomes “Step 2: add chaos,” with “Unleash the meme” and “Roast them again” actions. Pricing, privacy, account mechanics, and error details remain clear.

All 66 tests, TypeScript, and build pass. Production Chrome checks at 390px and 1440px confirm font loading, no overflow or browser errors, menu access, autocomplete, five-game schedule, automatic loyalty, anonymous favorite persistence, and background research dispatch. Mobile home and customization screenshots were visually reviewed. Evidence: `reports/personality-home-390.png`, `reports/personality-home-1440.png`, and refreshed `reports/progressive-flow.json` / `reports/progressive-personal-*.png`. No paid image generation was performed for this styling release.

## Share-only result and Safari menu fix — October 12, 2026

Production version `8eb7e655-f720-4c91-ad35-5c25f1c38757` replaces Save/regenerate/game-selection result buttons with one styled Share action, followed by Make another one and View all my trash talk links. History/menu naming is My trash talk. Removed iPhone save instructions and unused image-download preparation. Existing native URL sharing/publication behavior is retained; the full-screen viewer uses the same Share style.

Reproduced the reported hamburger failure in iPhone-style Playwright WebKit: tapping a destination closed the menu without switching views. Blur-based dismissal hid the item before click because Safari does not focus tapped buttons consistently. Dismissal now uses outside pointer interaction, selection, and Escape.

All 66 tests, TypeScript, and build passed before deployment. Chrome and iPhone-style WebKit checks verify all four live menu destinations, outside dismissal, and no overflow. Completed-result checks use an explicit mocked job/image fixture with the deployed frontend: one Share action, correct native-share URL payload, removal of Save/instructions, same-game customization link, and history link. They do not generate or publish a real meme. Evidence: `reports/result-navigation.json`, `reports/result-share-{chrome,webkit}.png`; rerun `npx tsx scripts/check-result-navigation.ts`. Physical iPhone testing remains separate.

## Public share simplification, collection controls, and logo reset — October 12, 2026

Production version `870ea9b7-8ec8-4cde-8b0f-1f362c3a1971` retains only the artwork, styled Share action, and Make your own link on public `/m/:token` pages. Document, Open Graph, Twitter, and native-share titles use away/home display names in Team A vs Team B format. External `share.js` respects CSP and shares the canonical page URL, with a clipboard fallback.

My trash talk cards show Share/Delete links instead of caption text. Each Share action publishes/shares its own token. Delete requires confirmation, checks ownership and completed status, tombstones the job, revokes share records, and schedules artwork deletion; Cron retries remaining deleted artwork. Trial/paid credit history and captured reservations remain intact. Logo navigation clears the visible creation selection and returns to Step 1 without resetting favorites or credits or cancelling server-side work.

All 68 tests, TypeScript, and build pass. Real SQLite tests cover unpublished-page privacy, exact escaped matchup metadata, deletion ownership, removal from history/private/public retrieval, and preserved accounting. Chrome and iPhone-style WebKit checks exercise live public meme content/title/payload and navigation. Collection delete/result interactions use mocked jobs/endpoints; no real user's meme was deleted. Evidence: `reports/public-share.json`, `reports/result-navigation.json`, corresponding screenshots; scripts `check-public-share.ts` and `check-result-navigation.ts`.

## Empty My trash talk state — October 12, 2026

Production version `18c62580-fa84-46dd-9950-069d481e9ac7` uses exact empty text “No masterpieces of disrespect to display yet.” Anonymous users see a Google sign-in note and the Google Auth button. All empty collections include Show some disrespect, which shares the logo's full Step 1 reset behavior. Google rendering also reacts when deletion removes the final image.

All 68 tests, TypeScript, and build pass. A 390px live Chrome check confirmed the real Google button renders for an anonymous empty collection; a signed-in-state fixture confirms the note/button are absent. Both variants' creation link returns to Step 1 without overflow. Evidence: `scripts/check-empty-collection.ts`, `reports/empty-collection-anonymous.png`, and `reports/empty-collection-signed-in.png`. No sign-in or paid generation was performed.

## Deleted share URLs redirect home — October 12, 2026

Production version `eab29e06-efcd-4fd0-b005-82b932fc43cf` retains share tokens for deleted jobs and returns a noncached HTTP 302 to `/` for deleted share pages. Missing-token pages also redirect, covering tokens already removed by the earlier implementation. Unpublished known shares remain inaccessible (404); deleted artwork/private job routes remain inaccessible and credit accounting is unchanged. The delete confirmation now describes the homepage redirect.

All 68 tests, TypeScript, and build pass. SQLite deletion tests assert retained token, redirect status/location/no-store, inaccessible image, and preserved balances. Live Chrome/WebKit follow a missing legacy-style share URL to the homepage/Step 1; readback checks HTTP 302 and verifies an existing published meme still serves HTTP 200 with its matchup title. No real meme was deleted during verification.

## Deterministic score-only caption context — October 12, 2026

Production version `a172753c-d2f0-4891-a8df-0739b573d2ec` removes runtime web research from both game selection and generation. Legacy selection research requests return `started:false`. Generation requests a fresh ESPN scoreboard through the facts Durable Object, bypassing its cache. Team/logo inputs remain pinned and validated.

Caption context is explicitly allowlisted: team identities, sport/competition, favorite side, and optional eligible scoreboard. Pregame has no scoreboard or backstory. Live requires ESPN in-progress status plus the half-open scheduled-start/four-hour window. Final requires ESPN completed status and is independent of that window. Both require numeric nonnegative scores and a snapshot no older than 30 seconds; feed failure/missing/stale facts fall back to a timeless team roast. Live period/clock and soccer shootout scores are included when supplied. Scores are stored in job context before caption requests. Original pregame-briefing/recent-play instructions are replaced; old-version persisted captions are discarded. Explicit retries keep pinned user/team inputs and refresh the scoreboard/new caption rather than inheriting saved research/caption. Stored-artwork recovery and ambiguous paid-call protections remain intact.

All 78 tests, TypeScript, and build pass. Mocked full generation tests assert eligible live/final score persistence and caption payloads, omitted pregame/out-of-window/stale/failed-feed context, absence of research calls, and old-context invalidation. Boundary tests cover zero scores, ties, shootouts, missing/invalid timestamps/scores and fresh cache bypass. Live production browser checks at 390px/1440px confirm game selection makes no research request, generation remains enabled, and no overflow/errors; `reports/progressive-flow.json`. No new paid production image or actual live-game generation was performed for this release.
