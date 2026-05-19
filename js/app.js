import { $, $$, Geometry, htmlEscape, ModalService } from "./core.js";
import { ProjectStore, newState } from "./model.js";
import { BoardRenderer2D } from "./render-2d.js";
import { ProjectStorage } from "./storage.js";
import { PrintService } from "./print.js";
import { Render3DService } from "./render-3d.js";
import { ElectricalChecks } from "./checks.js";

class PerfboardEditorApp {
  constructor() {
    this.store = new ProjectStore();
    this.modal = new ModalService();
    this.renderer = new BoardRenderer2D($("#editorSvg"), this.store);
    this.storage = new ProjectStorage(this.store, message => this.setSaveState(message));
    this.printer = new PrintService(this.store, this.modal);
    this.view3d = new Render3DService(this.store, this.modal);
    this.checks = new ElectricalChecks(this.store);

    this.tool = "select";
    this.selection = null;
    this.drag = null;
    this.pan = null;
    this.wireDraft = [];
    this.zoom = 1;
    this.autosaveTimer = null;
  }

  start() {
    this.bindToolbar();
    this.bindViewControls();
    this.bindPanelControls();
    this.setupCollapsibleSections();
    this.bindBoardEvents();
    this.bindKeyboard();
    this.syncBoardForm();
    this.storage.restoreAutosave();
    this.syncBoardForm();
    this.applyTheme();
    this.render();
    this.setStatus("");
  }

  bindToolbar() {
    $("#newProjectBtn").onclick = () => this.newProject();
    $("#openProjectBtn").onclick = () => this.storage.openWithPicker($("#fallbackFileInput")).then(() => this.afterLoad()).catch(error => this.setStatus(error.message));
    $("#fallbackFileInput").onchange = event => {
      const [file] = event.target.files || [];
      if (!file) return;
      this.storage.openFile(file).then(() => this.afterLoad());
      event.target.value = "";
    };
    $("#saveProjectBtn").onclick = () => this.storage.save().catch(error => this.setStatus(error.message));
    $("#saveProjectAsBtn").onclick = () => this.storage.saveAs().catch(error => this.setStatus(error.message));
    $("#backupProjectBtn").onclick = () => this.storage.downloadBackup();
    $("#printSchematicBtn").onclick = () => this.printer.showSchematic();
    $("#printLayoutBtn").onclick = () => this.printer.showLayout();
    $("#bomBtn").onclick = () => this.printer.showBom();
    $("#view3dBtn").onclick = () => this.view3d.show();
    $("#themeBtn").onclick = () => this.toggleTheme();

    $("#layoutPrintMode").onchange = event => {
      this.store.state.view.layoutPrintMode = event.target.value;
      this.scheduleAutosave("Layout print mode changed");
    };

    $$(".tool-btn").forEach(button => {
      button.onclick = () => this.setTool(button.dataset.tool);
    });
    $$("[data-place]").forEach(button => {
      button.onclick = () => this.setTool("place", button.dataset.place);
    });

    $$(".face-btn").forEach(button => {
      button.onclick = () => this.setFace(button.dataset.face);
    });
    $("#applyBoardBtn").onclick = () => this.applyBoardForm();
    $("#zoomOutBtn").onclick = () => this.setZoom(this.zoom * 0.86);
    $("#zoomInBtn").onclick = () => this.setZoom(this.zoom * 1.16);
    $("#zoomResetBtn").onclick = () => this.setZoom(1);
    $("#runChecksBtn").onclick = () => this.runChecks();
  }


  bindViewControls() {
    const bindings = [
      ["#viewShowLabels", "showLabels"],
      ["#viewShowPinNames", "showPinNames"],
      ["#viewShowRulers", "showRulers"],
      ["#viewShowBack", "showBack"],
      ["#viewWiresOnTop", "wiresOnTop"]
    ];

    bindings.forEach(([selector, key]) => {
      const el = $(selector);
      if (!el) return;
      el.addEventListener("change", event => {
        this.store.state.view[key] = !!event.target.checked;
        this.render();
        this.scheduleAutosave(`View option changed: ${key}`);
      });
    });
  }

