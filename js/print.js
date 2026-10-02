import { Geometry, htmlEscape, netKind, round } from "./core.js";
import { downloadFile } from "./storage.js";
import { assemblySteps, coordinateText } from "./assembly.js";
import { analyzeNetworks } from "./networks.js";
import { LayoutDrawing, layoutPrintCss, printSize, PRINT_PITCH, rowLabel, printReferences } from "./layout-print.js";

export class PrintService {
  constructor(store, modal) {
    this.store = store;
    this.modal = modal;
    this.layoutOptions = { values: false, pinNames: false, otherFace: true, key: true, monochrome: false };
  }

  preview(title, documentHtml, controls = "") {
    this.modal.open(title, `
      <div class="print-actions">
        <button id="openPrintWindowBtn">Open printable window</button>
        <button id="printNowBtn">Print</button>
      </div>
      ${controls}
      <iframe id="printPreviewFrame" class="print-preview-frame" title="Print preview"></iframe>
    `, () => document.querySelector(".modal-card")?.classList.remove("modal-print"));
    document.querySelector(".modal-card").classList.add("modal-print");
    const frame = document.querySelector("#printPreviewFrame");
    const buttons = [document.querySelector("#printNowBtn"), document.querySelector("#openPrintWindowBtn")];
    const loading = () => buttons.forEach(button => { button.disabled = true; });
    frame.onload = () => { frame.contentDocument?.body.classList.add("embedded-preview"); buttons.forEach(button => { button.disabled = false; }); };
    loading();
    frame.srcdoc = documentHtml;
    document.querySelector("#openPrintWindowBtn").onclick = () => this.openWindow(documentHtml);
    document.querySelector("#printNowBtn").onclick = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    };
    return html => { loading(); documentHtml = html; frame.srcdoc = html; };
  }

  openWindow(html) {
    const win = window.open("", "_blank", "width=1280,height=920");
    if (!win) { this.modal.body.insertAdjacentHTML("beforeend", `<p role="alert">The print window was blocked. Allow pop-ups or use the Print button.</p>`); return null; }
    win.opener = null;
    win.document.open();
    win.document.write(html);
    win.document.close();
    return win;
  }

  showSchematic() {
    this.preview("Print Connection Sketch", this.buildSchematicDocument());
  }

  showLayout() {
    this.previewMode = this.store.state.view.layoutPrintMode || "auto";
    const controls = `<div class="layout-print-options" aria-label="Layout print settings"><label>Pages <select id="previewLayoutMode"><option value="auto">Automatic</option><option value="two-up">Side by side</option><option value="separate">Separate pages</option></select></label>${["values", "pinNames", "otherFace", "key", "monochrome"].map(key => `<label><input type="checkbox" data-layout-print="${key}" ${this.layoutOptions[key] ? "checked" : ""}>${({ values: "Values", pinNames: "Pin names", otherFace: "Other-face outlines", key: "Parts & notes key", monochrome: "Black & white" })[key]}</label>`).join("")}<span id="layoutPrintSummary" aria-live="polite"></span></div>`;
    const update = this.preview("Print Layout", this.buildLayoutDocument(), controls);
    document.querySelector("#previewLayoutMode").value = this.previewMode;
    const refresh = () => {
      update(this.buildLayoutDocument());
      document.querySelector("#layoutPrintSummary").textContent = `${this.layoutSeparate() ? "2 drawing pages" : "1 drawing page"}${this.layoutOptions.key ? " + parts key" : ""} · Fit to page`;
    };
    document.querySelector("#previewLayoutMode").onchange = event => { this.previewMode = event.target.value; refresh(); };
    document.querySelectorAll("[data-layout-print]").forEach(input => { input.onchange = () => { this.layoutOptions[input.dataset.layoutPrint] = input.checked; refresh(); }; });
    document.querySelector("#layoutPrintSummary").textContent = `${this.layoutSeparate() ? "2 drawing pages" : "1 drawing page"}${this.layoutOptions.key ? " + parts key" : ""} · Fit to page`;
  }

  showBom() {
    this.preview("Print BOM", this.buildBomDocument());
  }

  showAssembly() { this.preview("Assembly worksheet", this.buildAssemblyDocument()); }

  buildAssemblyDocument() {
    const state = this.store.state, notebook = state.notebook, steps = assemblySteps(state);
    const open = analyzeNetworks(this.store).guides.length;
    const rows = steps.map(step => `<tr><td>☐</td><td>${htmlEscape(step.label)}</td><td>${step.kind}</td><td>${coordinateText(step.from)}</td><td>${coordinateText(step.to)}</td><td>${step.side}${step.active ? "" : " (inactive)"}</td></tr>`).join("");
    const tasks = notebook.tasks.map(task => `<li>${task.done ? "☑" : "☐"} ${htmlEscape(task.text)}</li>`).join("");
    return this.documentShell("Assembly worksheet", `<section class="page table-page"><div class="print-head"><div><h1>${htmlEscape(state.name)}</h1><div class="print-sub">ASSEMBLY WORKSHEET · ${state.board.type} · ${state.board.cols} × ${state.board.rows} holes · ${state.components.length} parts</div></div><div class="print-sub">${open} missing planned connections<br>${new Date().toLocaleString()}</div></div><p class="print-sub">Positions below are column, row in the TOP view, counted from 1. On the mirrored bottom layout, column 1 is on the right. Check inactive operations before assembly.</p><h2>Copper work</h2><table><thead><tr><th>Done</th><th>ID</th><th>Operation</th><th>From (column, row)</th><th>To (column, row)</th><th>Face</th></tr></thead><tbody>${rows || `<tr><td colspan="6">No cuts or solder bridges</td></tr>`}</tbody></table><h2>Checklist</h2><ul class="assembly-print-list">${tasks || "<li>No checklist steps</li>"}</ul><h2>Project notes</h2><pre class="assembly-print-notes">${htmlEscape(notebook.notes || "No project notes")}</pre></section>`);
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
      .copper-strip{fill:none;stroke:#bca47c;stroke-linecap:round;opacity:.55}.copper-cut{fill:none;stroke:#a22;stroke-width:2}.solder-bridge{fill:none;stroke:#555;stroke-width:5;stroke-linecap:round}.assembly-print-list{list-style:none;padding:0;font-size:12px;line-height:1.8}.assembly-print-notes{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace}h2{font-size:15px;margin-top:7mm}
      @media print{body{background:#fff}.toolbar{display:none}.page{width:auto;height:auto;margin:0;border:0;box-shadow:none;padding:0;break-after:page}}
      ${layoutPrintCss()}
      .embedded-preview>.toolbar{display:none}.monochrome-page .layout-legend-symbols svg path{stroke:#333}.monochrome-page .layout-legend-symbols svg rect{stroke:#333}
      .layout-page{width:min(297mm,calc(100% - 24px));height:auto;aspect-ratio:297/210;padding:8mm;grid-template-rows:auto minmax(0,1fr) auto;gap:4mm;border-color:#d8dee2;box-shadow:0 3px 14px #283b4610}
      .layout-head{align-items:center;gap:20px}.layout-head h1{font-size:17px;letter-spacing:0;line-height:1.3;color:#172f3d;margin:3px 0 4px;overflow-wrap:anywhere}.layout-eyebrow{font-size:9px;letter-spacing:1.6px;font-weight:700;color:#637984}.layout-head .print-sub{font-size:10px;color:#657982}
      .layout-spec{display:grid;gap:4px;text-align:right;white-space:nowrap;color:#536873;font-size:10px}.layout-spec strong{font-size:13px;color:#253e4c}
      .layout-figure{border:1px solid #ccd5da;border-radius:5px;grid-template-rows:auto minmax(0,1fr)}.layout-figure figcaption{padding:9px 12px;background:#f6f8f9;border-color:#dbe2e6;display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;color:#314e5e}.layout-figure figcaption strong{font-size:11px;letter-spacing:.4px}.layout-figure figcaption span{font-size:9px;color:#657b86;font-weight:400}
      .layout-legend{border-top:1px solid #dce3e7;padding-top:9px;color:#5c707b}.layout-legend-symbols{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:9px}.layout-legend-symbols>span{display:flex;align-items:center;gap:4px;white-space:nowrap}.layout-legend-symbols svg{width:24px;height:13px;flex:none}.layout-footnote{font-size:8px;line-height:1.6;margin-top:5px}
      .layout-key-page{width:min(297mm,calc(100% - 24px));min-height:210mm;padding:8mm;border-color:#d8dee2;box-shadow:0 3px 14px #283b4610}.layout-key-table{font-size:10px;table-layout:fixed;color:#334b58;line-height:1.4}.layout-key-table th,.layout-key-table td{border:0;border-bottom:1px solid #e0e6e9;padding:4px 7px;overflow-wrap:anywhere}.layout-key-table th{background:#f3f6f7;color:#506873;font-size:9px}.layout-key-table tr{break-inside:avoid}.layout-key-table th:nth-child(1){width:10%}.layout-key-table th:nth-child(2){width:26%}.layout-key-table th:nth-child(3){width:30%}.layout-key-table th:nth-child(4){width:7%}.layout-key-table th:nth-child(5){width:10%}.layout-key-table th:nth-child(6){width:7%}.layout-key-table th:nth-child(7){width:10%}.layout-key-table small{display:block;color:#7a8d97;font-size:8px;margin-top:2px}.layout-key-table td:nth-child(2) small{display:inline;margin:0 0 0 5px}.layout-key-note{padding:10px 0;border-bottom:1px solid #e0e6e9;font-size:11px}.layout-key-note pre{font:11px/1.6 Arial,Helvetica,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0}.layout-notes-title{font-size:12px;margin:18px 0 3px}
      @media screen and (max-width:750px){.layout-page{min-height:500px;aspect-ratio:auto;padding:14px;gap:12px}.layout-head h1{font-size:13px}.layout-head .print-sub,.layout-spec{font-size:8px}.layout-eyebrow{font-size:8px}.layout-spec strong{font-size:10px}.layout-head{gap:10px}.layout-page>.print-figure{min-height:320px}.layout-page>.figure-grid{min-height:320px}.layout-figure figcaption{padding:6px}.layout-figure figcaption strong{font-size:9px}.layout-figure figcaption span{font-size:8px}.layout-key-page{padding:14px;min-height:0}.layout-key-table{font-size:9px}}
      @media print{.layout-page{width:281mm;height:194mm;aspect-ratio:auto;padding:0;margin:0;border:0;border-radius:0;box-shadow:none;break-inside:avoid;break-after:page}.page.layout-key-page{width:281mm;min-height:0;height:auto;padding:0;margin:0;border:0;box-shadow:none}.layout-drawing,.layout-legend{-webkit-print-color-adjust:exact;print-color-adjust:exact}.layout-key-table thead{display:table-header-group}.page:last-child{break-after:auto}}
    </style>`;
  }

  layoutSeparate() {
    const mode = this.previewMode || this.store.state.view.layoutPrintMode || "auto";
    return mode === "separate" || (mode === "auto" && !this.boardFitsTwoUp());
  }

  buildLayoutDocument() {
    const separate = this.layoutSeparate();
    const top = this.layoutFigure("top"), bottom = this.layoutFigure("bottom");
    const head = this.layoutHeader(separate ? "Separate faces" : "Both faces");
    const footer = this.layoutLegend();
    const toolbar = `<div class="toolbar"><button onclick="window.print()">Print</button> <button onclick="window.close()">Close</button></div>`;
    const pages = separate
      ? `<section class="page layout-page${this.layoutOptions.monochrome ? " monochrome-page" : ""}">${head}${top}${footer}</section><section class="page layout-page${this.layoutOptions.monochrome ? " monochrome-page" : ""}">${head}${bottom}${footer}</section>`
      : `<section class="page layout-page${this.layoutOptions.monochrome ? " monochrome-page" : ""}">${head}<div class="figure-grid">${top}${bottom}</div>${footer}</section>`;
    return this.documentShell("Board layout · " + this.store.state.name, `${toolbar}${pages}${this.layoutOptions.key ? this.buildLayoutKeyPages() : ""}`);
  }

  layoutFigure(face) {
    const bottom = face === "bottom", state = this.store.state;
    const count = state.components.filter(c => (c.side || "top") === face).length;
    const wires = state.wires.filter(w => (w.layer === "jumper" ? "top" : w.layer) === face).length;
    return `<figure class="print-figure layout-figure"><figcaption><strong>${bottom ? "BOTTOM · solder side" : "TOP · component side"}</strong><span>${count} mounted parts · ${wires} wires · Column 1 on the ${bottom ? "right" : "left"}${bottom ? " · Mirrored" : ""}</span></figcaption>${this.buildBoardLayoutSvg(face)}</figure>`;
  }

  layoutHeader(pageMode) {
    const state = this.store.state, board = state.board, pitch = parseFloat(board.gridUnit) || 2.54;
    return `<div class="print-head layout-head"><div><div class="layout-eyebrow">BOARD LAYOUT / ASSEMBLY GUIDE</div><h1>${htmlEscape(state.name)}</h1><div class="print-sub">${board.type === "stripboard" ? `Stripboard · ${board.stripDirection || "horizontal"} copper` : "Perfboard"} · ${state.components.length} parts · ${pageMode}</div></div><div class="layout-spec"><strong>${board.cols} × ${board.rows} holes</strong><span>${round(board.cols * pitch, 1)} × ${round(board.rows * pitch, 1)} mm · ${htmlEscape(board.gridUnit)} pitch</span><span>Fit to page · Dimensions are board dimensions</span></div></div>`;
  }

  layoutLegend() {
    const board = this.store.state.board;
    return `<footer class="layout-legend"><div class="layout-legend-symbols"><span><svg viewBox="0 0 34 14" aria-hidden="true"><path d="M2 7H32" stroke="#235b79" stroke-width="2"/></svg>Bare wire</span><span><svg viewBox="0 0 34 14" aria-hidden="true"><path d="M2 7H32" stroke="#76518b" stroke-width="2" stroke-dasharray="6 4"/></svg>Insulated / jumper</span><span><svg viewBox="0 0 16 14" aria-hidden="true"><rect x="4" y="3" width="8" height="8" fill="white" stroke="#243943" stroke-width="1.5"/></svg>First pin</span><span><svg viewBox="0 0 16 14" aria-hidden="true"><path d="M4 3L12 11M4 11L12 3" stroke="#a1372e" stroke-width="2"/></svg>Cut</span><span><svg viewBox="0 0 22 14" aria-hidden="true"><path d="M4 7H18" stroke="#535f66" stroke-width="5" stroke-linecap="round"/></svg>Solder bridge</span><span>Dashed outline = part on opposite face</span></div><div class="layout-footnote">${board.coordinateMode === "numbersTopLettersSide" ? "Rows: A = 1, B = 2 … AA = 27." : "Columns and rows count from 1."} Filled dots mark wire ends or physical junctions. Crossings of insulated wires do not connect.${this.layoutOptions.key ? " Full component names, values and N-numbered board notes are in the parts key." : " References identify parts in the project."}</div></footer>`;
  }

  boardFitsTwoUp() {
    const size = printSize(this.store.state.board);
    // Keep the shortest reference text near 7 pt on paper instead of deciding
    // by hole counts that can squeeze a dense board into unreadable diagrams.
    const font = 11.5, scale = Math.min(500 / size.width, 550 / size.height);
    return scale * font >= 9;
  }

  buildBoardLayoutSvg(face) { return new LayoutDrawing(this.store, face, this.layoutOptions).build(); }

  buildLayoutKeyPages() {
    const state = this.store.state, refs = printReferences(state.components), chunks = [];
    const components = [...state.components].sort((a, b) => refs.get(a.id).localeCompare(refs.get(b.id), undefined, { numeric: true }));
    for (let i = 0; i < components.length; i += 22) chunks.push(components.slice(i, i + 22));
    const position = p => `${p.col + 1}, ${p.row + 1}${state.board.coordinateMode === "numbersTopLettersSide" ? ` (${rowLabel(p.row, state.board.coordinateMode)})` : ""}`;
    const notes = state.texts || [];
    const notesHtml = notes.length ? `<h2 class="layout-notes-title">Board notes · Coordinates from the top view</h2>${notes.map((note, i) => `<article class="layout-key-note"><strong>N${i + 1} · ${position(note)}</strong><pre>${htmlEscape(note.text)}</pre></article>`).join("")}` : "";
    let pages = chunks.map((chunk, index) => {
      const rows = chunk.map(c => { const first = this.store.pinsFor(c)[0]; return `<tr data-key-id="${htmlEscape(c.id)}"><td><strong>${htmlEscape(refs.get(c.id))}</strong>${refs.get(c.id) !== c.id ? `<small>Project ID: ${htmlEscape(c.id)}</small>` : ""}</td><td>${htmlEscape(c.name || c.id)}<small>${htmlEscape(c.kind)}</small></td><td>${htmlEscape(c.value || "—")}</td><td>${c.side || "top"}</td><td>${position(c)}</td><td>${c.rot || 0}°</td><td>${first ? position(first) : "—"}</td></tr>`; }).join("");
      return `<section class="page table-page layout-key-page"><div class="print-head layout-head"><div><div class="layout-eyebrow">PARTS KEY · ${index + 1} / ${chunks.length}</div><h1>${htmlEscape(state.name)}</h1><p class="print-sub">Refs match both drawings. Positions are column, row in the TOP view, counted from 1. The square pad marks the first listed pin on multi-pin parts. Body outlines are indicative.</p></div></div><table class="layout-key-table"><thead><tr><th>Ref</th><th>Component / package</th><th>Value / description</th><th>Mount</th><th>Anchor<br>(column, row)</th><th>Rotation</th><th>First pin<br>(column, row)</th></tr></thead><tbody>${rows}</tbody></table>${index === chunks.length - 1 ? notesHtml : ""}</section>`;
    }).join("");
    if (!chunks.length && notes.length) pages += `<section class="page table-page layout-key-page"><div class="print-head layout-head"><h1>${htmlEscape(state.name)}</h1></div>${notesHtml}</section>`;
    return pages;
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
      <section class="page"><div class="print-head"><div><h1>CONNECTION SKETCH</h1><div class="print-sub">Symbol view projected from real component positions, so parts do not float away from the board logic.</div></div><div class="print-sub">${new Date().toLocaleString("tr-TR")}</div></div><figure class="print-figure"><figcaption>Schematic / connection sketch</figcaption>${svg}</figure></section>
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

  downloadBomCsv() {
    const groups = new Map();
    this.store.state.components.forEach(c => {
      const key = `${c.kind}|${c.value || ""}`;
      if (!groups.has(key)) groups.set(key, { qty: 0, kind: c.kind, value: c.value || "", refs: [] });
      const g = groups.get(key); g.qty++; g.refs.push(c.name || c.id);
    });
    const cell = value => {
      let text = String(value); if (/^[=+@-]/.test(text)) text = "'" + text;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [["Quantity", "Kind", "Value", "References"], ...[...groups.values()].map(g => [g.qty, g.kind, g.value, g.refs.join(", ")])];
    downloadFile("perfboard-bom.csv", "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
  }

  downloadSvg() {
    const face = this.store.state.view.face === "bottom" ? "bottom" : "top";
    let svg = this.buildBoardLayoutSvg(face);
    const board = this.store.state.board, pitch = parseFloat(board.gridUnit) || 2.54;
    const size = printSize(board);
    const width = size.width / PRINT_PITCH * pitch, height = size.height / PRINT_PITCH * pitch;
    svg = svg.replace("<svg ", `<svg width="${width}mm" height="${height}mm" `).replace(/(<svg[^>]*>)/, `$1${this.printCss()}`);
    downloadFile(`perfboard-${face}.svg`, svg, "image/svg+xml");
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
