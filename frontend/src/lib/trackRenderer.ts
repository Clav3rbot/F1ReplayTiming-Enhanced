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

export interface Corner {
  x: number;
  y: number;
  number: number;
  letter: string;
  angle: number;
}

export interface MarshalSector {
  x: number;
  y: number;
  number: number;
}

export interface SectorFlag {
  sector: number;
  flag: string;
  driver: string;
}

export interface SectorOverlay {
  boundaries: { s1_end: number; s2_end: number; total: number };
  colors: { s1: string; s2: string; s3: string };
}

const TRACK_STATUS_COLORS: Record<string, string> = {
  green: "#3A3A4A",
  yellow: "#F5C518",
  sc: "#F5C518",
  vsc: "#F5C518",
  red: "#E10600",
};

/** Shared coordinate transform: rotation, bounds, scale, offset, toScreen. */
export function computeTrackTransform(
  points: TrackPoint[],
  width: number,
  height: number,
  rotation: number,
  compact: boolean,
  zoom: number,
  panX: number = 0,
  panY: number = 0,
) {
  const padX = compact ? 10 : 40;
  const padTop = compact ? 10 : 60;
  const padBottom = compact ? 10 : 90;
  const w = width - padX * 2;
  const h = height - padTop - padBottom;

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = 0.5;
  const cy = 0.5;

  const rotated = points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rotated) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(w / rangeX, h / rangeY) * Math.max(0.25, zoom);
  const offsetX = padX + (w - rangeX * scale) / 2;
  const offsetY = padTop + (h - rangeY * scale) / 2;

  function toScreen(p: TrackPoint): [number, number] {
    return [
      offsetX + (p.x - minX) * scale + panX,
      offsetY + (maxY - p.y) * scale + panY,
    ];
  }

  /** Rotate a normalized point (e.g. driver position, corner). */
  function rotate(x: number, y: number): { x: number; y: number } {
    const dx = x - cx;
    const dy = y - cy;
    return { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
  }

  return { rotated, scale, offsetX, offsetY, minX, maxX, minY, maxY, cos, sin, cx, cy, toScreen, rotate, padX, padTop, padBottom };
}

export type TrackTransform = ReturnType<typeof computeTrackTransform>;

