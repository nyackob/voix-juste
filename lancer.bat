@echo off
cd /d "%~dp0"
start "" http://localhost:8765
echo Voix Juste tourne sur http://localhost:8765 (fermer cette fenetre pour arreter)
python -m http.server 8765 --bind 127.0.0.1
