import { $, $$, Geometry, clone, htmlEscape, ModalService } from "./core.js";
import { ProjectStore } from "./model.js";
import { BoardRenderer2D } from "./render-2d.js";
import { ProjectStorage } from "./storage.js";
import { PrintService } from "./print.js";
import { Render3DService } from "./render-3d.js";
import { ElectricalChecks } from "./checks.js";
import { EditorPanels } from "./panels.js";
import { componentIcon } from "./catalog.js";
import { buildConnectivity, holeKey, routeContains, segmentContains, isInsulated } from "./connectivity.js";
import { analyzeNetworks } from "./networks.js";
import { nearestCut, pinContactSide, cutEnds } from "./copper.js";

class PerfboardEditorApp {
  constructor() {
    this.store = new ProjectStore();
    this.modal = new ModalService();
    this.renderer = new BoardRenderer2D($("#editorSvg"), this.store);
    this.storage = new ProjectStorage(this.store, message => this.setSaveState(message));
    this.printer = new PrintService(this.store, this.modal);
    this.view3d = new Render3DService(this.store, this.modal);
    this.checks = new ElectricalChecks(this.store);

    this.panels = new EditorPanels(this);
    this.selections = [];
    this.placementRotation = 0;
    this.keepConnections = true;
    this.spaceHeld = false;
    this.tool = "select";
    this.selection = null;
    this.drag = null;
    this.pan = null;
    this.wireDraft = [];
    this.bridgeStart = null;
    this.routingNet = null;
    this.customPlacingTemplate = null;
    this.zoom = 1;
    this.viewOnlyFullscreen = false;
    this.viewportUiRaf = 0;
    this.minimapCollapsed = false;
    this.workspaceResizeObserver = null;
    this.autosaveTimer = null;
  }

  start() {
    this.bindToolbar();
    this.bindViewControls();
    this.bindPanelControls();
    this.panels.bind();
    this.bindBoardEvents();
    this.bindContextMenu();
    this.bindKeyboard();
    this.syncBoardForm();
    this.storage.restoreAutosave();
    this.syncBoardForm();
    this.applyTheme();
    this.renderPalette();
    this.render();
    requestAnimationFrame(() => this.centerBoard({ fit: true, instant: true, silent: true }));
    this.setStatus("");
  }

  bindToolbar() {
    $("#newProjectBtn").onclick = () => this.newProject();
    $("#openProjectBtn").onclick = () => this.storage.openWithPicker($("#fallbackFileInput")).then(loaded => { if (loaded) this.afterLoad(); }).catch(error => this.reportError(error));
    $("#fallbackFileInput").onchange = event => {
      const [file] = event.target.files || [];
      if (!file) return;
      this.storage.openFile(file).then(() => this.afterLoad()).catch(error => this.reportError(error));
      event.target.value = "";
    };
    $("#saveProjectBtn").onclick = () => this.storage.save().catch(error => this.reportError(error));
    $("#saveProjectAsBtn").onclick = () => this.storage.saveAs().catch(error => this.reportError(error));
    $("#backupProjectBtn").onclick = () => this.storage.downloadBackup();
    $("#undoBtn").onclick = () => this.undo();
    $("#redoBtn").onclick = () => this.redo();
    $("#printSchematicBtn").onclick = () => this.printer.showSchematic();
    $("#printLayoutBtn").onclick = () => this.printer.showLayout();
    $("#bomBtn").onclick = () => this.printer.showBom();
    $("#view3dBtn").onclick = () => this.view3d.show().catch(error => this.reportError(error));
    $("#themeBtn").onclick = () => this.toggleTheme();

    $("#layoutPrintMode").onchange = event => {
      this.store.state.view.layoutPrintMode = event.target.value;
      this.scheduleAutosave("Layout print mode changed");
    };

    $$(".tool-btn").forEach(button => {
      button.onclick = () => this.setTool(button.dataset.tool);
    });
    document.querySelector(".palette-list")?.addEventListener("click", event => this.onPaletteClick(event));
    $("#customComponentBtn")?.addEventListener("click", () => this.openCustomDesigner());

    $$(".face-btn").forEach(button => {
      button.onclick = () => this.setFace(button.dataset.face);
    });
    $("#applyBoardBtn").onclick = () => this.applyBoardForm();
    $("#boardType").onchange = () => {
      const strip = $("#boardType").value === "stripboard";
      $("#stripDirectionField").hidden = !strip;
      $("#pthMode").checked = !strip;
    };
    $("#zoomOutBtn").onclick = () => this.setZoom(this.zoom * 0.86);
    $("#zoomInBtn").onclick = () => this.setZoom(this.zoom * 1.16);
    $("#zoomResetBtn").onclick = () => this.setZoom(1);
    $("#centerBoardBtn").onclick = () => this.centerBoard({ fit: true });
    $("#fullscreenViewBtn")?.addEventListener("click", () => this.enterFullscreenViewOnly());
    $("#miniMapToggleBtn")?.addEventListener("click", event => this.toggleMiniMap(event));
    document.addEventListener("fullscreenchange", () => this.onFullscreenChange());
    $("#runChecksBtn").onclick = () => this.runChecks();
  }

  onPaletteClick(event) {
    const button = event.target.closest?.("button");
    if (!button || button.id === "customComponentBtn") return;
    if (button.dataset.place) {
      this.customPlacingTemplate = null;
      this.setTool("place", button.dataset.place);
      this.panels.closeDrawers();
      return;
    }
    if (button.dataset.templateIndex) {
      const template = this.store.state.customTemplates?.[Number(button.dataset.templateIndex)];
      if (!template) return;
      this.customPlacingTemplate = template;
      this.setTool("placeCustom");
      this.panels.closeDrawers();
    }
  }


