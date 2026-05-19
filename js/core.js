/*
  Core utilities and small domain helpers.
  This file deliberately has no DOM side effects; other modules can be tested
  against these pure helpers first.
*/

export const SVG_NS = "http://www.w3.org/2000/svg";

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function svgEl(tag, attrs = {}, text = undefined) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, value);
  });
  if (text !== undefined) node.textContent = text;
  return node;
}

export function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function isPowerNet(net) {
  const upper = String(net || "").toUpperCase();
  return /(^|\b)(5V|3V3|3\.3V|1V8|1\.8V|VCC|VDD|AVDD|DVDD|VIN|VBAT|POWER)(\b|$)/.test(upper);
}

export function isGroundNet(net) {
  const upper = String(net || "").toUpperCase();
  return upper.includes("GND") || ["AGND", "DGND", "PGND", "GROUND", "0V"].includes(upper);
}

export function netKind(net) {
  if (isGroundNet(net)) return "ground";
  if (isPowerNet(net)) return "power";
  return "signal";
}

export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.handlers.get(type).delete(handler);
  }

  emit(type, payload) {
    const handlers = this.handlers.get(type);
    if (!handlers) return;
    handlers.forEach(handler => handler(payload));
  }
}

export class Geometry {
  static rotateGridPoint(point, rotationDeg) {
    const r = ((Number(rotationDeg) || 0) % 360 + 360) % 360;
    const { x, y } = point;
    if (r === 90) return { x: -y, y: x };
    if (r === 180) return { x: -x, y: -y };
    if (r === 270) return { x: y, y: -x };
    return { x, y };
  }

  static componentBounds(component) {
    const pins = Array.isArray(component.pins) ? component.pins : [];
    const rotated = pins.map(pin => Geometry.rotateGridPoint({ x: pin.x || 0, y: pin.y || 0 }, component.rot || 0));
    const minX = Math.min(0, ...rotated.map(point => point.x));
    const minY = Math.min(0, ...rotated.map(point => point.y));
    const maxX = Math.max((component.w || 1) - 1, ...rotated.map(point => point.x));
    const maxY = Math.max((component.h || 1) - 1, ...rotated.map(point => point.y));
    return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  static pinAbsolute(component, pin) {
    const bounds = Geometry.componentBounds(component);
    const p = Geometry.rotateGridPoint({ x: pin.x || 0, y: pin.y || 0 }, component.rot || 0);
    return {
      col: Math.round((component.col || 0) + p.x - bounds.minX),
      row: Math.round((component.row || 0) + p.y - bounds.minY)
    };
  }

  static gridToSvg(board, point) {
    return {
      x: board.margin + point.col * board.pitchPx,
      y: board.margin + point.row * board.pitchPx
    };
  }

  static svgToGrid(board, svgPoint) {
    return {
      col: clamp(Math.round((svgPoint.x - board.margin) / board.pitchPx), 0, board.cols - 1),
      row: clamp(Math.round((svgPoint.y - board.margin) / board.pitchPx), 0, board.rows - 1)
    };
  }

  static boardPixelSize(board) {
    const pad = board.margin * 2;
    return {
      width: pad + (board.cols - 1) * board.pitchPx,
      height: pad + (board.rows - 1) * board.pitchPx
    };
  }

  static distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  static rectsOverlap(a, b, padding = 0) {
    return !(
      a.x + a.w + padding < b.x ||
      b.x + b.w + padding < a.x ||
      a.y + a.h + padding < b.y ||
      b.y + b.h + padding < a.y
    );
  }
}

export class LabelPlacer {
  constructor() {
    this.rects = [];
  }

  reserve(preferred, width, height) {
    const candidate = { x: preferred.x, y: preferred.y, w: width, h: height };
    const steps = [0, -12, 12, -24, 24, -36, 36, -50, 50];
    for (const dy of steps) {
      const next = { ...candidate, y: preferred.y + dy };
      if (!this.rects.some(rect => Geometry.rectsOverlap(rect, next, 4))) {
        this.rects.push(next);
        return next;
      }
    }
    this.rects.push(candidate);
    return candidate;
  }
}

export class ModalService {
  constructor() {
    this.modal = $("#modal");
    this.title = $("#modalTitle");
    this.body = $("#modalBody");
    $("#modalCloseBtn")?.addEventListener("click", () => this.close());
    this.modal?.addEventListener("click", event => {
      if (event.target === this.modal) this.close();
    });
  }

  open(title, html) {
    this.title.textContent = title;
    this.body.innerHTML = html;
    this.modal.classList.remove("hidden");
  }

  close() {
    this.modal.classList.add("hidden");
    this.body.innerHTML = "";
  }
}
