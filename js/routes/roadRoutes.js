export async function fetchRoadRoute(fromLocation, toLocation) {
  const fromLng = Number(fromLocation.lng);
  const fromLat = Number(fromLocation.lat);
  const toLng = Number(toLocation.lng);
  const toLat = Number(toLocation.lat);

  if (
    !Number.isFinite(fromLng) ||
    !Number.isFinite(fromLat) ||
    !Number.isFinite(toLng) ||
    !Number.isFinite(toLat)
  ) {
    return null;
  }

  const coordinates = `${fromLng},${fromLat};${toLng},${toLat}`;

  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}`
  );

  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  url.searchParams.set("alternatives", "false");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`OSRM route request failed: ${response.status}`);
  }

  const data = await response.json();

  if (
    data.code !== "Ok" ||
    !data.routes ||
    !data.routes[0] ||
    !data.routes[0].geometry ||
    !data.routes[0].geometry.coordinates
  ) {
    return null;
  }

  const route = data.routes[0];

  const points = route.geometry.coordinates
    .map(([lng, lat]) => [lat, lng])
    .filter(([lat, lng]) => {
      return Number.isFinite(lat) && Number.isFinite(lng);
    });

  if (points.length < 2) {
    return null;
  }

  return {
    points,
    distanceMetres: route.distance,
    durationSeconds: route.duration,
    source: "OSRM driving route"
  };
}