  bindViewControls() {
    const bindings = [
      ["#viewShowLabels", "showLabels"],
      ["#viewShowPinNames", "showPinNames"],
      ["#viewShowRulers", "showRulers"],
      ["#viewShowBack", "showBack"],
      ["#viewWiresOnTop", "wiresOnTop"],
      ["#viewShowGuides", "showGuides"]
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
    $("#viewShowGuides").checked = view.showGuides !== false;
  }


  bindPanelControls() { this.panels.bindPanels(); }

  bindBoardEvents() {
    const svg = $("#editorSvg");
    const workspace = document.querySelector(".workspace");
    svg.addEventListener("pointermove", event => { if (!this.drag && !this.pan) this.onPointerMove(event); });
    svg.addEventListener("pointerdown", event => this.onPointerDown(event));
    svg.addEventListener("auxclick", event => {
      if (event.button === 1) event.preventDefault();
    });
    svg.addEventListener("dblclick", event => this.onDoubleClick(event));
    svg.addEventListener("mouseleave", () => {
      if (this.viewOnlyFullscreen) return;
      this.renderer.hoverHole = null;
      this.renderer.previewComponent = null;
      this.renderer.copperPreview = null;
      this.renderer.renderTransient();
    });
    window.addEventListener("pointermove", event => { if (this.pan || this.drag) this.onPointerMove(event); });
    window.addEventListener("pointerup", () => this.onPointerUp());
    window.addEventListener("pointercancel", () => this.onPointerUp());
    window.addEventListener("blur", () => { this.spaceHeld = false; this.onPointerUp(); });
    workspace?.addEventListener("pointerdown", event => {
      if (event.target.closest?.(".workspace-toolbar,.workspace-subbar,.workspace-footer,.context-menu,.mini-map")) return;
      if (event.target.closest?.("#editorSvg")) return;
      if (this.viewOnlyFullscreen || this.spaceHeld || event.button === 1 || event.buttons === 4) {
        event.preventDefault();
        this.startPan(event);
      }
    });
    workspace?.addEventListener("wheel", event => {
      if (event.target.closest?.(".workspace-toolbar,.workspace-subbar,.workspace-footer,.context-menu,.mini-map,#editorSvg")) return;
      const shouldZoom = this.viewOnlyFullscreen || event.ctrlKey || event.metaKey;
      if (!shouldZoom) return;
      event.preventDefault();
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 0.88), { x: event.clientX, y: event.clientY });
    }, { passive: false });
    workspace?.addEventListener("scroll", () => this.requestViewportUiUpdate(), { passive: true });
    window.addEventListener("resize", () => this.requestViewportUiUpdate());
    if (window.ResizeObserver && workspace) {
      this.workspaceResizeObserver = new ResizeObserver(() => this.requestViewportUiUpdate());
      this.workspaceResizeObserver.observe(workspace);
    }
    svg.addEventListener("wheel", event => {
      const shouldZoom = this.viewOnlyFullscreen || event.ctrlKey || event.metaKey;
      if (!shouldZoom) return;
      event.preventDefault();
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 0.88), { x: event.clientX, y: event.clientY });
    }, { passive: false });
  }

  bindContextMenu() {
    const svg = $("#editorSvg");
    const menu = $("#contextMenu");
    svg?.addEventListener("contextmenu", event => this.openContextMenu(event));
    menu?.addEventListener("click", event => {
      const button = event.target.closest?.("button[data-action]");
      if (!button) return;
      this.handleContextAction(button.dataset.action);
      this.hideContextMenu();
    });
    window.addEventListener("click", event => {
      if (!event.target.closest?.("#contextMenu")) this.hideContextMenu();
    });
    window.addEventListener("blur", () => this.hideContextMenu());
  }

  openContextMenu(event) {
    if (this.viewOnlyFullscreen) return;
    event.preventDefault();
    event.stopPropagation();
    const hit = this.hitTest(event);
    if (hit) this.select(hit); else this.clearSelection();
    const menu = $("#contextMenu");
    if (!menu) return;
    const component = hit?.type === "component" ? this.store.componentById(hit.id) : null;
    const wire = hit?.type === "wire" ? this.store.wireById(hit.id) : null;
    const items = [];
    if (component) {
      items.push(["rotate", "Rotate 90°"]);
      items.push(["duplicate", "Duplicate"]);
      items.push(["delete", "Delete"]);
    } else if (wire) {
      items.push(["wireJumper", wire.bridgeType === "jumper" ? "Make normal wire" : "Make jumper"]);
      items.push(["wireInsulated", wire.bridgeType === "insulated" ? "Remove insulated" : "Make insulated"]);
      items.push(["delete", "Delete"]);
    } else {
      items.push(["center", "Center board"]);
      if (this.wireDraft.length) items.push(["cancelWire", "Cancel wire draft"]);
    }
    menu.innerHTML = items.map(([action, label]) => `<button type="button" data-action="${action}">${htmlEscape(label)}</button>`).join("");
    menu.classList.remove("hidden");
    const rect = menu.getBoundingClientRect();
    const x = Math.min(event.clientX, window.innerWidth - rect.width - 8);
    const y = Math.min(event.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
  }

  hideContextMenu() {
    const menu = $("#contextMenu");
    if (!menu) return;
    menu.classList.add("hidden");
  }

  handleContextAction(action) {
    if (action === "center") return this.centerBoard();
    if (action === "cancelWire") return this.cancelWireDraft();
    if (action === "delete") return this.deleteSelection();
    if (action === "rotate") return this.rotateSelectedComponent();
    if (action === "duplicate") return this.duplicateSelectedComponent();
    if (action === "wireJumper") return this.toggleSelectedWireBridge("jumper");
    if (action === "wireInsulated") return this.toggleSelectedWireBridge("insulated");
  }

  rotateSelectedComponent() {
    if (this.selections.length > 1) { this.setStatus("Select one component to rotate. Groups can be moved or duplicated together."); return; }
    if (this.selection?.type !== "component") return;
    const component = this.store.componentById(this.selection.id), before = clone(component), next = clone(component);
    next.rot = (next.rot + 90) % 360;
    try { this.store.fitComponent(next); } catch (error) { this.reportError(error); return; }
    this.store.snapshot("Rotate component"); Object.assign(component, next);
    this.followPinChanges(before, component); this.scheduleAutosave("Component rotated"); this.render();
  }

  duplicateSelectedComponent() {
    if (!this.selections.length) return;
    const copies = this.selections.map(selection => ({ selection, item: clone(this.selectedObject(selection)) }));
    const points = copies.flatMap(({ selection, item }) => this.objectPoints(selection, item));
    const dx = Math.max(...points.map(p => p.col)) + 1 < this.store.state.board.cols ? 1 : 0;
    const dy = Math.max(...points.map(p => p.row)) + 1 < this.store.state.board.rows ? 1 : 0;
    this.store.snapshot("Duplicate selection"); const selected = [];
    copies.forEach(({ selection, item }) => {
      const key = selection.type === "component" ? "components" : selection.type === "wire" ? "wires" : "texts";
      item.id = this.store.ids.next(selection.type === "component" ? this.store.components.prefixFor(item.kind) : selection.type === "wire" ? "W" : "T");
      if (selection.type === "wire") { item.route = item.route.map(p => ({ col: p.col + dx, row: p.row + dy })); item.name = item.id; }
      else { item.col += dx; item.row += dy; if (selection.type === "component") item.name = item.id; }
      this.store.state[key].push(item); selected.push({ type: selection.type, id: item.id });
    });
    this.selections = selected; this.selection = selected[selected.length - 1]; this.scheduleAutosave("Selection duplicated"); this.render();
  }

  toggleSelectedWireBridge(type) {
    if (this.selection?.type !== "wire") return;
    const wire = this.store.wireById(this.selection.id);
    if (!wire) return;
    this.store.snapshot("Wire bridge mode");
    if (wire.bridgeType === type) {
      wire.bridgeType = "normal";
      if (wire.layer === "jumper") wire.layer = this.store.state.view.face === "bottom" ? "bottom" : "top";
      wire.style = "solid";
    } else {
      wire.bridgeType = type;
      if (type === "jumper") wire.layer = "jumper";
      wire.style = type === "normal" ? "solid" : "dashed";
    }
    this.scheduleAutosave("Wire bridge mode changed");
    this.render();
  }

  bindKeyboard() {
    window.addEventListener("keyup", event => { if (event.code === "Space") this.spaceHeld = false; });
    window.addEventListener("keydown", event => {
      if (this.modal.isOpen || this.isEditingText(event.target)) return;
      const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (this.viewOnlyFullscreen) return;
      if (event.code === "Space") { event.preventDefault(); this.spaceHeld = true; return; }
      if (mod && key === "s") { event.preventDefault(); this.storage.save().catch(e => this.reportError(e)); }
      else if (mod && key === "z") { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
      else if (mod && key === "y") { event.preventDefault(); this.redo(); }
      else if (mod && key === "d") { event.preventDefault(); this.duplicateSelectedComponent(); }
      else if (mod && key === "n") { event.preventDefault(); this.newProject(); }
      else if (event.key === "Escape") { this.cancelWireDraft(); this.clearSelection(); this.hideContextMenu(); this.setTool("select"); this.panels.closeDrawers(); }
      else if (event.key === "Backspace" && this.tool === "wire" && this.wireDraft.length) { event.preventDefault(); this.wireDraft.pop(); this.updateDraftRender(); }
      else if (event.key === "Delete") { event.preventDefault(); this.deleteSelection(); }
      else if (!mod && key === "r") {
        if (["place", "placeCustom"].includes(this.tool)) { this.placementRotation = (this.placementRotation + 90) % 360; this.updatePlacementPreview(this.renderer.hoverHole); }
        else this.rotateSelectedComponent();
      } else if (!mod && ["v", "w", "e", "t", "c", "b"].includes(key)) this.setTool(({ v: "select", w: "wire", e: "wireErase", t: "text", c: "cut", b: "solder" })[key]);
      else if (!mod && key === "f") { event.preventDefault(); this.centerBoard({ fit: true }); }
      else if (!mod && key === "/") { event.preventDefault(); this.panels.setPage("library"); const panel = $(".left-panel"); if (innerWidth <= 700) panel.classList.add("is-open"); else { panel.classList.remove("is-collapsed"); $(".app-shell").classList.remove("left-collapsed"); } $("#paletteSearch").focus(); }
    });
  }

  isEditingText(target) {
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
  }

  newProject() {
    try { this.storage.archiveCurrent(); } catch (error) { this.reportError(error); return; }
    clearTimeout(this.autosaveTimer);
    this.store.resetProject(); this.storage.fileHandle = null; this.storage.savedContent = JSON.stringify(this.store.state);
    this.afterLoad(); this.setStatus("New board. Previous work is available in Project → Recover.");
  }

  afterLoad() {
    this.selection = null; this.selections = []; this.drag = null; this.wireDraft = []; this.customPlacingTemplate = null;
    this.renderer.draftRoute = []; this.renderer.previewComponent = null;
    this.renderer.activeNet = null;
    this.setTool("select"); this.syncBoardForm(); this.applyTheme(); this.render();
    $("#projectName").value = this.store.state.name;
    $("#checkResults").textContent = "Check routes, net names and unconnected pins.";
    requestAnimationFrame(() => this.centerBoard({ fit: true, instant: true, silent: true }));
    this.scheduleAutosave("Project loaded");
  }

  setTool(tool, placingKind = null) {
    if (tool === "cut" && this.store.state.board.type !== "stripboard") {
      this.panels.setPage("board");
      if (innerWidth <= 700) $(".left-panel").classList.add("is-open");
      else { $(".left-panel").classList.remove("is-collapsed"); $(".app-shell").classList.remove("left-collapsed"); }
      this.setStatus("Choose Stripboard in Board settings, then apply it to use copper cuts.");
      $(".copper-menu").open = false; this.panels.syncPanelButtons(); return;
    }
    if (tool !== this.tool) { this.wireDraft = []; this.renderer.draftRoute = []; this.bridgeStart = null; this.routingNet = null; }
    this.renderer.copperPreview = null;
    this.tool = tool;
    this.placingKind = placingKind;
    this.placementRotation = 0;
    this.renderer.previewComponent = null;
    $$(".tool-btn").forEach(button => button.classList.toggle("is-active", button.dataset.tool === tool));
    $$(".palette-list button[data-place]").forEach(button => button.classList.toggle("is-active", tool === "place" && button.dataset.place === placingKind));
    $$(".custom-template-palette button[data-template-index]").forEach(button => {
      const index = Number(button.dataset.templateIndex);
      button.classList.toggle("is-active", tool === "placeCustom" && this.store.state.customTemplates?.[index] === this.customPlacingTemplate);
    });
    const label = tool === "cut" ? "Click between pads to cut / restore a copper strip · Esc finish"
      : tool === "solder" ? "Click two neighboring holes to add / remove a solder bridge · Esc finish"
      : tool === "placeCustom"
      ? `Place ${this.customPlacingTemplate?.name || "custom component"}: click a hole`
      : (tool === "place" ? `Place ${placingKind}: click a hole` : `${tool} tool`);
    this.setStatus(label);
    $("#activeToolBadge").textContent = tool === "place" ? placingKind : tool === "placeCustom" ? "Custom part" : ({ select: "Select", wire: "Draw wire", wireErase: "Erase", text: "Add note", cut: "Cut strip", solder: "Solder bridge" })[tool];
    $(".copper-menu").open = false;
    if (tool === "cut" && this.store.state.view.face !== "bottom") this.setFace("bottom");
    this.renderer.renderTransient();
  }

  renderPalette() { this.panels.renderPalette(); }

  componentIcon(kind) { return componentIcon(kind); }

  setZoom(value, anchor = null) {
    const workspace = $(".workspace"), rect = workspace.getBoundingClientRect();
    const client = anchor || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const point = this.svgPointFromClient(client.x, client.y);
    this.zoom = Math.max(0.25, Math.min(3.5, value));
    this.renderer.setZoom(this.zoom); $("#zoomText").textContent = `${Math.round(this.zoom * 100)}%`;
    this.renderCanvasOnly(); this.applyCanvasCentering();
    if (point) { workspace.scrollLeft = this.svgMargin("left") + point.x * this.zoom - (client.x - rect.left); workspace.scrollTop = this.svgMargin("top") + point.y * this.zoom - (client.y - rect.top); }
    this.requestViewportUiUpdate();
  }

  centerBoard(options = {}) {
    const workspace = document.querySelector(".workspace");
    const svg = $("#editorSvg");
    if (!workspace || !svg) return;

    if (options.fit !== false) {
      const size = Geometry.boardPixelSize(this.store.state.board);
      const availableW = Math.max(120, workspace.clientWidth - 72);
      const availableH = Math.max(120, workspace.clientHeight - 180);
      const fitZoom = Math.min(3.5, Math.max(0.25, Math.min(availableW / size.width, availableH / size.height)));
      this.setZoom(fitZoom);
    }

    requestAnimationFrame(() => {
      this.applyCanvasCentering();
      const board = this.store.state.board;
      const boardCenter = Geometry.gridToSvg(board, { col: (board.cols - 1) / 2, row: (board.rows - 1) / 2 });
      const targetLeft = Math.max(0, this.svgMargin("left") + boardCenter.x * this.zoom - workspace.clientWidth / 2);
      const targetTop = Math.max(0, this.svgMargin("top") + boardCenter.y * this.zoom - workspace.clientHeight / 2);
      workspace.scrollTo({ left: targetLeft, top: targetTop, behavior: options.instant ? "auto" : "smooth" });
      requestAnimationFrame(() => this.updateViewportUi());
      if (!options.silent) this.setStatus("Board fit and centered.");
    });
  }

  svgMargin(side) {
    const svg = $("#editorSvg");
    if (!svg) return 0;
    const value = Number.parseFloat(svg.style[`margin${side[0].toUpperCase()}${side.slice(1)}`] || "0");
    return Number.isFinite(value) ? value : 0;
  }

  applyCanvasCentering() {
    const workspace = document.querySelector(".workspace");
    const svg = $("#editorSvg");
    if (!workspace || !svg) return;
    // Keep real scrollable room around the board so middle-button panning works
    // even after a fit-to-screen center operation or in fullscreen view mode.
    const panRoomX = Math.floor(Math.max(420, workspace.clientWidth * 0.72));
    const panRoomY = Math.floor(Math.max(360, workspace.clientHeight * 0.72));
    const mx = Math.max(panRoomX, Math.floor((workspace.clientWidth - svg.clientWidth) / 2));
    const my = Math.max(panRoomY, Math.floor((workspace.clientHeight - svg.clientHeight) / 2));
    svg.style.marginLeft = `${mx}px`;
    svg.style.marginRight = `${mx}px`;
    svg.style.marginTop = `${my}px`;
    svg.style.marginBottom = `${my}px`;
  }

  async enterFullscreenViewOnly() {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    this.viewOnlyFullscreen = true;
    workspace.classList.add("view-only-fullscreen");
    this.clearSelection();
    try {
      if (workspace.requestFullscreen && !document.fullscreenElement) await workspace.requestFullscreen();
    } catch (error) {
      this.viewOnlyFullscreen = false; workspace.classList.remove("view-only-fullscreen");
      this.setStatus(`Fullscreen unavailable: ${error.message || error}`);
    }
    this.centerBoard({ fit: true, instant: true, silent: true });
  }

  onFullscreenChange() {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    const active = document.fullscreenElement === workspace;
    this.viewOnlyFullscreen = active;
    workspace.classList.toggle("view-only-fullscreen", active);
    if (!active) this.applyCanvasCentering();
    requestAnimationFrame(() => this.updateViewportUi());
  }

  onPointerMove(event) {
    if (this.pan) {
      const workspace = $(".workspace");
      workspace.scrollLeft = this.pan.scrollLeft - (event.clientX - this.pan.clientX);
      workspace.scrollTop = this.pan.scrollTop - (event.clientY - this.pan.clientY);
      this.requestViewportUiUpdate(); return;
    }
    if (this.viewOnlyFullscreen) return;
    const point = this.svgEventToGrid(event);
    $("#cursorCoordinates").textContent = `${point.col + 1}, ${point.row + 1}`;
    if (this.drag) {
      if (this.drag.type === "wireHandle") {
        const wire = this.store.wireById(this.drag.id), old = wire.route[this.drag.index];
        if (old.col === point.col && old.row === point.row) return;
        if (!this.drag.changed) this.store.snapshot("Move wire point");
        this.drag.changed = true; wire.route[this.drag.index] = point;
      } else {
        let dx = point.col - this.drag.start.col, dy = point.row - this.drag.start.row;
        const bounds = this.drag.bounds, board = this.store.state.board;
        dx = Math.max(-bounds.minCol, Math.min(board.cols - 1 - bounds.maxCol, dx));
        dy = Math.max(-bounds.minRow, Math.min(board.rows - 1 - bounds.maxRow, dy));
        if (dx === this.drag.dx && dy === this.drag.dy) return;
        if (!this.drag.changed) this.store.snapshot(this.selections.length > 1 ? "Move selection" : "Move object");
        this.drag.changed = true; this.drag.dx = dx; this.drag.dy = dy;
        this.drag.items.forEach(({ selection, original }) => {
          const item = this.selectedObject(selection);
          if (selection.type === "wire") item.route = original.route.map(p => ({ col: p.col + dx, row: p.row + dy }));
          else { item.col = original.col + dx; item.row = original.row + dy; }
        });
        if (this.keepConnections) this.drag.attached.forEach(({ wire, route, keys }) => {
          wire.route = route.map((p, i) => keys.has(holeKey(p)) && (!isInsulated(wire) || i === 0 || i === route.length - 1) ? { col: p.col + dx, row: p.row + dy } : { ...p });
        });
      }
      this.renderCanvasOnly(); return;
    }
    if (this.tool === "cut") {
      this.renderer.copperPreview = nearestCut(this.store.state.board, this.svgEventToGridFloat(event));
      this.renderer.renderTransient(); return;
    }
    if (this.tool === "solder") this.renderer.copperPreview = this.bridgeStart ? { a: this.bridgeStart, b: point } : null;
    if (this.tool !== "solder" && this.renderer.hoverHole?.col === point.col && this.renderer.hoverHole?.row === point.row) return;
    this.renderer.hoverHole = point;
    this.updatePlacementPreview(point);
    this.renderer.draftRoute = this.wireDraft.length ? [...this.wireDraft, point] : [];
    this.renderer.renderTransient();
  }

  onPointerDown(event) {
    if (this.viewOnlyFullscreen || this.spaceHeld || event.button === 1) { event.preventDefault(); this.startPan(event); return; }
    if (event.button !== 0) return;
    event.preventDefault(); $("#editorSvg").focus({ preventScroll: true });
    const point = this.svgEventToGrid(event);
    try {
      if (this.tool === "place" || this.tool === "placeCustom") {
        const component = this.tool === "place" ? this.store.addComponent(this.placingKind, point.col, point.row, this.placementRotation) : this.store.addComponentFromTemplate(this.customPlacingTemplate, point.col, point.row, this.placementRotation);
        this.select({ type: "component", id: component.id }); this.scheduleAutosave("Component placed");
        this.setStatus("Click to place another · R rotate · Esc finish"); this.updatePlacementPreview(point); return;
      }
      if (this.tool === "text") {
        const text = this.store.addText(point.col, point.row);
        this.setTool("select"); this.select({ type: "text", id: text.id }); this.scheduleAutosave("Note added");
        if (innerWidth <= 1100) $(".right-panel").classList.add("is-open");
        $("#noteText")?.focus(); $("#noteText")?.select(); return;
      }
      if (this.tool === "wire") { this.handleWireClick(point, event.shiftKey); return; }
      if (this.tool === "cut") {
        const added = this.store.toggleCut(nearestCut(this.store.state.board, this.svgEventToGridFloat(event)));
        this.scheduleAutosave("Copper changed"); this.render(); this.setStatus(added ? "Copper cut added. Click the same gap to restore it." : "Copper strip restored."); return;
      }
      if (this.tool === "solder") {
        if (!this.bridgeStart) { this.bridgeStart = point; this.setStatus("Now click a neighboring hole · Esc cancel"); return; }
        this.store.toggleSolderBridge(this.bridgeStart, point, this.store.state.view.face === "top" ? "top" : "bottom");
        this.bridgeStart = null; this.renderer.copperPreview = null;
        this.scheduleAutosave("Solder bridge updated"); this.render(); return;
      }
      if (this.tool === "wireErase") { this.eraseWireNear(point); return; }
      const handle = event.target.closest?.("[data-wire-handle]");
      if (handle) { this.drag = { type: "wireHandle", id: handle.dataset.id, index: Number(handle.dataset.wireHandle), changed: false }; return; }
      const hit = this.hitTest(event);
      if (!hit) { if (!event.shiftKey) this.clearSelection(); return; }
      if (event.shiftKey) { this.select(hit, true); return; }
      if (!this.selections.some(s => s.id === hit.id && s.type === hit.type)) this.select(hit);
      this.beginObjectDrag(point);
    } catch (error) { this.reportError(error); }
  }

  onPointerUp() {
    if (this.pan) this.stopPan();
    if (!this.drag) return;
    const changed = this.drag.changed;
    this.drag = null;
    if (changed) { this.scheduleAutosave("Position updated"); this.render(); }
  }

  startPan(event) {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    event.preventDefault?.();
    this.pan = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop
    };
    workspace.classList.add("is-panning");
    document.body.classList.add("is-editor-panning");
  }

  stopPan() {
    document.querySelector(".workspace")?.classList.remove("is-panning");
    document.body.classList.remove("is-editor-panning");
    this.pan = null;
    this.requestViewportUiUpdate();
  }

  onDoubleClick(event) {
    if (this.viewOnlyFullscreen) return;
    if (this.tool === "wire" && this.wireDraft.length >= 2) { event.preventDefault(); this.finishWireDraft(); return; }
    const hit = this.hitTest(event);
    if (this.tool !== "select" || hit?.type !== "wire") return;
    const wire = this.store.wireById(hit.id), point = this.svgEventToGrid(event);
    if (wire.route.some(p => p.col === point.col && p.row === point.row)) return;
    const index = wire.route.findIndex((p, i) => i && segmentContains(wire.route[i - 1], p, point));
    if (index < 1) return;
    this.store.snapshot("Add wire point"); wire.route.splice(index, 0, point); this.select(hit); this.scheduleAutosave("Wire point added");
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
    const graph = buildConnectivity(this.store);
    const touching = graph.holes.get(holeKey(this.wireDraft[0] || {})) || [];
    const pin = this.store.pinAt(this.wireDraft[0]?.col, this.wireDraft[0]?.row);
    const pinGroup = pin && graph.pinGroups.get(`${pin.component.id}|${pin.pinIndex}`);
    const net = this.routingNet || (pin && (this.store.state.board.platedThroughHoles || pinContactSide(this.store.state.board, pin) === layer) ? (pin.pin.net || [...pinGroup.nets][0]) : null) || touching.find(entry => this.store.state.board.platedThroughHoles || entry.wire.layer === layer)?.wire.net;
    const wire = this.store.addWire(this.wireDraft, { layer, net, style: layer === "jumper" ? "dashed" : "solid" });
    this.wireDraft = [];
    this.routingNet = null;
    this.renderer.draftRoute = [];
    if (wire) this.select({ type: "wire", id: wire.id });
    this.scheduleAutosave("Wire added");
  }

  cancelWireDraft() {
    this.wireDraft = [];
    this.routingNet = null; this.bridgeStart = null; this.renderer.copperPreview = null;
    this.renderer.draftRoute = [];
    this.renderer.renderTransient();
  }

  updateDraftRender() { this.renderer.draftRoute = [...this.wireDraft]; this.renderer.renderTransient(); }

  eraseWireNear(point) {
    const bridge = [...this.store.state.solderBridges].reverse().find(b => (this.store.state.view.face === "both" || this.store.state.view.face === b.layer) && routeContains([b.a, b.b], point));
    if (bridge) { this.store.snapshot("Remove solder bridge"); this.store.state.solderBridges = this.store.state.solderBridges.filter(b => b.id !== bridge.id); this.scheduleAutosave("Solder bridge removed"); this.render(); return; }
    const wire = [...this.store.state.wires].reverse().find(item => this.renderer.wireVisible(item) && !this.renderer.wireIsGhost(item) && routeContains(item.route, point));
    if (!wire) { this.setStatus("No visible wire at this hole."); return; }
    this.select({ type: "wire", id: wire.id }); this.deleteSelection();
  }

  hitTest(event) {
    const target = event.target;
    const component = target.closest?.(".component");
    if (component?.dataset.id) return { type: "component", id: component.dataset.id };
    const wire = target.closest?.(".wire[data-id],.wire-hit[data-id],[data-wire-handle]");
    if (wire?.dataset.id) return { type: "wire", id: wire.dataset.id };
    const note = target.closest?.(".note");
    if (note?.dataset.id) return { type: "text", id: note.dataset.id };
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

  svgEventToGridFloat(event) {
    const p = this.svgPointFromClient(event.clientX, event.clientY), b = this.store.state.board;
    return { col: (p.x - b.margin) / b.pitchPx, row: (p.y - b.margin) / b.pitchPx };
  }

  select(selection, additive = false) {
    if (additive) {
      const index = this.selections.findIndex(s => s.id === selection.id && s.type === selection.type);
      if (index >= 0) this.selections.splice(index, 1); else this.selections.push(selection);
    } else this.selections = selection ? [selection] : [];
    this.selection = this.selections[this.selections.length - 1] || null;
    this.render();
  }

  clearSelection() { this.select(null); }

  deleteSelection() {
    if (!this.selections.length) return;
    this.store.snapshot("Delete selection");
    for (const [type, key] of [["component", "components"], ["wire", "wires"], ["text", "texts"]]) {
      const ids = new Set(this.selections.filter(s => s.type === type).map(s => s.id));
      this.store.state[key] = this.store.state[key].filter(item => !ids.has(item.id));
    }
    this.clearSelection(); this.scheduleAutosave("Deleted");
  }

  undo() {
    if (this.store.undo()) {
      this.drag = null; this.wireDraft = []; this.renderer.draftRoute = [];
      this.bridgeStart = null; this.routingNet = null; this.renderer.copperPreview = null;
      this.syncBoardForm(); this.clearSelection(); this.scheduleAutosave("Undo");
    }
  }

  redo() {
    if (this.store.redo()) {
      this.drag = null; this.wireDraft = []; this.renderer.draftRoute = [];
      this.bridgeStart = null; this.routingNet = null; this.renderer.copperPreview = null;
      this.syncBoardForm(); this.clearSelection(); this.scheduleAutosave("Redo");
    }
  }

  syncBoardForm() {
    const board = this.store.state.board;
    $("#boardCols").value = board.cols;
    $("#boardRows").value = board.rows;
    $("#boardType").value = board.type;
    $("#stripDirection").value = board.stripDirection;
    $("#stripDirectionField").hidden = board.type !== "stripboard";
    $("#boardPitch").value = board.pitchPx;
    $("#holeDiameter").value = board.holeDiameterMm;
    $("#padDiameter").value = board.padDiameterMm;
    $("#gridUnit").value = parseFloat(board.gridUnit) || 2.54;
    $("#projectName").value = this.store.state.name;
    $("#boardColor").value = board.color;
    $("#pthMode").checked = board.platedThroughHoles;
    if ($("#labelFontSize")) $("#labelFontSize").value = this.store.state.view.labelFontSize ?? 8.4;
    if ($("#pinFontSize")) $("#pinFontSize").value = this.store.state.view.pinFontSize ?? 6;
    if ($("#labelWrapChars")) $("#labelWrapChars").value = this.store.state.view.labelWrapChars ?? 20;
    if ($("#coordLabels")) $("#coordLabels").checked = board.coordinateLabels !== false;
    if ($("#coordMode")) $("#coordMode").value = board.coordinateMode || "numbersTopLettersSide";
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
    const cols = Math.round(this.numberFrom("#boardCols", this.store.state.board.cols, 5, 300));
    const rows = Math.round(this.numberFrom("#boardRows", this.store.state.board.rows, 5, 220));
    const points = [...this.store.allPins(), ...this.store.state.wires.flatMap(w => w.route), ...this.store.state.texts, ...this.store.state.solderBridges.flatMap(b => [b.a, b.b]), ...this.store.state.board.cuts.flatMap(cutEnds)];
    if (points.some(p => p.col >= cols || p.row >= rows)) { this.setStatus("Board is too small for the current layout. Move the outer objects first."); return; }
    this.store.snapshot("Board settings");
    const board = this.store.state.board;
    board.cols = cols;
    board.rows = rows;
    board.type = $("#boardType").value;
    board.stripDirection = $("#stripDirection").value;
    board.pitchPx = this.numberFrom("#boardPitch", board.pitchPx, 10, 42);
    board.holeDiameterMm = this.numberFrom("#holeDiameter", board.holeDiameterMm, 0.1, 3);
    board.padDiameterMm = this.numberFrom("#padDiameter", board.padDiameterMm, 0.2, 4);
    board.gridUnit = `${this.numberFrom("#gridUnit", 2.54, 0.5, 10)}mm`;
    board.color = $("#boardColor").value || board.color;
    board.platedThroughHoles = $("#pthMode").checked;
    board.coordinateLabels = $("#coordLabels") ? $("#coordLabels").checked : board.coordinateLabels !== false;
    board.coordinateMode = $("#coordMode")?.value || board.coordinateMode || "numbersTopLettersSide";
    this.store.state.view.labelFontSize = this.numberFrom("#labelFontSize", this.store.state.view.labelFontSize ?? 8.4, 4, 18);
    this.store.state.view.pinFontSize = this.numberFrom("#pinFontSize", this.store.state.view.pinFontSize ?? 6, 3, 14);
    this.store.state.view.labelWrapChars = this.numberFrom("#labelWrapChars", this.store.state.view.labelWrapChars ?? 20, 8, 48);
    this.syncBoardForm(); this.scheduleAutosave("Board settings applied");
    this.render(); this.centerBoard({ fit: true });
  }

  numberFrom(selector, fallback, min, max) {
    const value = Number($(selector).value);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value * 100) / 100));
  }

  requestViewportUiUpdate() {
    if (this.viewportUiRaf) return;
    this.viewportUiRaf = requestAnimationFrame(() => {
      this.viewportUiRaf = 0;
      this.updateViewportUi();
    });
  }

  toggleMiniMap(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    this.minimapCollapsed = !this.minimapCollapsed;
    const mini = $("#miniMap");
    const btn = $("#miniMapToggleBtn");
    mini?.classList.toggle("is-collapsed", this.minimapCollapsed);
    if (btn) btn.textContent = this.minimapCollapsed ? "+" : "−";
    this.requestViewportUiUpdate();
  }

  updateViewportUi() {
    this.updateWorkspaceGrid();
    this.updateEdgeRulers();
    this.updateMiniMap();
  }

  updateWorkspaceGrid() {
    const workspace = document.querySelector(".workspace");
    const svg = $("#editorSvg");
    if (!workspace || !svg) return;
    const board = this.store.state.board;
    const pitch = Math.max(4, (Number(board.pitchPx) || 22) * this.zoom);
    const svgRect = svg.getBoundingClientRect();
    const wsRect = workspace.getBoundingClientRect();
    const firstX = svgRect.left - wsRect.left + (Number(board.margin) || 0) * this.zoom;
    const firstY = svgRect.top - wsRect.top + (Number(board.margin) || 0) * this.zoom;
    workspace.style.setProperty("--workspace-grid-size", `${pitch}px`);
    workspace.style.setProperty("--workspace-grid-x", `${firstX}px`);
    workspace.style.setProperty("--workspace-grid-y", `${firstY}px`);
  }

  updateOverlayPositions() {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return null;
    const rect = workspace.getBoundingClientRect();
    const bottom = $("#editorRulerBottom");
    const left = $("#editorRulerLeft");
    const width = workspace.clientWidth;
    const height = workspace.clientHeight;
    const mini = $("#miniMap");
    if (mini) {
      const w = mini.offsetWidth || 180;
      mini.style.left = `${Math.max(rect.left + 36, rect.left + width - w - 12)}px`;
      mini.style.top = `${rect.top + 112}px`;
    }
    for (const [selector, offset] of [[".workspace-toolbar", 12], [".workspace-subbar", 70], [".workspace-footer", height - 52]]) {
      const el = $(selector); if (!el) continue;
      el.style.left = `${rect.left + (innerWidth <= 700 ? 12 : 32)}px`;
      el.style.top = `${rect.top + offset}px`;
      el.style.width = `${Math.max(0, width - (innerWidth <= 700 ? 24 : 48))}px`;
    }
    // Keep rulers inside the drawing area, clear of the toolbars and footer.
    const rulerLeftWidth = left?.offsetWidth || 28;
    const rulerBottomHeight = bottom?.offsetHeight || 24;
    const drawingTop = $(".workspace-subbar").getBoundingClientRect().bottom + 12;
    const drawingBottom = $(".workspace-footer").getBoundingClientRect().top - 8 - rulerBottomHeight;
    if (bottom) {
      bottom.style.left = `${rect.left + rulerLeftWidth}px`;
      bottom.style.top = `${drawingBottom}px`;
      bottom.style.width = `${Math.max(0, width - rulerLeftWidth)}px`;
    }
    if (left) {
      left.style.left = `${rect.left}px`;
      left.style.top = `${drawingTop}px`;
      left.style.height = `${Math.max(0, drawingBottom - drawingTop)}px`;
    }
    const label = $("#fixedSelectionLabel");
    label.style.left = `${rect.left + 34}px`; label.style.top = `${rect.top + 111}px`;
    return rect;
  }

  updateEdgeRulers() {
    const workspace = document.querySelector(".workspace");
    const svg = $("#editorSvg");
    const bottom = $("#editorRulerBottom");
    const left = $("#editorRulerLeft");
    if (!workspace || !svg || !bottom || !left) return;
    const wsRect = this.updateOverlayPositions();
    if (!wsRect || this.store.state.view.showRulers === false) {
      bottom.classList.add("is-hidden");
      left.classList.add("is-hidden");
      return;
    }
    bottom.classList.remove("is-hidden");
    left.classList.remove("is-hidden");
    const board = this.store.state.board;
    const svgRect = svg.getBoundingClientRect();
    const bottomRect = bottom.getBoundingClientRect();
    const leftRect = left.getBoundingClientRect();
    const fragBottom = document.createDocumentFragment();
    const fragLeft = document.createDocumentFragment();
    const make = (className, style = {}, text = "") => {
      const el = document.createElement("span");
      el.className = className;
      Object.assign(el.style, style);
      if (text !== "") el.textContent = text;
      return el;
    };
    for (let col = 0; col < board.cols; col += 1) {
      const p = Geometry.gridToSvg(board, { col, row: 0 });
      const x = svgRect.left - bottomRect.left + p.x * this.zoom;
      if (x < -35 || x > bottomRect.width + 35) continue;
      const major = col % 5 === 0;
      fragBottom.append(make(`ruler-tick ruler-tick-x${major ? " major" : ""}`, { left: `${x}px` }));
      fragBottom.append(make("ruler-label ruler-label-x", { left: `${x}px` }, String(col + 1)));
    }
    for (let row = 0; row < board.rows; row += 1) {
      const p = Geometry.gridToSvg(board, { col: 0, row });
      const y = svgRect.top - leftRect.top + p.y * this.zoom;
      if (y < -35 || y > leftRect.height + 35) continue;
      const major = row % 5 === 0;
      fragLeft.append(make(`ruler-tick ruler-tick-y${major ? " major" : ""}`, { top: `${y}px` }));
      fragLeft.append(make("ruler-label ruler-label-y", { top: `${y}px` }, String(row + 1)));
    }
    bottom.replaceChildren(fragBottom);
    left.replaceChildren(fragLeft);
  }

  svgPointFromClient(clientX, clientY) {
    const svg = $("#editorSvg");
    if (!svg || !svg.getScreenCTM()) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  updateMiniMap() {
    const workspace = document.querySelector(".workspace");
    const canvas = $("#miniMapCanvas");
    const svg = $("#editorSvg");
    if (!workspace || !canvas || !svg) return;
    this.updateOverlayPositions();
    const mini = $("#miniMap");
    const btn = $("#miniMapToggleBtn");
    if (mini) mini.classList.toggle("is-collapsed", this.minimapCollapsed);
    if (btn) btn.textContent = this.minimapCollapsed ? "+" : "−";
    if (this.minimapCollapsed) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(80, Math.round(rect.width || 120));
    const cssH = Math.max(54, Math.round(rect.height || 80));
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const board = this.store.state.board;
    const boardRect = {
      x: board.margin - board.pitchPx / 2,
      y: board.margin - board.pitchPx / 2,
      w: (board.cols - 1) * board.pitchPx + board.pitchPx,
      h: (board.rows - 1) * board.pitchPx + board.pitchPx
    };
    const wsRect = workspace.getBoundingClientRect();
    const tl = this.svgPointFromClient(wsRect.left, wsRect.top) || { x: 0, y: 0 };
    const br = this.svgPointFromClient(wsRect.right, wsRect.bottom) || { x: boardRect.x + boardRect.w, y: boardRect.y + boardRect.h };
    const viewRect = {
      x: Math.min(tl.x, br.x),
      y: Math.min(tl.y, br.y),
      w: Math.abs(br.x - tl.x),
      h: Math.abs(br.y - tl.y)
    };
    const minX = Math.min(boardRect.x, viewRect.x);
    const minY = Math.min(boardRect.y, viewRect.y);
    const maxX = Math.max(boardRect.x + boardRect.w, viewRect.x + viewRect.w);
    const maxY = Math.max(boardRect.y + boardRect.h, viewRect.y + viewRect.h);
    const pad = Math.max(12, Math.max(maxX - minX, maxY - minY) * 0.08);
    const world = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    const scale = Math.min(cssW / world.w, cssH / world.h);
    const ox = (cssW - world.w * scale) / 2;
    const oy = (cssH - world.h * scale) / 2;
    const mapRect = rect => ({
      x: ox + (rect.x - world.x) * scale,
      y: oy + (rect.y - world.y) * scale,
      w: rect.w * scale,
      h: rect.h * scale
    });
    ctx.fillStyle = "rgba(10,16,28,.86)";
    ctx.fillRect(0, 0, cssW, cssH);
    const b = mapRect(boardRect);
    ctx.fillStyle = "rgba(38,56,77,.95)";
    ctx.strokeStyle = "rgba(238,244,255,.45)";
    ctx.lineWidth = 1;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    const v = mapRect(viewRect);
    ctx.strokeStyle = "rgba(255,226,122,.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(v.x, v.y, Math.max(2, v.w), Math.max(2, v.h));
    ctx.fillStyle = "rgba(255,226,122,.16)";
    ctx.fillRect(v.x, v.y, Math.max(2, v.w), Math.max(2, v.h));
  }

  render() {
    this.applyTheme(); this.renderCanvasOnly();
    this.renderInspector(); this.renderPalette(); this.renderLists();
    this.panels.renderNetworks();
    $("#boardSummary").textContent = `${this.store.state.board.cols} × ${this.store.state.board.rows} · ${this.store.state.board.type} · ${this.store.state.components.length} parts`;
    $("#projectName").value = this.store.state.name;
    document.title = `${this.store.state.name} · Perfboard Editor`;
  }

  renderCanvasOnly() {
    this.renderer.selection = this.selection;
    this.renderer.selections = this.selections;
    this.renderer.connectivity = buildConnectivity(this.store);
    this.networks = analyzeNetworks(this.store, this.renderer.connectivity);
    this.renderer.guides = this.networks.guides;
    this.renderer.render(); this.applyCanvasCentering(); this.renderFixedSelectionLabel(); this.requestViewportUiUpdate();
  }

  renderFixedSelectionLabel() {
    const host = $("#fixedSelectionLabel");
    if (!host) return;
    if (this.selection?.type !== "component") {
      host.classList.add("is-empty");
      host.textContent = "";
      return;
    }
    const component = this.store.componentById(this.selection.id);
    if (!component) {
      host.classList.add("is-empty");
      host.textContent = "";
      return;
    }
    host.classList.remove("is-empty");
    host.innerHTML = `<b>${htmlEscape(component.name || component.id)}</b>${component.value ? `<span>${htmlEscape(component.value)}</span>` : ""}`;
  }

  renderInspector() {
    const host = $("#inspector"), pinHost = $("#pinList");
    if (this.selections.length > 1) {
      host.innerHTML = `<div class="inspector-meta">${this.selections.length} OBJECTS SELECTED</div><p class="help-text">Drag an object to move the group. Shift+click to change the selection.</p><div class="inspector-actions"><button id="duplicateGroupBtn">Duplicate</button><button id="deleteSelectedBtn" class="danger">Delete</button></div>`;
      $("#duplicateGroupBtn").onclick = () => this.duplicateSelectedComponent(); $("#deleteSelectedBtn").onclick = () => this.deleteSelection();
      pinHost.innerHTML = `<div class="pin-list-empty">Select one component to edit its pins.</div>`; return;
    }
    if (!this.selection) {
      host.innerHTML = `<div class="empty-state"><b>Your board, one detail at a time.</b>Select a part, wire or note to edit its properties.<br>Shift+click to select a group.</div>`;
      pinHost.innerHTML = `<div class="pin-list-empty">Pin names and connections appear here.</div>`; return;
    }
    if (this.selection.type === "component") {
      const component = this.store.componentById(this.selection.id); this.renderComponentInspector(host, component); this.renderSelectedPinList(pinHost, component);
    } else if (this.selection.type === "wire") {
      this.renderWireInspector(host, this.store.wireById(this.selection.id)); pinHost.innerHTML = `<div class="pin-list-empty">Drag a wire handle to move it. Double-click a segment to add a bend.</div>`;
    } else {
      this.renderTextInspector(host, this.selectedObject()); pinHost.innerHTML = `<div class="pin-list-empty">Notes are included in layout exports.</div>`;
    }
  }

  renderComponentInspector(host, component) {
    if (!component) return;
    host.innerHTML = `<div class="inspector-meta">${htmlEscape(component.kind)} · ${component.pins.length} PINS</div><div class="inspector-form">
      <label>Reference <input id="compName" value="${htmlEscape(component.name)}"></label>
      <label>Value <input id="compValue" value="${htmlEscape(component.value)}"></label>
      <label>Column <input id="compCol" type="number" min="1" value="${component.col + 1}"></label>
      <label>Row <input id="compRow" type="number" min="1" value="${component.row + 1}"></label>
      <label>Rotation <select id="compRot"><option>0</option><option>90</option><option>180</option><option>270</option></select></label>
      <label>Mounting side <select id="compSide"><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
      <label>Color <input id="compColor" type="color" value="${component.color}"></label>
      ${component.pins.length === 2 ? `<label>Lead spacing <input id="leadSpacing" type="number" min="1" max="40" value="${Math.max(Math.abs(component.pins[1].x - component.pins[0].x), Math.abs(component.pins[1].y - component.pins[0].y))}"></label>` : ""}
      ${component.kind === "header" ? `<label>Pin count <input id="headerCount" type="number" min="1" max="40" value="${component.pins.length}"></label>` : ""}
      <label class="check-row"><input id="keepConnections" type="checkbox" ${this.keepConnections ? "checked" : ""}/>Keep attached wire points</label>
      <div class="inspector-actions"><button id="applyCompBtn" class="primary">Apply</button><button id="rotateCompBtn" title="Rotate (R)">↻</button><button id="duplicateCompBtn" title="Duplicate (Ctrl+D)">⧉</button><button id="deleteSelectedBtn" class="danger">Delete</button></div>
      <button id="saveFootprintBtn">Save footprint to library</button>
    </div>`;
    $("#compRot").value = String(component.rot || 0); $("#compSide").value = component.side || "top";
    $("#keepConnections").onchange = event => this.keepConnections = event.target.checked;
    $("#applyCompBtn").onclick = () => {
      const next = clone(component);
      next.name = $("#compName").value.trim() || component.id; next.value = $("#compValue").value;
      next.col = Math.round(Number($("#compCol").value) || 1) - 1; next.row = Math.round(Number($("#compRow").value) || 1) - 1;
      next.rot = Number($("#compRot").value); next.side = $("#compSide").value; next.color = $("#compColor").value;
      if ($("#leadSpacing")) {
        const gap = Math.round(this.numberFrom("#leadSpacing", 1, 1, 40)), [a, b] = next.pins;
        if (Math.abs(b.y - a.y) > Math.abs(b.x - a.x)) b.y = a.y + Math.sign(b.y - a.y || 1) * gap;
        else b.x = a.x + Math.sign(b.x - a.x || 1) * gap;
      }
      if ($("#headerCount")) {
        const count = Math.round(this.numberFrom("#headerCount", 4, 1, 40));
        next.pins = Array.from({ length: count }, (_, i) => next.pins[i] || { name: String(i + 1), number: i + 1, x: i, y: 0 });
      }
      try { this.store.fitComponent(next); } catch (error) { this.reportError(error); return; }
      this.store.snapshot("Edit component"); const previous = clone(component); Object.assign(component, next);
      this.followPinChanges(previous, component); this.scheduleAutosave("Component updated"); this.render();
    };
    $("#rotateCompBtn").onclick = () => this.rotateSelectedComponent(); $("#duplicateCompBtn").onclick = () => this.duplicateSelectedComponent();
    $("#deleteSelectedBtn").onclick = () => this.deleteSelection();
    $("#saveFootprintBtn").onclick = () => { const template = clone(component); delete template.id; delete template.col; delete template.row; template.name = component.value || component.kind; this.rememberCustomTemplate(template); this.scheduleAutosave("Footprint saved"); this.renderPalette(); this.setStatus("Footprint added to your component library."); };
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
      const netText = info ? Array.from(info.nets).join(", ") || "copper" : "open";
      const statusClass = info ? "is-connected" : "";
      const statusText = info ? "connected" : "open";
      return `
        <div class="pin-edit-row ${statusClass}">
          <input class="pin-no-box" value="${htmlEscape(pin.pin.number ?? pin.pinIndex + 1)}" readonly title="Pin number">
          <input class="pin-name-box" data-pin-index="${pin.pinIndex}" value="${htmlEscape(pin.pin.name || "")}" placeholder="Pin name">
          <span class="pin-hole">${pin.col + 1},${pin.row + 1}</span>
          <span class="pin-net" title="${htmlEscape(netText)}">${htmlEscape(netText)}</span>
          <input class="pin-plan-net" data-pin-net="${pin.pinIndex}" value="${htmlEscape(pin.pin.net || "")}" maxlength="200" placeholder="e.g. GND" aria-label="Pin ${htmlEscape(pin.pin.number)} planned net" title="Same planned net names should be physically connected">
          <input type="checkbox" data-pin-nc="${pin.pinIndex}" title="Intentionally unconnected (NC)" aria-label="Pin ${htmlEscape(pin.pin.number)} intentionally unconnected" ${pin.pin.noConnect ? "checked" : ""}>
        </div>`;
    }).join("");

    host.innerHTML = `
      <div class="pin-edit-head">
        <span>No</span><span>Name</span><span>Hole</span><span>Contact</span><span>Plan net</span><span>NC</span>
      </div>
      <div class="pin-edit-list">${rows || `<div class="pin-list-empty">This component has no pins.</div>`}</div>
      <div class="pin-edit-actions">
        <button id="addPinBtn">${this.store.isDipComponent(component) ? "Add pin pair" : "Add pin"}</button>
        <button id="removePinBtn">${this.store.isDipComponent(component) ? "Remove pin pair" : "Remove last pin"}</button>
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

    host.querySelectorAll("input[data-pin-nc]").forEach(input => input.onchange = () => {
      this.store.snapshot("Mark pin NC"); component.pins[Number(input.dataset.pinNc)].noConnect = input.checked; this.scheduleAutosave("Pin status updated"); this.render();
    });
    host.querySelectorAll("input[data-pin-net]").forEach(input => input.onchange = () => {
      this.store.snapshot("Set planned net"); component.pins[Number(input.dataset.pinNet)].net = input.value.trim();
      this.scheduleAutosave("Connection plan updated"); this.render();
    });
    const changePinCount = delta => {
      const next = clone(component), previous = clone(component), dip = this.store.isDipComponent(component);
      if (delta < 0 && next.pins.length <= (dip ? 2 : 1)) return;
      if (dip) this.store.reflowDipPins(next, next.pins.length + delta * 2);
      else if (delta < 0) next.pins.pop();
      else {
        let number = 1; while (next.pins.some(p => String(p.number) === String(number))) number++;
        const x = Math.max(...next.pins.map(p => p.x), -1) + 1;
        next.pins.push({ number, name: `P${number}`, x, y: 0 });
      }
      try { this.store.fitComponent(next); } catch (error) { this.reportError(error); return; }
      this.store.snapshot(delta > 0 ? "Add pin" : "Remove pin"); Object.assign(component, next);
      this.followPinChanges(previous, component); this.scheduleAutosave("Pin layout updated"); this.render();
    };
    host.querySelector("#addPinBtn").onclick = () => changePinCount(1);
    host.querySelector("#removePinBtn").onclick = () => changePinCount(-1);
    host.querySelector("#removePinBtn").disabled = component.pins.length <= (this.store.isDipComponent(component) ? 2 : 1);

  }

  buildPinConnectionSummary() { return (this.renderer.connectivity || buildConnectivity(this.store)).pins; }

  renderWireInspector(host, wire) {
    if (!wire) return;
    host.innerHTML = `<div class="inspector-meta">WIRE · ${wire.route.length} POINTS</div><div class="inspector-form">
      <label>Name <input id="wireName" value="${htmlEscape(wire.name)}"></label><label>Net <input id="wireNet" value="${htmlEscape(wire.net)}"></label>
      <label>Layer <select id="wireLayer"><option value="top">Top</option><option value="bottom">Bottom</option><option value="jumper">Jumper</option></select></label>
      <label>Conductor <select id="wireBridgeType"><option value="normal">Bare wire</option><option value="jumper">Jumper</option><option value="insulated">Insulated</option></select></label>
      <label>Style <select id="wireStyle"><option value="solid">Solid</option><option value="dashed">Dashed</option></select></label>
      <label>Color <input id="wireColor" type="color" value="${wire.color || (wire.layer === "bottom" ? "#78bafa" : "#efc77a")}"></label>
      <label class="check-row"><input id="renameConnectedNet" type="checkbox" checked/>Rename connected routes</label>
      <div class="inspector-actions"><button id="applyWireBtn" class="primary">Apply</button><button id="deleteSelectedBtn" class="danger">Delete</button></div>
      <p class="help-text">Route points · column / row</p><div class="wire-route-list">${wire.route.map((p, i) => `<div class="wire-route-row"><span>${i + 1}</span><input aria-label="Point ${i + 1} column" data-route-col="${i}" type="number" min="1" value="${p.col + 1}"><input aria-label="Point ${i + 1} row" data-route-row="${i}" type="number" min="1" value="${p.row + 1}"><button data-remove-point="${i}" aria-label="Remove point ${i + 1}" ${wire.route.length <= 2 ? "disabled" : ""}>×</button></div>`).join("")}</div>
    </div>`;
    $("#wireLayer").value = wire.layer; $("#wireStyle").value = wire.style; $("#wireBridgeType").value = wire.bridgeType || "normal";
    $("#applyWireBtn").onclick = () => {
      const route = wire.route.map((p, i) => ({ col: Math.round(Number(host.querySelector(`[data-route-col="${i}"]`).value)) - 1, row: Math.round(Number(host.querySelector(`[data-route-row="${i}"]`).value)) - 1 }));
      const board = this.store.state.board;
      if (route.some(p => !Number.isFinite(p.col) || !Number.isFinite(p.row) || p.col < 0 || p.row < 0 || p.col >= board.cols || p.row >= board.rows)) { this.setStatus("Route points must stay inside the board."); return; }
      const group = buildConnectivity(this.store).wireGroups.get(wire.id);
      this.store.snapshot("Edit wire"); wire.name = $("#wireName").value.trim() || wire.id;
      const net = $("#wireNet").value.trim() || wire.id;
      if ($("#renameConnectedNet").checked) group?.wires.forEach(w => w.net = net);
      wire.net = net; wire.layer = $("#wireLayer").value; wire.style = $("#wireStyle").value; wire.bridgeType = $("#wireBridgeType").value;
      if (wire.layer === "jumper") wire.bridgeType = "jumper";
      wire.color = $("#wireColor").value; wire.route = route;
      this.scheduleAutosave("Wire updated"); this.render();
    };
    $$('[data-remove-point]', host).forEach(button => button.onclick = () => { if (wire.route.length <= 2) return; this.store.snapshot("Remove wire point"); wire.route.splice(Number(button.dataset.removePoint), 1); this.scheduleAutosave("Wire point removed"); this.render(); });
    $("#deleteSelectedBtn").onclick = () => this.deleteSelection();
  }

  renderLists() { this.panels.renderObjects(); this.renderHistoryList(); this.updateHistoryButtons(); }

  renderHistoryList() {
    const host = $("#historyList");
    if (!host) return;
    const past = (this.store.historyMeta || []).slice(-12).reverse().map((item, index) => `
      <div class="history-row">
        <b>${htmlEscape(item.label || "Edit")}</b>
        <small>${index === 0 ? "last undo point" : "undo point"} • ${htmlEscape(this.timeOnly(item.at))}</small>
      </div>`).join("");
    const future = (this.store.futureMeta || []).slice(-8).reverse().map(item => `
      <div class="history-row is-future">
        <b>${htmlEscape(item.label || "Redo")}</b>
        <small>redo • ${htmlEscape(this.timeOnly(item.at))}</small>
      </div>`).join("");
    host.innerHTML = past || future ? `${past}${future}` : `<div class="check-results">No undo history yet.</div>`;
  }

  timeOnly(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  updateHistoryButtons() {
    const undo = $("#undoBtn");
    const redo = $("#redoBtn");
    if (undo) undo.disabled = !(this.store.history || []).length;
    if (redo) redo.disabled = !(this.store.future || []).length;
  }

  openCustomDesigner(existingTemplate = null) {
    this.customTemplateEditIndex = this.store.state.customTemplates.indexOf(existingTemplate);
    const template = existingTemplate || {
      name: "X?_CUSTOM",
      value: "custom",
      color: "#cbd5e1",
      bodyShape: "roundrect",
      cols: 4,
      rows: 3,
      pins: [
        { number: 1, name: "1", x: 0, y: 0 },
        { number: 2, name: "2", x: 3, y: 0 }
      ]
    };
    const saved = (this.store.state.customTemplates || []).map((item, index) => `
      <button type="button" data-template-index="${index}"><b>${htmlEscape(item.name || "Custom")}</b><small>${htmlEscape(item.value || "")} • ${(item.pins || []).length} pins</small></button>
    `).join("");
    this.modal.open("Custom component designer", `
      <div class="custom-designer">
        <div class="designer-form">
          <label>Name <input id="customName" value="${htmlEscape(template.name)}"></label>
          <label>Value <input id="customValue" value="${htmlEscape(template.value || "")}"></label>
          <label>Color <input id="customColor" type="color" value="${htmlEscape(template.color || "#cbd5e1")}"></label>
          <label>Shape <select id="customShape"><option value="roundrect">rounded rectangle</option><option value="rect">rectangle</option><option value="ellipse">ellipse</option><option value="circle">circle</option><option value="none">pins only</option></select></label>
          <label>Grid cols <input id="customCols" type="number" min="1" max="40" value="${Number(template.cols || template.w || template.bodyW || 4)}"></label>
          <label>Grid rows <input id="customRows" type="number" min="1" max="30" value="${Number(template.rows || template.h || template.bodyH || 3)}"></label>
          <div class="designer-actions">
            <button id="resizeCustomGridBtn" type="button">Resize grid</button>
            <button id="clearCustomPinsBtn" type="button">Clear pins</button>
          </div>
          <div class="custom-pin-editor">
            <span class="help-text">Selected pin:</span>
            <input id="customPinNumber" placeholder="number" aria-label="Selected pin number"><input id="customPinName" placeholder="pin name" aria-label="Selected pin name">
            <button id="deleteCustomPinBtn" type="button">Delete pin</button>
          </div>
          <div class="designer-actions">
            <button id="placeCustomBtn" type="button">Create & place</button>
            <button id="saveCustomTemplateBtn" type="button">Save template</button>
          </div>
          <div class="help-text">
            Click a hole to add/select a pin. Click a selected pin name field to rename it. Pins are saved in exact perfboard-grid coordinates.
          </div>
          <div class="saved-template-list">${saved || `<div class="check-results">No saved custom templates in this project.</div>`}</div>
        </div>
        <div class="custom-grid-wrap">
          <div id="customGrid" class="custom-grid"></div>
        </div>
      </div>
    `);

    const draft = {
      selectedIndex: 0,
      pins: (template.pins || []).map((pin, index) => ({
        number: pin.number ?? index + 1,
        name: pin.name || String(pin.number ?? index + 1),
        x: Number(pin.x) || 0,
        y: Number(pin.y) || 0
      }))
    };
    $("#customShape").value = template.bodyShape || "roundrect";

    const gridSize = () => ({
      cols: this.numberFrom("#customCols", 4, 1, 40),
      rows: this.numberFrom("#customRows", 3, 1, 30)
    });

    const renumber = () => {
      draft.pins.forEach((pin, index) => { if (pin.number == null) pin.number = index + 1; });
      if (draft.selectedIndex >= draft.pins.length) draft.selectedIndex = Math.max(0, draft.pins.length - 1);
    };

    const currentTemplate = () => {
      const { cols, rows } = gridSize();
      renumber();
      return {
        kind: "custom",
        name: $("#customName").value || "X?_CUSTOM",
        value: $("#customValue").value || "custom",
        color: $("#customColor").value || "#cbd5e1",
        bodyShape: $("#customShape").value || "roundrect",
        bodyW: cols,
        bodyH: rows,
        w: cols,
        h: rows,
        cols,
        rows,
        pins: draft.pins.map(pin => ({ ...pin }))
      };
    };

    const renderGrid = () => {
      const { cols, rows } = gridSize();
      const grid = $("#customGrid");
      grid.style.gridTemplateColumns = `repeat(${cols}, 38px)`;
      grid.replaceChildren();
      renumber();
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const index = draft.pins.findIndex(pin => pin.x === x && pin.y === y);
          const pin = index >= 0 ? draft.pins[index] : null;
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.x = String(x);
          button.dataset.y = String(y);
          button.className = `${pin ? "has-pin" : ""} ${index === draft.selectedIndex ? "is-selected" : ""}`;
          button.textContent = pin ? String(pin.number) : "·";
          button.title = pin ? `${pin.name} @ ${x + 1},${y + 1}` : `add pin @ ${x + 1},${y + 1}`;
          button.onclick = () => {
            const existingIndex = draft.pins.findIndex(item => item.x === x && item.y === y);
            if (existingIndex >= 0) {
              draft.selectedIndex = existingIndex;
            } else {
              let number = 1; while (draft.pins.some(p => String(p.number) === String(number))) number++;
              draft.pins.push({ number, name: `P${number}`, x, y });
              draft.selectedIndex = draft.pins.length - 1;
            }
            renderGrid();
          };
          grid.append(button);
        }
      }
      const selected = draft.pins[draft.selectedIndex];
      const nameInput = $("#customPinName");
      if (nameInput) {
        nameInput.value = selected?.name || "";
        nameInput.disabled = !selected;
      }
      $("#customPinNumber").value = selected?.number ?? ""; $("#customPinNumber").disabled = !selected;
      const deleteButton = $("#deleteCustomPinBtn");
      if (deleteButton) deleteButton.disabled = !selected;
    };

    $("#customPinNumber").onchange = event => {
      const pin = draft.pins[draft.selectedIndex], number = event.target.value.trim();
      if (!pin || !number || draft.pins.some(p => p !== pin && String(p.number) === number)) { this.setStatus("Pin numbers must be unique and nonempty."); renderGrid(); return; }
      pin.number = number; renderGrid();
    };
    $("#resizeCustomGridBtn").onclick = renderGrid;
    $("#clearCustomPinsBtn").onclick = () => { draft.pins = []; draft.selectedIndex = 0; renderGrid(); };
    $("#customPinName").oninput = event => {
      const selected = draft.pins[draft.selectedIndex];
      if (!selected) return;
      selected.name = event.target.value;
      renderGrid();
      event.target.focus();
      event.target.selectionStart = event.target.selectionEnd = event.target.value.length;
    };
    $("#deleteCustomPinBtn").onclick = () => {
      if (!draft.pins[draft.selectedIndex]) return;
      draft.pins.splice(draft.selectedIndex, 1);
      draft.selectedIndex = Math.max(0, draft.selectedIndex - 1);
      renderGrid();
    };
    $("#saveCustomTemplateBtn").onclick = () => {
      const next = currentTemplate();
      if (!next.pins.length) {
        this.setStatus("Custom component needs at least one pin.");
        return;
      }
      if (next.pins.some(p => p.x >= next.cols || p.y >= next.rows)) { this.setStatus("Some pins are outside the custom grid. Enlarge the grid or remove those pins."); return; }
      if (this.customTemplateEditIndex >= 0) { this.store.snapshot("Update custom template"); this.store.state.customTemplates[this.customTemplateEditIndex] = next; }
      else this.rememberCustomTemplate(next, "Save custom template");
      this.scheduleAutosave("Custom template saved");
      this.modal.close();
      this.render();
    };
    $("#placeCustomBtn").onclick = () => {
      const next = currentTemplate();
      if (!next.pins.length) {
        this.setStatus("Custom component needs at least one pin.");
        return;
      }
      if (next.pins.some(p => p.x >= next.cols || p.y >= next.rows)) { this.setStatus("Some pins are outside the custom grid. Enlarge the grid or remove those pins."); return; }
      if (this.customTemplateEditIndex >= 0) { this.store.snapshot("Update custom template"); this.store.state.customTemplates[this.customTemplateEditIndex] = next; }
      else this.rememberCustomTemplate(next, "Save custom template");
      this.scheduleAutosave("Custom template saved");
      this.customPlacingTemplate = next;
      this.modal.close();
      this.renderPalette();
      this.setTool("placeCustom");
    };
    this.modal.body.querySelectorAll("[data-template-index]").forEach(button => {
      button.addEventListener("click", () => this.openCustomDesigner(this.store.state.customTemplates[Number(button.dataset.templateIndex)]));
    });
    renderGrid();
  }

  rememberCustomTemplate(template, historyLabel = "Save custom template") {
    const templates = this.store.state.customTemplates || [];
    const signature = item => JSON.stringify({
      name: item.name || "",
      value: item.value || "",
      bodyShape: item.bodyShape || "roundrect",
      w: Number(item.w || item.bodyW || item.cols || 0),
      h: Number(item.h || item.bodyH || item.rows || 0),
      pins: (item.pins || []).map(pin => ({ name: pin.name || "", x: Number(pin.x) || 0, y: Number(pin.y) || 0 }))
    });
    const nextSignature = signature(template);
    const existingIndex = templates.findIndex(item => signature(item) === nextSignature);
    if (existingIndex >= 0) {
      this.store.state.customTemplates[existingIndex] = template;
      return existingIndex;
    }
    this.store.snapshot(historyLabel);
    this.store.state.customTemplates = [...templates, template];
    return this.store.state.customTemplates.length - 1;
  }

  runChecks() {
    const problems = this.checks.run(), host = $("#checkResults");
    host.innerHTML = problems.length ? `<p>${problems.length} findings · click to locate</p>` + problems.map((p, i) => `<button class="check-result ${p.severity}" data-check="${i}"><b>${htmlEscape(p.type.replaceAll("_", " "))}</b>${htmlEscape(p.message)}</button>`).join("") : `<span class="check-success">No layout issues found.</span><p>Checks cover routes and net names, not circuit behavior.</p>`;
    host.onclick = event => { const button = event.target.closest("[data-check]"); if (button) { const p = problems[Number(button.dataset.check)]; if (p.selection) this.select(p.selection); if (p.point) this.focusPoint(p.point); else this.focusSelection(); } };
  }

  toggleTheme() {
    this.store.state.view.theme = this.store.state.view.theme === "dark" ? "light" : "dark";
    this.scheduleAutosave("Theme changed");
    this.render();
  }

  applyTheme() {
    document.body.classList.toggle("light", this.store.state.view.theme === "light");
  }

  reportError(error) {
    if (error?.name === "AbortError") return;
    const message = error?.message || String(error);
    this.setStatus(message);
    if (this.modal.isOpen) {
      let notice = this.modal.body.querySelector(".modal-error");
      if (!notice) { notice = document.createElement("p"); notice.className = "modal-error"; notice.setAttribute("role", "alert"); this.modal.body.prepend(notice); }
      notice.textContent = message;
    }
  }

  selectedObject(selection = this.selection) {
    if (!selection) return null;
    const key = selection.type === "component" ? "components" : selection.type === "wire" ? "wires" : "texts";
    return this.store.state[key].find(item => item.id === selection.id);
  }

  objectPoints(selection, item = this.selectedObject(selection)) {
    return selection.type === "component" ? this.store.pinsFor(item) : selection.type === "wire" ? item.route : [item];
  }

  beginObjectDrag(point) {
    const items = this.selections.map(selection => ({ selection, original: clone(this.selectedObject(selection)) }));
    const points = items.flatMap(({ selection, original }) => this.objectPoints(selection, original));
    if (!points.length) return;
    const movedParts = items.filter(i => i.selection.type === "component").map(i => i.original);
    const attached = this.store.state.wires.filter(w => !this.selections.some(s => s.type === "wire" && s.id === w.id)).map(wire => {
      const keys = new Set(movedParts.filter(c => this.store.state.board.platedThroughHoles || (wire.layer === "jumper" ? "top" : wire.layer) === pinContactSide(this.store.state.board, { component: c })).flatMap(c => this.store.pinsFor(c).map(holeKey)));
      return { wire, route: clone(wire.route), keys };
    }).filter(({ wire, keys }) => wire.route.some((p, i) => keys.has(holeKey(p)) && (!isInsulated(wire) || i === 0 || i === wire.route.length - 1)));
    this.drag = { type: "objects", start: point, items, attached, dx: 0, dy: 0, changed: false, bounds: { minCol: Math.min(...points.map(p => p.col)), maxCol: Math.max(...points.map(p => p.col)), minRow: Math.min(...points.map(p => p.row)), maxRow: Math.max(...points.map(p => p.row)) } };
  }

  followPinChanges(before, after) {
    if (!this.keepConnections) return;
    const mapping = new Map();
    before.pins.forEach(pin => { const next = after.pins.find(p => String(p.number) === String(pin.number)); if (next) mapping.set(holeKey(Geometry.pinAbsolute(before, pin)), Geometry.pinAbsolute(after, next)); });
    this.store.state.wires.forEach(wire => {
      if (!this.store.state.board.platedThroughHoles && (wire.layer === "jumper" ? "top" : wire.layer) !== pinContactSide(this.store.state.board, { component: before })) return;
      wire.route = wire.route.map((point, i) => mapping.has(holeKey(point)) && (!isInsulated(wire) || i === 0 || i === wire.route.length - 1) ? { ...mapping.get(holeKey(point)) } : point);
    });
  }

  updatePlacementPreview(point) {
    this.renderer.previewComponent = null;
    if (point && ["place", "placeCustom"].includes(this.tool)) {
      const item = this.tool === "place" ? this.store.components.create(this.placingKind, point.col, point.row) : this.store.components.fromTemplate(this.customPlacingTemplate, point.col, point.row);
      item.rot = this.placementRotation;
      try { this.store.fitComponent(item); this.renderer.previewComponent = item; } catch { this.setStatus("Footprint does not fit this board. Increase its size in Board settings."); }
    }
    this.renderer.renderTransient();
  }

  focusSelection() {
    if (!this.selection) return;
    const points = this.objectPoints(this.selection); if (!points.length) return;
    const col = (Math.min(...points.map(p => p.col)) + Math.max(...points.map(p => p.col))) / 2;
    const row = (Math.min(...points.map(p => p.row)) + Math.max(...points.map(p => p.row))) / 2;
    this.focusPoint({ col, row });
  }

  focusPoint(point) {
    const p = Geometry.gridToSvg(this.store.state.board, point), workspace = $(".workspace");
    workspace.scrollTo({ left: this.svgMargin("left") + p.x * this.zoom - workspace.clientWidth / 2, top: this.svgMargin("top") + p.y * this.zoom - workspace.clientHeight / 2, behavior: "smooth" });
  }

  startGuide(guide) {
    if (guide.a.side !== guide.b.side && !this.store.state.board.platedThroughHoles) { this.setStatus("These contacts are on opposite faces. Add a through-hole connection before routing."); return; }
    this.setFace(guide.a.side); this.setTool("wire");
    this.routingNet = guide.net; this.wireDraft = [{ col: guide.a.col, row: guide.a.row }];
    this.updateDraftRender(); this.focusPoint(guide.a); this.panels.closeDrawers();
    this.setStatus(`${guide.net}: route to ${guide.b.col + 1},${guide.b.row + 1} · Shift+click adds bends · Esc cancel`);
  }

  renderTextInspector(host, note) {
    if (!note) return;
    host.innerHTML = `<div class="inspector-form"><label>Note <textarea id="noteText" rows="4" maxlength="2000">${htmlEscape(note.text)}</textarea></label><label>Column <input id="noteCol" type="number" min="1" value="${note.col + 1}"></label><label>Row <input id="noteRow" type="number" min="1" value="${note.row + 1}"></label><label>Size <input id="noteSize" type="number" min="6" max="48" value="${note.size}"></label><label>Color <input id="noteColor" type="color" value="${htmlEscape(note.color)}"></label><div class="inspector-actions"><button id="applyNoteBtn" class="primary">Apply note</button><button id="deleteSelectedBtn" class="danger">Delete</button></div></div>`;
    $("#applyNoteBtn").onclick = () => {
      this.store.snapshot("Edit note"); note.text = $("#noteText").value || "Note";
      note.col = Math.round(this.numberFrom("#noteCol", 1, 1, this.store.state.board.cols)) - 1;
      note.row = Math.round(this.numberFrom("#noteRow", 1, 1, this.store.state.board.rows)) - 1;
      note.size = this.numberFrom("#noteSize", 12, 6, 48); note.color = $("#noteColor").value;
      this.scheduleAutosave("Note updated"); this.render();
    };
    $("#deleteSelectedBtn").onclick = () => this.deleteSelection();
  }

  scheduleAutosave(reason) {
    this.setSaveState(`${reason} · saving to browser…`);
    $("#checkResults").textContent = "Layout changed. Run checks to update results.";
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
