export function formatDistance(distanceMetres) {
  const metres = Number(distanceMetres);

  if (!Number.isFinite(metres)) {
    return "Unknown";
  }

  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  }

  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatDuration(durationSeconds) {
  const seconds = Number(durationSeconds);

  if (!Number.isFinite(seconds)) {
    return "Unknown";
  }

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}
