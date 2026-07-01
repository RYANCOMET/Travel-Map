const FAILED_ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOCAL_ROUTE_JSON_BYTES = 250000;
const ROUTE_CACHE_KEY_PREFIX = "travel-map-";

export function getRegeneratedRoute(routeType, fromLocation, toLocation) {
  const directCacheKey = getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation);
  const directRoute = readCachedRoute(directCacheKey, false);

  if (directRoute) {
    return directRoute;
  }

  const reverseCacheKey = getRegeneratedRouteCacheKey(routeType, toLocation, fromLocation);
  const reverseRoute = readCachedRoute(reverseCacheKey, true);

  if (reverseRoute) {
    return reverseRoute;
  }

  return null;
}

export function setRegeneratedRoute(routeType, fromLocation, toLocation, route) {
  const routeWithMetadata = {
    ...route,
    regeneratedAt: new Date().toISOString()
  };

  const saved = writeRouteToLocalStorage(
    getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation),
    routeWithMetadata,
    `regenerated ${routeType}`
  );

  if (saved) {
    setCachedRoute(routeType, fromLocation, toLocation, routeWithMetadata);
  }
}

export function clearCachedRoute(routeType, fromLocation, toLocation) {
  try {
    [
      getRouteCacheKey(routeType, fromLocation, toLocation),
      getRouteCacheKey(routeType, toLocation, fromLocation),
      getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation),
      getRegeneratedRouteCacheKey(routeType, toLocation, fromLocation),
      getFailedRouteCacheKey(routeType, fromLocation, toLocation),
      getFailedRouteCacheKey(routeType, toLocation, fromLocation)
    ].forEach((cacheKey) => localStorage.removeItem(cacheKey));
  } catch (error) {
    console.warn(`Could not clear ${routeType} route cache.`, error);
  }
}

export function getCachedRoute(routeType, fromLocation, toLocation) {
  const directCacheKey = getRouteCacheKey(routeType, fromLocation, toLocation);
  const directRoute = readCachedRoute(directCacheKey, false);

  if (directRoute) {
    return directRoute;
  }

  const reverseCacheKey = getRouteCacheKey(routeType, toLocation, fromLocation);
  const reverseRoute = readCachedRoute(reverseCacheKey, true);

  if (reverseRoute) {
    return reverseRoute;
  }

  return null;
}

export function setCachedRoute(routeType, fromLocation, toLocation, route) {
  const cacheKey = getRouteCacheKey(routeType, fromLocation, toLocation);
  const saved = writeRouteToLocalStorage(cacheKey, route, `${routeType}`);

  if (!saved) {
    return;
  }

  try {
    localStorage.removeItem(getFailedRouteCacheKey(routeType, fromLocation, toLocation));
    localStorage.removeItem(getFailedRouteCacheKey(routeType, toLocation, fromLocation));
  } catch (error) {
    console.warn(`Could not clear failed ${routeType} route cache markers.`, error);
  }
}

export function hasRecentlyFailedRoute(routeType, fromLocation, toLocation) {
  return hasRecentlyFailedRouteForKey(getFailedRouteCacheKey(routeType, fromLocation, toLocation)) ||
    hasRecentlyFailedRouteForKey(getFailedRouteCacheKey(routeType, toLocation, fromLocation));
}

export function setFailedRoute(routeType, fromLocation, toLocation, reason = "") {
  const cacheKey = getFailedRouteCacheKey(routeType, fromLocation, toLocation);

  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        failedAt: Date.now(),
        reason
      })
    );
  } catch (error) {
    console.warn(`Could not save failed ${routeType} route cache.`, error);
  }
}

