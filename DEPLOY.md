# Putting Worms online (Vercel + Ably)

The phone party game runs entirely on **Vercel**. Vercel serves the pages and two tiny
serverless functions; the live phone↔host connection runs through **Ably** (a free
real-time service), because Vercel can't hold a WebSocket open itself.

You set this up **once**. After that, every `git push` auto-deploys.

---

## One-time setup

### 1. Create a free Ably account + key
1. Sign up at **ably.com** (free, no card).
2. Dashboard → your app → **API Keys** → copy the **Root key** (looks like `appId.keyId:secret`).

### 2. Import the repo into Vercel
1. **vercel.com** → **Add New… → Project** → import **`jac772/worms-party`**.
2. Framework preset: **Other** (it's static + `/api` functions — no build step needed).
3. Click **Deploy**.

### 3. Add the Ably key to Vercel
1. Vercel → your project → **Settings → Environment Variables**.
2. Add **`ABLY_API_KEY`** = the Ably root key. Tick **Production, Preview, Development**. Save.
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the key takes effect.

Done. Your game is at `https://<project>.vercel.app`.
- **Host screen:** open `https://<project>.vercel.app/host` on your big screen.
- **Players:** scan the QR it shows (it points at `…/play?room=CODE`).

---

## How it fits together
- `index.html` + `engine.js` — the game (solo works with zero server).
- `host.html` — big-screen host; runs the game, shows the QR, talks to phones via Ably.
- `controller.html` — phone controller (served at `/play`).
- `api/ably-token.js` — hands out short-lived Ably tokens so the secret key stays on the server.
- `api/qr.js` — generates the join QR.
- `ABLY_API_KEY` lives only in Vercel's env — never in the code or the repo.

## Local development (optional)
```bash
npm i -g vercel
npm install
vercel link                       # link to the Vercel project
vercel env pull .env.development.local   # pulls ABLY_API_KEY locally
vercel dev                        # http://localhost:3000  (static + /api + Ably)
```
Open `http://localhost:3000/host` and, in another tab/phone, the `/play?room=CODE` URL.

## Solo-only on any static host
The single-player game (`index.html` + `engine.js`) is pure static files and will run on
GitHub Pages, Netlify, plain Vercel, etc. The party mode needs the Vercel functions + Ably above.

## Free-tier note
Ably free: 200 concurrent connections, 6M messages/month — comfortably more than a party game needs.
