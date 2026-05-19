import { Geometry, htmlEscape, netKind, round } from "./core.js";

export class PrintService {
  constructor(store, modal) {
    this.store = store;
    this.modal = modal;
  }

  preview(title, documentHtml) {
    this.modal.open(title, `
      <div class="print-actions">
        <button id="openPrintWindowBtn">Open printable window</button>
        <button id="printNowBtn">Print</button>
      </div>
      <iframe id="printPreviewFrame" class="print-preview-frame" title="Print preview"></iframe>
    `);
    const frame = document.querySelector("#printPreviewFrame");
    frame.srcdoc = documentHtml;
    document.querySelector("#openPrintWindowBtn").onclick = () => this.openWindow(documentHtml);
    document.querySelector("#printNowBtn").onclick = () => {
      const win = this.openWindow(documentHtml);
      if (win) win.addEventListener("load", () => setTimeout(() => win.print(), 120));
    };
  }

  openWindow(html) {
    const win = window.open("", "_blank", "noopener,noreferrer,width=1280,height=920");
    if (!win) return null;
    win.document.open();
    win.document.write(html);
    win.document.close();
    return win;
  }

  showSchematic() {
    this.preview("Print Schematic", this.buildSchematicDocument());
  }

  showLayout() {
    this.preview("Print Layout", this.buildLayoutDocument());
  }

  showBom() {
    this.preview("Print BOM", this.buildBomDocument());
  }

