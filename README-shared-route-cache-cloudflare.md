# Shared route cache + Cloudflare save endpoint patch

This patch adds a shared `route-cache.json` for all generated route types:

- rail
- road/car/taxi
- bus/coach/minibus
- hitch/hitchhiking
- flight/plane

The browser now checks routes in this order:

1. manually regenerated local cache
2. shared `route-cache.json`
3. legacy `rail-routes.json` for rail routes
4. local browser cache
5. live generation
6. POST generated route to the Cloudflare Worker so it can be committed back to GitHub

The Cloudflare Worker endpoint is currently set in:

```js
js/routes/remoteRouteSaver.js
```

as:

```txt
https://travel-map-route-cache.ryancomet.workers.dev/save-route
```

## Important

If `route-cache.json` already contains routes in GitHub, do not replace it with the empty file in this patch. Merge the existing contents instead.

For first setup, the included empty `route-cache.json` is correct:

```json
{
  "version": 1,
  "updatedAt": null,
  "routes": {}
}
```

## Cloudflare Worker variables

Your Worker needs these normal variables:

```txt
GITHUB_OWNER = RYANCOMET
GITHUB_REPO = Travel-Map
GITHUB_BRANCH = main
CACHE_PATH = route-cache.json
ALLOWED_ORIGIN = https://ryancomet.github.io
```

And this secret:

```txt
GITHUB_TOKEN = your new GitHub fine-grained token
```

The token must have `Contents: Read and write` permission for `RYANCOMET/Travel-Map`.

## Files changed/added

```txt
route-cache.json
js/mapView.js
js/routes/remoteRouteSaver.js
js/routes/sharedRouteCache.js
js/routes/routeService.js
js/routes/routeCache.js
js/routes/routeQueue.js
js/routes/railRegion.js
js/routes/transitousRoutes.js
js/routes/ukRailBrowserRouter.js
js/routes/ukRailWorker.js
js/routes/ukRailWorkerClient.js
```

The rest of the files in `js/routes` are included so this can be extracted as a complete routing patch.
