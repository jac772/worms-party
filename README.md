# Worms — Artillery Battle 🪱

A turn-based artillery game (Worms-style) with **two ways to play**:

1. **Solo vs the computer** — just double-click `index.html`.
2. **Phone party game** — host on your screen, friends scan a QR code and each control their own team from their phones.

Destructible terrain, realistic weapons, wind, health bars, and an AI that actually aims.

---

## 1) Solo vs the CPU (no setup)

**Double-click `index.html`.** It opens in your browser — no install, no internet needed. Pick a difficulty and play.

| Action | Keys |
|---|---|
| Move | `←` / `→` (or `A` / `D`) |
| Aim | Move the **mouse** (or `↑` / `↓`) |
| Fire | **Hold** mouse / `Space` to charge, release to launch |
| Jump | `J` |
| Weapon | `1`–`6`, `Q`/`E` to cycle, or click the bar |

---

## 2) Phone party game (host + QR join)

Players use their phones as controllers; the battle plays out on your screen. Each player is a team — **last team standing wins**. Empty slots can be filled with **AI bots** (1–4 teams total).

### Start it
1. **Double-click `start.command`.** (First run installs a couple of small libraries automatically; needs [Node.js](https://nodejs.org).)
2. Your screen opens the **host page** with a big **QR code**.
3. On the same WiFi, players **scan the QR** (or type the address shown) → enter a name → they're in.
4. Choose bots / difficulty / worms-per-team, then press **START GAME**.

On each player's turn their phone shows the controls (aim dial, weapon picker, move/jump, hold-to-charge FIRE); everyone else sees whose turn it is.

### Play over the internet (friends not on your WiFi)
Keep `start.command` running, then **double-click `tunnel.command`**. It opens a free Cloudflare tunnel and prints an `https://…` address.
- Open **`<that-https-url>/host`** on your screen (use the tunnel URL, not localhost) — the QR will now point at the tunnel, so anyone, anywhere can scan and join.
- No account needed. (If `cloudflared` isn't installed: `brew install cloudflared`, or use the no-install fallback `npx localtunnel --port 3000` that the script suggests.)

> Manual start instead of the launcher: `cd` into this folder and run `npm install` once, then `node server.js`. Open the printed `/host` URL.

---

## Weapons

| Weapon | Behaviour |
|---|---|
| **Bazooka** | Wind-affected rocket, explodes on impact. Unlimited. |
| **Grenade** | Bounces, 3-sec fuse. Ignores wind — good for lobbing behind cover. |
| **Cluster Bomb** | Splits into 5 bomblets on detonation. |
| **Shotgun** | Instant hitscan blast, no arc. Unlimited. |
| **Dynamite** | Planted at your feet, huge blast, 4-sec fuse — run away! |
| **Air Strike** | Call a 5-bomb salvo down on a chosen spot. |

Fused weapons give you a short **retreat** window to escape after firing. Falling too far hurts; water (or being knocked off the edge) is instant death. If a match drags on, **Sudden Death** raises the water each round.

---

## Files
- `index.html` — solo game (double-click, fully offline).
- `engine.js` — shared game engine (terrain, physics, weapons, AI, rendering).
- `server.js` — party-mode host server (static files + QR + WebSocket relay).
- `host.html` — the big-screen host (lobby, QR, live battle).
- `controller.html` — the phone controller.
- `start.command` / `tunnel.command` — double-click launchers (macOS).

Everything runs locally on your machine; the server only relays controller inputs to the host screen.
