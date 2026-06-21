#!/bin/bash
# Double-click to expose your running game to the internet (start.command must be running first).
# Uses Cloudflare's free quick-tunnel — no account needed.
echo ""
echo "  🌍  Opening an internet tunnel to your game (port 3000)…"
if command -v cloudflared >/dev/null 2>&1; then
  echo "  When the https URL appears below, open  <that-url>/host  on your screen."
  echo "  Players then scan the QR shown there. (Ctrl-C to stop.)"
  echo ""
  cloudflared tunnel --url http://localhost:3000
else
  echo "  cloudflared isn't installed. Two options:"
  echo "   1) Install it once:   brew install cloudflared    then double-click this again."
  echo "   2) No install (needs internet):"
  echo "        npx localtunnel --port 3000"
  echo "      then open the printed https URL + /host on your screen."
  read -p "  Press Return to close."
fi
