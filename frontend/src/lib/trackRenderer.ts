export interface TrackPoint {
  x: number;
  y: number;
}

export interface DriverMarker {
  abbr: string;
  x: number;
  y: number;
  color: string;
  position: number | null;
}

export function drawTrack(
  ctx: CanvasRenderingContext2D,
  points: TrackPoint[],
  width: number,
  height: number,
  rotation: number,
) {
  if (points.length === 0) return;

  const padding = 40;
  const w = width - padding * 2;
  const h = height - padding * 2;

  // Apply rotation
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Center of the normalized track
  const cx = 0.5;
  const cy = 0.5;

  const rotated = points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: dx * cos - dy * sin + cx,
      y: dx * sin + dy * cos + cy,
    };
  });

  // Find bounds after rotation
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rotated) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(w / rangeX, h / rangeY);

  const offsetX = padding + (w - rangeX * scale) / 2;
  const offsetY = padding + (h - rangeY * scale) / 2;

  function toScreen(p: TrackPoint): [number, number] {
    return [
      offsetX + (p.x - minX) * scale,
      offsetY + (p.y - minY) * scale,
    ];
  }

  // Draw track outline
  ctx.beginPath();
  ctx.strokeStyle = "#3A3A4A";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const [sx, sy] = toScreen(rotated[0]);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < rotated.length; i++) {
    const [px, py] = toScreen(rotated[i]);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();

  // Draw track center line
  ctx.beginPath();
  ctx.strokeStyle = "#4A4A5A";
  ctx.lineWidth = 2;
  ctx.moveTo(sx, sy);
  for (let i = 1; i < rotated.length; i++) {
    const [px, py] = toScreen(rotated[i]);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();

  // Start/finish marker
  const [fx, fy] = toScreen(rotated[0]);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(fx - 2, fy - 8, 4, 16);
}

export function drawDrivers(
  ctx: CanvasRenderingContext2D,
  drivers: DriverMarker[],
  trackPoints: TrackPoint[],
  width: number,
  height: number,
  rotation: number,
  highlightedDriver: string | null,
) {
  if (trackPoints.length === 0) return;

  const padding = 40;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = 0.5;
  const cy = 0.5;

  // Compute rotation bounds from track points
  const rotatedTrack = trackPoints.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rotatedTrack) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(w / rangeX, h / rangeY);
  const offsetX = padding + (w - rangeX * scale) / 2;
  const offsetY = padding + (h - rangeY * scale) / 2;

  for (const drv of drivers) {
    // Rotate driver position
    const dx = drv.x - cx;
    const dy = drv.y - cy;
    const rx = dx * cos - dy * sin + cx;
    const ry = dx * sin + dy * cos + cy;

    const sx = offsetX + (rx - minX) * scale;
    const sy = offsetY + (ry - minY) * scale;

    const isHighlighted = highlightedDriver === drv.abbr;
    const radius = isHighlighted ? 8 : 5;

    // Glow effect for highlighted
    if (isHighlighted) {
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = drv.color + "40";
      ctx.fill();
    }

    // Driver dot
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = drv.color;
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Driver label
    ctx.font = isHighlighted ? "bold 11px monospace" : "10px monospace";
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.fillText(drv.abbr, sx, sy - radius - 4);
  }
}
