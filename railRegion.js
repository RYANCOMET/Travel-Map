import { normaliseLongitude, toDegrees, toRadians } from "./geoMath.js";

export function getGreatCirclePoints(fromLocation, toLocation, numberOfSegments = 96) {
  const startLat = toRadians(Number(fromLocation.lat));
  const startLng = toRadians(Number(fromLocation.lng));
  const endLat = toRadians(Number(toLocation.lat));
  const endLng = toRadians(Number(toLocation.lng));

  const angularDistance = 2 * Math.asin(
    Math.sqrt(
      Math.sin((endLat - startLat) / 2) ** 2 +
        Math.cos(startLat) *
          Math.cos(endLat) *
          Math.sin((endLng - startLng) / 2) ** 2
    )
  );

  if (!Number.isFinite(angularDistance) || angularDistance === 0) {
    return [
      [fromLocation.lat, fromLocation.lng],
      [toLocation.lat, toLocation.lng]
    ];
  }

  const points = [];

  for (let step = 0; step <= numberOfSegments; step++) {
    const fraction = step / numberOfSegments;

    const startWeight =
      Math.sin((1 - fraction) * angularDistance) /
      Math.sin(angularDistance);

    const endWeight =
      Math.sin(fraction * angularDistance) /
      Math.sin(angularDistance);

    const x =
      startWeight * Math.cos(startLat) * Math.cos(startLng) +
      endWeight * Math.cos(endLat) * Math.cos(endLng);

    const y =
      startWeight * Math.cos(startLat) * Math.sin(startLng) +
      endWeight * Math.cos(endLat) * Math.sin(endLng);

    const z =
      startWeight * Math.sin(startLat) +
      endWeight * Math.sin(endLat);

    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lng = Math.atan2(y, x);

    points.push([
      toDegrees(lat),
      normaliseLongitude(toDegrees(lng))
    ]);
  }

  return points;
}
