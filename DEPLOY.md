# Putting Worms online

## The one thing to know first
- **Solo vs CPU** = static files → can run on *any* free static host (incl. GitHub Pages).
- **Phone party multiplayer** = needs a live **Node server** (`server.js`) for the WebSocket connection
  → GitHub Pages **cannot** run this. Use a Node host (below). It's still free.

---

## Step 1 — Put it on GitHub
From inside the `worms-game` folder:

```bash
git init
git add .
git commit -m "Worms artillery party game"
gh repo create worms-party --public --source=. --push   # needs the GitHub CLI
# …or create an empty repo on github.com and:
#   git remote add origin https://github.com/<you>/worms-party.git
#   git branch -M main && git push -u origin main
```
(`node_modules` is git-ignored on purpose — the host reinstalls it.)

## Step 2 — Run it online (full multiplayer) — Render, free
1. Go to **render.com**, sign up (free), connect your GitHub.
2. **New + → Web Service** → pick the `worms-party` repo.
3. Settings (Render usually auto-detects these from `render.yaml`):
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Instance type:** Free
4. **Create Web Service.** After it builds you get a public URL like `https://worms-party.onrender.com`.
5. On your screen open **`https://worms-party.onrender.com/host`** → the QR now points at that public URL.
   Anyone, anywhere can scan it and play. (No tunnel needed once it's hosted.)

> Note: Render's free tier sleeps after ~15 min idle — the first visit after a nap takes ~30s to wake. Fine for casual play.

**Other free Node hosts that also work:** Railway, Fly.io, Glitch, Replit. Any host that runs `node server.js` and supports WebSockets is fine; the app reads the port from the `PORT` env var automatically.

---

## (Optional) GitHub Pages — solo game only
If you only want the single-player game at a public link:
1. Push the repo (Step 1).
2. Repo **Settings → Pages → Deploy from branch → `main` / root**.
3. Your game is at `https://<you>.github.io/worms-party/` — solo vs CPU works; the party "Host" button won't (no server).