  documentShell(title, bodyHtml) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>${this.printCss()}</head><body>${bodyHtml}</body></html>`;
  }

  printCss() {
    return `<style>
      @page { size: A4 landscape; margin: 8mm; }
      *{box-sizing:border-box}
      body{margin:0;background:#e9edf3;color:#111;font-family:Arial,Helvetica,sans-serif}
      button{font:inherit;padding:6px 10px}.toolbar{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #bbb;padding:8px}
      .page{width:calc(297mm - 16mm);height:calc(210mm - 16mm);margin:12px auto;padding:8mm;background:#fff;border:1px solid #bbb;box-shadow:0 8px 24px rgba(0,0,0,.12);break-after:page;display:grid;grid-template-rows:auto minmax(0,1fr);gap:4mm}
      .page.table-page{display:block;height:auto;min-height:calc(210mm - 16mm)}
      .print-head{display:flex;justify-content:space-between;gap:12mm;align-items:flex-start}.print-head h1{margin:0;font-size:17px;letter-spacing:.05em}.print-sub{font-size:9px;color:#555;line-height:1.35}
      .figure-grid{height:100%;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:6mm}.figure-grid.single{grid-template-columns:1fr}
      .print-figure{min-height:0;margin:0;border:1px solid #222;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}.print-figure figcaption{font-size:10px;font-weight:700;padding:3px 5px;border-bottom:1px solid #222;background:#f5f5f5}.print-figure svg{width:100%;height:100%;display:block}
      table{border-collapse:collapse;width:100%;font-size:8px;margin-top:3mm}th,td{border:1px solid #999;padding:2px 4px;text-align:left;vertical-align:top}th{background:#f2f2f2}
      .wire{fill:none;stroke:#111;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.wire.dashed{stroke-dasharray:7 5}.wire.bottom{stroke:#444;stroke-dasharray:3 4}.wire.jumper{stroke:#111;stroke-dasharray:8 5}
      .board-outline{fill:#fff;stroke:#111;stroke-width:1.2}.hole-mark{fill:none;stroke:#777;stroke-width:.45}.part-body{fill:#fff;stroke:#111;stroke-width:1.15}.component-pin{fill:none;stroke:#111;stroke-width:.9}.pin{font-size:5.7px;fill:#333}.label{font-size:7.6px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:2px;fill:#111}.net-label{font-size:7px;fill:#111;font-weight:700}
      .schem-wire{fill:none;stroke:#111;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round}.schem-wire.dashed{stroke-dasharray:7 5}.schem-pin{fill:none;stroke:#111;stroke-width:1}.symbol{fill:none;stroke:#111;stroke-width:1.25}.component-box{fill:#fff;stroke:#111;stroke-width:1.25}.small-text{font-size:6.5px;fill:#333}
      @media print{body{background:#fff}.toolbar{display:none}.page{width:auto;height:auto;margin:0;border:0;box-shadow:none;padding:0;break-after:page}}
    </style>`;
  }

  buildLayoutDocument() {
    const mode = this.store.state.view.layoutPrintMode || "auto";
    const separate = mode === "separate" || (mode === "auto" && !this.boardFitsTwoUp());
    const topSvg = this.buildBoardLayoutSvg("top");
    const bottomSvg = this.buildBoardLayoutSvg("bottom");
    const head = this.layoutHeader(separate ? "2 pages" : "side by side");
    const toolbar = `<div class="toolbar"><button onclick="window.print()">Print</button> <button onclick="window.close()">Close</button></div>`;
    let pages;
    if (separate) {
      pages = `
        <section class="page">${head}<figure class="print-figure"><figcaption>Top / Front — full page</figcaption>${topSvg}</figure></section>
        <section class="page">${head}<figure class="print-figure"><figcaption>Bottom / Rear mirrored — full page</figcaption>${bottomSvg}</figure></section>`;
    } else {
      pages = `<section class="page">${head}<div class="figure-grid"><figure class="print-figure"><figcaption>Top / Front</figcaption>${topSvg}</figure><figure class="print-figure"><figcaption>Bottom / Rear mirrored</figcaption>${bottomSvg}</figure></div></section>`;
    }
    return this.documentShell("Perfboard Layout Print", `${toolbar}${pages}`);
  }

  layoutHeader(pageMode) {
    const board = this.store.state.board;
    return `<div class="print-head"><div><h1>BOARD LAYOUT</h1><div class="print-sub">Parts placement + ${board.cols}×${board.rows} perfboard holes. Bottom view is mirrored for solder-side checking.</div></div><div class="print-sub">${htmlEscape(board.gridUnit)} pitch<br>${pageMode}<br>${new Date().toLocaleString("tr-TR")}</div></div>`;
  }

  boardFitsTwoUp() {
    const board = this.store.state.board;
    return board.cols <= 90 && board.rows <= 64;
  }

  buildBoardLayoutSvg(face) {
    const board = this.store.state.board;
    const size = Geometry.boardPixelSize(board);
    const mirror = face === "bottom";
    const xTransform = mirror ? `translate(${size.width} 0) scale(-1 1)` : "";
    const boardX = board.margin - board.pitchPx / 2;
    const boardY = board.margin - board.pitchPx / 2;
    const boardW = (board.cols - 1) * board.pitchPx + board.pitchPx;
    const boardH = (board.rows - 1) * board.pitchPx + board.pitchPx;

    let holes = "";
    const markR = Math.max(1.1, Math.min(2.6, board.pitchPx * 0.085));
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const p = Geometry.gridToSvg(board, { col, row });
        holes += `<path class="hole-mark" d="M${round(p.x - markR, 1)} ${round(p.y, 1)}H${round(p.x + markR, 1)}M${round(p.x, 1)} ${round(p.y - markR, 1)}V${round(p.y + markR, 1)}"/>`;
      }
    }

    const wires = this.store.state.wires
      .filter(wire => wire.layer === face || wire.layer === "jumper")
      .map(wire => `<path class="wire ${wire.layer} ${wire.style === "dashed" || wire.layer === "jumper" ? "dashed" : ""}" d="${this.routePath(wire.route, board)}"/>`).join("");

    const components = this.store.state.components.map(component => this.layoutComponentSvg(component, board)).join("");
    return `<svg viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g transform="${xTransform}"><rect class="board-outline" x="${boardX}" y="${boardY}" width="${boardW}" height="${boardH}"/>${holes}<g>${wires}</g><g>${components}</g></g></svg>`;
  }

  layoutComponentSvg(component, board) {
    const pins = (component.pins || []).map(pin => ({ ...Geometry.pinAbsolute(component, pin), pin })).map(pin => ({ ...pin, svg: Geometry.gridToSvg(board, pin) }));
    if (!pins.length) return "";
    if (this.isCompactSmdFootprint(component, pins)) return this.layoutSmdComponentSvg(component, pins, board);
    const xs = pins.map(pin => pin.svg.x), ys = pins.map(pin => pin.svg.y);
    const pad = Math.max(6, board.pitchPx * 0.28);
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const pinMark = Math.max(2, board.pitchPx * 0.12);
    const pinSvg = pins.map(pin => `<path class="component-pin" d="M${round(pin.svg.x - pinMark, 1)} ${round(pin.svg.y, 1)}H${round(pin.svg.x + pinMark, 1)}M${round(pin.svg.x, 1)} ${round(pin.svg.y - pinMark, 1)}V${round(pin.svg.y + pinMark, 1)}"/><text class="pin" x="${round(pin.svg.x + pinMark + 1.5, 1)}" y="${round(pin.svg.y - pinMark - 1.5, 1)}">${htmlEscape(pin.pin.name)}</text>`).join("");
    const text = `${component.name || component.id}${component.value ? " " + component.value : ""}`;
    return `<rect class="part-body" x="${round(x, 1)}" y="${round(y, 1)}" width="${round(w, 1)}" height="${round(h, 1)}" rx="3"/>${pinSvg}<text class="label" x="${round(x + w / 2, 1)}" y="${round(y - 4, 1)}" text-anchor="middle">${htmlEscape(text)}</text>`;
  }

  isCompactSmdFootprint(component, pins) {
    if (!pins || pins.length !== 2) return false;
    if (String(component.kind || "").startsWith("smd")) return true;
    const compactKind = ["resistor", "capacitor", "electrolytic", "led", "crystal"].includes(component.kind);
    const dx = Math.abs((pins[1].col || 0) - (pins[0].col || 0));
    const dy = Math.abs((pins[1].row || 0) - (pins[0].row || 0));
    return compactKind && Math.max(dx, dy) <= 1;
  }

  layoutSmdComponentSvg(component, pins, board) {
    const [a, b] = pins;
    const mid = { x: (a.svg.x + b.svg.x) / 2, y: (a.svg.y + b.svg.y) / 2 };
    const dx = b.svg.x - a.svg.x;
    const dy = b.svg.y - a.svg.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const bodyW = Math.max(8, Math.min(len * 0.58, 18));
    const bodyH = Math.max(7, board.pitchPx * 0.36);
    const terminalW = Math.max(2.2, board.pitchPx * 0.12);
    const pinMark = Math.max(2, board.pitchPx * 0.11);
    const text = `${component.name || component.id}${component.value ? " " + component.value : ""}`;
    const pinSvg = pins.map(pin => `<path class="component-pin" d="M${round(pin.svg.x - pinMark, 1)} ${round(pin.svg.y, 1)}H${round(pin.svg.x + pinMark, 1)}M${round(pin.svg.x, 1)} ${round(pin.svg.y - pinMark, 1)}V${round(pin.svg.y + pinMark, 1)}"/>`).join("");
    return `<g transform="translate(${round(mid.x, 1)} ${round(mid.y, 1)}) rotate(${round(angle, 1)})"><line class="symbol" x1="${round(-len/2, 1)}" y1="0" x2="${round(len/2, 1)}" y2="0"/><rect class="part-body" x="${round(-bodyW/2, 1)}" y="${round(-bodyH/2, 1)}" width="${round(bodyW, 1)}" height="${round(bodyH, 1)}" rx="2"/><path class="component-pin" d="M${round(-len/2, 1)} ${round(-bodyH/2, 1)}v${round(bodyH, 1)}M${round(len/2, 1)} ${round(-bodyH/2, 1)}v${round(bodyH, 1)}"/></g>${pinSvg}<text class="label" x="${round(mid.x, 1)}" y="${round(mid.y - bodyH - 4, 1)}" text-anchor="middle">${htmlEscape(text)}</text>`;
  }

  routePath(route, board) {
    return (route || []).map((point, index) => {
      const p = Geometry.gridToSvg(board, point);
      return `${index ? "L" : "M"}${round(p.x, 1)} ${round(p.y, 1)}`;
    }).join(" ");
  }

  buildSchematicDocument() {
    const svg = this.buildSchematicSvg();
    const table = this.connectionsTable();
    const toolbar = `<div class="toolbar"><button onclick="window.print()">Print</button> <button onclick="window.close()">Close</button></div>`;
    const body = `${toolbar}
      <section class="page"><div class="print-head"><div><h1>SCHEMATIC</h1><div class="print-sub">Symbol view projected from real component positions, so parts do not float away from the board logic.</div></div><div class="print-sub">${new Date().toLocaleString("tr-TR")}</div></div><figure class="print-figure"><figcaption>Schematic / connection sketch</figcaption>${svg}</figure></section>
      <section class="page table-page"><div class="print-head"><div><h1>CONNECTION TABLE</h1><div class="print-sub">Net list exported from the same project model.</div></div></div>${table}</section>`;
    return this.documentShell("Perfboard Schematic Print", body);
  }

  buildSchematicSvg() {
    const width = 1600;
    const height = 1040;
    const project = this.makeSchematicProjector(width, height);
    const model = this.schematicModel(project);
    const wires = this.store.state.wires.map(wire => this.schematicWireSvg(wire, model.pinPositions, project)).join("");
    const components = model.components.map(item => this.schematicComponentSvg(item)).join("");
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>${wires}${components}</svg>`;
  }

  makeSchematicProjector(width, height) {
    const board = this.store.state.board;
    const margin = 72;
    const sx = (width - margin * 2) / Math.max(1, board.cols - 1);
    const sy = (height - margin * 2) / Math.max(1, board.rows - 1);
    const scale = Math.min(sx, sy);
    const usedW = (board.cols - 1) * scale;
    const usedH = (board.rows - 1) * scale;
    const ox = (width - usedW) / 2;
    const oy = (height - usedH) / 2;
    return point => ({ x: ox + point.col * scale, y: oy + point.row * scale });
  }

  schematicModel(project) {
    const components = [];
    const pinPositions = new Map();
    this.store.state.components.forEach(component => {
      const pins = (component.pins || []).map((pin, pinIndex) => {
        const abs = Geometry.pinAbsolute(component, pin);
        const p = project(abs);
        const item = { ...p, component, pin, pinIndex, col: abs.col, row: abs.row };
        pinPositions.set(`${component.id}|${pinIndex}`, item);
        return item;
      });
      components.push({ component, pins });
    });
    return { components, pinPositions };
  }

  schematicComponentSvg(item) {
    if (!item.pins.length) return "";
    const title = `${item.component.name || item.component.id}${item.component.value ? " " + item.component.value : ""}`;
    if (item.pins.length <= 2) return this.twoPinSchematicSvg(item, title);
    const xs = item.pins.map(pin => pin.x), ys = item.pins.map(pin => pin.y);
    const pad = 18;
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const pins = item.pins.map(pin => `<circle class="schem-pin" cx="${round(pin.x, 1)}" cy="${round(pin.y, 1)}" r="3"/><text class="pin" x="${round(pin.x + 5, 1)}" y="${round(pin.y - 5, 1)}">${htmlEscape(pin.pin.name || pin.pin.number)}</text>`).join("");
    return `<g><rect class="component-box" x="${round(x, 1)}" y="${round(y, 1)}" width="${round(w, 1)}" height="${round(h, 1)}" rx="6"/><text class="label" x="${round(x + w / 2, 1)}" y="${round(y + h / 2, 1)}" text-anchor="middle">${htmlEscape(title)}</text>${pins}</g>`;
  }

  twoPinSchematicSvg(item, title) {
    const [a, b = item.pins[0]] = item.pins;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const bodyW = 28, bodyH = 14;
    const p = (along, off) => ({ x: mid.x + ux * along + px * off, y: mid.y + uy * along + py * off });
    const c1 = p(-bodyW / 2, -bodyH / 2), c2 = p(bodyW / 2, -bodyH / 2), c3 = p(bodyW / 2, bodyH / 2), c4 = p(-bodyW / 2, bodyH / 2);
    const body = `M${round(c1.x, 1)} ${round(c1.y, 1)}L${round(c2.x, 1)} ${round(c2.y, 1)}L${round(c3.x, 1)} ${round(c3.y, 1)}L${round(c4.x, 1)} ${round(c4.y, 1)}Z`;
    return `<g><line class="symbol" x1="${round(a.x, 1)}" y1="${round(a.y, 1)}" x2="${round(b.x, 1)}" y2="${round(b.y, 1)}"/><path class="component-box" d="${body}"/><circle class="schem-pin" cx="${round(a.x, 1)}" cy="${round(a.y, 1)}" r="3"/><circle class="schem-pin" cx="${round(b.x, 1)}" cy="${round(b.y, 1)}" r="3"/><text class="label" x="${round(mid.x, 1)}" y="${round(mid.y - 15, 1)}" text-anchor="middle">${htmlEscape(title)}</text></g>`;
  }

  schematicWireSvg(wire, pinPositions, project) {
    if (!wire.route || wire.route.length < 2) return "";
    const path = wire.route.map((point, index) => {
      const p = project(point);
      return `${index ? "L" : "M"}${round(p.x, 1)} ${round(p.y, 1)}`;
    }).join(" ");
    const last = project(wire.route[Math.floor(wire.route.length / 2)]);
    const dashed = wire.style === "dashed" || wire.layer === "jumper" ? "dashed" : "";
    const kind = netKind(wire.net);
    return `<path class="schem-wire ${dashed}" d="${path}"/><text class="net-label" x="${round(last.x + 5, 1)}" y="${round(last.y - 5, 1)}">${htmlEscape(wire.net || wire.id)}${kind !== "signal" ? ` (${kind})` : ""}</text>`;
  }

  connectionsTable() {
    const rows = this.store.state.wires.map((wire, index) => `<tr><td>${index + 1}</td><td>${htmlEscape(wire.net || wire.id)}</td><td>${htmlEscape(wire.layer)}</td><td>${htmlEscape(wire.style)}</td><td>${htmlEscape((wire.route || []).map(p => `${p.col + 1},${p.row + 1}`).join(" → "))}</td></tr>`).join("");
    return `<table><thead><tr><th>#</th><th>Net</th><th>Layer</th><th>Style</th><th>Route</th></tr></thead><tbody>${rows || "<tr><td colspan='5'>No wires</td></tr>"}</tbody></table>`;
  }

  buildBomDocument() {
    const toolbar = `<div class="toolbar"><button onclick="window.print()">Print</button> <button onclick="window.close()">Close</button></div>`;
    const rows = this.store.state.components.map((component, index) => {
      const pins = (component.pins || []).map(pin => pin.name || pin.number).join(", ");
      return `<tr><td>${index + 1}</td><td>${htmlEscape(component.name || component.id)}</td><td>${htmlEscape(component.kind)}</td><td>${htmlEscape(component.value || "")}</td><td>${component.col + 1},${component.row + 1}</td><td>${component.rot || 0}°</td><td>${htmlEscape(pins)}</td></tr>`;
    }).join("");
    const summary = this.bomSummaryTable();
    const body = `${toolbar}<section class="page table-page"><div class="print-head"><div><h1>BILL OF MATERIALS</h1><div class="print-sub">Component list exported from the project model.</div></div><div class="print-sub">${new Date().toLocaleString("tr-TR")}</div></div>${summary}<table><thead><tr><th>#</th><th>Ref</th><th>Kind</th><th>Value</th><th>Position</th><th>Rotation</th><th>Pins</th></tr></thead><tbody>${rows || "<tr><td colspan='7'>No components</td></tr>"}</tbody></table></section>`;
    return this.documentShell("Perfboard BOM Print", body);
  }

  bomSummaryTable() {
    const groups = new Map();
    this.store.state.components.forEach(component => {
      const key = `${component.kind}|${component.value || ""}`;
      if (!groups.has(key)) groups.set(key, { kind: component.kind, value: component.value || "", qty: 0, refs: [] });
      const group = groups.get(key);
      group.qty += 1;
      group.refs.push(component.name || component.id);
    });
    const rows = Array.from(groups.values()).map(group => `<tr><td>${group.qty}</td><td>${htmlEscape(group.kind)}</td><td>${htmlEscape(group.value)}</td><td>${htmlEscape(group.refs.join(", "))}</td></tr>`).join("");
    return `<table><thead><tr><th>Qty</th><th>Kind</th><th>Value</th><th>Refs</th></tr></thead><tbody>${rows || "<tr><td colspan='4'>No components</td></tr>"}</tbody></table>`;
  }
}
