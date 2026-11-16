/**
 * Dispatches the dashboard's "Build & deploy" workflow on behalf of the static page.
 *
 * The page is on GitHub Pages and the repo is public, so a token that can trigger builds
 * cannot live in the page. This Worker holds it instead and exposes exactly one action:
 * "rebuild the dashboard". It cannot read or write anything else in the repo.
 *
 * The Worker URL is public and Origin headers are trivially forged outside a browser, so
 * this does not try to authenticate callers. Instead it caps the blast radius: the only
 * possible effect is rebuilding a public dashboard, and THROTTLE_MIN stops that being
 * triggered more than once every few minutes.
 */

const REPO = "gabrielgalarza/ott-ticketing-analytics";
const WORKFLOW = "deploy.yml";
const ALLOWED_ORIGIN = "https://gabrielgalarza.github.io";
const THROTTLE_MIN = 5;
const UA = "ott-dashboard-refresh";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

async function gh(path, token, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
      ...(init.headers || {}),
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, origin);
    if (!env.GITHUB_TOKEN) return json({ error: "worker is missing GITHUB_TOKEN" }, 500, origin);

    // Don't pile builds on top of each other: if one is running or just ran, tell the page
    // to watch for that one instead of starting another.
    const runsRes = await gh(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`,
      env.GITHUB_TOKEN
    );
    if (runsRes.ok) {
      const runs = await runsRes.json();
      const last = runs.workflow_runs && runs.workflow_runs[0];
      if (last) {
        const running = last.status === "in_progress" || last.status === "queued";
        const ageMin = (Date.now() - new Date(last.created_at).getTime()) / 60000;
        if (running || ageMin < THROTTLE_MIN) {
          return json(
            { ok: false, reason: running ? "already_running" : "throttled", run: last.html_url },
            429,
            origin
          );
        }
      }
    }

    const res = await gh(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      env.GITHUB_TOKEN,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main" }) }
    );

    if (res.status === 204) return json({ ok: true }, 202, origin);
    return json({ ok: false, error: `github responded ${res.status}` }, 502, origin);
  },
};
