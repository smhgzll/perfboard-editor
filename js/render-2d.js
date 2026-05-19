import { $, svgEl, Geometry, round } from "./core.js";

export class BoardRenderer2D {
  constructor(svg, store) {
    this.svg = svg;
    this.store = store;
    this.zoom = 1;
    this.selection = null;
    this.hoverHole = null;
    this.draftRoute = [];
  }

  setZoom(value) {
    this.zoom = Math.max(0.25, Math.min(3.5, value));
    document.documentElement.style.setProperty("--label-scale", String(Math.max(0.58, Math.min(1.25, 0.62 + this.zoom * 0.24))));
  }

  render() {
    const { state } = this.store;
    const board = state.board;
    const size = Geometry.boardPixelSize(board);
    this.svg.replaceChildren();
    this.svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    this.svg.style.width = `${size.width * this.zoom}px`;
    this.svg.style.height = `${size.height * this.zoom}px`;

    this.drawBoard(board, size);
    if (state.view.showRulers !== false) this.drawRulers(board);
    if (!state.view.wiresOnTop) this.drawWires();
    this.drawComponents();
    if (state.view.wiresOnTop) this.drawWires();
    this.drawDraftWire();
    this.drawHoverHole();
  }

  drawBoard(board, size) {
    this.svg.append(svgEl("rect", {
      class: "board",
      x: board.margin - board.pitchPx / 2,
      y: board.margin - board.pitchPx / 2,
      width: (board.cols - 1) * board.pitchPx + board.pitchPx,
      height: (board.rows - 1) * board.pitchPx + board.pitchPx,
      rx: 10,
      style: `fill:${board.color || "var(--board)"}`
    }));

    // Screen holes are intentionally smaller than the physical ratio.
    // A literal 0.9/2.54 scale makes the board look crowded at common zooms.
    const padRadius = Math.max(1.6, Math.min(board.pitchPx * 0.24, (board.padDiameterMm / 2.54) * board.pitchPx * 0.34));
    const holeRadius = Math.max(0.75, Math.min(board.pitchPx * 0.13, (board.holeDiameterMm / 2.54) * board.pitchPx * 0.28));
    const holes = svgEl("g", { class: "board-holes" });
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const p = Geometry.gridToSvg(board, { col, row });
        holes.append(svgEl("circle", { class: "board-pad", cx: p.x, cy: p.y, r: round(padRadius, 2) }));
        holes.append(svgEl("circle", { class: "board-hole", cx: p.x, cy: p.y, r: round(holeRadius, 2) }));
      }
    }
    this.svg.append(holes);
  }

  drawRulers(board) {
    const ruler = svgEl("g", { class: "rulers" });
    for (let col = 0; col < board.cols; col += 5) {
      const p = Geometry.gridToSvg(board, { col, row: 0 });
      ruler.append(svgEl("line", { class: "ruler-line", x1: p.x, y1: board.margin - 34, x2: p.x, y2: board.margin - 18 }));
      ruler.append(svgEl("text", { class: "ruler-text", x: p.x, y: board.margin - 38, "text-anchor": "middle" }, String(col + 1)));
    }
    for (let row = 0; row < board.rows; row += 5) {
      const p = Geometry.gridToSvg(board, { col: 0, row });
      ruler.append(svgEl("line", { class: "ruler-line", x1: board.margin - 34, y1: p.y, x2: board.margin - 18, y2: p.y }));
      ruler.append(svgEl("text", { class: "ruler-text", x: board.margin - 38, y: p.y + 3, "text-anchor": "end" }, String(row + 1)));
    }
    this.svg.append(ruler);
  }

  drawComponents() {
    this.connectedPinKeys = this.buildConnectedPinKeySet();
    const group = svgEl("g", { class: "components-layer" });
    this.store.state.components.forEach(component => {
      group.append(this.renderComponent(component));
    });
    this.svg.append(group);
  }

  renderComponent(component) {
    const board = this.store.state.board;
    const pins = this.store.pinsFor(component).map(item => ({ ...item, svg: Geometry.gridToSvg(board, item) }));
    const node = svgEl("g", { class: "component", "data-id": component.id });
    if (pins.length === 1) this.drawTestPad(node, component, pins);
    else if (component.kind === "ic") this.drawIc(node, component, pins);
    else if (["header", "jackpads"].includes(component.kind)) this.drawHeaderLike(node, component, pins);
    else if (this.isCompactSmdFootprint(component, pins)) this.drawSmdTwoPinPart(node, component, pins);
    else this.drawTwoPinPart(node, component, pins);
    if (this.selection?.type === "component" && this.selection.id === component.id) this.drawSelection(node, pins);
    return node;
  }


  isCompactSmdFootprint(component, pins) {
    if (!pins || pins.length !== 2) return false;
    if (String(component.kind || "").startsWith("smd")) return true;
    const compactKind = ["resistor", "capacitor", "electrolytic", "led", "crystal"].includes(component.kind);
    const dx = Math.abs((pins[1].col || 0) - (pins[0].col || 0));
    const dy = Math.abs((pins[1].row || 0) - (pins[0].row || 0));
    return compactKind && Math.max(dx, dy) <= 1;
  }

  drawSmdTwoPinPart(node, component, pins) {
    const [a, b] = pins;
    const mid = { x: (a.svg.x + b.svg.x) / 2, y: (a.svg.y + b.svg.y) / 2 };
    const dx = b.svg.x - a.svg.x;
    const dy = b.svg.y - a.svg.y;
    const len = Math.max(8, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const totalW = Math.min(len * 0.86, 31);
    const bodyW = Math.max(9, totalW - 9);
    const bodyH = component.kind === "smdElectrolytic" || component.kind === "electrolytic" ? 15 : 12;
    const terminalW = Math.max(3.2, Math.min(5, totalW * 0.16));
    const group = svgEl("g", { transform: `translate(${round(mid.x, 2)} ${round(mid.y, 2)}) rotate(${round(angle, 2)})` });

    group.append(svgEl("line", {
      class: "smd-lead",
      x1: round(-len / 2, 1), y1: 0, x2: round(len / 2, 1), y2: 0
    }));
    group.append(svgEl("rect", {
      class: "smd-terminal",
      x: round(-totalW / 2, 1), y: round(-bodyH / 2 - 1, 1),
      width: round(terminalW, 1), height: round(bodyH + 2, 1), rx: 1.4
    }));
    group.append(svgEl("rect", {
      class: "smd-terminal",
      x: round(totalW / 2 - terminalW, 1), y: round(-bodyH / 2 - 1, 1),
      width: round(terminalW, 1), height: round(bodyH + 2, 1), rx: 1.4
    }));
    group.append(svgEl("rect", {
      class: "comp-body smd-body",
      x: round(-bodyW / 2, 1), y: round(-bodyH / 2, 1),
      width: round(bodyW, 1), height: round(bodyH, 1), rx: 3,
      style: `fill:${component.color}`
    }));
    if (component.kind === "smdElectrolytic" || component.kind === "electrolytic") {
      group.append(svgEl("text", { class: "smd-polarity", x: round(-bodyW / 2 + 3, 1), y: 4, "text-anchor": "middle" }, "+"));
    }
    node.append(group);
    pins.forEach(pin => this.drawPin(node, pin));
    this.drawComponentLabel(node, component, mid.x, mid.y - 15);
  }

  drawTwoPinPart(node, component, pins) {
    const [a, b] = pins;
    const mid = { x: (a.svg.x + b.svg.x) / 2, y: (a.svg.y + b.svg.y) / 2 };
    const dx = b.svg.x - a.svg.x;
    const dy = b.svg.y - a.svg.y;
    const len = Math.max(16, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    node.append(svgEl("line", { x1: a.svg.x, y1: a.svg.y, x2: b.svg.x, y2: b.svg.y, stroke: "#e5e7eb", "stroke-width": 3.2, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
    const bodyW = Math.min(len * 0.58, 58);
    const bodyH = component.kind === "electrolytic" ? 24 : 18;
    const body = component.kind === "capacitor" || component.kind === "electrolytic"
      ? svgEl("ellipse", { class: "comp-body", cx: mid.x, cy: mid.y, rx: bodyW / 2, ry: bodyH / 2, style: `fill:${component.color}` })
      : svgEl("rect", { class: "comp-body", x: mid.x - bodyW / 2, y: mid.y - bodyH / 2, width: bodyW, height: bodyH, rx: 5, style: `fill:${component.color}` });
    body.setAttribute("transform", `rotate(${angle} ${mid.x} ${mid.y})`);
    node.append(body);
    pins.forEach(pin => this.drawPin(node, pin));
    this.drawComponentLabel(node, component, mid.x, mid.y - 16);
  }

  drawIc(node, component, pins) {
    const board = this.store.state.board;
    const xs = pins.map(pin => pin.svg.x);
    const ys = pins.map(pin => pin.svg.y);
    const x = Math.min(...xs) - board.pitchPx * 0.58;
    const y = Math.min(...ys) - board.pitchPx * 0.55;
    const w = Math.max(...xs) - Math.min(...xs) + board.pitchPx * 1.16;
    const h = Math.max(...ys) - Math.min(...ys) + board.pitchPx * 1.1;
    node.append(svgEl("rect", { class: "comp-body ic", x, y, width: w, height: h, rx: 7, style: `fill:${component.color}` }));
    node.append(svgEl("circle", { cx: x + 12, cy: y + 12, r: 4, fill: "#f8fafc" }));
    pins.forEach(pin => this.drawPin(node, pin));
    this.drawComponentLabel(node, component, x + w / 2, y + h / 2 + 4);
  }

  drawHeaderLike(node, component, pins) {
    const xs = pins.map(pin => pin.svg.x);
    const ys = pins.map(pin => pin.svg.y);
    const x = Math.min(...xs) - 10;
    const y = Math.min(...ys) - 10;
    const w = Math.max(...xs) - Math.min(...xs) + 20;
    const h = Math.max(...ys) - Math.min(...ys) + 20;
    node.append(svgEl("rect", { class: "comp-body", x, y, width: w, height: h, rx: 5, style: `fill:${component.color}` }));
    pins.forEach(pin => this.drawPin(node, pin));
    this.drawComponentLabel(node, component, x + w / 2, y - 7);
  }

  drawTestPad(node, component, pins) {
    const pin = pins[0];
    node.append(svgEl("circle", { class: "comp-body", cx: pin.svg.x, cy: pin.svg.y, r: 9, style: `fill:${component.color}` }));
    this.drawPin(node, pin);
    this.drawComponentLabel(node, component, pin.svg.x, pin.svg.y - 14);
  }

  drawPin(node, pin) {
    const key = `${pin.component.id}|${pin.pinIndex}`;
    const classes = `comp-pin${this.connectedPinKeys?.has(key) ? " connected" : ""}`;
    node.append(svgEl("circle", { class: classes, cx: pin.svg.x, cy: pin.svg.y, r: 4.1 }));
    if (this.store.state.view.showPinNames) {
      node.append(svgEl("text", { class: "pin-label", x: pin.svg.x + 6, y: pin.svg.y - 6 }, pin.pin.name || pin.pin.number || ""));
    }
  }

  buildConnectedPinKeySet() {
    const keys = new Set();
    const pinsByHole = new Map();
    this.store.allPins().forEach(pin => {
      const holeKey = `${pin.col},${pin.row}`;
      if (!pinsByHole.has(holeKey)) pinsByHole.set(holeKey, []);
      pinsByHole.get(holeKey).push(pin);
    });

    this.store.state.wires.forEach(wire => {
      (wire.route || []).forEach(point => {
        const pins = pinsByHole.get(`${point.col},${point.row}`) || [];
        pins.forEach(pin => keys.add(`${pin.component.id}|${pin.pinIndex}`));
      });
    });
    return keys;
  }

  drawComponentLabel(node, component, x, y) {
    if (!this.store.state.view.showLabels) return;
    const label = `${component.name || component.id}${component.value ? ` ${component.value}` : ""}`;
    node.append(svgEl("text", { class: "comp-label", x, y, "text-anchor": "middle" }, label));
  }

  drawSelection(node, pins) {
    const xs = pins.map(pin => pin.svg.x);
    const ys = pins.map(pin => pin.svg.y);
    const x = Math.min(...xs) - 20;
    const y = Math.min(...ys) - 20;
    const w = Math.max(...xs) - Math.min(...xs) + 40;
    const h = Math.max(...ys) - Math.min(...ys) + 40;
    node.append(svgEl("rect", { class: "selected-outline", x, y, width: w, height: h, rx: 8 }));
  }

  drawWires() {
    const group = svgEl("g", { class: "wires-layer" });
    this.store.state.wires.forEach(wire => {
      const visible = this.wireVisible(wire);
      if (!visible) return;
      const isGhost = this.wireIsGhost(wire);
      const path = this.wirePath(wire.route);
      const classes = ["wire", wire.layer || "top", wire.style === "dashed" ? "dashed" : "", isGhost ? "ghost" : "", this.selection?.type === "wire" && this.selection.id === wire.id ? "selected" : ""].filter(Boolean).join(" ");
      group.append(svgEl("path", { class: classes, d: path, "data-id": wire.id, style: wire.color ? `stroke:${wire.color}` : "" }));
      if (this.selection?.type === "wire" && this.selection.id === wire.id) this.drawWireHandles(group, wire);
    });
    this.svg.append(group);
  }

  wireVisible(wire) {
    const face = this.store.state.view.face;
    if (face === "both" || wire.layer === "jumper") return true;
    return wire.layer === face || !!this.store.state.view.showBack; // opposite side can stay visible as ghost
  }

  wireIsGhost(wire) {
    const face = this.store.state.view.face;
    return face !== "both" && wire.layer !== "jumper" && wire.layer !== face;
  }

  wirePath(route) {
    const board = this.store.state.board;
    return route.map((point, index) => {
      const p = Geometry.gridToSvg(board, point);
      return `${index ? "L" : "M"} ${round(p.x, 1)} ${round(p.y, 1)}`;
    }).join(" ");
  }

  drawWireHandles(group, wire) {
    const board = this.store.state.board;
    wire.route.forEach(point => {
      const p = Geometry.gridToSvg(board, point);
      group.append(svgEl("circle", { class: "wire-handle", cx: p.x, cy: p.y, r: 5 }));
    });
  }

  drawDraftWire() {
    if (!this.draftRoute.length) return;
    const path = this.wirePath(this.draftRoute);
    this.svg.append(svgEl("path", { class: "wire jumper dashed", d: path }));
  }

  drawHoverHole() {
    if (!this.hoverHole) return;
    const p = Geometry.gridToSvg(this.store.state.board, this.hoverHole);
    this.svg.append(svgEl("circle", { class: "hover-hole", cx: p.x, cy: p.y, r: 9 }));
  }
}
