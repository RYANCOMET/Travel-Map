# Regenerate route ArcGIS source fix

This patch fixes the error:

`No ArcGIS source. Provide arcgisItemId, arcgisUrl, or cacheUrl.`

Cause:
- The UK rail worker client was sending `arcgisItemId: undefined` into the worker.
- That accidentally overwrote the browser router's built-in default ArcGIS item id.
- The route service also passed `arcgis-rail-network-cache.json` as a relative path, which can resolve relative to `js/routes/` inside a worker context.

Fix:
- `ukRailWorkerClient.js` now only sends optional ArcGIS settings when they are actually defined.
- `routeService.js` now passes an absolute URL to the project-root `arcgis-rail-network-cache.json`.

Install:
Extract over your existing project folder.