function writeRouteToLocalStorage(cacheKey, route, label) {
  let json = "";

  try {
    json = JSON.stringify(route);
  } catch (error) {
    console.warn(`Could not serialise ${label} route cache.`, error);
    return false;
  }

  const byteSize = approximateByteSize(json);

  if (byteSize > MAX_LOCAL_ROUTE_JSON_BYTES) {
    console.info(
      `Skipping localStorage for ${label} route because it is large (${Math.round(byteSize / 1024)} KB). ` +
      "It can still be saved to the shared GitHub route-cache.json."
    );
    return false;
  }

  try {
    localStorage.setItem(cacheKey, json);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) {
      console.warn(`Could not save ${label} route cache.`, error);
      return false;
    }

    const removedCount = evictLocalRouteCacheEntries(cacheKey);

    try {
      localStorage.setItem(cacheKey, json);
      console.info(`Saved ${label} route cache after clearing ${removedCount} old route cache entries.`);
      return true;
    } catch (retryError) {
      console.warn(
        `Could not save ${label} route cache even after clearing ${removedCount} old entries. ` +
        "This is safe if the shared GitHub cache save succeeds.",
        retryError
      );
      return false;
    }
  }
}

function evictLocalRouteCacheEntries(currentCacheKey) {
  const keys = [];

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);

      if (!key || key === currentCacheKey || !key.startsWith(ROUTE_CACHE_KEY_PREFIX)) {
        continue;
      }

      keys.push(key);
    }
  } catch {
    return 0;
  }

  const failedKeys = keys.filter((key) => key.includes("-failed-"));
  const normalRouteKeys = keys.filter((key) => key.includes("-route-") && !key.includes("-regenerated-") && !key.includes("-failed-"));
  const regeneratedKeys = keys.filter((key) => key.includes("-regenerated-"));
  const otherTravelMapKeys = keys.filter((key) => !failedKeys.includes(key) && !normalRouteKeys.includes(key) && !regeneratedKeys.includes(key));

  const evictionOrder = [
    ...failedKeys,
    ...normalRouteKeys,
    ...otherTravelMapKeys,
    ...regeneratedKeys
  ];

  let removed = 0;

  evictionOrder.forEach((key) => {
    try {
      localStorage.removeItem(key);
      removed++;
    } catch {
      // Ignore individual removal errors.
    }
  });

  return removed;
}

function readCachedRoute(cacheKey, reverse) {
  const raw = localStorage.getItem(cacheKey);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      !Array.isArray(parsed.points) ||
      parsed.points.length < 2
    ) {
      return null;
    }

    if (!reverse) {
      return parsed;
    }

    return {
      ...parsed,
      points: [...parsed.points].reverse(),
      source: parsed.source ? `${parsed.source} (reversed from cache)` : "Reversed cached route"
    };
  } catch {
    return null;
  }
}

function hasRecentlyFailedRouteForKey(cacheKey) {
  const raw = localStorage.getItem(cacheKey);

  if (!raw) {
    return false;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || !parsed.failedAt) {
      return false;
    }

    const age = Date.now() - Number(parsed.failedAt);

    if (age > FAILED_ROUTE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getRouteCacheKey(routeType, fromLocation, toLocation) {
  const fromLat = roundCoordinate(fromLocation.lat);
  const fromLng = roundCoordinate(fromLocation.lng);
  const toLat = roundCoordinate(toLocation.lat);
  const toLng = roundCoordinate(toLocation.lng);

  return `travel-map-${routeType}-route-${fromLat},${fromLng}-${toLat},${toLng}`;
}

function getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation) {
  const fromLat = roundCoordinate(fromLocation.lat);
  const fromLng = roundCoordinate(fromLocation.lng);
  const toLat = roundCoordinate(toLocation.lat);
  const toLng = roundCoordinate(toLocation.lng);

  return `travel-map-${routeType}-route-regenerated-${fromLat},${fromLng}-${toLat},${toLng}`;
}

function getFailedRouteCacheKey(routeType, fromLocation, toLocation) {
  const fromLat = roundCoordinate(fromLocation.lat);
  const fromLng = roundCoordinate(fromLocation.lng);
  const toLat = roundCoordinate(toLocation.lat);
  const toLng = roundCoordinate(toLocation.lng);

  return `travel-map-${routeType}-route-failed-${fromLat},${fromLng}-${toLat},${toLng}`;
}

function roundCoordinate(value) {
  return Number(value).toFixed(5);
}

function approximateByteSize(value) {
  return new Blob([value]).size;
}

function isQuotaError(error) {
  return error && (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    String(error.message || "").toLowerCase().includes("quota")
  );
}
