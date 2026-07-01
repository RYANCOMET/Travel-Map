export function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

export function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

export function normaliseLongitude(longitude) {
  return ((longitude + 540) % 360) - 180;
}

export function distanceMetres(firstPoint, secondPoint) {
  const earthRadiusMetres = 6371000;
  const lat1 = toRadians(Number(firstPoint.lat));
  const lat2 = toRadians(Number(secondPoint.lat));
  const deltaLat = toRadians(Number(secondPoint.lat) - Number(firstPoint.lat));
  const deltaLng = toRadians(Number(secondPoint.lng) - Number(firstPoint.lng));

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return earthRadiusMetres * centralAngle;
}

export function calculatePathDistanceMetres(points) {
  let total = 0;

  for (let index = 1; index < points.length; index++) {
    const previous = {
      lat: points[index - 1][0],
      lng: points[index - 1][1]
    };

    const current = {
      lat: points[index][0],
      lng: points[index][1]
    };

    total += distanceMetres(previous, current);
  }

  return total;
}

export function getPaddedBounds(fromLocation, toLocation, paddingDegrees) {
  const fromLat = Number(fromLocation.lat);
  const fromLng = Number(fromLocation.lng);
  const toLat = Number(toLocation.lat);
  const toLng = Number(toLocation.lng);

  return {
    south: Math.min(fromLat, toLat) - paddingDegrees,
    west: Math.min(fromLng, toLng) - paddingDegrees,
    north: Math.max(fromLat, toLat) + paddingDegrees,
    east: Math.max(fromLng, toLng) + paddingDegrees
  };
}
