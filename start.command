#!/bin/bash
# Double-click this file to host a Worms party game.
cd "$(dirname "$0")"
echo ""
echo "  🪱  Starting Worms Party…"
if ! command -v node >/dev/null 2>&1; then
  echo "  ⚠  Node.js is not installed. Get it from https://nodejs.org then try again."
  read -p "  Press Return to close." ; exit 1
fi
if [ ! -d node_modules ]; then
  echo "  Installing dependencies (first run only)…"
  npm install --no-audit --no-fund
fi
# open the host screen automatically once the server is up
( sleep 1.5; open "http://localhost:3000/host" ) &
node server.js
