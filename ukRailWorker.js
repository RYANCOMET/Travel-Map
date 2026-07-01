import { calculatePathDistanceMetres } from "./geoMath.js";

const TRANSITOUS_PLAN_URL = "https://api.transitous.org/api/v6/plan";
const TRANSITOUS_TIMEOUT_MS = 45000;

const RAIL_MODES = new Set([
  "RAIL",
  "HIGHSPEED_RAIL",
  "LONG_DISTANCE",
  "NIGHT_RAIL",
  "REGIONAL_RAIL",
  "SUBURBAN",
  "SUBWAY",
  "TRAM"
]);

export async function fetchTransitousRailRoute(fromLocation, toLocation, options = {}) {
  const url = buildTransitousUrl(fromLocation, toLocation, options);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Number(options.timeoutMs) || TRANSITOUS_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Transitous route request failed: ${response.status} ${text.slice(0, 160)}`);
    }

    const data = await response.json();
    const itinerary = chooseBestItinerary(data);

    if (!itinerary) {
      return null;
    }

    return itineraryToRoute(itinerary);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildTransitousUrl(fromLocation, toLocation, options) {
  const url = new URL(TRANSITOUS_PLAN_URL);
  const routeDate = options.routeDate instanceof Date ? options.routeDate : getDefaultTransitDate();

  url.searchParams.set("fromPlace", `${fromLocation.lat},${fromLocation.lng}`);
  url.searchParams.set("toPlace", `${toLocation.lat},${toLocation.lng}`);
  url.searchParams.set("time", routeDate.toISOString());
  url.searchParams.set("detailedLegs", "true");
  url.searchParams.set("detailedTransfers", "false");
  url.searchParams.set("joinInterlinedLegs", "true");
  url.searchParams.set("transitModes", [...RAIL_MODES].join(","));
  url.searchParams.set("directModes", "");
  url.searchParams.set("preTransitModes", "WALK");
  url.searchParams.set("postTransitModes", "WALK");
  url.searchParams.set("maxPreTransitTime", "3600");
  url.searchParams.set("maxPostTransitTime", "3600");
  url.searchParams.set("maxDirectTime", "0");
  url.searchParams.set("searchWindow", "10800");
  url.searchParams.set("numItineraries", "5");
  url.searchParams.set("maxItineraries", "5");
  url.searchParams.set("timeout", "40");
  url.searchParams.set("language", "en");

  return url;
}

function getDefaultTransitDate() {
  const date = new Date();

  // Transit routing is timetable-based. A normal future weekday late morning is safer than now.
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
  date.setHours(10, 0, 0, 0);

  return date;
}

function chooseBestItinerary(data) {
  const itineraries = Array.isArray(data.itineraries) ? data.itineraries : [];

  if (itineraries.length === 0) {
    return null;
  }

  return itineraries
    .map((itinerary) => ({
      itinerary,
      score: scoreItinerary(itinerary)
    }))
    .sort((a, b) => a.score - b.score)[0].itinerary;
}

function scoreItinerary(itinerary) {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  const transitLegs = legs.filter((leg) => isTransitLegMode(leg.mode));
  const railLegs = legs.filter((leg) => isRailLegMode(leg.mode));
  const duration = Number(itinerary.duration || sumLegDurations(legs) || 0);

  // Prefer useful rail geometry, but don't choose a silly all-day detour if alternatives exist.
  return duration - railLegs.length * 600 + transitLegs.length * 120;
}

function sumLegDurations(legs) {
  return legs.reduce((total, leg) => total + Number(leg.duration || 0), 0);
}

function itineraryToRoute(itinerary) {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  const points = [];
  const details = [];
  let durationSeconds = 0;

  legs.forEach((leg) => {
    durationSeconds += Number(leg.duration || 0);

    const legPoints = extractLegPoints(leg);

    if (legPoints.length > 0) {
      appendPoints(points, legPoints);
    } else if (
      leg.from &&
      leg.to &&
      Number.isFinite(Number(leg.from.lat)) &&
      Number.isFinite(Number(leg.from.lon)) &&
      Number.isFinite(Number(leg.to.lat)) &&
      Number.isFinite(Number(leg.to.lon))
    ) {
      appendPoints(points, [
        [Number(leg.from.lat), Number(leg.from.lon)],
        [Number(leg.to.lat), Number(leg.to.lon)]
      ]);
    }

    if (isTransitLegMode(leg.mode)) {
      details.push({
        mode: leg.mode || "",
        displayName: leg.displayName || leg.routeShortName || leg.routeLongName || "",
        from: leg.from && leg.from.name ? leg.from.name : "",
        to: leg.to && leg.to.name ? leg.to.name : "",
        startTime: leg.startTime || "",
        endTime: leg.endTime || "",
        agencyName: leg.agencyName || ""
      });
    }
  });

  const cleanPoints = simplifyPoints(points, 0.00001);

  if (cleanPoints.length < 2) {
    return null;
  }

  return {
    points: cleanPoints,
    distanceMetres: Math.round(calculatePathDistanceMetres(cleanPoints)),
    durationSeconds: durationSeconds ? Math.round(durationSeconds) : null,
    source: "Transitous MOTIS API",
    generatedAt: new Date().toISOString(),
    details
  };
}

function isTransitLegMode(mode) {
  return isRailLegMode(mode) || String(mode || "").toUpperCase() === "BUS";
}

function isRailLegMode(mode) {
  return RAIL_MODES.has(String(mode || "").toUpperCase());
}

function extractLegPoints(leg) {
  const geometry = leg.legGeometry;

  if (!geometry) {
    return [];
  }

  if (typeof geometry === "string") {
    return decodePolyline(geometry, 6);
  }

  if (typeof geometry.points === "string") {
    return decodePolyline(geometry.points, Number(geometry.precision || 6));
  }

  if (typeof geometry.polyline === "string") {
    return decodePolyline(geometry.polyline, Number(geometry.precision || 6));
  }

  if (Array.isArray(geometry.points)) {
    return normalisePointArray(geometry.points);
  }

  if (Array.isArray(geometry.coordinates)) {
    return normalisePointArray(geometry.coordinates);
  }

  return [];
}

function decodePolyline(encoded, precision = 6) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);

    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);

    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    coordinates.push([lat / factor, lng / factor]);
  }

  return coordinates.filter(([pointLat, pointLng]) => {
    return Number.isFinite(pointLat) && Number.isFinite(pointLng);
  });
}

function normalisePointArray(points) {
  return points
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const a = Number(point[0]);
        const b = Number(point[1]);

        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
          return [a, b];
        }

        return [b, a];
      }

      if (point && typeof point === "object") {
        return [Number(point.lat), Number(point.lng ?? point.lon)];
      }

      return null;
    })
    .filter((point) => {
      return point && Number.isFinite(point[0]) && Number.isFinite(point[1]);
    });
}

function appendPoints(target, points) {
  points.forEach((point) => {
    const previous = target[target.length - 1];

    if (
      previous &&
      Math.abs(previous[0] - point[0]) < 0.000001 &&
      Math.abs(previous[1] - point[1]) < 0.000001
    ) {
      return;
    }

    target.push(point);
  });
}

function simplifyPoints(points, tolerance) {
  if (points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];

  for (let index = 1; index < points.length - 1; index++) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];

    if (
      Math.abs(previous[0] - current[0]) >= tolerance ||
      Math.abs(previous[1] - current[1]) >= tolerance
    ) {
      simplified.push(current);
    }
  }

  simplified.push(points[points.length - 1]);

  return simplified.map(([lat, lng]) => [
    Number(lat.toFixed(6)),
    Number(lng.toFixed(6))
  ]);
}
