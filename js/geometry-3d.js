import { clamp } from "./core.js";

export const BOARD_THICKNESS = 1.6;

export function componentFamily(component) {
  const kind = component.kind || "custom";
  if (kind.startsWith("smd")) return "smd";
  if (/adapter/i.test(component.value || "") || ["regulatorSot223", "bridgeRectifier", "slideSwitch"].includes(kind)) return "adapter";
  if (/^dip\d+$/.test(kind) || kind === "ic") return "dip";
  if (/electrolytic/i.test(kind)) return "electrolytic";
  if (kind === "led") return "led";
  if (/diode/i.test(kind)) return "diode";
  if (/resistor/i.test(kind)) return "resistor";
  if (/inductor/i.test(kind)) return "inductor";
  if (/film/i.test(kind)) return "film";
  if (/capacitor/i.test(kind)) return "ceramic";
  if (/^header/.test(kind)) return "header";
  if (/^screwTerminal/.test(kind)) return "terminal";
  if (kind === "transistor") return "to92";
  if (/To220/.test(kind)) return "to220";
  if (kind === "tactSwitch") return "switch";
  if (kind === "dipSwitch4") return "dipSwitch";
  if (kind === "potentiometer" || kind === "trimpot") return "pot";
  if (kind === "crystal") return "crystal";
  if (kind === "fuseAxial") return "fuse";
  if (kind === "buzzer") return "buzzer";
  if (kind === "testpad" || kind === "jackpads") return "pads";
  return "custom";
}

export function componentFrame(store, component) {
  const pitch = parseFloat(store.state.board.gridUnit) || 2.54;
  const local = component.pins, absolute = store.pinsFor(component);
  const average = (items, key) => items.reduce((sum, p) => sum + p[key], 0) / Math.max(1, items.length);
  const cx = average(local, "x"), cy = average(local, "y");
  const col = average(absolute, "col"), row = average(absolute, "row");
  return {
    x: (col - (store.state.board.cols - 1) / 2) * pitch,
    z: ((store.state.board.rows - 1) / 2 - row) * pitch,
    rotation: (component.rot || 0) * Math.PI / 180,
    side: component.side === "bottom" ? -1 : 1,
    pins: local.map((p, index) => ({ x: (p.x - cx) * pitch, z: -(p.y - cy) * pitch, index, number: p.number, name: p.name })),
    pitch
  };
}

// Round corners locally without moving endpoints or overshooting the route.
export function roundPolyline(points, radius = 0.45, steps = 5) {
  const clean = points.filter((p, i) => !i || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y, p.z - points[i - 1].z) > 1e-7);
  if (clean.length < 3) return clean.map(p => ({ ...p }));
  const out = [{ ...clean[0] }];
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1], b = clean[i], c = clean[i + 1];
    const before = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), after = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z);
    const cut = Math.min(radius, before * 0.35, after * 0.35);
    const p = {}, q = {};
    for (const axis of ["x", "y", "z"]) { p[axis] = b[axis] + (a[axis] - b[axis]) / before * cut; q[axis] = b[axis] + (c[axis] - b[axis]) / after * cut; }
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, point = {};
      for (const axis of ["x", "y", "z"]) point[axis] = (1 - t) ** 2 * p[axis] + 2 * t * (1 - t) * b[axis] + t ** 2 * q[axis];
      out.push(point);
    }
  }
  out.push({ ...clean[clean.length - 1] });
  return out;
}

export function resistorBands(value) {
  const text = String(value || "").trim();
  const inline = text.match(/^(\d+)([RrKkMm])(\d+)\b/), prefix = text.match(/^([RrKkM])(\d+)\b/), ordinary = text.match(/^(\d+(?:[.,]\d+)?)\s*([RrKkMm]?)/);
  if (!inline && !prefix && !ordinary) return [];
  const unit = prefix ? prefix[1] : (inline || ordinary)[2], scale = unit === "M" ? 1e6 : /k/i.test(unit) ? 1e3 : unit === "m" ? 1e-3 : 1;
  const ohms = (prefix ? Number(`0.${prefix[2]}`) : inline ? Number(`${inline[1]}.${inline[3]}`) : Number(ordinary[1].replace(",", "."))) * scale;
  const colors = ["#171b21", "#694329", "#bc423c", "#ed8a39", "#e8c949", "#45915b", "#387cbb", "#8d5fab", "#828a91", "#e2e4de"];
  if (ohms === 0) return [colors[0]];
  const exponent = Math.floor(Math.log10(ohms));
  let multiplier = exponent - 2;
  if (multiplier < -2 || multiplier > 9) return [];
  let digits = Math.round(ohms / (10 ** multiplier));
  if (digits > 999) { digits = 100; multiplier += 1; }
  if (multiplier > 9) return [];
  const tolerance = text.match(/(0\.1|0\.25|0\.5|1|2|5|10)\s*%/);
  const toleranceColor = ({ "0.1": colors[7], "0.25": colors[6], "0.5": colors[5], "1": colors[1], "2": colors[2], "10": "#bfc4c8" })[tolerance?.[1]] || "#c8a45a";
  return [...String(digits).padStart(3, "0")].map(d => colors[Number(d)]).concat(multiplier < 0 ? (multiplier === -1 ? "#c8a45a" : "#bfc4c8") : colors[multiplier], toleranceColor);
}

