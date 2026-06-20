import { $, $$, Geometry, clone, htmlEscape, ModalService } from "./core.js";
import { ProjectStore } from "./model.js";
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
    this.setupCollapsibleSections();
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
    $("#undoBtn").onclick = () => this.undo();
    $("#redoBtn").onclick = () => this.redo();
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
    document.querySelector(".palette-list")?.addEventListener("click", event => this.onPaletteClick(event));
    $("#customComponentBtn")?.addEventListener("click", () => this.openCustomDesigner());

    $$(".face-btn").forEach(button => {
      button.onclick = () => this.setFace(button.dataset.face);
    });
    $("#applyBoardBtn").onclick = () => this.applyBoardForm();
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
      return;
    }
    if (button.dataset.templateIndex) {
      const template = this.store.state.customTemplates?.[Number(button.dataset.templateIndex)];
      if (!template) return;
      this.customPlacingTemplate = template;
      this.setTool("placeCustom");
    }
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

    const refreshLayout = () => {
      this.requestViewportUiUpdate();
      requestAnimationFrame(() => this.updateViewportUi());
      window.setTimeout(() => this.updateViewportUi(), 80);
      window.setTimeout(() => this.updateViewportUi(), 220);
    };
    const toggleLeft = () => { leftPanel?.classList.toggle("is-collapsed"); sync(); refreshLayout(); };
    const toggleRight = () => { rightPanel?.classList.toggle("is-collapsed"); sync(); refreshLayout(); };

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
    const workspace = document.querySelector(".workspace");
    svg.addEventListener("mousemove", event => this.onPointerMove(event));
    svg.addEventListener("mousedown", event => this.onPointerDown(event));
    svg.addEventListener("auxclick", event => {
      if (event.button === 1) event.preventDefault();
    });
    svg.addEventListener("dblclick", event => this.onDoubleClick(event));
    svg.addEventListener("mouseleave", () => {
      if (this.viewOnlyFullscreen) return;
      this.renderer.hoverHole = null;
      this.renderCanvasOnly();
    });
    window.addEventListener("mousemove", event => { if (this.pan) this.onPointerMove(event); });
    window.addEventListener("mouseup", () => this.onPointerUp());
    workspace?.addEventListener("mousedown", event => {
      if (event.target.closest?.(".floating-controls,.context-menu,.mini-map")) return;
      if (event.target.closest?.("#editorSvg")) return;
      if (this.viewOnlyFullscreen || event.button === 1 || event.buttons === 4) {
        event.preventDefault();
        this.startPan(event);
      }
    });
    workspace?.addEventListener("wheel", event => {
      if (event.target.closest?.(".floating-controls,.context-menu,.mini-map,#editorSvg")) return;
      const shouldZoom = this.viewOnlyFullscreen || event.ctrlKey || event.metaKey;
      if (!shouldZoom) return;
      event.preventDefault();
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 0.88));
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
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 0.88));
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
    if (this.selection?.type !== "component") return;
    const component = this.store.componentById(this.selection.id);
    if (!component) return;
    this.store.snapshot("Rotate component");
    component.rot = ((Number(component.rot) || 0) + 90) % 360;
    this.scheduleAutosave("Component rotated");
    this.render();
  }

  duplicateSelectedComponent() {
    if (this.selection?.type !== "component") return;
    const component = this.store.componentById(this.selection.id);
    if (!component) return;
    this.store.snapshot("Duplicate component");
    const copy = clone(component);
    copy.id = this.store.ids.next(this.store.components.prefixFor(copy.kind || "custom"));
    copy.name = copy.name ? `${copy.name}_copy` : copy.id;
    copy.col = Math.min(this.store.state.board.cols - 1, Number(copy.col || 0) + 1);
    copy.row = Math.min(this.store.state.board.rows - 1, Number(copy.row || 0) + 1);
    this.store.state.components.push(copy);
    this.select({ type: "component", id: copy.id });
    this.scheduleAutosave("Component duplicated");
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
    window.addEventListener("keydown", event => {
      if (this.viewOnlyFullscreen) return;
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
        this.hideContextMenu();
        this.setTool("select");
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
    this.store.resetProject();
    this.selection = null;
    this.wireDraft = [];
    this.customPlacingTemplate = null;
    this.storage.fileHandle = null;
    this.syncBoardForm();
    this.render();
    this.scheduleAutosave("New project");
    this.setStatus("New empty project.");
  }

  afterLoad() {
    this.selection = null;
    this.wireDraft = [];
    this.customPlacingTemplate = null;
    this.syncBoardForm();
    this.applyTheme();
    this.render();
    requestAnimationFrame(() => this.centerBoard({ fit: true, instant: true, silent: true }));
    this.scheduleAutosave("Project loaded");
  }

  setTool(tool, placingKind = null) {
    this.tool = tool;
    this.placingKind = placingKind;
    $$(".tool-btn").forEach(button => button.classList.toggle("is-active", button.dataset.tool === tool));
    $$(".palette-list button[data-place]").forEach(button => button.classList.toggle("is-active", tool === "place" && button.dataset.place === placingKind));
    $$(".custom-template-palette button[data-template-index]").forEach(button => {
      const index = Number(button.dataset.templateIndex);
      button.classList.toggle("is-active", tool === "placeCustom" && this.store.state.customTemplates?.[index] === this.customPlacingTemplate);
    });
    const label = tool === "placeCustom"
      ? `Place ${this.customPlacingTemplate?.name || "custom component"}: click a hole`
      : (tool === "place" ? `Place ${placingKind}: click a hole` : `${tool} tool`);
    this.setStatus(label);
  }

  renderPalette() {
    this.decoratePaletteButtons();
    const host = $("#customTemplatePalette");
    if (!host) return;
    const templates = this.store.state.customTemplates || [];
    host.innerHTML = templates.length
      ? `<div class="palette-subtitle">Custom templates</div>${templates.map((template, index) => `
        <button type="button" data-template-index="${index}" title="Place custom component">
          <span class="palette-icon">${this.componentIcon(template.kind || "custom")}</span>
          <span><b>${htmlEscape(template.name || "Custom")}</b><small>${htmlEscape(template.value || "")} • ${(template.pins || []).length} pins</small></span>
        </button>`).join("")}`
      : `<div class="palette-subtitle is-empty">No custom templates yet</div>`;
    $$(".palette-list button[data-place]").forEach(button => button.classList.toggle("is-active", this.tool === "place" && button.dataset.place === this.placingKind));
    $$(".custom-template-palette button[data-template-index]").forEach(button => {
      const index = Number(button.dataset.templateIndex);
      button.classList.toggle("is-active", this.tool === "placeCustom" && templates[index] === this.customPlacingTemplate);
    });
  }

  decoratePaletteButtons() {
    $$(".palette-list > button[data-place]").forEach(button => {
      if (button.dataset.decorated === "1") return;
      const label = button.textContent.trim();
      const kind = button.dataset.place;
      button.innerHTML = `<span class="palette-icon">${this.componentIcon(kind)}</span><span>${htmlEscape(label)}</span>`;
      button.dataset.decorated = "1";
    });
    const customBtn = $("#customComponentBtn");
    if (customBtn && customBtn.dataset.decorated !== "1") {
      customBtn.innerHTML = `<span class="palette-icon">${this.componentIcon("custom")}</span><span>Custom component…</span>`;
      customBtn.dataset.decorated = "1";
    }
  }

  componentIcon(kind) {
    const safeKind = String(kind || "component").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "component";
    return `<img src="assets/component-placeholder.png" alt="${safeKind}" loading="lazy">`;
  }

  setZoom(value) {
    this.zoom = Math.max(0.25, Math.min(3.5, value));
    this.renderer.setZoom(this.zoom);
    $("#zoomText").textContent = `${Math.round(this.zoom * 100)}%`;
    this.renderCanvasOnly();
    requestAnimationFrame(() => {
      this.applyCanvasCentering();
      this.updateViewportUi();
    });
  }

  centerBoard(options = {}) {
    const workspace = document.querySelector(".workspace");
    const svg = $("#editorSvg");
    if (!workspace || !svg) return;

    if (options.fit !== false) {
      const size = Geometry.boardPixelSize(this.store.state.board);
      const availableW = Math.max(120, workspace.clientWidth - 72);
      const availableH = Math.max(120, workspace.clientHeight - 96);
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
      const workspace = document.querySelector(".workspace");
      event.preventDefault?.();
      const panSpeed = this.viewOnlyFullscreen ? 1.45 : 1.35;
      workspace.scrollLeft = this.pan.scrollLeft - (event.clientX - this.pan.clientX) * panSpeed;
      workspace.scrollTop = this.pan.scrollTop - (event.clientY - this.pan.clientY) * panSpeed;
      this.requestViewportUiUpdate();
      return;
    }
    if (this.viewOnlyFullscreen) return;

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
    if (this.viewOnlyFullscreen) {
      if (event.button === 0 || event.button === 1 || event.buttons === 4) {
        event.preventDefault();
        this.startPan(event);
      }
      return;
    }
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

    if (this.tool === "placeCustom" && this.customPlacingTemplate) {
      const component = this.store.addComponentFromTemplate(this.customPlacingTemplate, point.col, point.row);
      this.select({ type: "component", id: component.id });
      this.setStatus(`Custom ${this.customPlacingTemplate.name || "component"} placed. Click another hole to place again, or press Esc/select.`);
      this.scheduleAutosave("Custom component placed");
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
    if (this.viewOnlyFullscreen) return;
    if (!this.drag) return;
    this.drag = null;
    this.scheduleAutosave("Move complete");
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
    board.coordinateLabels = $("#coordLabels") ? $("#coordLabels").checked : board.coordinateLabels !== false;
    board.coordinateMode = $("#coordMode")?.value || board.coordinateMode || "numbersTopLettersSide";
    this.store.state.view.labelFontSize = this.numberFrom("#labelFontSize", this.store.state.view.labelFontSize ?? 8.4, 4, 18);
    this.store.state.view.pinFontSize = this.numberFrom("#pinFontSize", this.store.state.view.pinFontSize ?? 6, 3, 14);
    this.store.state.view.labelWrapChars = this.numberFrom("#labelWrapChars", this.store.state.view.labelWrapChars ?? 20, 8, 48);
    this.scheduleAutosave("Board settings applied");
    this.render();
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
    const top = $("#editorRulerTop");
    const left = $("#editorRulerLeft");
    if (top) {
      top.style.left = `${rect.left}px`;
      top.style.top = `${rect.top}px`;
      top.style.width = `${rect.width}px`;
    }
    if (left) {
      left.style.left = `${rect.left}px`;
      left.style.top = `${rect.top}px`;
      left.style.height = `${rect.height}px`;
    }
    const mini = $("#miniMap");
    if (mini) {
      const w = mini.offsetWidth || 180;
      mini.style.left = `${Math.max(rect.left + 36, rect.right - w - 12)}px`;
      mini.style.top = `${rect.top + 12}px`;
    }
    return rect;
  }

  updateEdgeRulers() {
    const workspace = document.querySelector(".workspace");
    const svg = $("#editorSvg");
    const top = $("#editorRulerTop");
    const left = $("#editorRulerLeft");
    if (!workspace || !svg || !top || !left) return;
    const wsRect = this.updateOverlayPositions();
    if (!wsRect || this.store.state.view.showRulers === false) {
      top.classList.add("is-hidden");
      left.classList.add("is-hidden");
      return;
    }
    top.classList.remove("is-hidden");
    left.classList.remove("is-hidden");
    const board = this.store.state.board;
    const svgRect = svg.getBoundingClientRect();
    const fragTop = document.createDocumentFragment();
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
      const x = svgRect.left - wsRect.left + p.x * this.zoom;
      if (x < -35 || x > wsRect.width + 35) continue;
      const major = col % 5 === 0;
      fragTop.append(make(`ruler-tick ruler-tick-x${major ? " major" : ""}`, { left: `${x}px` }));
      fragTop.append(make("ruler-label ruler-label-x", { left: `${x}px` }, String(col + 1)));
    }
    for (let row = 0; row < board.rows; row += 1) {
      const p = Geometry.gridToSvg(board, { col: 0, row });
      const y = svgRect.top - wsRect.top + p.y * this.zoom;
      if (y < -35 || y > wsRect.height + 35) continue;
      const major = row % 5 === 0;
      fragLeft.append(make(`ruler-tick ruler-tick-y${major ? " major" : ""}`, { top: `${y}px` }));
      fragLeft.append(make("ruler-label ruler-label-y", { top: `${y}px` }, String(row + 1)));
    }
    top.replaceChildren(fragTop);
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
    this.applyTheme();
    this.renderer.selection = this.selection;
    this.renderer.render();
    this.applyCanvasCentering();
    this.renderInspector();
    this.renderFixedSelectionLabel();
    this.renderPalette();
    this.renderLists();
    this.updateViewportUi();
  }

  renderCanvasOnly() {
    this.renderer.selection = this.selection;
    this.renderer.render();
    this.applyCanvasCentering();
    this.renderFixedSelectionLabel();
    this.updateViewportUi();
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

    host.querySelector("#addPinBtn")?.addEventListener("click", () => {
      this.store.snapshot("Add pin");
      if (this.store.isDipComponent(component)) {
        this.store.reflowDipPins(component, component.pins.length + 2);
      } else {
        const number = component.pins.length + 1;
        component.pins.push({ number, name: `P${number}`, x: Math.max(0, number - 1), y: 0 });
      }
      this.scheduleAutosave("Pin added");
      this.render();
    });

    host.querySelector("#removePinBtn")?.addEventListener("click", () => {
      if (!component.pins.length) return;
      this.store.snapshot("Remove pin");
      if (this.store.isDipComponent(component) && component.pins.length > 2) {
        this.store.reflowDipPins(component, component.pins.length - 2);
      } else {
        component.pins.pop();
      }
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
      <label>Bridge/isolated <select id="wireBridgeType"><option value="normal">normal wire</option><option value="jumper">jumper / atlama</option><option value="insulated">insulated / izole</option></select></label>
      <label>Color <input id="wireColor" type="color" value="${wire.color || (wire.layer === "bottom" ? "#5fa7ff" : "#d6a11e")}"></label>
      <div class="inspector-actions"><button id="applyWireBtn">Apply</button><button id="deleteSelectedBtn" class="danger">Delete</button></div>
    </div>`;
    $("#wireLayer").value = wire.layer;
    $("#wireStyle").value = wire.style;
    $("#wireBridgeType").value = wire.bridgeType || (wire.layer === "jumper" ? "jumper" : "normal");
    $("#applyWireBtn").onclick = () => {
      this.store.snapshot("Edit wire");
      wire.name = $("#wireName").value;
      wire.net = $("#wireNet").value;
      wire.layer = $("#wireLayer").value;
      wire.style = $("#wireStyle").value;
      wire.bridgeType = $("#wireBridgeType").value;
      if (wire.bridgeType === "jumper") wire.style = "dashed";
      wire.color = $("#wireColor").value;
      this.scheduleAutosave("Wire edited");
      this.render();
    };
    $("#deleteSelectedBtn").onclick = () => this.deleteSelection();
  }

  renderLists() {
    const components = this.store.state.components.map(component => `<button class="object-row" data-list-type="component" data-id="${component.id}"><span><b>${htmlEscape(component.name || component.id)}</b><small>${htmlEscape(component.kind)} @ ${component.col + 1},${component.row + 1}</small></span></button>`).join("");
    const wires = this.store.state.wires.map(wire => `<button class="object-row" data-list-type="wire" data-id="${wire.id}"><span><b>${htmlEscape(wire.net || wire.id)}</b><small>${htmlEscape(wire.layer)} • ${htmlEscape(wire.bridgeType || wire.style || "normal")} • ${wire.route.length} pts</small></span></button>`).join("");
    $("#componentList").innerHTML = components || `<div class="check-results">No components.</div>`;
    $("#wireList").innerHTML = wires || `<div class="check-results">No wires.</div>`;
    this.renderHistoryList();
    this.updateHistoryButtons();
    $$(`[data-list-type]`).forEach(button => {
      button.onclick = () => this.select({ type: button.dataset.listType, id: button.dataset.id });
    });
  }

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
          <label>Color <input id="customColor" type="color" value="${template.color || "#cbd5e1"}"></label>
          <label>Shape <select id="customShape"><option value="roundrect">rounded rectangle</option><option value="rect">rectangle</option><option value="ellipse">ellipse</option><option value="circle">circle</option><option value="none">pins only</option></select></label>
          <label>Grid cols <input id="customCols" type="number" min="1" max="40" value="${Number(template.cols || template.w || template.bodyW || 4)}"></label>
          <label>Grid rows <input id="customRows" type="number" min="1" max="30" value="${Number(template.rows || template.h || template.bodyH || 3)}"></label>
          <div class="designer-actions">
            <button id="resizeCustomGridBtn" type="button">Resize grid</button>
            <button id="clearCustomPinsBtn" type="button">Clear pins</button>
          </div>
          <div class="custom-pin-editor">
            <span class="help-text">Selected pin:</span>
            <input id="customPinName" placeholder="pin name">
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
      draft.pins.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      draft.pins.forEach((pin, index) => { pin.number = index + 1; });
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
              draft.pins.push({ number: draft.pins.length + 1, name: `P${draft.pins.length + 1}`, x, y });
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
      const deleteButton = $("#deleteCustomPinBtn");
      if (deleteButton) deleteButton.disabled = !selected;
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
      this.rememberCustomTemplate(next, "Save custom template");
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
      this.rememberCustomTemplate(next, "Save custom template");
      this.customPlacingTemplate = next;
      this.modal.close();
      this.renderPalette();
      this.setTool("placeCustom");
    };
    document.querySelectorAll("[data-template-index]").forEach(button => {
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
