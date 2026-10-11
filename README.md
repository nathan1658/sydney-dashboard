# Sydney Live

A realtime 3D dashboard of Sydney, built on open government data. Sydney is
drawn as a sandstone architectural model (3D buildings over OpenStreetMap
data). On top of it run every train, metro, light rail, ferry and bus, BoM
temperature columns for the Sydney stations and the animated rain radar.

- **Weather** (Bureau of Meteorology): latest observations from the ~20 stations
  in BoM's Sydney Metropolitan district, the 7-day Sydney forecast, current NSW
  warnings, and the last ~40 minutes of the Terrey Hills 128 km rain radar.
- **Public transport** (Transport for NSW): live vehicle positions with
  fading trails, service alerts and network status for each mode, and on-time
  performance for trains and metro computed from GTFS-realtime trip updates.

Unofficial, and not affiliated with BoM or Transport for NSW.

## Run it

Needs Node 23.6 or newer (the server is TypeScript run directly by Node).

```sh
npm install
cp .env.example .env   # then paste your TfNSW key into .env
npm run dev            # http://localhost:8787
```

Weather works with no setup. Live transport needs a free Transport for NSW
Open Data API key:

1. Sign up at <https://opendata.transport.nsw.gov.au>.
2. Create an application and add the **Public Transport - Realtime** APIs
   (vehicle positions, trip updates and alerts).
3. Put the key in `.env` as `TFNSW_API_KEY=...` and restart the server.

For production: `npm run build && npm start`. One Node process serves the
built app and the live API on `PORT` (default 8787).

## How it works

```
BoM anonymous FTP ─┐
                   ├─► Node server ──SSE──► browser: MapLibre (city) + deck.gl (live data)
TfNSW GTFS-RT API ─┘   polls, decodes,
                       keeps API key
```

- `server/`: polls each upstream feed on its own schedule, decodes
  GTFS-realtime protobuf and BoM XML, and pushes JSON to browsers over one
  Server-Sent Events stream (`/api/live`). It polls only while at least one
  browser is connected, so an idle server makes no upstream requests.
  `/api/health` reports the state of each feed.
- `src/`: MapLibre GL renders the basemap, buildings and radar. deck.gl
  owns the camera and draws vehicles, trails and station columns on top.
  Vehicles are rendered 45 seconds behind real time, so each one is always
  interpolated between two real GPS fixes instead of jumping between polls.

BoM data is read from its [anonymous FTP service](https://www.bom.gov.au/catalogue/anon-ftp.shtml),
the Bureau's published channel for automated access.

## API usage

With the default `VEHICLE_POLL_SECONDS=20`, one server with a browser open
around the clock makes about 41,000 TfNSW requests a day: 8 vehicle feeds
every 20 s, 2 trip-update feeds every minute and 5 alert feeds every 2
minutes. Any number of browsers share the same polls. Raise
`VEHICLE_POLL_SECONDS` if your plan's daily quota is lower.

## Data and licences

- Transport for NSW Open Data: [CC BY 4.0](https://opendata.transport.nsw.gov.au).
- Bureau of Meteorology: © Commonwealth of Australia. See the BoM
  [copyright notice](https://www.bom.gov.au/other/copyright.shtml) before
  any commercial reuse.
- Basemap tiles: [OpenFreeMap](https://openfreemap.org), with data
  © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

Code: MIT.
