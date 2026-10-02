import { $, svgEl, Geometry, round } from "./core.js";
import { copperRuns, cutEnds, activeCut, adjacent } from "./copper.js";
import { canonicalNet } from "./connectivity.js";

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
    const boardKey = JSON.stringify([board, state.view.face, state.view.showBack]);
    const reusedBoard = boardKey === this.cachedBoardKey;
    this.svg.replaceChildren(...(reusedBoard ? this.cachedBoardNodes : []));
    this.labelBoxes = [];
    this.svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    this.svg.style.width = `${size.width * this.zoom}px`;
    this.svg.style.height = `${size.height * this.zoom}px`;

    if (!reusedBoard) {
    this.drawWorkspaceGrid(board, size);
    this.drawBoard(board, size);
    // Rulers are rendered as fixed viewport overlays by app.js so they stay on editor edges.
    if (board.coordinateLabels !== false) this.drawCoordinateLabels(board);
    this.cachedBoardNodes = [...this.svg.childNodes]; this.cachedBoardKey = boardKey;
    }
    this.drawCopperHighlight();
    this.drawConnectionGuides();
    this.drawSolderBridges();
    if (!state.view.wiresOnTop) this.drawWires();
    this.drawComponents();
    if (state.view.wiresOnTop) this.drawWires();
    this.drawNotes();
    this.layoutComponentLabels(size);
    this.drawSelectedLabelOverlay();
    this.renderTransient();
  }

  drawWorkspaceGrid(board, size) {
    const grid = svgEl("g", { class: "workspace-grid" });
    const pitch = Math.max(4, Number(board.pitchPx) || 22);
    const offsetX = ((Number(board.margin) || 0) % pitch + pitch) % pitch;
    const offsetY = ((Number(board.margin) || 0) % pitch + pitch) % pitch;

    // Background grid: aligned to the perfboard holes, but drawn behind the board.
    // This restores the original board look while keeping the surrounding workspace useful.
    for (let x = offsetX; x <= size.width + 0.5; x += pitch) {
      grid.append(svgEl("line", { x1: round(x, 2), y1: 0, x2: round(x, 2), y2: size.height }));
    }
    for (let y = offsetY; y <= size.height + 0.5; y += pitch) {
      grid.append(svgEl("line", { x1: 0, y1: round(y, 2), x2: size.width, y2: round(y, 2) }));
    }
    this.svg.append(grid);
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

    const view = this.store.state.view;
    if (view.face !== "top" || view.showBack) {
      const strips = svgEl("g", { class: `copper-strips${view.face === "top" ? " is-ghost" : ""}` });
      copperRuns(board).forEach(run => strips.append(svgEl("path", { class: "copper-strip", d: this.wirePath(run), "stroke-width": board.pitchPx * 0.38 })));
      this.svg.append(strips);
    }

    // Screen holes are intentionally smaller than the physical ratio.
    // A literal 0.9/2.54 scale makes the board look crowded at common zooms.
    const padRadius = Math.max(1.6, Math.min(board.pitchPx * 0.24, (board.padDiameterMm / (parseFloat(board.gridUnit) || 2.54)) * board.pitchPx * 0.34));
    const holeRadius = Math.max(0.75, Math.min(board.pitchPx * 0.13, (board.holeDiameterMm / (parseFloat(board.gridUnit) || 2.54)) * board.pitchPx * 0.28));
    const holes = svgEl("g", { class: "board-holes" });
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const p = Geometry.gridToSvg(board, { col, row });
        holes.append(svgEl("circle", { class: "board-pad", cx: p.x, cy: p.y, r: round(padRadius, 2) }));
        holes.append(svgEl("circle", { class: "board-hole", cx: p.x, cy: p.y, r: round(holeRadius, 2) }));
      }
    }
    this.svg.append(holes);
    if (view.face !== "top" || view.showBack) {
      const cuts = svgEl("g", { class: `copper-cuts${view.face === "top" ? " is-ghost" : ""}` });
      (board.cuts || []).filter(cut => activeCut(board, cut)).forEach(cut => cuts.append(this.cutMark(cut)));
      this.svg.append(cuts);
    }
  }

  cutMark(cut, preview = false) {
    const [a, b] = cutEnds(cut), p = Geometry.gridToSvg(this.store.state.board, { col: (a.col + b.col) / 2, row: (a.row + b.row) / 2 });
    const r = this.store.state.board.pitchPx * 0.18;
    const node = svgEl("g", { class: preview ? "cut-preview" : "copper-cut" });
    node.append(svgEl("path", { d: `M${p.x - r} ${p.y - r}L${p.x + r} ${p.y + r}M${p.x - r} ${p.y + r}L${p.x + r} ${p.y - r}` }));
    return node;
  }

  drawSolderBridges() {
    const view = this.store.state.view, group = svgEl("g", { class: "solder-bridges" });
    (this.store.state.solderBridges || []).forEach(bridge => {
      const ghost = view.face !== "both" && view.face !== bridge.layer;
      if (ghost && !view.showBack) return;
      const highlighted = this.groupHighlighted(this.connectivity?.groupAt(bridge.layer, bridge.a));
      group.append(svgEl("path", { class: `solder-bridge${ghost ? " is-ghost" : ""}${highlighted ? " net-highlight" : ""}`, d: this.wirePath([bridge.a, bridge.b]), "stroke-width": this.store.state.board.pitchPx * 0.22 }));
    });
    this.svg.append(group);
  }

  groupHighlighted(group) {
    if (!group) return false;
    return (this.activeNet && [...group.nets].some(n => canonicalNet(n) === canonicalNet(this.activeNet))) || (this.selection?.type === "wire" && group === this.connectivity?.wireGroups.get(this.selection.id));
  }

  drawCopperHighlight() {
    const { board, view } = this.store.state;
    if (view.face === "top" && !view.showBack) return;
    const group = svgEl("g", { class: `copper-highlights${view.face === "top" ? " is-ghost" : ""}`, "pointer-events": "none" });
    copperRuns(board).forEach(run => {
      const point = { col: Math.round(run[0].col), row: Math.round(run[0].row) };
      if (!this.groupHighlighted(this.connectivity?.groupAt("bottom", point))) return;
      group.append(svgEl("path", { class: "copper-net-highlight", d: this.wirePath(run), "stroke-width": board.pitchPx * 0.38 }));
    });
    this.svg.insertBefore(group, this.svg.querySelector(".board-holes"));
  }

  drawConnectionGuides() {
    if (this.store.state.view.showGuides === false) return;
    const group = svgEl("g", { class: "connection-guides" });
    (this.guides || []).forEach(guide => {
      const selected = !this.activeNet || canonicalNet(this.activeNet) === canonicalNet(guide.net);
      const path = svgEl("path", { class: `connection-guide${selected ? "" : " is-muted"}`, "data-net": guide.net, d: this.wirePath([guide.a, guide.b]) });
      path.append(svgEl("title", {}, `${guide.net}: connection still needed`)); group.append(path);
      for (const point of [guide.a, guide.b]) {
        const p = Geometry.gridToSvg(this.store.state.board, point);
        group.append(svgEl("circle", { class: "guide-end", cx: p.x, cy: p.y, r: 4 }));
      }
    });
    this.svg.append(group);
  }

  drawRulers(board) {
    const ruler = svgEl("g", { class: "rulers" });
    for (let col = 0; col < board.cols; col += 1) {
      const p = Geometry.gridToSvg(board, { col, row: 0 });
      ruler.append(svgEl("line", { class: "ruler-line", x1: p.x, y1: board.margin - 31, x2: p.x, y2: board.margin - 21 }));
      ruler.append(svgEl("text", { class: "ruler-text", x: p.x, y: board.margin - 35, "text-anchor": "middle" }, String(col + 1)));
    }
    for (let row = 0; row < board.rows; row += 1) {
      const p = Geometry.gridToSvg(board, { col: 0, row });
      ruler.append(svgEl("line", { class: "ruler-line", x1: board.margin - 31, y1: p.y, x2: board.margin - 21, y2: p.y }));
      ruler.append(svgEl("text", { class: "ruler-text", x: board.margin - 35, y: p.y + 3, "text-anchor": "end" }, String(row + 1)));
    }
    this.svg.append(ruler);
  }

  drawCoordinateLabels(board) {
    const labels = svgEl("g", { class: "edge-coordinate-labels" });
    const topUsesLetters = (board.coordinateMode || "numbersTopLettersSide") === "lettersTopNumbersSide";
    const topLabel = index => topUsesLetters ? this.indexToLetters(index) : String(index + 1);
    const sideLabel = index => topUsesLetters ? String(index + 1) : this.indexToLetters(index);
    const lastRowY = Geometry.gridToSvg(board, { col: 0, row: board.rows - 1 }).y;
    const lastColX = Geometry.gridToSvg(board, { col: board.cols - 1, row: 0 }).x;

    for (let col = 0; col < board.cols; col += 1) {
      const p = Geometry.gridToSvg(board, { col, row: 0 });
      labels.append(svgEl("text", { class: "edge-coord-label", x: p.x, y: board.margin - 13, "text-anchor": "middle" }, topLabel(col)));
      labels.append(svgEl("text", { class: "edge-coord-label", x: p.x, y: lastRowY + 20, "text-anchor": "middle" }, topLabel(col)));
    }
    for (let row = 0; row < board.rows; row += 1) {
      const p = Geometry.gridToSvg(board, { col: 0, row });
      labels.append(svgEl("text", { class: "edge-coord-label", x: board.margin - 14, y: p.y + 3, "text-anchor": "end" }, sideLabel(row)));
      labels.append(svgEl("text", { class: "edge-coord-label", x: lastColX + 14, y: p.y + 3, "text-anchor": "start" }, sideLabel(row)));
    }
    this.svg.append(labels);
  }

  indexToLetters(index) {
    let value = Number(index) || 0;
    let text = "";
    do {
      text = String.fromCharCode(65 + (value % 26)) + text;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return text;
  }

  drawComponents() {
    this.connectedPinKeys = this.buildConnectedPinKeySet();
    const group = svgEl("g", { class: "components-layer" });
    const selectedId = this.selection?.type === "component" ? this.selection.id : null;
    const components = (this.store.state.components || []).filter(c => this.store.state.view.face === "both" || (c.side || "top") === this.store.state.view.face || this.store.state.view.showBack);
    components.filter(component => component.id !== selectedId).forEach(component => {
      group.append(this.renderComponent(component));
    });
    components.filter(component => component.id === selectedId).forEach(component => {
      group.append(this.renderComponent(component));
    });
    this.svg.append(group);
  }

  drawSelectedLabelOverlay() {
    if (this.selection?.type !== "component") return;
    const component = this.store.componentById(this.selection.id);
    if (!component) return;
    const overlay = svgEl("g", { class: "selected-label-overlay" });
    const cloneSource = [...this.svg.querySelectorAll(".component-annotations")].find(node => node.dataset.id === component.id);
    if (!cloneSource) return;
    cloneSource.querySelectorAll("text.comp-label, text.pin-label").forEach(text => {
      const copy = text.cloneNode(true);
      if (copy.classList.contains("comp-label")) copy.classList.add("selected-comp-label");
      overlay.append(copy);
    });
    if (overlay.childNodes.length) this.svg.append(overlay);
  }

  renderComponent(component) {
    const board = this.store.state.board;
    const pins = this.store.pinsFor(component).map(item => ({ ...item, svg: Geometry.gridToSvg(board, item) }));
    const ghost = this.store.state.view.face !== "both" && (component.side || "top") !== this.store.state.view.face;
    const node = svgEl("g", { class: `component${ghost ? " ghost-component" : ""}`, "data-id": component.id });
    if (!pins.length) return node;
    if (pins.length === 1) this.drawTestPad(node, component, pins);
    else if (component.kind === "ic") this.drawIc(node, component, pins);
    else if (String(component.kind || "").startsWith("dip")) this.drawIc(node, component, pins);
    else if (["header", "jackpads"].includes(component.kind)) this.drawHeaderLike(node, component, pins);
    else if (component.bodyShape) this.drawCustomComponent(node, component, pins);
    else if (this.isCompactSmdFootprint(component, pins)) this.drawSmdTwoPinPart(node, component, pins);
    else this.drawTwoPinPart(node, component, pins);
    if (this.isSelected("component", component.id)) this.drawSelection(node, pins);
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
    this.drawComponentLabel(node, component, mid.x, mid.y - 15, { preferred: "above" });
  }

  drawTwoPinPart(node, component, pins) {
    const [a, b] = pins;
    const mid = { x: (a.svg.x + b.svg.x) / 2, y: (a.svg.y + b.svg.y) / 2 };
    const dx = b.svg.x - a.svg.x;
    const dy = b.svg.y - a.svg.y;
    const len = Math.max(16, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    node.append(svgEl("line", { x1: a.svg.x, y1: a.svg.y, x2: b.svg.x, y2: b.svg.y, stroke: "#e5e7eb", "stroke-width": 3.2, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
    const bodyW = Math.min(len * 0.58, this.isInductorKind(component) ? 74 : 58);
    const bodyH = this.isElectrolyticKind(component) ? 24 : 18;
    const body = this.isCapacitorKind(component) || this.isElectrolyticKind(component)
      ? svgEl("ellipse", { class: "comp-body", cx: mid.x, cy: mid.y, rx: bodyW / 2, ry: bodyH / 2, style: `fill:${component.color}` })
      : svgEl("rect", { class: "comp-body", x: mid.x - bodyW / 2, y: mid.y - bodyH / 2, width: bodyW, height: bodyH, rx: 5, style: `fill:${component.color}` });
    body.setAttribute("transform", `rotate(${angle} ${mid.x} ${mid.y})`);
    node.append(body);
    if (this.isDiodeKind(component)) this.drawDiodeMarker(node, mid, angle, bodyW);
    if (this.isElectrolyticKind(component)) this.drawPolarityMarker(node, mid, angle, bodyW);
    pins.forEach(pin => this.drawPin(node, pin));
    this.drawComponentLabel(node, component, mid.x, mid.y - 16, { preferred: "above" });
  }

  drawDiodeMarker(node, mid, angle, bodyW) {
    const marker = svgEl("g", { transform: `translate(${round(mid.x, 2)} ${round(mid.y, 2)}) rotate(${round(angle, 2)})` });
    marker.append(svgEl("line", { x1: round(bodyW / 2 - 8, 1), y1: -8, x2: round(bodyW / 2 - 8, 1), y2: 8, stroke: "#0f172a", "stroke-width": 2.2, "vector-effect": "non-scaling-stroke" }));
    node.append(marker);
  }

  drawPolarityMarker(node, mid, angle, bodyW) {
    const marker = svgEl("g", { transform: `translate(${round(mid.x, 2)} ${round(mid.y, 2)}) rotate(${round(angle, 2)})` });
    marker.append(svgEl("text", { class: "smd-polarity", x: round(-bodyW / 2 + 7, 1), y: 4, "text-anchor": "middle" }, "+"));
    node.append(marker);
  }

  isCapacitorKind(component) {
    return /capacitor|cap/i.test(component.kind || "") || component.kind === "filmCapacitor5";
  }

  isElectrolyticKind(component) {
    return /electrolytic/i.test(component.kind || "");
  }

  isDiodeKind(component) {
    return /diode/i.test(component.kind || "") || component.kind === "led" || component.kind === "smdLed";
  }

  isInductorKind(component) {
    return /inductor/i.test(component.kind || "");
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
    this.drawComponentLabel(node, component, x + w / 2, y + h / 2 + 4, { preferred: "center" });
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
    this.drawComponentLabel(node, component, x + w / 2, y - 7, { preferred: "above" });
  }

  drawCustomComponent(node, component, pins) {
    const board = this.store.state.board;
    const xs = pins.map(pin => pin.svg.x);
    const ys = pins.map(pin => pin.svg.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const bodyW = Math.max(Number(component.bodyW || component.w || 1), Math.max(...pins.map(pin => pin.pin.x || 0)) + 1);
    const bodyH = Math.max(Number(component.bodyH || component.h || 1), Math.max(...pins.map(pin => pin.pin.y || 0)) + 1);
    const rotated = component.rot === 90 || component.rot === 270;
    const w = Math.max(board.pitchPx * 0.9, ((rotated ? bodyH : bodyW) - 1) * board.pitchPx + board.pitchPx * 0.9);
    const h = Math.max(board.pitchPx * 0.9, ((rotated ? bodyW : bodyH) - 1) * board.pitchPx + board.pitchPx * 0.9);
    const x = minX - board.pitchPx * 0.45;
    const y = minY - board.pitchPx * 0.45;
    const shape = component.bodyShape || "roundrect";
    if (shape !== "none") {
      if (shape === "ellipse" || shape === "circle") {
        const r = shape === "circle" ? Math.max(w, h) / 2 : undefined;
        node.append(svgEl("ellipse", {
          class: "comp-body custom-body",
          cx: x + w / 2,
          cy: y + h / 2,
          rx: r || w / 2,
          ry: r || h / 2,
          style: `fill:${component.color}`
        }));
      } else {
        node.append(svgEl("rect", {
          class: "comp-body custom-body",
          x,
          y,
          width: w,
          height: h,
          rx: shape === "rect" ? 2 : 7,
          style: `fill:${component.color}`
        }));
      }
    }
    pins.forEach(pin => this.drawPin(node, pin));
    this.drawComponentLabel(node, component, x + w / 2, y - 7, { preferred: "above" });
  }

  drawTestPad(node, component, pins) {
    const pin = pins[0];
    node.append(svgEl("circle", { class: "comp-body", cx: pin.svg.x, cy: pin.svg.y, r: 9, style: `fill:${component.color}` }));
    this.drawPin(node, pin);
    this.drawComponentLabel(node, component, pin.svg.x, pin.svg.y - 14, { preferred: "above" });
  }

  drawPin(node, pin) {
    const key = `${pin.component.id}|${pin.pinIndex}`;
    const classes = `comp-pin${this.connectedPinKeys?.has(key) ? " connected" : ""}`;
    const marker = svgEl("circle", { class: classes, cx: pin.svg.x, cy: pin.svg.y, r: 4.1 });
    marker.append(svgEl("title", {}, String(pin.pin.name || pin.pin.number || "")));
    node.append(marker);
    if (this.store.state.view.showPinNames) {
      const fontSize = Math.min(this.viewNumber("pinFontSize", 6, 3, 14), Math.max(3.5, this.store.state.board.pitchPx * 0.35));
      this.appendEllipsizedText(node, pin.pin.name || pin.pin.number || "", pin.svg.x + 5.8, pin.svg.y - 5.8, {
        className: "pin-label",
        anchor: "start",
        fontSize,
        maxChars: Math.max(4, Math.min(12, Math.floor(this.store.state.board.pitchPx / Math.max(1, fontSize) * 2.6)))
      });
    }
  }

  buildConnectedPinKeySet() {
    return new Set(this.connectivity?.pins.keys() || []);
  }

  drawComponentLabel(node, component, x, y, options = {}) {
    if (!this.store.state.view.showLabels) return;
    const fullLabel = `${component.name || component.id}${component.value ? ` ${component.value}` : ""}`;
    const selected = this.selection?.type === "component" && this.selection.id === component.id;
    this.appendEllipsizedText(node, fullLabel, x, y, {
      className: selected ? "comp-label selected-comp-label" : "comp-label",
      anchor: "middle",
      fontSize: this.viewNumber("labelFontSize", 8.4, 4, 18),
      maxChars: this.viewNumber("labelWrapChars", 24, 8, 48)
    });
  }

  appendEllipsizedText(parent, text, x, y, options = {}) {
    const full = String(text ?? "").trim();
    const maxChars = Math.max(4, Number(options.maxChars) || 24);
    const label = this.ellipsize(full, maxChars);
    const node = svgEl("text", {
      class: options.className || "text-label",
      x,
      y,
      "text-anchor": options.anchor || "middle",
      style: `font-size:${Number(options.fontSize) || 8}px`
    }, label);
    if (full) node.append(svgEl("title", {}, full));
    parent.append(node);
    return node;
  }

  layoutComponentLabels(size) {
    // Measure attached SVG text: character counts miss wide letters and font settings.
    const occupied = [...this.svg.querySelectorAll(".comp-pin, .edge-coord-label, .note")].map(node => {
      const box = node.getBBox();
      return { x: box.x - 2, y: box.y - 2, w: box.width + 4, h: box.height + 4 };
    });
    const layer = svgEl("g", { class: "component-labels-layer" });
    const groups = new Map();
    const labels = [...this.svg.querySelectorAll(".components-layer .comp-label, .components-layer .pin-label")];
    const selectedId = this.selection?.type === "component" ? this.selection.id : null;
    labels.sort((a, b) => {
      const priority = node => (node.closest(".component").dataset.id === selectedId ? 0 : 2) + (node.classList.contains("pin-label") ? 1 : 0);
      return priority(a) - priority(b);
    });
    for (const label of labels) {
      const component = label.closest(".component");
      const id = component.dataset.id;
      if (!groups.has(id)) {
        const group = svgEl("g", { class: `component-annotations${component.classList.contains("ghost-component") ? " ghost-component" : ""}`, "data-id": id });
        groups.set(id, group);
        layer.append(group);
        const fullLabel = component.querySelector(".comp-label title")?.textContent;
        if (fullLabel) component.append(svgEl("title", {}, fullLabel));
      }
      const box = label.getBBox();
      const pin = label.classList.contains("pin-label");
      const pitch = this.store.state.board.pitchPx;
      const width = box.width, height = box.height;
      const offsets = [[0, 0]];
      if (pin) {
        // Keep names near their pin; try the opposite side before moving rows.
        offsets.push([-width - 11.6, 0], [0, height + 11.6], [-width - 11.6, height + 11.6]);
      }
      for (let step = 1; step <= 4; step++) {
        const distance = step * Math.max(height + 5, pitch * 0.5);
        offsets.push([0, -distance], [0, distance]);
        if (!pin) offsets.push([-step * (width + 6) / 2, 0], [step * (width + 6) / 2, 0]);
      }
      const chosen = offsets.find(([dx, dy]) => {
        const rect = { x: box.x + dx - 2, y: box.y + dy - 2, w: width + 4, h: height + 4 };
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > size.width || rect.y + rect.h > size.height) return false;
        if (occupied.some(other => Geometry.rectsOverlap(other, rect, 1))) return false;
        occupied.push(rect);
        return true;
      });
      if (!chosen) {
        // Dense layouts retain full names on component/pin tooltips.
        label.remove();
        continue;
      }
      label.setAttribute("x", Number(label.getAttribute("x")) + chosen[0]);
      label.setAttribute("y", Number(label.getAttribute("y")) + chosen[1]);
      groups.get(id).append(label);
    }
    this.labelBoxes = occupied;
    this.svg.append(layer);
  }

  ellipsize(value, maxChars = 24) {
    const text = String(value ?? "").trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  }

  appendSmartWrappedText(parent, text, x, y, options = {}) {
    const fontSize = Number(options.fontSize) || 8;
    const lineHeight = fontSize * (Number(options.lineHeight) || 1.12);
    const lines = this.wrapText(text, options.maxChars || 20, options.maxLines || 3);
    const width = Math.max(12, Math.max(...lines.map(line => line.length || 1)) * fontSize * 0.62 + 7);
    const height = Math.max(fontSize, lines.length * lineHeight);
    const preferred = options.preferred || "above";
    const candidateSets = {
      center: [
        { dx: 0, dy: 0, anchor: "middle" },
        { dx: 0, dy: -height - 8, anchor: "middle" },
        { dx: 0, dy: height + 5, anchor: "middle" },
        { dx: width / 2 + 10, dy: 0, anchor: "start" },
        { dx: -width / 2 - 10, dy: 0, anchor: "end" }
      ],
      pin: [
        { dx: 8, dy: -7, anchor: "start" },
        { dx: -8, dy: -7, anchor: "end" },
        { dx: 8, dy: height + 2, anchor: "start" },
        { dx: -8, dy: height + 2, anchor: "end" },
        { dx: 0, dy: -height - 7, anchor: "middle" },
        { dx: 0, dy: height + 9, anchor: "middle" },
        { dx: 13, dy: 4, anchor: "start" },
        { dx: -13, dy: 4, anchor: "end" }
      ],
      above: [
        { dx: 0, dy: 0, anchor: "middle" },
        { dx: 0, dy: -height - 7, anchor: "middle" },
        { dx: 0, dy: height + 9, anchor: "middle" },
        { dx: width / 2 + 12, dy: 0, anchor: "start" },
        { dx: -width / 2 - 12, dy: 0, anchor: "end" },
        { dx: width / 2 + 12, dy: height + 5, anchor: "start" },
        { dx: -width / 2 - 12, dy: height + 5, anchor: "end" }
      ]
    };
    const candidates = candidateSets[preferred] || candidateSets.above;
    let chosen = null;
    for (const candidate of candidates) {
      const cx = x + candidate.dx;
      const cy = y + candidate.dy;
      const rect = this.textRect(cx, cy, width, height, candidate.anchor || options.anchor || "middle", fontSize);
      if (!this.labelBoxes.some(existing => Geometry.rectsOverlap(existing, rect, 3))) {
        chosen = { x: cx, y: cy, anchor: candidate.anchor || options.anchor || "middle", rect };
        break;
      }
    }
    if (!chosen) {
      const candidate = candidates[0];
      const cx = x + candidate.dx;
      const cy = y + candidate.dy;
      chosen = { x: cx, y: cy, anchor: candidate.anchor || options.anchor || "middle", rect: this.textRect(cx, cy, width, height, candidate.anchor || options.anchor || "middle", fontSize) };
    }
    this.labelBoxes.push(chosen.rect);
    return this.appendWrappedText(parent, text, chosen.x, chosen.y, { ...options, anchor: chosen.anchor });
  }

  textRect(x, y, width, height, anchor, fontSize) {
    const left = anchor === "middle" ? x - width / 2 : (anchor === "end" ? x - width : x);
    return { x: left - 2, y: y - fontSize - 2, w: width + 4, h: height + 4 };
  }

  appendWrappedText(parent, text, x, y, options = {}) {
    const lines = this.wrapText(text, options.maxChars || 20, options.maxLines || 3);
    const node = svgEl("text", {
      class: options.className || "text-label",
      x,
      y,
      "text-anchor": options.anchor || "middle",
      style: `font-size:${Number(options.fontSize) || 8}px`
    });
    const lineHeight = (Number(options.fontSize) || 8) * (Number(options.lineHeight) || 1.12);
    lines.forEach((line, index) => {
      const tspan = svgEl("tspan", { x, dy: index ? round(lineHeight, 2) : 0 }, line);
      node.append(tspan);
    });
    parent.append(node);
    return node;
  }

  wrapText(value, maxChars = 20, maxLines = 3) {
    const text = String(value ?? "").trim();
    if (!text) return [""];
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const chunks = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, "g")) : [word];
      for (const chunk of chunks) {
        const candidate = line ? `${line} ${chunk}` : chunk;
        if (candidate.length > maxChars && line) {
          lines.push(line);
          line = chunk;
        } else {
          line = candidate;
        }
        if (lines.length >= maxLines) break;
      }
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length > maxLines) lines.length = maxLines;
    const joined = lines.join(" ");
    if (joined.length < text.length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/, "")}…`;
    return lines;
  }

  viewNumber(key, fallback, min, max) {
    const value = Number(this.store.state.view?.[key]);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
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
      const isBridge = wire.bridgeType === "jumper" || wire.bridgeType === "insulated" || wire.layer === "jumper";
      const classes = ["wire", wire.layer || "top", wire.style === "dashed" ? "dashed" : "", isBridge ? "bridge" : "", wire.bridgeType === "insulated" ? "insulated" : "", isGhost ? "ghost" : "", this.isSelected("wire", wire.id) ? "selected" : "", this.groupHighlighted(this.connectivity?.wireGroups.get(wire.id)) ? "net-highlight" : ""].filter(Boolean).join(" ");
      if (isBridge && !isGhost) group.append(svgEl("path", { class: "wire-bridge-casing", d: path }));
      if (!isGhost) group.append(svgEl("path", { class: "wire-hit", d: path, "data-id": wire.id }));
      group.append(svgEl("path", { class: classes, d: path, "data-id": wire.id, style: wire.color ? `stroke:${wire.color}` : "" }));
      if (this.isSelected("wire", wire.id)) this.drawWireHandles(group, wire);
    });
    this.svg.append(group);
  }

  wireVisible(wire) {
    const face = this.store.state.view.face;
    if (face === "both" || wire.layer === "jumper" || wire.bridgeType === "jumper" || wire.bridgeType === "insulated") return true;
    return wire.layer === face || !!this.store.state.view.showBack; // opposite side can stay visible as ghost
  }

  wireIsGhost(wire) {
    const face = this.store.state.view.face;
    if (wire.layer === "jumper" || wire.bridgeType === "jumper" || wire.bridgeType === "insulated") return false;
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
    wire.route.forEach((point, index) => {
      const p = Geometry.gridToSvg(board, point);
      group.append(svgEl("circle", { class: "wire-handle", cx: p.x, cy: p.y, r: 5, "data-id": wire.id, "data-wire-handle": index }));
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

  isSelected(type, id) { return (this.selections || [this.selection]).some(s => s?.type === type && s.id === id); }

  drawNotes() {
    this.store.state.texts.forEach(note => {
      const p = Geometry.gridToSvg(this.store.state.board, note);
      const lines = String(note.text).split("\n");
      const size = Number(note.size) || 12;
      const group = svgEl("g", { class: "note", "data-id": note.id });
      const width = Math.max(30, Math.max(...lines.map(line => line.length)) * size * .62);
      group.append(svgEl("rect", { x: p.x - 4, y: p.y - size, width: width + 8, height: lines.length * size * 1.35 + 6, fill: "transparent", class: this.isSelected("text", note.id) ? "selected-outline" : "note-hit" }));
      const text = svgEl("text", { x: p.x, y: p.y, fill: note.color || "#e6edf3", "font-size": size });
      lines.forEach((line, i) => text.append(svgEl("tspan", { x: p.x, dy: i ? size * 1.35 : 0 }, line || " ")));
      group.append(text); this.svg.append(group);
    });
  }

  renderTransient() {
    this.svg.querySelector(".transient-layer")?.remove();
    const group = svgEl("g", { class: "transient-layer", "pointer-events": "none" });
    if (this.draftRoute.length) group.append(svgEl("path", { class: "wire jumper dashed", d: this.wirePath(this.draftRoute) }));
    if (this.hoverHole) {
      const p = Geometry.gridToSvg(this.store.state.board, this.hoverHole);
      group.append(svgEl("circle", { class: "hover-hole", cx: p.x, cy: p.y, r: 7 }));
    }
    if (this.previewComponent) {
      const preview = svgEl("g", { class: "placement-preview" });
      const labelBoxes = this.labelBoxes; this.labelBoxes = [];
      preview.append(this.renderComponent(this.previewComponent)); this.labelBoxes = labelBoxes;
      group.append(preview);
    }
    if (this.copperPreview?.axis && this.store.state.board.type === "stripboard") group.append(this.cutMark(this.copperPreview, true));
    if (this.copperPreview?.a) group.append(svgEl("path", { class: `solder-preview${adjacent(this.copperPreview.a, this.copperPreview.b) ? "" : " invalid"}`, d: this.wirePath([this.copperPreview.a, this.copperPreview.b]) }));
    this.svg.append(group);
  }

  drawFocusBanner() {
    if (this.selection?.type !== "component") return;
    const component = this.store.componentById(this.selection.id);
    if (!component) return;
    const board = this.store.state.board;
    const size = Geometry.boardPixelSize(board);
    const text = `${component.name || component.id}${component.value ? ` — ${component.value}` : ""}`;
    const lines = this.wrapText(text, 52, 2);
    const fontSize = 12;
    const w = Math.min(size.width - 28, Math.max(220, Math.max(...lines.map(line => line.length)) * 7.4 + 28));
    const h = 26 + Math.max(0, lines.length - 1) * 14;
    const x = (size.width - w) / 2;
    const y = 6;
    const group = svgEl("g", { class: "focus-banner" });
    group.append(svgEl("rect", { x, y, width: w, height: h, rx: 10 }));
    const label = svgEl("text", { x: x + w / 2, y: y + 17, "text-anchor": "middle", style: `font-size:${fontSize}px` });
    lines.forEach((line, index) => label.append(svgEl("tspan", { x: x + w / 2, dy: index ? 14 : 0 }, line)));
    group.append(label);
    this.svg.append(group);
  }
}