// Generate a board with actual openings rather than black discs. Each grid
// cell contributes square-to-circle rings; the outer boundary closes the slab.
export function perforatedBoardGeometry(board, pitch = parseFloat(board.gridUnit) || 2.54) {
  const positions = [], indices = [], half = pitch / 2, y = BOARD_THICKNESS / 2;
  const radius = clamp(board.holeDiameterMm / 2, 0.1, pitch * 0.4), segments = 12;
  const quad = (a, b, c, d) => {
    const n = positions.length / 3;
    for (const p of [a, b, c, d]) positions.push(...p);
    indices.push(n, n + 2, n + 1, n, n + 3, n + 2);
  };
  for (let row = 0; row < board.rows; row++) for (let col = 0; col < board.cols; col++) {
    const x = (col - (board.cols - 1) / 2) * pitch, z = ((board.rows - 1) / 2 - row) * pitch;
    for (let i = 0; i < segments; i++) {
      const angle = Math.PI / 4 + i * Math.PI * 2 / segments, next = angle + Math.PI * 2 / segments;
      const sample = t => {
        const cos = Math.cos(t), sin = Math.sin(t), outer = half / Math.max(Math.abs(cos), Math.abs(sin));
        return { outer: [x + cos * outer, y, z + sin * outer], inner: [x + cos * radius, y, z + sin * radius] };
      };
      const a = sample(angle), b = sample(next), lower = p => [p[0], -y, p[2]];
      quad(a.outer, a.inner, b.inner, b.outer);
      quad(lower(b.outer), lower(b.inner), lower(a.inner), lower(a.outer));
      quad(a.inner, lower(a.inner), lower(b.inner), b.inner);
    }
  }
  const w = board.cols * pitch / 2, d = board.rows * pitch / 2;
  quad([w, y, -d], [w, -y, -d], [-w, -y, -d], [-w, y, -d]);
  quad([-w, y, d], [-w, -y, d], [w, -y, d], [w, y, d]);
  quad([-w, y, -d], [-w, -y, -d], [-w, -y, d], [-w, y, d]);
  quad([w, y, d], [w, -y, d], [w, -y, -d], [w, y, -d]);
  return { positions, indices };
}

// Underside strips retain the same open holes and cut gaps as the board.
export function copperStripGeometry(board, a, b, pitch = parseFloat(board.gridUnit) || 2.54) {
  const vertical = board.stripDirection === "vertical", start = vertical ? a.row : a.col, end = vertical ? b.row : b.col;
  const positions = [], indices = [], radius = clamp(board.holeDiameterMm / 2, 0.1, pitch * 0.4), halfWidth = pitch * 0.325;
  for (let offset = Math.ceil(start); offset <= Math.floor(end); offset++) {
    const col = vertical ? a.col : offset, row = vertical ? offset : a.row;
    const x = (col - (board.cols - 1) / 2) * pitch, z = ((board.rows - 1) / 2 - row) * pitch;
    const low = Math.max(start - offset, -0.5) * pitch, high = Math.min(end - offset, 0.5) * pitch;
    const left = vertical ? -halfWidth : low, right = vertical ? halfWidth : high;
    const near = vertical ? -high : -halfWidth, far = vertical ? -low : halfWidth;
    const distance = t => {
      const dx = Math.cos(t), dz = Math.sin(t);
      return Math.min(dx > 1e-8 ? right / dx : dx < -1e-8 ? left / dx : Infinity, dz > 1e-8 ? far / dz : dz < -1e-8 ? near / dz : Infinity);
    };
    const points = t => {
      const dx = Math.cos(t), dz = Math.sin(t), length = distance(t), inner = Math.min(length, radius);
      return [[x + dx * inner, -0.823, z + dz * inner], [x + dx * length, -0.823, z + dz * length]];
    };
    // Include rectangle corners so no copper is lost between neighboring cells.
    const angles = [...Array.from({ length: 16 }, (_, i) => i * Math.PI / 8), ...[[left, near], [left, far], [right, near], [right, far]].map(([dx, dz]) => Math.atan2(dz, dx))];
    // Larger holes may meet strip edges; clip there instead of filling the hole.
    for (const dx of [left, right]) if (Math.abs(dx) < radius) { const angle = Math.acos(dx / radius); angles.push(angle, -angle); }
    for (const dz of [near, far]) if (Math.abs(dz) < radius) { const angle = Math.asin(dz / radius); angles.push(angle, Math.PI - angle); }
    const sorted = [...new Set(angles.map(t => (t + Math.PI * 2) % (Math.PI * 2)))].sort((c, d) => c - d);
    for (let i = 0; i < sorted.length; i++) {
      const next = i === sorted.length - 1 ? sorted[0] + Math.PI * 2 : sorted[i + 1];
      if (distance((sorted[i] + next) / 2) < radius) continue;
      const [innerA, outerA] = points(sorted[i]), [innerB, outerB] = points(next);
      const n = positions.length / 3;
      for (const p of [outerB, innerB, innerA, outerA]) positions.push(...p);
      indices.push(n, n + 2, n + 1, n, n + 3, n + 2);
    }
  }
  return { positions, indices };
}
