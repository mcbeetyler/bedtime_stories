# The Bedtime Story Machine

Pick a few sparks (who's listening, hero, place, problem, wildcard, vibe, length), tap once, get numbered story beats to read aloud and riff off. Installs on a phone home screen as an app. The Anthropic API key lives only on the server.

## Layout

```
api/story.js          Vercel serverless function. Builds prompts, calls Anthropic, validates JSON.
public/index.html     App shell + PWA meta tags
public/styles.css     Night-sky theme
public/app.js         All front-end logic. Plain JS, no build step. CONFIG block at the top.
public/manifest.json  PWA install manifest
public/sw.js          Service worker (caches the shell; never touches /api)
public/icons/         Home-screen icons (PNG)
vercel.json           60-second function timeout so long stories don't get cut off
package.json          ESM flag. Zero dependencies.
```

## Deploy (Vercel)

1. **Repo layout matters.** `api/`, `public/`, `vercel.json`, `package.json` must sit at the repo **root**, not inside a `bedtime-stories/` subfolder. (That nesting caused the earlier 404.)
2. Vercel → Project → **Settings → General**: Framework Preset `Other`, Build Command empty, Output Directory empty (default = `public`). Clear any override added earlier.
3. **Settings → Environment Variables**: `ANTHROPIC_API_KEY` = `sk-ant-…`, all environments. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5`; `claude-haiku-4-5-20251001` is faster and cheaper).
4. **Redeploy** after adding env vars (Deployments → ⋯ → Redeploy). Env changes don't apply to existing deployments.
5. Open the URL. The status line should read *"tonight's fresh ideas ✦"* — that means the API round-trip works.

## Install on a phone

- **iPhone:** open the URL in Safari → Share → **Add to Home Screen**. (Only Safari can install web apps on iOS.)
- **Android:** Chrome → ⋮ menu → **Add to Home screen** / **Install app**.

Opens full-screen with no browser chrome, like a native app.

## Customize

- **Kids / vibes / lengths:** `CONFIG` at the top of `public/app.js`.
- **Prompts:** `menuPrompt` and `storyPrompt` in `api/story.js`. That's where the catchphrase, "Ask the kids" beats, and sleepy ending rules live.
- **Model:** `ANTHROPIC_MODEL` env var — no code change.
- **After editing anything in `public/`:** bump `VERSION` in `public/sw.js` (e.g. `bsm-v2`) so phones fetch the new build.

## How it works day to day

- Opening the app fetches a fresh menu once per day per audience and caches it in the browser. **↻ New ideas** forces a new batch.
- Picks, vibe, and length are remembered. The last story is restored on reopen ("read it again!").
- Tapping a selected chip clears it. Typing in a "…or type your own" box overrides that row's chip.

## Cost

Two API calls per night (menu + story), roughly 1–3k tokens total. A few cents a month on Sonnet; less on Haiku.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Red error: *ANTHROPIC_API_KEY is not set* | Env var missing, or you didn't redeploy after adding it. |
| Site 404s | Files nested in a subfolder, or an Output Directory override in Vercel settings. |
| Story spins then errors after ~10 s | `vercel.json` `maxDuration` not applied. Check Deployments → your deploy → Functions shows 60 s. |
| Long stories time out | Use Medium/Short, or set `ANTHROPIC_MODEL` to Haiku. |
| Phone keeps showing the old version | Bump `VERSION` in `sw.js`, redeploy, close and reopen the app. |
| Anything else | Vercel → Project → **Logs**. The function logs the real error. |

## Handoff prompt for Claude in VS Code

Open the repo folder in VS Code, start a Claude chat, and paste:

> I'm continuing a bedtime-story app I built with Claude on mobile. It's in this folder: a static PWA in `public/` (plain JS, no build) plus one Vercel serverless function in `api/story.js` that proxies to the Anthropic API. It's deployed on Vercel with `ANTHROPIC_API_KEY` set. Read `README.md` first for the layout and conventions, then help me with: [what you want next].

## Ideas for later

- Stream beats as they generate (SSE) instead of waiting for the whole story.
- A simple passcode (`APP_PASSCODE` env var + one prompt on first open) so a stranger with the URL can't burn your API credit.
- Save favourite stories; recurring characters the kids can ask for by name.
- Voice: read the beats aloud with the browser's speech API for hands-free tuck-ins.
