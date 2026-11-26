# Haunted Dorm + Multiplayer (Normal mode)
Run: `npm install && npm start` -> open http://localhost:3000 -> lobby -> MULTIPLAYER
Flow: MULTIPLAYER -> Create/Join (4-letter code) -> original Matching screen -> host presses START -> original game scene.
Server (server.js) owns: ghost, bots, doors/beds HP, coins/lightning, turrets, deaths, win/lose. The original scene only renders it.
Your own movement is local (original controls) and validated by the server. Building uses the original menu (bed, door, turret, game console).
Not yet: human demon, other building types (ice, barb, mines...). Deploy: Render Web Service (npm install / node server.js); Vercel has no WebSockets.
Tuning: CFG at top of server.js. Env: GHOST_DMG_MULT (10), GHOST_SPAWN_AT (30), TIME_LIMIT (1500), PORT.

## Deploy on Render (Docker)
1. Push this whole folder to an empty GitHub repo.
2. Render -> New -> Blueprint -> select the repo (uses `render.yaml` + `Dockerfile`). Or New -> Web Service -> Runtime: Docker.
3. Open the `.onrender.com` URL -> lobby -> MULTIPLAYER.
Self keep-alive: server pings its own `/health` every 10 min (`KEEPALIVE=0` to disable). Backup: add the same URL in UptimeRobot (5 min).
Local Docker: `docker build -t haunted-dorm . && docker run -p 3000:3000 haunted-dorm`
