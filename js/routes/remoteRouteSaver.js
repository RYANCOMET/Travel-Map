const ROUTE_SAVE_ENDPOINT = "https://travel-map-route-cache.ryancomet.workers.dev/save-route";

export async function saveRouteToRemoteCache(cacheKey, route) {
  if (!cacheKey || !route) {
    return {
      ok: false,
      skipped: true,
      error: "Missing cache key or route"
    };
  }

  try {
    const response = await fetch(ROUTE_SAVE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cacheKey,
        route
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.ok !== true) {
      const errorMessage = data && data.error
        ? data.error
        : `Remote route save failed: ${response.status}`;

      throw new Error(errorMessage);
    }

    console.log(`Saved route to shared GitHub cache: ${cacheKey}`);
    return data;
  } catch (error) {
    console.warn(`Could not save route to shared GitHub cache: ${cacheKey}`, error);

    return {
      ok: false,
      error: error.message || "Remote save failed"
    };
  }
}

export function getRouteSaveEndpoint() {
  return ROUTE_SAVE_ENDPOINT;
}
