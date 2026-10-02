import { Geometry, htmlEscape, round, clamp } from "./core.js";
import { copperRuns, cutEnds, activeCut } from "./copper.js";
import { isInsulated, routeHoles, holeKey } from "./connectivity.js";
import { componentFamily } from "./geometry-3d.js";

// Print geometry is independent of the editor's zoom and display pitch.
export const PRINT_PITCH = 24;
export const PRINT_MARGIN = 60;
export const printSize = board => ({ width: (board.cols - 1) * PRINT_PITCH + PRINT_MARGIN * 2, height: (board.rows - 1) * PRINT_PITCH + PRINT_MARGIN * 2 });
const n = value => round(value, 2);
const xy = p => `${n(p.x)} ${n(p.y)}`;
const average = (items, key) => items.reduce((sum, p) => sum + (p[key] || 0), 0) / Math.max(1, items.length);
const rectSvg = (x, y, w, h, cls = "layout-body", radius = 3) => `<rect class="${cls}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${radius}"/>`;
const circleSvg = (x, y, r, cls) => `<circle class="${cls}" cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`;

export function lineIntersectsBox(a, b, box, padding = 2) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, a.x - box.x + padding], [dx, box.x + box.w + padding - a.x], [-dy, a.y - box.y + padding], [dy, box.y + box.h + padding - a.y]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}

export function rowLabel(row, mode = "numbersTopLettersSide") {
  if (mode !== "numbersTopLettersSide") return String(row + 1);
  let value = row + 1, text = "";
  while (value > 0) { value--; text = String.fromCharCode(65 + value % 26) + text; value = Math.floor(value / 26); }
  return text;
}

export function printReferences(components) {
  const used = new Set(), refs = new Map();
  // Reserve unambiguous saved IDs before assigning a shortened custom name.
  const ids = new Map(components.map(c => [String(c.id).toUpperCase(), c]));
  components.forEach((c, index) => {
    const candidate = String(c.name || "").match(/^([a-z]{1,4}\d+)(?:\b|_)/i)?.[1];
    let ref = candidate && (!ids.has(candidate.toUpperCase()) || ids.get(candidate.toUpperCase()) === c) ? candidate : String(c.id);
    if (ref.length > 12 || used.has(ref.toUpperCase())) ref = `P${index + 1}`;
    while (used.has(ref.toUpperCase()) || (ids.has(ref.toUpperCase()) && ids.get(ref.toUpperCase()) !== c)) ref = `${ref}a`;
    used.add(ref.toUpperCase()); refs.set(c.id, ref);
  });
  return refs;
}

export class LayoutDrawing {
  constructor(store, face = "top", options = {}) {
    this.store = store; this.face = face;
    this.options = { values: false, pinNames: false, otherFace: true, monochrome: false, ...options };
    this.board = { ...store.state.board, pitchPx: PRINT_PITCH, margin: PRINT_MARGIN };
    this.size = printSize(this.board); this.refs = printReferences(store.state.components);
  }

  point(point) { return Geometry.gridToSvg(this.board, point); }
  displayPoint(point) { const p = this.point(point); return { x: this.face === "bottom" ? this.size.width - p.x : p.x, y: p.y }; }
  path(route) { return (route || []).map((p, i) => `${i ? "L" : "M"}${xy(this.point(p))}`).join(" "); }
  rectForFace(rect) { return { ...rect, x: this.face === "bottom" ? this.size.width - rect.x - rect.w : rect.x }; }

