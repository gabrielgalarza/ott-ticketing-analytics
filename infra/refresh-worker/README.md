# Refresh proxy

Lets the dashboard's **Refresh data** button trigger a rebuild, instead of sending you to
GitHub Actions to click "Run workflow".

## Why this exists

The dashboard is a static file on GitHub Pages. The numbers are baked in at build time by a
Python job that calls SweatPals and Windsor with secret API keys. A browser can't do that:
the keys would be public, and neither API accepts cross-origin calls from the page.

So the button needs *something* to kick off the build. The repo is public, so a token that
can trigger builds can't be embedded in the page either. This Worker holds the token and
exposes one action — "rebuild the dashboard" — and nothing else.

**The dashboard works fine without this.** With no Worker configured the button still checks
for a newer build and reloads if there is one; it just can't force a fresh pull, and links to
Actions for that. Builds also run hourly on their own.

## Setup (about 5 minutes, one time)

### 1. Create a token

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new.

- **Repository access:** Only select repositories → `ott-ticketing-analytics`
- **Permissions:** Repository permissions → **Actions: Read and write**. Nothing else.
- **Expiration:** your call. If it expires the button degrades to the no-Worker behaviour
  above, and the hourly builds are unaffected.

Copy the token.

### 2. Deploy the Worker

```bash
npm install -g wrangler        # if you don't have it
cd infra/refresh-worker
wrangler login
wrangler secret put GITHUB_TOKEN    # paste the token when prompted
wrangler deploy
```

`wrangler deploy` prints a URL like `https://ott-dashboard-refresh.<you>.workers.dev`.

The token is stored as a Cloudflare secret. It is never in this repo and never reaches the page.

### 3. Point the dashboard at it

```bash
gh variable set REFRESH_PROXY_URL --repo gabrielgalarza/ott-ticketing-analytics --body "https://ott-dashboard-refresh.<you>.workers.dev"
```

Then run the workflow once so the page picks it up. The button text changes from
"Checks for a newer build" to "Pulls fresh data".

## How it behaves

Click → Worker dispatches the build → page polls `build.json` every 10s, showing elapsed time
→ reloads itself when the new build is live. Typically 2–6 minutes.

If a build is already running, or one started in the last 5 minutes, the Worker returns 429
and the page watches that build instead of starting a second one.

## On security

The Worker URL is public and `Origin` headers can be forged outside a browser, so this does
not try to authenticate callers. That's deliberate: the only thing a caller can cause is a
rebuild of an already-public dashboard, and the 5-minute throttle plus the workflow's
`concurrency: pages` group bound how often that can happen. The token cannot touch code,
secrets, or anything outside Actions on this one repo.

To revoke: delete the token on GitHub, or `wrangler delete`, or unset `REFRESH_PROXY_URL`.
