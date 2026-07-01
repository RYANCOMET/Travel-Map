# Travel Vis regenerate route button patch

Extract this zip over your existing `travel vis` project folder.

This patch adds a **Regenerate route** button to each route popup.

## Files changed

- `js/mapView.js`
- `js/routes/routeService.js`
- `js/routes/routeCache.js`

The zip also includes the current browser-routing route modules so it can be applied on top of the previous browser routing patch safely.

## Behaviour

When a route is clicked, its popup now includes **Regenerate route**.

Clicking the button:

1. clears the local generated/failed cache for that route,
2. re-runs the correct route generator,
3. replaces the line on the map,
4. saves the regenerated result in this browser.

For rail routes:

- UK endpoint pair → browser-safe UK rail worker
- Europe endpoint pair → Transitous

Manually regenerated rail routes are preferred over `rail-routes.json` on later page loads in the same browser, so a regenerated route actually sticks.

## Not changed

This patch does not include or overwrite:

- `locations.json`
- `place-aliases.json`
- `rail-routes.json`
- `index.html`
- `styles.css`