  syncViewControls() {
    const view = this.store.state.view || {};
    if ($("#viewShowLabels")) $("#viewShowLabels").checked = view.showLabels !== false;
    if ($("#viewShowPinNames")) $("#viewShowPinNames").checked = view.showPinNames !== false;
    if ($("#viewShowRulers")) $("#viewShowRulers").checked = view.showRulers !== false;
    if ($("#viewShowBack")) $("#viewShowBack").checked = view.showBack !== false;
    if ($("#viewWiresOnTop")) $("#viewWiresOnTop").checked = view.wiresOnTop !== false;
  }


  bindPanelControls() {
    const shell = document.querySelector(".app-shell");
    const leftPanel = document.querySelector(".left-panel");
    const rightPanel = document.querySelector(".right-panel");

    const sync = () => {
      const leftClosed = leftPanel?.classList.contains("is-collapsed");
      const rightClosed = rightPanel?.classList.contains("is-collapsed");
      shell?.classList.toggle("left-collapsed", !!leftClosed);
      shell?.classList.toggle("right-collapsed", !!rightClosed);
      const leftLabel = leftClosed ? "Left ›" : "‹ Left";
      const rightLabel = rightClosed ? "‹ Right" : "Right ›";
      $("#toggleLeftPanelBtn").textContent = leftLabel;
      $("#toggleRightPanelBtn").textContent = rightLabel;
      $("#collapseLeftPanelBtn").textContent = leftClosed ? "›" : "‹";
      $("#collapseRightPanelBtn").textContent = rightClosed ? "‹" : "›";
    };

    const toggleLeft = () => { leftPanel?.classList.toggle("is-collapsed"); sync(); };
    const toggleRight = () => { rightPanel?.classList.toggle("is-collapsed"); sync(); };

    $("#toggleLeftPanelBtn")?.addEventListener("click", toggleLeft);
    $("#collapseLeftPanelBtn")?.addEventListener("click", toggleLeft);
    $("#toggleRightPanelBtn")?.addEventListener("click", toggleRight);
    $("#collapseRightPanelBtn")?.addEventListener("click", toggleRight);
    sync();
  }

