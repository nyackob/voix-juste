#!/usr/bin/env bash
# Lance Voix Juste en local sur http://localhost:8765
cd "$(dirname "$0")"
PORT=8765
( sleep 1; xdg-open "http://localhost:$PORT" >/dev/null 2>&1 ) &
echo "Voix Juste tourne sur http://localhost:$PORT (Ctrl+C pour arrêter)"
python3 -m http.server "$PORT" --bind 127.0.0.1
