# Worms — Artillery Battle 🪱

A turn-based artillery game (Worms-style) with **two ways to play**:

1. **Solo vs the computer** — open `index.html` (or the deployed site root).
2. **Phone party game** — host on a screen, friends scan a QR code and each control their own team from their phones.

Destructible terrain, realistic weapons, wind, health bars, and an AI that actually aims.

---

## 1) Solo vs the CPU
Open **`index.html`** in a browser (works offline, no setup). Pick a difficulty and play.

| Action | Keys |
|---|---|
| Move | `←` / `→` (or `A` / `D`) |
| Aim | Move the **mouse** (or `↑` / `↓`) |
| Fire | **Hold** mouse / `Space` to charge, release to launch |
| Jump | `J` |
| Weapon | `1`–`6`, `Q`/`E` to cycle, or click the bar |

## 2) Phone party game
Hosted online via **Vercel + Ably** (see [DEPLOY.md](DEPLOY.md) for the one-time setup).

- Open **`/host`** on your big screen → it shows a **QR code**.
- Players **scan the QR** on their phones → enter a name → they're in.
- Each player is a team; pick bots / difficulty / worms-per-team, then **START GAME**.
- On your turn your phone shows the controls (aim dial, weapon picker, move/jump, hold-to-charge FIRE).

Last team standing wins. Empty slots can be filled with AI bots. If a player drops mid-game, a waiting player takes their team — or it becomes a bot — so the game never stalls.

## Weapons
| Weapon | Behaviour |
|---|---|
| **Bazooka** | Wind-affected rocket, explodes on impact. Unlimited. |
| **Grenade** | Bounces, 3-sec fuse, ignores wind. |
| **Cluster Bomb** | Splits into 5 bomblets on detonation. |
| **Shotgun** | Instant hitscan blast, no arc. Unlimited. |
| **Dynamite** | Planted at your feet, huge blast, 4-sec fuse — run! |
| **Air Strike** | Call a 5-bomb salvo down on a chosen spot. |

Falling too far hurts; water (or being knocked off the edge) is instant death. If a match drags on, **Sudden Death** raises the water each round.

## Files
- `index.html` — solo game (open directly, fully offline).
- `engine.js` — shared game engine (terrain, physics, weapons, AI, rendering).
- `host.html` — big-screen host (lobby, QR, live battle).
- `controller.html` — phone controller (served at `/play`).
- `api/ably-token.js`, `api/qr.js` — Vercel serverless functions (Ably auth + QR).
- `vercel.json`, `package.json` — Vercel config + dependencies.

The secret `ABLY_API_KEY` lives only in Vercel's environment settings — never in the code.