export function drawTrack(
  ctx: CanvasRenderingContext2D,
  points: TrackPoint[],
  width: number,
  height: number,
  rotation: number,
  trackStatus: string = "green",
  sectorOverlay?: SectorOverlay | null,
  compact: boolean = false,
  zoom: number = 1,
  corners?: Corner[] | null,
  marshalSectors?: MarshalSector[] | null,
  sectorFlags?: SectorFlag[] | null,
  panX: number = 0,
  panY: number = 0,
  precomputed?: TrackTransform,
) {
  if (points.length === 0) return;

  const { rotated, toScreen, rotate } = precomputed ?? computeTrackTransform(
    points, width, height, rotation, compact, zoom, panX, panY,
  );

  // Draw track outline (optionally colored by sector)
  if (sectorOverlay) {
    const { boundaries, colors } = sectorOverlay;
    const segments = [
      { start: 0, end: boundaries.s1_end, color: colors.s1 },
      { start: boundaries.s1_end, end: boundaries.s2_end, color: colors.s2 },
      { start: boundaries.s2_end, end: rotated.length - 1, color: colors.s3 },
    ];
    // Draw base track first (so gaps between segments aren't visible)
    ctx.beginPath();
    ctx.strokeStyle = "#3A3A4A";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const [bx, by] = toScreen(rotated[0]);
    ctx.moveTo(bx, by);
    for (let i = 1; i < rotated.length; i++) {
      const [px, py] = toScreen(rotated[i]);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw colored sector segments on top
    for (const seg of segments) {
      ctx.beginPath();
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const [sx2, sy2] = toScreen(rotated[seg.start]);
      ctx.moveTo(sx2, sy2);
      for (let i = seg.start + 1; i <= seg.end && i < rotated.length; i++) {
        const [px, py] = toScreen(rotated[i]);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    const effectiveStatus = (sectorFlags && sectorFlags.length > 0 && (trackStatus === "yellow")) ? "green" : trackStatus;
    ctx.strokeStyle = TRACK_STATUS_COLORS[effectiveStatus] || "#3A3A4A";
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
  }

  // Draw track center line
  ctx.beginPath();
  ctx.strokeStyle = "#4A4A5A";
  ctx.lineWidth = 2;
  const [sx, sy] = toScreen(rotated[0]);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < rotated.length; i++) {
    const [px, py] = toScreen(rotated[i]);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();

  // Start/finish marker  - drawn perpendicular to track direction
  const [fx, fy] = toScreen(rotated[0]);
  const [nx, ny] = toScreen(rotated[1]);
  const trackAngle = Math.atan2(ny - fy, nx - fx);
  const perpAngle = trackAngle + Math.PI / 2;
  const markerLen = 8;
  ctx.beginPath();
  ctx.moveTo(fx - Math.cos(perpAngle) * markerLen, fy - Math.sin(perpAngle) * markerLen);
  ctx.lineTo(fx + Math.cos(perpAngle) * markerLen, fy + Math.sin(perpAngle) * markerLen);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();

  // Corner labels
  if (corners && corners.length > 0) {
    ctx.font = `bold ${compact ? 11 : 10}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const c of corners) {
      const rp = rotate(c.x, c.y);
      const [screenX, screenY] = toScreen(rp);

      const labelRad = ((c.angle + rotation) * Math.PI) / 180;
      const labelOffset = compact ? 18 : 16;
      const lx = screenX + Math.cos(labelRad) * labelOffset;
      const ly = screenY - Math.sin(labelRad) * labelOffset;

      const label = c.letter ? `${c.number}${c.letter}` : `${c.number}`;

      ctx.lineWidth = compact ? 3 : 2;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillText(label, lx, ly);
    }
  }

  // Marshal sector flag indicators
  if (marshalSectors && sectorFlags && sectorFlags.length > 0) {
    const flagLookup = new Map<number, SectorFlag>();
    for (const sf of sectorFlags) {
      flagLookup.set(sf.sector, sf);
    }

    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const ms of marshalSectors) {
      const sf = flagLookup.get(ms.number);
      if (!sf) continue;

      const rp = rotate(ms.x, ms.y);
      const [screenX, screenY] = toScreen(rp);

      const isDouble = sf.flag === "DOUBLE YELLOW";
      const flagColor = sf.flag === "RED" ? "#FF0000" : "#FFD700";
      const radius = 8;

      ctx.beginPath();
      ctx.arc(screenX, screenY, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = "#000000";
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.fillStyle = flagColor;
      ctx.fill();

      if (isDouble) {
        ctx.beginPath();
        ctx.arc(screenX, screenY, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#B8960F";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (sf.driver) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(sf.driver, screenX, screenY + radius + 10);
      }
    }
  }
}

export function drawDrivers(
  ctx: CanvasRenderingContext2D,
  drivers: DriverMarker[],
  trackPoints: TrackPoint[],
  width: number,
  height: number,
  rotation: number,
  highlightedDrivers: string[],
  showNames: boolean = true,
  compact: boolean = false,
  zoom: number = 1,
  panX: number = 0,
  panY: number = 0,
  precomputed?: TrackTransform,
) {
  if (trackPoints.length === 0) return;

  const { scale, toScreen, rotate } = precomputed ?? computeTrackTransform(
    trackPoints, width, height, rotation, compact, zoom, panX, panY,
  );

  const highlightedSet = new Set(highlightedDrivers);
  for (const drv of drivers) {
    const rp = rotate(drv.x, drv.y);
    const [sx, sy] = toScreen(rp);

    const isHighlighted = highlightedSet.has(drv.abbr);
    const radius = isHighlighted ? 8 : 5;

    ctx.save();

    if (isHighlighted) {
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = drv.color + "40";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = drv.color;
    ctx.strokeStyle = drv.color;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    if (showNames) {
      ctx.font = isHighlighted ? "800 12px system-ui, -apple-system, sans-serif" : "800 10px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.fillText(drv.abbr, sx, sy - radius - 4);
    }
  }
}

