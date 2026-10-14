# Mobile-only acquisition

User-facing entry is the public mobile app on PC or phone. No Windows app is required by these workflows.

`Collect X candidates and verify Amazon invitations` runs every two hours and on relevant main changes. It tries these nine accounts: pokecamatomeru, pokecasokuhou, lifeprep_list, kotatsudemikanm, mymyme0901, manimegame336, medakadesu41, PokeGetInfoMain, pokecayoyaku. These are trial sources from the supplied research, not independently proven early sources.

If the existing repository secret `X_BEARER_TOKEN` is available, acquisition uses the official X API. This change does not purchase API access or create credentials. With no secret, Chromium reads the normal public profile pages, at most three visible timeline samples per account. It does not log in, extract cookies, evade a challenge, or use private APIs. Public samples are partial coverage; a sign-in wall or missing articles is unknown/failed, not successful zero posts.

Acquired links become candidates only. Short Amazon/Rakuten links are resolved hop by hop; Amazon links are rebuilt from ASINs. Unsupported destinations remain review items. The X API confirmed cursor advances only after all pending pages are saved. Continuation persists across runs; an invalid continuation resets to the confirmed lower bound.

`data/internal/x-collection-status.json` records actual acquisition outcomes. `x-candidates.json` records source evidence and canonical links. `amazon-asin-pool.json` is a discovery input, not proof of an invitation. These files contain no bearer token or cookies. Visible public timeline coverage does not have an API cursor.

Amazon uses existing normal Chromium search and product-detail checks, now also accepting the X candidate pool and previously published ASINs. Two separate Node/browser processes must agree on product title, ASIN match, Amazon seller, invitation notice and visible enabled request button. Only that evidence can update snapshot.json. No purchase or invitation request is clicked. Blocked/unknown pages preserve previous rows and fail the acquisition run. At most 40 details are checked per process; larger pools are a coverage limit requiring a subsequent scheduling improvement.

Rakuten Books now runs hourly. Its official entry page remains primary; X-discovered canonical Rakuten Books product URLs supplement the detail candidates. A changed/unparseable entry schedule no longer prevents checking valid product details. Independent live fetches and matching official periods are still required. This does not add Rakuten Marketplace shop-wide collectors.

Existing tests had expectations that closed lotteries appeared under an obsolete phase filter and an old UI version number. They now assert that closed lotteries stay excluded and that delivery matches during an open period. The UI itself is unchanged.

Deployment is not proof of working acquisition. Inspect the first run's structured evidence, new verified ASIN count and the published snapshot before claiming monitoring is operational. X blocked/API missing and Amazon blocked are outstanding issues until live results show otherwise.

## Separation of X and Amazon (job split)
`x-amazon-live.yml` now has two jobs. `x` collects X candidates; `amazon` (`needs: x`, `if: always()`) verifies Amazon details and runs even when X failed or is not running. Each has its own status file, step summary, annotation and failure signal.

X states in `x-collection-status.json`: `auth` (`SET`/`UNSET`), `collection` (`RUNNING_API`/`NOT_RUNNING`), `status` (`OK`, `PARTIAL_OR_FAILED`, `NOT_RUNNING_AUTH_UNSET`). With no `X_BEARER_TOKEN` the status is `NOT_RUNNING_AUTH_UNSET`; scheduled public-browser attempts are disabled. The job completes with a warning, which is NOT proof of monitoring coverage. If a token is set and acquisition is incomplete, the `x` job fails. No token, credit purchase or paid API setup is performed by this change.

Amazon: run 1 searches and inspects up to 40 ASINs (unconfirmed candidates first). Run 2, a separate process, is given exactly the ASINs run 1 inspected (no new search); blocking can still interrupt either run. `status.json` reports actual target consistency and differences. An ASIN that looked like an invitation in at least one run but was not confirmed by both gets `unconfirmed` in `amazon-asin-pool.json` and is checked first next time. Existing unconfirmed evidence survives missing/blocked/failed results. It clears only on two strict confirmations or two HTTP-200 parsed product results with candidate=false. Published ASINs beyond the 40-check cap are still not rechecked every run. The CLI regression test uses two real child processes with a test-only browser loader, not live Amazon.
