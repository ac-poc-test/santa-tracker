# Santa Tracker

A whimsical one-page Santa Tracker: a world map showing where Santa is right now.

Santa flies through the time zone where the clock reads 02:00, crossing it east to west in one hour, so he sweeps westward around the world ahead of the sunrise. Within a zone he zig-zags north and south in 3-degree strips, and he is only ever placed over land where the sun is at least 6 degrees below the horizon. Time zones are nominal 15-degree bands, not political boundaries.

Server-side rendered with Astro and the Node adapter. The map and Santa's position are rendered on the server; the page polls `/api/santa.json` to move him.

## Run

```sh
npm ci
npm run dev        # http://localhost:4321
```

Query parameters:

- `speed=N` runs the clock N times faster (try `?speed=120` for a demo)
- `t=<epoch ms>` starts at a given moment

## Docker

```sh
docker build -t santa-tracker .
docker run --rm -p 3000:3000 santa-tracker
```

The container listens on `PORT` (default 3000) and answers `GET /healthz`.