  component(c) {
    const absolute = this.store.pinsFor(c), local = c.pins || [], cx = average(local, "x"), cy = average(local, "y");
    const center = this.point({ col: average(absolute, "col"), row: average(absolute, "row") });
    const pins = local.map(pin => ({ ...pin, x: (pin.x - cx) * PRINT_PITCH, y: (pin.y - cy) * PRINT_PITCH }));
    const shape = this.shape(c, pins), rotation = (c.rot || 0) * Math.PI / 180;
    const corners = [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x, shape.y + shape.h], [shape.x + shape.w, shape.y + shape.h]].map(([x, y]) => ({ x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }));
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const bounds = this.rectForFace({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    const ghost = (c.side || "top") !== this.face;
    return { c, absolute, center: { x: this.face === "bottom" ? this.size.width - center.x : center.x, y: center.y }, bounds, inside: shape.inside, ghost,
      svg: `<g class="layout-component${ghost ? " other-face" : ""}" data-component-id="${htmlEscape(c.id)}" data-family="${componentFamily(c)}" transform="translate(${xy(center)}) rotate(${c.rot || 0})"><title>${htmlEscape(`${this.refs.get(c.id)} · ${c.name || c.id} · ${c.value || ""} · ${c.side || "top"}`)}</title>${shape.svg}</g>` };
  }

  shape(c, pins) {
    const pitch = PRINT_PITCH, xs = pins.map(p => p.x), ys = pins.map(p => p.y);
    const minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
    const spanX = maxX - minX, spanY = maxY - minY, family = componentFamily(c);
    let w = Math.max(pitch * 0.7, spanX + pitch * 0.6), h = Math.max(pitch * 0.7, spanY + pitch * 0.6), svg = "", inside = false;
    const compact = family === "smd" || (pins.length === 2 && Math.max(spanX, spanY) <= pitch && ["resistor", "ceramic", "electrolytic", "crystal"].includes(family));
    if (pins.length === 2 && (compact || ["resistor", "diode", "inductor", "fuse", "crystal", "film", "ceramic"].includes(family))) {
      const [a, b] = pins, span = Math.hypot(b.x - a.x, b.y - a.y), angle = Math.atan2(b.y - a.y, b.x - a.x);
      const length = clamp(span * 0.55, pitch * 0.4, pitch * 2.2), height = compact ? pitch * 0.34 : pitch * 0.45;
      let body = rectSvg(-length / 2, -height / 2, length, height, "layout-body", family === "ceramic" ? height / 2 : 3);
      if (family === "diode") body += `<path class="layout-detail" d="M${n(length * 0.3)} ${n(-height / 2)}v${n(height)}"/>`;
      if (family === "fuse" || compact) body += `<path class="layout-detail" d="M${n(-length * 0.32)} ${n(-height / 2)}v${n(height)}M${n(length * 0.32)} ${n(-height / 2)}v${n(height)}"/>`;
      if (family === "inductor") body += [-1, 0, 1].map(i => circleSvg(i * length / 4, 0, height * 0.32, "layout-detail")).join("");
      svg = `<g transform="rotate(${n(angle * 180 / Math.PI)})"><path class="layout-lead" d="M${n(-span / 2)} 0H${n(span / 2)}"/>${body}</g>`;
      w = Math.abs(Math.cos(angle)) * length + Math.abs(Math.sin(angle)) * height;
      h = Math.abs(Math.sin(angle)) * length + Math.abs(Math.cos(angle)) * height;
    } else if (["electrolytic", "led", "to92", "pot", "buzzer"].includes(family)) {
      const diameter = clamp(Math.max(spanX, spanY) + pitch * 0.35, pitch * 0.85, pitch * 1.8); w = h = diameter;
      svg = pins.map(p => { const length = Math.hypot(p.x, p.y); return length > diameter / 2 ? `<path class="layout-lead" d="M${xy(p)}L${n(p.x / length * diameter / 2)} ${n(p.y / length * diameter / 2)}"/>` : ""; }).join("") + circleSvg(0, 0, diameter / 2, "layout-body");
      if (family === "electrolytic") svg += `<path class="layout-detail" d="M${n(diameter * 0.3)} ${n(-diameter * 0.32)}V${n(diameter * 0.32)}"/>`;
      if (family === "led" || family === "to92") svg += `<path class="layout-detail" d="M${n(diameter * 0.32)} ${n(-diameter * 0.32)}V${n(diameter * 0.32)}"/>`;
      if (family === "pot") svg += `<path class="layout-detail" d="M${n(-diameter * 0.18)} 0H${n(diameter * 0.18)}"/>`;
      if (family === "buzzer") svg += circleSvg(0, 0, diameter * 0.12, "layout-detail");
    } else if (family === "pads") {
      svg = pins.map(p => circleSvg(p.x, p.y, pitch * 0.22, "layout-body")).join("");
    } else {
      if (family === "dip") { h = Math.max(pitch * 0.7, spanY - pitch * 0.55); inside = spanY > pitch; }
      if (family === "adapter") inside = spanY > pitch;
      if (family === "header") { w = spanX + pitch * 0.65; h = spanY + pitch * 0.65; }
      if (["terminal", "switch", "dipSwitch", "to220"].includes(family)) h = Math.max(h, pitch);
      if (family === "custom") { w = Math.max(w, ((c.bodyW || c.w || 1) - 1) * pitch + pitch * 0.7); h = Math.max(h, ((c.bodyH || c.h || 1) - 1) * pitch + pitch * 0.7); inside = w > pitch * 2 && h > pitch; }
      if (["circle", "ellipse"].includes(c.bodyShape)) svg = `<ellipse class="layout-body" cx="0" cy="0" rx="${n(w / 2)}" ry="${n(h / 2)}"/>`;
      else if (c.bodyShape !== "none") svg = rectSvg(-w / 2, -h / 2, w, h);
      if (family === "dip") {
        svg += `<path class="layout-detail" d="M${n(-w / 2)} -5a5 5 0 0 1 0 10"/>`;
        svg += pins.map(p => `<path class="layout-lead" d="M${xy(p)}L${n(p.x)} ${n(Math.sign(p.y || 1) * h / 2)}"/>`).join("");
      }
      if (family === "adapter") svg += rectSvg(-Math.min(w, h) * 0.13, -Math.min(w, h) * 0.13, Math.min(w, h) * 0.26, Math.min(w, h) * 0.26, "layout-detail", 1);
      if (family === "terminal") svg += pins.map(p => circleSvg(p.x, 0, pitch * 0.18, "layout-detail")).join("");
      if (family === "switch") svg += circleSvg(0, 0, pitch * 0.2, "layout-detail");
      if (family === "dipSwitch") svg += [0, 1, 2, 3].map(i => rectSvg((i - 1.5) * w / 4 - 2, -4, 4, 8, "layout-detail", 1)).join("");
    }
    return { svg, x: -w / 2, y: -h / 2, w, h, inside };
  }

  build() {
    const { board, size, face } = this, pitch = PRINT_PITCH, edge = PRINT_MARGIN - pitch / 2;
    const width = board.cols * pitch, height = board.rows * pitch;
    const allItems = this.store.state.components.map(c => this.component(c));
    const items = allItems.filter(item => !item.ghost || this.options.otherFace);
    const mirrored = face === "bottom" ? `translate(${size.width} 0) scale(-1 1)` : "";
    let holes = "", guides = "";
    for (let row = 0; row < board.rows; row++) for (let col = 0; col < board.cols; col++) {
      const p = this.point({ col, row }); holes += circleSvg(p.x, p.y, 1.9, "layout-hole");
    }
    for (let col = 4; col < board.cols; col += 5) { const p = this.point({ col, row: 0 }); guides += `<path class="layout-guide" d="M${n(p.x)} ${edge}v${height}"/>`; }
    for (let row = 4; row < board.rows; row += 5) { const p = this.point({ col: 0, row }); guides += `<path class="layout-guide" d="M${edge} ${n(p.y)}h${width}"/>`; }
    const copper = face === "bottom" ? copperRuns(board).map(run => `<path class="copper-strip" stroke-width="${pitch * 0.4}" d="${this.path(run)}"/>`).join("") : "";
    const cuts = face === "bottom" ? (board.cuts || []).filter(cut => activeCut(board, cut)).map(cut => {
      const [a, b] = cutEnds(cut), p = this.point({ col: (a.col + b.col) / 2, row: (a.row + b.row) / 2 }), r = pitch * 0.19;
      return `<path class="copper-cut" d="M${n(p.x - r)} ${n(p.y - r)}L${n(p.x + r)} ${n(p.y + r)}M${n(p.x - r)} ${n(p.y + r)}L${n(p.x + r)} ${n(p.y - r)}"/>`;
    }).join("") : "";
    const bridges = (this.store.state.solderBridges || []).filter(b => b.layer === face).map(b => `<path class="solder-bridge" data-bridge-id="${htmlEscape(b.id)}" d="${this.path([b.a, b.b])}"/>`).join("");
    const wires = this.store.state.wires.filter(w => (w.layer === "jumper" ? "top" : w.layer) === face);
    const wireSvg = wires.map(wire => `<g class="layout-wire ${isInsulated(wire) ? "insulated" : "bare"}" data-wire-id="${htmlEscape(wire.id)}"><title>${htmlEscape(`${wire.id} · ${wire.net || ""} · ${wire.layer}`)}</title><path class="layout-wire-halo" d="${this.path(wire.route)}"/><path class="layout-wire-line" d="${this.path(wire.route)}"/></g>`).join("");
    const contacts = new Map();
    wires.forEach(wire => routeHoles(wire).forEach(p => {
      const key = holeKey(p), current = contacts.get(key) || { point: p, wires: new Set(), end: false };
      current.wires.add(wire.id); current.end ||= [wire.route[0], wire.route.at(-1)].some(end => holeKey(end) === key); contacts.set(key, current);
    }));
    const dots = [...contacts.values()].filter(c => c.end || c.wires.size > 1).map(c => { const p = this.point(c.point); return `<circle class="layout-contact" data-grid="${holeKey(c.point)}" cx="${n(p.x)}" cy="${n(p.y)}" r="${c.wires.size > 1 ? 3 : 2.4}"/>`; }).join("");
    let pinSvg = "", pinText = "";
    for (const item of allItems) item.absolute.forEach((p, index) => {
      if (item.ghost && String(item.c.kind).startsWith("smd")) return;
      const at = this.point(p), data = `data-pin="${htmlEscape(item.c.id)}:${index}" data-col="${p.col}" data-row="${p.row}"`;
      pinSvg += index === 0 && item.absolute.length > 2 ? `<rect class="layout-pin pin-one" ${data} x="${n(at.x - 3.2)}" y="${n(at.y - 3.2)}" width="6.4" height="6.4"/>` : `<circle class="layout-pin" ${data} cx="${n(at.x)}" cy="${n(at.y)}" r="3.2"/>`;
      if (this.options.pinNames) {
        const pos = this.displayPoint(p), name = String(p.pin.name || p.pin.number || index + 1);
        const above = pos.y <= item.center.y;
        pinText += `<text class="layout-pin-label" x="${n(pos.x)}" y="${n(pos.y + (above ? -6 : 11))}" text-anchor="middle">${htmlEscape(name)}</text>`;
      } else if (item.absolute.length === 2 && /^[+\-AK]$/.test(String(p.pin.name))) {
        const pos = this.displayPoint(p);
        pinText += `<text class="layout-polarity" x="${n(pos.x + (pos.x < item.center.x ? -7 : 7))}" y="${n(pos.y - 5)}" text-anchor="middle">${htmlEscape(p.pin.name)}</text>`;
      }
    });
    const labels = this.labels(items);
    const notes = (this.store.state.texts || []).map((note, i) => { const p = this.displayPoint(note); return `<g class="layout-note" data-note-id="${htmlEscape(note.id)}"><title>${htmlEscape(note.text)}</title>${rectSvg(p.x - 10, p.y - 9, 25, 15, "layout-note-box", 3)}<text x="${n(p.x + 2.5)}" y="${n(p.y + 1)}" text-anchor="middle">N${i + 1}</text></g>`; }).join("");
    return `<svg class="layout-drawing${this.options.monochrome ? " monochrome" : ""}" data-face="${face}" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${face === "bottom" ? "Mirrored bottom" : "Top"} board layout"><title>${htmlEscape(this.store.state.name)} · ${face} layout</title><desc>Column 1 is on the ${face === "bottom" ? "right" : "left"}. Short component references match the parts key. Solid wires are bare; dashed wires are insulated or jumpers.</desc><g class="layout-geometry" transform="${mirrored}">${rectSvg(edge, edge, width, height, "layout-board", 4)}${guides}${copper}${holes}${items.map(item => item.svg).join("")}${bridges}${wireSvg}${dots}${pinSvg}${cuts}</g>${this.coordinates()}<g class="layout-annotations">${pinText}${labels}${notes}</g></svg>`;
  }

  coordinates() {
    const { board, size } = this, edge = PRINT_MARGIN - PRINT_PITCH / 2;
    let out = "";
    const stride = count => count <= 60 ? 1 : count <= 150 ? 5 : 10;
    for (let col = 0; col < board.cols; col++) if (!col || col === board.cols - 1 || (col + 1) % stride(board.cols) === 0) {
      const p = this.displayPoint({ col, row: 0 });
      out += `<text class="layout-coordinate" data-column="${col + 1}" x="${n(p.x)}" y="${edge - 9}" text-anchor="middle">${col + 1}</text>`;
      out += `<text class="layout-coordinate" x="${n(p.x)}" y="${size.height - edge + 16}" text-anchor="middle">${col + 1}</text>`;
    }
    for (let row = 0; row < board.rows; row++) if (!row || row === board.rows - 1 || (row + 1) % stride(board.rows) === 0) {
      const p = this.displayPoint({ col: 0, row });
      out += `<text class="layout-coordinate" data-row="${row + 1}" x="${edge - 11}" y="${n(p.y + 3.3)}" text-anchor="end">${rowLabel(row, board.coordinateMode)}</text>`;
      out += `<text class="layout-coordinate" x="${size.width - edge + 11}" y="${n(p.y + 3.3)}">${rowLabel(row, board.coordinateMode)}</text>`;
    }
    return `<g class="layout-coordinates">${out}</g>`;
  }

  labels(items) {
    const reserved = [], obstacles = items.filter(item => item.bounds.w < PRINT_PITCH * 6 || item.bounds.h < PRINT_PITCH * 2).map(item => ({ ...item.bounds, id: item.c.id }));
    for (const item of items) for (const pin of item.absolute) { const p = this.displayPoint(pin); obstacles.push({ x: p.x - 4, y: p.y - 4, w: 8, h: 8 }); }
    const edge = PRINT_MARGIN - PRINT_PITCH / 2;
    obstacles.push({ x: edge, y: edge - 21, w: this.board.cols * PRINT_PITCH, h: 17 }, { x: edge, y: this.size.height - edge + 3, w: this.board.cols * PRINT_PITCH, h: 18 }, { x: edge - 29, y: edge, w: 24, h: this.board.rows * PRINT_PITCH }, { x: this.size.width - edge + 5, y: edge, w: 24, h: this.board.rows * PRINT_PITCH });
    for (const note of this.store.state.texts || []) { const p = this.displayPoint(note); obstacles.push({ x: p.x - 10, y: p.y - 9, w: 25, h: 15 }); }
    const segments = this.store.state.wires.filter(w => (w.layer === "jumper" ? "top" : w.layer) === this.face).flatMap(w => (w.route || []).slice(1).map((p, i) => [this.displayPoint(w.route[i]), this.displayPoint(p)]));
    const overlaps = (a, b, pad = 2) => Geometry.rectsOverlap(a, b, pad);
    const insideCanvas = box => box.x >= 8 && box.y >= 8 && box.x + box.w <= this.size.width - 8 && box.y + box.h <= this.size.height - 8;
    let out = "";
    // Place larger labels first so short refs can use nearby gaps afterward.
    for (const item of [...items].sort((a, b) => Number(b.inside) - Number(a.inside) || this.refs.get(b.c.id).length - this.refs.get(a.c.id).length)) {
      const ref = this.refs.get(item.c.id), value = String(item.c.value || ""), showValue = this.options.values && value;
      const valueLimit = Math.min(24, Math.max(6, Math.floor((this.size.width - 24) / 5.2)));
      const preview = value.length > valueLimit ? value.slice(0, valueLimit - 2) + "…" : value;
      const w = Math.max(ref.length * 7 + 8, showValue ? preview.length * 5.2 + 8 : 0), h = showValue ? 29 : 17;
      const bounds = item.bounds, center = item.center, candidates = [];
      if (item.inside && bounds.w > w + 6 && bounds.h > h + 8) candidates.push({ x: center.x - w / 2, y: center.y - h / 2, inside: true });
      for (const gap of [4, 12, 24, 40, 60, 84]) {
        candidates.push({ x: center.x - w / 2, y: bounds.y - h - gap }, { x: center.x - w / 2, y: bounds.y + bounds.h + gap }, { x: bounds.x - w - gap, y: center.y - h / 2 }, { x: bounds.x + bounds.w + gap, y: center.y - h / 2 });
        for (const dx of [-PRINT_PITCH, PRINT_PITCH]) candidates.push({ x: center.x - w / 2 + dx, y: bounds.y - h - gap }, { x: center.x - w / 2 + dx, y: bounds.y + bounds.h + gap });
      }
      const valid = candidates.map(p => ({ ...p, w, h })).filter(insideCanvas);
      const score = box => reserved.filter(r => overlaps(box, r)).length * 10000 + obstacles.filter(r => r.id !== item.c.id && overlaps(box, r, 1)).length * 1000 + segments.filter(([a, b]) => lineIntersectsBox(a, b, box)).length * 180 + Math.hypot(box.x + w / 2 - center.x, box.y + h / 2 - center.y);
      const chosen = valid.map(box => ({ box, score: score(box) })).sort((a, b) => a.score - b.score)[0]?.box || { x: clamp(center.x - w / 2, 8, this.size.width - w - 8), y: clamp(center.y - h / 2, 8, this.size.height - h - 8), w, h };
      reserved.push(chosen);
      const end = { x: clamp(center.x, chosen.x, chosen.x + w), y: clamp(center.y, chosen.y, chosen.y + h) };
      const distant = Math.hypot(end.x - center.x, end.y - center.y) > Math.max(bounds.w, bounds.h) / 2 + 8;
      const leader = distant && !chosen.inside ? `<path class="layout-callout" d="M${xy(center)}L${xy(end)}"/>` : "";
      out += `<g class="layout-ref${item.ghost ? " other-face" : ""}" data-ref="${htmlEscape(item.c.id)}"><title>${htmlEscape(`${item.c.name || item.c.id} · ${value}`)}</title>${leader}${rectSvg(chosen.x, chosen.y, w, h, "layout-ref-box", 3)}<text class="layout-ref-text" x="${n(chosen.x + w / 2)}" y="${n(chosen.y + 12)}" text-anchor="middle">${htmlEscape(ref)}</text>${showValue ? `<text class="layout-value" x="${n(chosen.x + w / 2)}" y="${n(chosen.y + 24)}" text-anchor="middle">${htmlEscape(preview)}</text>` : ""}</g>`;
    }
    return out;
  }
}

export function layoutPrintCss() {
  return `
    .layout-drawing { font-family:Arial,Helvetica,sans-serif; --wire-ink:#235b79; --jumper-ink:#76518b; }
    .layout-drawing.monochrome { --wire-ink:#222; --jumper-ink:#222; }
    .layout-board { fill:#fff; stroke:#626f78; stroke-width:1.2; }
    .layout-guide { fill:none; stroke:#edf0f2; stroke-width:.65; }
    .layout-hole { fill:#fff; stroke:#c6cfd3; stroke-width:.65; }
    .layout-component .layout-body { fill:#f4f7f8; fill-opacity:.75; stroke:#344957; stroke-width:1.35; }
    .layout-detail,.layout-lead { fill:none; stroke:#344957; stroke-width:1.2; stroke-linejoin:round; }
    .layout-component.other-face .layout-body,.layout-component.other-face .layout-detail,.layout-component.other-face .layout-lead { fill:none; stroke:#b8c0c4; stroke-width:.9; stroke-dasharray:3 3; }
    .layout-drawing .copper-strip { fill:none; stroke:#dde1e3; stroke-linecap:butt; opacity:1; }
    .layout-drawing .copper-cut { fill:none; stroke:#a1372e; stroke-width:2.4; stroke-linecap:round; }
    .layout-drawing.monochrome .copper-cut { stroke:#111; }
    .layout-drawing .solder-bridge { fill:none; stroke:#535f66; stroke-width:5; stroke-linecap:round; }
    .layout-wire path { fill:none; stroke-linecap:round; stroke-linejoin:round; }
    .layout-wire-halo { stroke:#fff; stroke-width:4.7; }
    .layout-wire-line { stroke:var(--wire-ink); stroke-width:1.85; }
    .layout-wire.insulated .layout-wire-line { stroke:var(--jumper-ink); stroke-width:2; stroke-dasharray:6 4; }
    .layout-contact { fill:var(--wire-ink); stroke:#fff; stroke-width:.7; }
    .layout-pin { fill:#fff; stroke:#243943; stroke-width:1.3; }
    .layout-pin.pin-one { stroke-width:1.6; }
    .layout-coordinate { fill:#5b6b75; font-size:10px; font-weight:600; }
    .layout-pin-label,.layout-polarity { fill:#273f4b; font-size:8px; paint-order:stroke; stroke:#fff; stroke-width:2.7; stroke-linejoin:round; }
    .layout-polarity { font-weight:700; font-size:9px; }
    .layout-ref-box { fill:#fff; fill-opacity:.97; stroke:#d3dade; stroke-width:.65; }
    .layout-ref-text { fill:#172f3d; font-size:11.5px; font-weight:700; }
    .layout-ref.other-face .layout-ref-text { fill:#707f87; }.layout-ref.other-face .layout-ref-box { stroke-dasharray:2 2; }
    .layout-value { fill:#50616b; font-size:9px; }
    .layout-callout { fill:none; stroke:#8e9da6; stroke-width:.8; }
    .layout-note-box { fill:#fff; stroke:#7d8d96; stroke-width:.8; }.layout-note text { fill:#43535d; font-size:9px; font-weight:700; }
    .layout-drawing.monochrome .layout-board{stroke:#666}.layout-drawing.monochrome .layout-guide{stroke:#eee}.layout-drawing.monochrome .layout-hole{stroke:#ccc}
    .layout-drawing.monochrome .layout-component .layout-body{stroke:#333;fill:#f5f5f5}.layout-drawing.monochrome .layout-detail,.layout-drawing.monochrome .layout-lead,.layout-drawing.monochrome .layout-pin{stroke:#333}
    .layout-drawing.monochrome .layout-component.other-face .layout-body,.layout-drawing.monochrome .layout-component.other-face .layout-detail,.layout-drawing.monochrome .layout-component.other-face .layout-lead{stroke:#aaa;fill:none}
    .layout-drawing.monochrome .copper-strip{stroke:#ddd}.layout-drawing.monochrome .solder-bridge{stroke:#555}.layout-drawing.monochrome .layout-coordinate{fill:#666}
    .layout-drawing.monochrome .layout-pin-label,.layout-drawing.monochrome .layout-polarity,.layout-drawing.monochrome .layout-ref-text{fill:#222}.layout-drawing.monochrome .layout-ref.other-face .layout-ref-text{fill:#777}
    .layout-drawing.monochrome .layout-ref-box{stroke:#ccc}.layout-drawing.monochrome .layout-value{fill:#666}.layout-drawing.monochrome .layout-callout{stroke:#999}.layout-drawing.monochrome .layout-note-box{stroke:#777}.layout-drawing.monochrome .layout-note text{fill:#444}
  `;
}
