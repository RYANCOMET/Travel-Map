# Travel Vis browser routing patch

Extract this zip over your existing `travel vis` project folder.

It only replaces/adds files under:

- `js/routes/`

It does not include or overwrite:

- `locations.json`
- `place-aliases.json`
- `rail-routes.json`
- `index.html`
- `styles.css`
- `js/app.js`
- `js/mapView.js`

## Behaviour

For train/rail-style journeys, the live site now uses this order:

1. `rail-routes.json`
2. generated route in `localStorage`
3. UK browser rail router if both endpoints are in Great Britain
4. Transitous rail routing if either endpoint is in Europe
5. placeholder line if generation fails

Road routes still use OSRM.
Flights still use great-circle lines.

## UK rail router

The UK router runs inside a Web Worker:

- `js/routes/ukRailWorkerClient.js`
- `js/routes/ukRailWorker.js`
- `js/routes/ukRailBrowserRouter.js`

By default it first tries to load:

- `arcgis-rail-network-cache.json`

from the project root. If that file is not present, it tries to download the ArcGIS rail layer live. For best performance, add your known-good ArcGIS rail cache file at the project root.

## Performance change

`routeQueue.js` now runs one route request at a time. This is deliberate because routing now happens automatically when missing routes are found.