  setupCollapsibleSections() {
    $$(".panel-section").forEach((section, index) => {
      const title = section.querySelector("h2");
      if (!title || title.querySelector(".section-toggle")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "section-toggle";
      button.title = "Bu bölümü aç/kapat";
      button.textContent = "−";
      title.appendChild(button);

      const toggle = event => {
        event.preventDefault();
        event.stopPropagation();
        section.classList.toggle("is-collapsed");
        button.textContent = section.classList.contains("is-collapsed") ? "+" : "−";
      };
      button.addEventListener("click", toggle);
      title.addEventListener("click", toggle);
    });
  }

  bindBoardEvents() {
    const svg = $("#editorSvg");
    svg.addEventListener("mousemove", event => this.onPointerMove(event));
    svg.addEventListener("mousedown", event => this.onPointerDown(event));
    svg.addEventListener("dblclick", event => this.onDoubleClick(event));
    svg.addEventListener("mouseleave", () => {
      this.renderer.hoverHole = null;
      this.renderCanvasOnly();
    });
    window.addEventListener("mouseup", () => this.onPointerUp());
    svg.addEventListener("wheel", event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 0.88));
    });
  }

  bindKeyboard() {
    window.addEventListener("keydown", event => {
      if (this.isEditingText(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) this.redo(); else this.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.storage.save().catch(error => this.setStatus(error.message));
      } else if (event.key === "Escape") {
        this.cancelWireDraft();
        this.clearSelection();
      } else if (event.key === "Backspace" && this.tool === "wire" && this.wireDraft.length) {
        event.preventDefault();
        this.wireDraft.pop();
        this.updateDraftRender();
      } else if (event.key === "Delete") {
        this.deleteSelection();
      }
    });
  }

  isEditingText(target) {
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
  }

  newProject() {
    this.store.state = newState();
    this.selection = null;
    this.wireDraft = [];
    this.storage.fileHandle = null;
    this.syncBoardForm();
    this.render();
    this.scheduleAutosave("New project");
    this.setStatus("New empty project.");
  }

  afterLoad() {
    this.selection = null;
    this.wireDraft = [];
    this.syncBoardForm();
    this.applyTheme();
    this.render();
    this.scheduleAutosave("Project loaded");
  }

  setTool(tool, placingKind = null) {
    this.tool = tool;
    this.placingKind = placingKind;
    $$(".tool-btn").forEach(button => button.classList.toggle("is-active", button.dataset.tool === tool));
    const label = tool === "place" ? `Place ${placingKind}: click a hole` : `${tool} tool`;
    this.setStatus(label);
  }

  setZoom(value) {
    this.zoom = Math.max(0.25, Math.min(3.5, value));
    this.renderer.setZoom(this.zoom);
    $("#zoomText").textContent = `${Math.round(this.zoom * 100)}%`;
    this.renderCanvasOnly();
  }

  onPointerMove(event) {
    if (this.pan) {
      const workspace = document.querySelector(".workspace");
      workspace.scrollLeft = this.pan.scrollLeft - (event.clientX - this.pan.clientX);
      workspace.scrollTop = this.pan.scrollTop - (event.clientY - this.pan.clientY);
      return;
    }

    const point = this.svgEventToGrid(event);
    this.renderer.hoverHole = point;

    if (this.drag?.type === "component") {
      const component = this.store.componentById(this.drag.id);
      if (component) {
        component.col = Math.max(0, point.col - this.drag.offsetCol);
        component.row = Math.max(0, point.row - this.drag.offsetRow);
        this.render();
      }
      return;
    }

    if (this.wireDraft.length) {
      this.renderer.draftRoute = [...this.wireDraft, point];
    }
    this.renderCanvasOnly();
  }

  onPointerDown(event) {
    if (event.button === 1 || event.buttons === 4) {
      event.preventDefault();
      this.startPan(event);
      return;
    }
    if (event.button !== 0) return;

    const point = this.svgEventToGrid(event);
    if (this.tool === "place" && this.placingKind) {
      const component = this.store.addComponent(this.placingKind, point.col, point.row);
      this.select({ type: "component", id: component.id });
      this.setTool("select");
      this.scheduleAutosave("Component placed");
      return;
    }

    if (this.tool === "wire") {
      this.handleWireClick(point, event.shiftKey);
      return;
    }

    if (this.tool === "wireErase") {
      this.eraseWireNear(point);
      return;
    }

    const hit = this.hitTest(event);
    if (!hit) {
      this.clearSelection();
      return;
    }
    this.select(hit);
    if (hit.type === "component") {
      const component = this.store.componentById(hit.id);
      this.store.snapshot("Move component");
      this.drag = { type: "component", id: hit.id, offsetCol: point.col - component.col, offsetRow: point.row - component.row };
    }
  }

  onPointerUp() {
    if (this.pan) {
      this.stopPan();
      return;
    }
    if (!this.drag) return;
    this.drag = null;
    this.scheduleAutosave("Move complete");
  }

  startPan(event) {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    this.pan = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop
    };
    workspace.classList.add("is-panning");
  }

  stopPan() {
    document.querySelector(".workspace")?.classList.remove("is-panning");
    this.pan = null;
  }

  onDoubleClick(event) {
    if (this.tool !== "wire" || this.wireDraft.length < 2) return;
    event.preventDefault();
    this.finishWireDraft();
  }

  handleWireClick(point, keepRouting) {
    if (!this.wireDraft.length) {
      this.wireDraft = [point];
      this.updateDraftRender();
      this.setStatus("Wire started. Shift+click adds more bends; normal click finishes.");
      return;
    }
    this.wireDraft.push(point);
    if (keepRouting) {
      this.updateDraftRender();
      return;
    }
    this.finishWireDraft();
  }

  finishWireDraft() {
    const layer = this.store.state.view.face === "both" ? "top" : this.store.state.view.face;
    const wire = this.store.addWire(this.wireDraft, { layer, style: layer === "jumper" ? "dashed" : "solid" });
    this.wireDraft = [];
    this.renderer.draftRoute = [];
    if (wire) this.select({ type: "wire", id: wire.id });
    this.scheduleAutosave("Wire added");
  }

  cancelWireDraft() {
    this.wireDraft = [];
    this.renderer.draftRoute = [];
    this.renderCanvasOnly();
  }

  updateDraftRender() {
    this.renderer.draftRoute = [...this.wireDraft];
    this.renderCanvasOnly();
  }

  eraseWireNear(point) {
    const wire = this.store.state.wires.find(item => item.route.some(p => p.col === point.col && p.row === point.row));
    if (!wire) {
      this.setStatus("No wire segment on this hole.");
      return;
    }
    this.store.snapshot("Erase wire");
    this.store.state.wires = this.store.state.wires.filter(item => item.id !== wire.id);
    this.selection = null;
    this.scheduleAutosave("Wire erased");
    this.render();
  }

  hitTest(event) {
    const target = event.target;
    const componentGroup = target.closest?.(".component");
    if (componentGroup?.dataset.id) return { type: "component", id: componentGroup.dataset.id };
    if (target.classList?.contains("wire") && target.dataset.id) return { type: "wire", id: target.dataset.id };
    return null;
  }

  svgEventToGrid(event) {
    const svg = $("#editorSvg");
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const svgPoint = point.matrixTransform(svg.getScreenCTM().inverse());
    return Geometry.svgToGrid(this.store.state.board, svgPoint);
  }

  select(selection) {
    this.selection = selection;
    this.renderer.selection = selection;
    this.render();
  }

  clearSelection() {
    this.selection = null;
    this.renderer.selection = null;
    this.render();
  }

  deleteSelection() {
    if (this.store.deleteSelection(this.selection)) {
      this.selection = null;
      this.renderer.selection = null;
      this.scheduleAutosave("Deleted");
      this.render();
    }
  }

  undo() {
    if (this.store.undo()) {
      this.clearSelection();
      this.render();
      this.scheduleAutosave("Undo");
    }
  }

  redo() {
    if (this.store.redo()) {
      this.clearSelection();
      this.render();
      this.scheduleAutosave("Redo");
    }
  }

  syncBoardForm() {
    const board = this.store.state.board;
    $("#boardCols").value = board.cols;
    $("#boardRows").value = board.rows;
    $("#boardPitch").value = board.pitchPx;
    $("#holeDiameter").value = board.holeDiameterMm;
    $("#padDiameter").value = board.padDiameterMm;
    $("#gridUnit").value = board.gridUnit;
    $("#boardColor").value = board.color;
    $("#pthMode").checked = board.platedThroughHoles;
    this.syncFaceButtons();
    this.syncViewControls();
    $("#layoutPrintMode").value = this.store.state.view.layoutPrintMode || "auto";
  }


  setFace(face) {
    this.store.state.view.face = face;
    this.syncFaceButtons();
    this.render();
    this.scheduleAutosave("Layer changed");
  }

  syncFaceButtons() {
    const face = this.store.state.view.face || "top";
    $$(".face-btn").forEach(button => button.classList.toggle("is-active", button.dataset.face === face));
  }

  applyBoardForm() {
    this.store.snapshot("Board settings");
    const board = this.store.state.board;
    board.cols = this.numberFrom("#boardCols", board.cols, 5, 300);
    board.rows = this.numberFrom("#boardRows", board.rows, 5, 220);
    board.pitchPx = this.numberFrom("#boardPitch", board.pitchPx, 10, 42);
    board.holeDiameterMm = this.numberFrom("#holeDiameter", board.holeDiameterMm, 0.1, 3);
    board.padDiameterMm = this.numberFrom("#padDiameter", board.padDiameterMm, 0.2, 4);
    board.gridUnit = $("#gridUnit").value || "2.54mm";
    board.color = $("#boardColor").value || board.color;
    board.platedThroughHoles = $("#pthMode").checked;
    this.scheduleAutosave("Board settings applied");
    this.render();
  }

  numberFrom(selector, fallback, min, max) {
    const value = Number($(selector).value);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value * 100) / 100));
  }

  render() {
    this.applyTheme();
    this.renderer.selection = this.selection;
    this.renderer.render();
    this.renderInspector();
    this.renderLists();
  }

  renderCanvasOnly() {
    this.renderer.selection = this.selection;
    this.renderer.render();
  }

  renderInspector() {
    const host = $("#inspector");
    const pinHost = $("#pinList");

    if (!this.selection) {
      host.innerHTML = "Nothing selected.";
      if (pinHost) pinHost.innerHTML = `<div class="pin-list-empty">Select a component to edit pin names.</div>`;
      return;
    }

    if (this.selection.type === "component") {
      const component = this.store.componentById(this.selection.id);
      this.renderComponentInspector(host, component);
      this.renderSelectedPinList(pinHost, component);
      return;
    }

    if (this.selection.type === "wire") {
      this.renderWireInspector(host, this.store.wireById(this.selection.id));
      if (pinHost) pinHost.innerHTML = `<div class="pin-list-empty">Wire selected. Select a component to edit its pins.</div>`;
    }
  }

  renderComponentInspector(host, component) {
    if (!component) return;
    host.innerHTML = `<div class="inspector-form">
      <label>Name <input id="compName" value="${htmlEscape(component.name)}"></label>
      <label>Value <input id="compValue" value="${htmlEscape(component.value)}"></label>
      <label>Col <input id="compCol" type="number" value="${component.col}"></label>
      <label>Row <input id="compRow" type="number" value="${component.row}"></label>
      <label>Rotation <select id="compRot"><option>0</option><option>90</option><option>180</option><option>270</option></select></label>
      <label>Color <input id="compColor" type="color" value="${component.color || "#cbd5e1"}"></label>
      <div class="inspector-actions"><button id="applyCompBtn">Apply</button><button id="deleteSelectedBtn" class="danger">Delete</button></div>
    </div>`;
    $("#compRot").value = String(component.rot || 0);
    $("#applyCompBtn").onclick = () => {
      this.store.snapshot("Edit component");
      component.name = $("#compName").value;
      component.value = $("#compValue").value;
      component.col = Number($("#compCol").value) || 0;
      component.row = Number($("#compRow").value) || 0;
      component.rot = Number($("#compRot").value) || 0;
      component.color = $("#compColor").value;
      this.scheduleAutosave("Component edited");
      this.render();
    };
    $("#deleteSelectedBtn").onclick = () => this.deleteSelection();
  }

  renderSelectedPinList(host, component) {
    if (!host) return;
    if (!component) {
      host.innerHTML = `<div class="pin-list-empty">Selected component was not found.</div>`;
      return;
    }

    const connections = this.buildPinConnectionSummary();
    const pins = this.store.pinsFor(component);
    const rows = pins.map(pin => {
      const key = `${component.id}|${pin.pinIndex}`;
      const info = connections.get(key);
      const netText = info ? Array.from(info.nets).join(", ") : "not connected";
      const statusClass = info ? "is-connected" : "";
      const statusText = info ? "connected" : "open";
      return `
        <div class="pin-edit-row ${statusClass}">
          <input class="pin-no-box" value="${htmlEscape(pin.pin.number ?? pin.pinIndex + 1)}" readonly title="Pin number">
          <input class="pin-name-box" data-pin-index="${pin.pinIndex}" value="${htmlEscape(pin.pin.name || "")}" placeholder="Pin name">
          <span class="pin-hole">${pin.col + 1},${pin.row + 1}</span>
          <span class="pin-net" title="${htmlEscape(netText)}">${htmlEscape(netText)}</span>
          <span class="pin-status">${statusText}</span>
        </div>`;
    }).join("");

    host.innerHTML = `
      <div class="pin-edit-head">
        <span>No</span><span>Name</span><span>Hole</span><span>Net</span><span>Status</span>
      </div>
      <div class="pin-edit-list">${rows || `<div class="pin-list-empty">This component has no pins.</div>`}</div>
      <div class="pin-edit-actions">
        <button id="addPinBtn">Add pin</button>
        <button id="removePinBtn">Remove last pin</button>
      </div>
    `;

    host.querySelectorAll("input[data-pin-index]").forEach(input => {
      input.onchange = () => {
        this.store.snapshot("Edit pin name");
        const pin = component.pins[Number(input.dataset.pinIndex)];
        if (pin) pin.name = input.value;
        this.scheduleAutosave("Pin name edited");
        this.render();
      };
    });

    host.querySelector("#addPinBtn")?.addEventListener("click", () => {
      this.store.snapshot("Add pin");
      const number = component.pins.length + 1;
      component.pins.push({ number, name: `P${number}`, x: Math.max(0, number - 1), y: 0 });
      this.scheduleAutosave("Pin added");
      this.render();
    });

    host.querySelector("#removePinBtn")?.addEventListener("click", () => {
      if (!component.pins.length) return;
      this.store.snapshot("Remove pin");
      component.pins.pop();
      this.scheduleAutosave("Pin removed");
      this.render();
    });
  }

  buildPinConnectionSummary() {
    const pinsByHole = new Map();
    this.store.allPins().forEach(pin => {
      const holeKey = `${pin.col},${pin.row}`;
      if (!pinsByHole.has(holeKey)) pinsByHole.set(holeKey, []);
      pinsByHole.get(holeKey).push(pin);
    });

    const summaries = new Map();
    this.store.state.wires.forEach(wire => {
      (wire.route || []).forEach(point => {
        const pins = pinsByHole.get(`${point.col},${point.row}`) || [];
        pins.forEach(pin => {
          const key = `${pin.component.id}|${pin.pinIndex}`;
          if (!summaries.has(key)) summaries.set(key, { nets: new Set(), wires: new Set() });
          summaries.get(key).nets.add(wire.net || wire.name || wire.id || "NET");
          summaries.get(key).wires.add(wire.id);
        });
      });
    });
    return summaries;
  }

  renderWireInspector(host, wire) {
    if (!wire) return;
    host.innerHTML = `<div class="inspector-form">
      <label>Name <input id="wireName" value="${htmlEscape(wire.name)}"></label>
      <label>Net <input id="wireNet" value="${htmlEscape(wire.net)}"></label>
      <label>Layer <select id="wireLayer"><option value="top">top</option><option value="bottom">bottom</option><option value="jumper">jumper</option></select></label>
      <label>Style <select id="wireStyle"><option value="solid">solid</option><option value="dashed">dashed</option></select></label>
      <label>Color <input id="wireColor" type="color" value="${wire.color || (wire.layer === "bottom" ? "#5fa7ff" : "#d6a11e")}"></label>
      <div class="inspector-actions"><button id="applyWireBtn">Apply</button><button id="deleteSelectedBtn" class="danger">Delete</button></div>
    </div>`;
    $("#wireLayer").value = wire.layer;
    $("#wireStyle").value = wire.style;
    $("#applyWireBtn").onclick = () => {
      this.store.snapshot("Edit wire");
      wire.name = $("#wireName").value;
      wire.net = $("#wireNet").value;
      wire.layer = $("#wireLayer").value;
      wire.style = $("#wireStyle").value;
      wire.color = $("#wireColor").value;
      this.scheduleAutosave("Wire edited");
      this.render();
    };
    $("#deleteSelectedBtn").onclick = () => this.deleteSelection();
  }

  renderLists() {
    const components = this.store.state.components.map(component => `<button class="object-row" data-list-type="component" data-id="${component.id}"><span><b>${htmlEscape(component.name || component.id)}</b><small>${htmlEscape(component.kind)} @ ${component.col + 1},${component.row + 1}</small></span></button>`).join("");
    const wires = this.store.state.wires.map(wire => `<button class="object-row" data-list-type="wire" data-id="${wire.id}"><span><b>${htmlEscape(wire.net || wire.id)}</b><small>${htmlEscape(wire.layer)} • ${htmlEscape(wire.style)} • ${wire.route.length} pts</small></span></button>`).join("");
    $("#componentList").innerHTML = components || `<div class="check-results">No components.</div>`;
    $("#wireList").innerHTML = wires || `<div class="check-results">No wires.</div>`;
    $$(`[data-list-type]`).forEach(button => {
      button.onclick = () => this.select({ type: button.dataset.listType, id: button.dataset.id });
    });
  }

  runChecks() {
    const problems = this.checks.run();
    const host = $("#checkResults");
    if (!problems.length) {
      host.innerHTML = `<b>OK</b> — obvious shorts/floating pins not found.`;
      return;
    }
    host.innerHTML = problems.slice(0, 80).map(problem => `<div><b>${htmlEscape(problem.type)}</b>: ${htmlEscape(problem.message)}</div>`).join("");
  }

  toggleTheme() {
    this.store.state.view.theme = this.store.state.view.theme === "dark" ? "light" : "dark";
    this.scheduleAutosave("Theme changed");
    this.render();
  }

  applyTheme() {
    document.body.classList.toggle("light", this.store.state.view.theme === "light");
  }

  scheduleAutosave(reason) {
    this.setSaveState(`${reason} • dirty`);
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.storage.autosave(), 500);
  }

  setStatus(message) {
    const status = $("#statusBar");
    status.textContent = message || "";
    status.classList.toggle("is-empty", !message);
  }

  setSaveState(message) {
    $("#saveState").textContent = message;
  }
}

const app = new PerfboardEditorApp();
app.start();
window.perfboardEditor = app;
