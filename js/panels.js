import { $, $$, htmlEscape, clone } from "./core.js";
import { COMPONENT_CATALOG, componentIcon } from "./catalog.js";
import { downloadFile } from "./storage.js";
import { newState } from "./model.js";
import { exportNetlist } from "./networks.js";
import { assemblySteps, coordinateText, notebookMarkdown } from "./assembly.js";

export class EditorPanels {
  constructor(app) { this.app = app; this.category = "All"; this.objectTab = "component"; }

  bind() {
    const app = this.app;
    $("#projectName").onchange = event => {
      const name = event.target.value.trim() || "Untitled Project";
      if (name === app.store.state.name) return;
      app.store.snapshot("Rename project"); app.store.state.name = name; app.scheduleAutosave("Project renamed"); app.render();
    };
    $("#paletteSearch").oninput = () => this.renderPalette();
    $("#objectSearch").oninput = () => this.renderObjects();
    $("#examplesBtn").onclick = () => this.showExamples();
    $("#recoveryBtn").onclick = () => this.showRecovery();
    $("#helpBtn").onclick = () => this.showHelp();
    $("#notebookBtn").onclick = () => this.showNotebook();
    $("#copperPlanBtn").onclick = () => this.showCopperPlan();
    $("#assemblyBtn").onclick = () => app.printer.showAssembly();
    $("#netlistBtn").onclick = () => downloadFile(`${app.store.state.name.replace(/[^a-z0-9_-]/gi, "_")}-connections.json`, JSON.stringify(exportNetlist(app.store), null, 2));
    $("#csvBtn").onclick = () => app.printer.downloadBomCsv();
    $("#svgBtn").onclick = () => app.printer.downloadSvg();
    $("#customTemplatePalette").onclick = event => app.onPaletteClick(event);
    $("#exportTemplatesBtn").onclick = () => downloadFile("perfboard-components.json", JSON.stringify({ templates: app.store.state.customTemplates }, null, 2));
    $("#importTemplatesBtn").onclick = () => $("#templateFileInput").click();
    $("#templateFileInput").onchange = async event => {
      const [file] = event.target.files || []; event.target.value = "";
      if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error("Component library must be smaller than 1 MB.");
        const raw = JSON.parse(await file.text()), templates = raw.templates || raw.state?.customTemplates;
        if (!Array.isArray(templates)) throw new Error("This file does not contain a component library.");
        app.store.normalizeValidated({ ...newState(), customTemplates: templates });
        if (templates.some(t => !t.pins?.length)) throw new Error("Every template needs at least one pin.");
        app.store.snapshot("Import component library");
        app.store.state.customTemplates.push(...clone(templates)); app.scheduleAutosave("Library imported"); app.render();
      } catch (error) { app.reportError(error); }
    };
    $$("[data-page-target]").forEach(button => button.onclick = () => this.setPage(button.dataset.pageTarget));
    $$("[data-object-tab]").forEach(button => button.onclick = () => {
      this.objectTab = button.dataset.objectTab; this.renderObjects();
    });
    document.addEventListener("click", event => {
      $$(".menu[open]").forEach(menu => { if (!menu.contains(event.target) || event.target.closest("button")) menu.open = false; });
      $$(".copper-menu[open]").forEach(menu => { if (!menu.contains(event.target) || event.target.closest("button")) menu.open = false; });
    });
    window.addEventListener("pagehide", () => app.storage.autosave());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") app.storage.autosave(); });
    window.addEventListener("beforeunload", event => {
      if (JSON.stringify(app.store.state) !== app.storage.lastAutosave && app.storage.dirty && !app.storage.autosave()) { event.preventDefault(); event.returnValue = ""; }
    });
  }

  setPage(page) {
    $$("[data-page]").forEach(el => el.hidden = el.dataset.page !== page);
    $$("[data-page-target]").forEach(el => { const active = el.dataset.pageTarget === page; el.classList.toggle("is-active", active); el.setAttribute("aria-pressed", active); });
  }

  bindPanels() {
    const shell = $(".app-shell"), left = $(".left-panel"), right = $(".right-panel");
    const toggle = (panel, side) => {
      const overlay = innerWidth <= (side === "left" ? 700 : 1100);
      if (overlay) {
        panel.classList.toggle("is-open"); panel.classList.remove("is-collapsed"); shell.classList.remove(`${side}-collapsed`);
        (side === "left" ? right : left).classList.remove("is-open");
      } else { panel.classList.toggle("is-collapsed"); shell.classList.toggle(`${side}-collapsed`, panel.classList.contains("is-collapsed")); }
      this.syncPanelButtons();
      this.app.requestViewportUiUpdate();
    };
    $("#toggleLeftPanelBtn").onclick = () => toggle(left, "left");
    $("#collapseLeftPanelBtn").onclick = () => toggle(left, "left");
    $("#toggleRightPanelBtn").onclick = () => toggle(right, "right");
    $("#collapseRightPanelBtn").onclick = () => toggle(right, "right");
    window.addEventListener("resize", () => this.syncPanelButtons());
    this.syncPanelButtons();
  }

  syncPanelButtons() {
    for (const side of ["left", "right"]) {
      const panel = $(`.${side}-panel`), overlay = innerWidth <= (side === "left" ? 700 : 1100);
      const open = overlay ? panel.classList.contains("is-open") : !panel.classList.contains("is-collapsed");
      $(`#toggle${side === "left" ? "Left" : "Right"}PanelBtn`).setAttribute("aria-expanded", open);
    }
  }

  closeDrawers() { $$(".side-panel.is-open").forEach(el => el.classList.remove("is-open")); this.syncPanelButtons(); }

  renderPalette() {
    const search = $("#paletteSearch").value.toLowerCase().trim();
    const categories = ["All", ...new Set(COMPONENT_CATALOG.map(c => c.category))];
    $("#paletteCategories").innerHTML = categories.map(c => `<button class="${this.category === c ? "is-active" : ""}" aria-pressed="${this.category === c}" data-category="${htmlEscape(c)}">${htmlEscape(c)}</button>`).join("");
    $("#paletteCategories").onclick = event => { const button = event.target.closest("[data-category]"); if (button) { this.category = button.dataset.category; this.renderPalette(); } };
    const items = COMPONENT_CATALOG.filter(c => (this.category === "All" || c.category === this.category) && `${c.label} ${c.category} ${c.kind}`.toLowerCase().includes(search));
    $("#paletteCount").textContent = `${items.length}/${COMPONENT_CATALOG.length}`;
    $("#paletteEmpty").hidden = items.length > 0;
    $("#componentPalette").innerHTML = items.map(c => `<button data-place="${c.kind}" class="${this.app.tool === "place" && this.app.placingKind === c.kind ? "is-active" : ""}" title="${htmlEscape(c.label)}"><span class="palette-icon">${componentIcon(c.kind)}</span><span><b>${htmlEscape(c.label)}</b><small>${htmlEscape(c.category)}</small></span></button>`).join("");
    const templates = this.app.store.state.customTemplates || [];
    $("#customTemplatePalette").innerHTML = templates.length ? `<div class="palette-subtitle">YOUR COMPONENTS</div>` + templates.map((t, i) => `<button data-template-index="${i}" title="Place ${htmlEscape(t.name)}"><span class="palette-icon">${componentIcon("custom")}</span><span><b>${htmlEscape(t.name || "Custom")}</b><small>${t.pins?.length || 0} pins · ${htmlEscape(t.value || "Custom footprint")}</small></span></button>`).join("") : "";
  }

  renderObjects() {
    const app = this.app, state = app.store.state, query = $("#objectSearch").value.toLowerCase();
    $("#objectCount").textContent = state.components.length + state.wires.length + state.texts.length;
    const groups = [["component", state.components], ["wire", state.wires], ["text", state.texts]];
    groups.forEach(([type, items]) => {
      const host = $(`#${type === "component" ? "component" : type === "wire" ? "wire" : "text"}List`);
      host.hidden = this.objectTab !== type;
      host.innerHTML = items.filter(item => `${item.id} ${item.name || ""} ${item.value || ""} ${item.net || ""} ${item.text || ""}`.toLowerCase().includes(query)).map(item => {
        const title = type === "wire" ? item.net || item.id : type === "text" ? item.text : item.name || item.id;
        const detail = type === "wire" ? `${item.layer} · ${item.route.length} points` : type === "text" ? `Note · ${item.col + 1},${item.row + 1}` : `${item.value || item.kind} · ${item.col + 1},${item.row + 1}`;
        const selected = app.selections.some(s => s.type === type && s.id === item.id);
        return `<button class="object-row ${selected ? "is-active" : ""}" data-list-type="${type}" data-id="${htmlEscape(item.id)}" title="${htmlEscape(title)}"><span><b>${htmlEscape(title)}</b><small>${htmlEscape(detail)}</small></span></button>`;
      }).join("") || `<div class="empty-state">${query ? "No matching objects." : `No ${type === "component" ? "parts" : type === "wire" ? "wires" : "notes"} yet.`}</div>`;
      host.onclick = event => {
        const button = event.target.closest("[data-list-type]");
        if (button) { app.select({ type, id: button.dataset.id }, event.shiftKey); app.focusSelection(); }
      };
    });
    $$("[data-object-tab]").forEach(b => b.classList.toggle("is-active", b.dataset.objectTab === this.objectTab));
  }

  renderNetworks() {
    const app = this.app, networks = app.networks || { nets: [], guides: [] };
    $("#netCount").textContent = `${networks.guides.length} open`;
    $("#netList").innerHTML = networks.nets.map(net => `<div class="net-card ${net.guides.length ? "is-open" : "is-complete"}"><button class="net-focus ${app.renderer.activeNet === net.name ? "is-active" : ""}" data-net-focus="${htmlEscape(net.name)}"><b>${htmlEscape(net.name)}</b><small>${net.pins.length} pins · ${net.wireIds.size} routes · ${net.guides.length ? `${net.guides.length} missing` : "continuous"}</small></button>${net.guides.map(g => `<button class="route-guide-button" data-route-guide="${htmlEscape(g.id)}"><span>↗</span> Route ${coordinateText(g.a)} → ${coordinateText(g.b)}</button>`).join("")}</div>`).join("") || `<p class="help-text">Set <b>Plan net</b> on two or more pins, for example GND. Dashed guides show the copper connections still needed.</p>`;
    $("#netList").onclick = event => {
      const focus = event.target.closest("[data-net-focus]"), route = event.target.closest("[data-route-guide]");
      if (focus) {
        app.renderer.activeNet = app.renderer.activeNet === focus.dataset.netFocus ? null : focus.dataset.netFocus;
        app.renderCanvasOnly(); this.renderNetworks();
        const net = app.networks.nets.find(n => n.name === focus.dataset.netFocus);
        if (net?.groups[0]?.points[0]) app.focusPoint(net.groups[0].points[0]);
      }
      if (route) {
        const guide = networks.guides.find(g => g.id === route.dataset.routeGuide);
        if (guide) app.startGuide(guide);
      }
    };
  }

  showNotebook() {
    const app = this.app, notebook = app.store.state.notebook;
    app.modal.open("Project notebook", `<div class="notebook-layout"><div><label class="notebook-label" for="projectNotes">Design &amp; build notes</label><textarea id="projectNotes" rows="13" maxlength="100000" placeholder="Part choices, measurements, assembly order…">${htmlEscape(notebook.notes)}</textarea><p class="help-text">Saved with this project as you type. Markdown stays editable in the exported notes.</p><div class="notebook-actions"><button id="exportNotesBtn">Download notes (.md)</button><button id="notebookPrintBtn">Print worksheet</button></div></div><div><div class="section-heading"><h2>Assembly checklist</h2><span id="taskProgress" class="count-badge"></span></div><div id="assemblyTasks" class="assembly-tasks"></div><form id="addTaskForm"><label class="notebook-label" for="newTaskText">Add a step</label><div class="task-add"><input id="newTaskText" maxlength="2000" placeholder="e.g. Check resistor values" required/><button type="submit" class="primary">Add</button></div></form></div></div>`);
    let notesSnapshot = false;
    $("#projectNotes").oninput = event => {
      if (!notesSnapshot) { app.store.snapshot("Edit project notes"); notesSnapshot = true; }
      notebook.notes = event.target.value; app.scheduleAutosave("Notebook updated");
    };
    const renderTasks = () => {
      $("#taskProgress").textContent = `${notebook.tasks.filter(t => t.done).length}/${notebook.tasks.length}`;
      $("#assemblyTasks").innerHTML = notebook.tasks.map((task, index) => `<div class="assembly-task ${task.done ? "is-done" : ""}"><label><input type="checkbox" data-task-done="${index}" ${task.done ? "checked" : ""}/><span>${htmlEscape(task.text)}</span></label><button data-task-delete="${index}" aria-label="Remove task ${index + 1}">×</button></div>`).join("") || `<p class="empty-state">Keep track of soldering and verification steps here.</p>`;
    };
    renderTasks();
    $("#assemblyTasks").onchange = event => {
      if (event.target.dataset.taskDone == null) return;
      app.store.snapshot("Update assembly checklist"); notebook.tasks[Number(event.target.dataset.taskDone)].done = event.target.checked;
      app.scheduleAutosave("Checklist updated"); renderTasks();
    };
    $("#assemblyTasks").onclick = event => {
      const button = event.target.closest("[data-task-delete]"); if (!button) return;
      app.store.snapshot("Remove assembly step"); notebook.tasks.splice(Number(button.dataset.taskDelete), 1);
      app.scheduleAutosave("Checklist updated"); renderTasks();
    };
    $("#addTaskForm").onsubmit = event => {
      event.preventDefault(); const text = $("#newTaskText").value.trim(); if (!text) return;
      if (notebook.tasks.length >= 500) { app.reportError(new Error("The checklist can hold up to 500 steps.")); return; }
      app.store.snapshot("Add assembly step"); notebook.tasks.push({ text, done: false });
      $("#newTaskText").value = ""; app.scheduleAutosave("Checklist updated"); renderTasks();
    };
    $("#exportNotesBtn").onclick = () => downloadFile(`${app.store.state.name.replace(/[^a-z0-9_-]/gi, "_")}-notes.md`, notebookMarkdown(app.store.state), "text/markdown");
    $("#notebookPrintBtn").onclick = () => app.printer.showAssembly();
  }

  showCopperPlan() {
    const app = this.app, steps = assemblySteps(app.store.state);
    app.modal.open("Copper work plan", `<p class="help-text">Coordinates are <b>column, row</b> in the top view, counted from 1. Cuts sit between holes; both pads remain available. Bottom copper is shown as a ghost when you view the top.</p><div class="copper-plan">${steps.map((step, index) => `<div class="copper-step"><button data-copper-locate="${index}"><b>${htmlEscape(step.label)} · ${step.kind}</b><small>${coordinateText(step.from)} → ${coordinateText(step.to)} · ${step.side}${step.active ? "" : " · inactive"}</small></button><button data-copper-remove="${index}" aria-label="Remove ${htmlEscape(step.label)}">×</button></div>`).join("") || `<div class="empty-state">No cuts or solder bridges yet. Choose a copper tool from ⋯ in the editor toolbar.</div>`}</div>`);
    $(".copper-plan", app.modal.body).onclick = event => {
      const locate = event.target.closest("[data-copper-locate]"), remove = event.target.closest("[data-copper-remove]");
      if (locate) { const step = steps[Number(locate.dataset.copperLocate)]; app.modal.close(); app.setFace(step.side); app.focusPoint({ col: (step.from.col + step.to.col) / 2, row: (step.from.row + step.to.row) / 2 }); }
      if (remove) {
        const step = steps[Number(remove.dataset.copperRemove)]; app.store.snapshot("Remove copper operation");
        if (step.kind === "Cut") app.store.state.board.cuts.splice(Number(step.label.slice(1)) - 1, 1);
        else app.store.state.solderBridges = app.store.state.solderBridges.filter(b => b.id !== step.label);
        app.scheduleAutosave("Copper plan updated"); app.render(); this.showCopperPlan();
      }
    };
  }

  showExamples() {
    const app = this.app;
    app.modal.open("Start from an example", `<p class="help-text">Explore a completed layout. Your current work is kept in project recovery.</p><div class="example-grid"><button class="example-card" data-example="ADAU1701_perfboard_rev5_example.perfboard.json"><span class="example-icon">▦</span><b>ADAU1701 audio board</b><small>31 × 26 holes · 39 parts · 122 routes<br>A dense layout with a 48-pin adapter and audio connections.</small><span>Open layout →</span></button><button class="example-card" data-example="ADAU1701_LD1117_1V8_3V3_Regulator_compact_6x10_jumper.perfboard.json"><span class="example-icon">ϟ</span><b>Compact power supply</b><small>6 × 10 holes · 13 parts · 26 routes<br>A small dual-regulator layout with insulated bridges.</small><span>Open layout →</span></button></div>`);
    $(".example-grid", app.modal.body).insertAdjacentHTML("beforeend", `<button class="example-card" data-example="Stripboard_LED_indicator.perfboard.json"><span class="example-icon">≡</span><b>Stripboard LED indicator</b><small>12 × 10 holes · 4 parts · 1 cut · 1 solder bridge<br>Explore copper strips, planned nets and an assembly checklist. Complete the remaining 5V connection.</small><span>Open layout →</span></button>`);
    $$("[data-example]", app.modal.body).forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const response = await fetch(`examples/${button.dataset.example}`);
        if (!response.ok) throw new Error("The example could not be loaded.");
        app.storage.replaceProject(await response.json()); app.modal.close(); app.afterLoad();
      } catch (error) { app.reportError(error); button.disabled = false; }
    });
  }

  showRecovery() {
    const app = this.app;
    try {
      const items = app.storage.recoveryProjects();
      app.modal.open("Recover previous work", `<p class="help-text">The last 20 project snapshots are kept in this browser when you start, open or recover a project.</p><div class="recovery-list">${items.map((item, i) => `<button data-recovery="${i}"><b>${htmlEscape(item.state.name || "Untitled")}</b><small>${htmlEscape(new Date(item.savedAt).toLocaleString())} · ${item.state.components?.length || 0} parts · ${item.state.wires?.length || 0} wires</small></button>`).join("") || `<div class="empty-state">No previous projects yet. Your current project is saved automatically.</div>`}</div>`);
      $$("[data-recovery]", app.modal.body).forEach(button => button.onclick = () => {
        try { app.storage.replaceProject(items[Number(button.dataset.recovery)]); app.modal.close(); app.afterLoad(); } catch (error) { app.reportError(error); }
      });
    } catch (error) { app.reportError(error); }
  }

  showHelp() {
    this.app.modal.open("A few useful shortcuts", `<div class="shortcut-grid"><kbd>V / W / E / T</kbd><span>Select / wire / erase / note</span><kbd>C / B</kbd><span>Cut / restore a strip · solder bridge</span><kbd>R</kbd><span>Rotate the selected part or placement preview</span><kbd>Shift + click</kbd><span>Select multiple objects, or add a wire bend</span><kbd>Ctrl / ⌘ + D</kbd><span>Duplicate selection</span><kbd>Delete</kbd><span>Delete selection</span><kbd>Ctrl / ⌘ + Z</kbd><span>Undo · add Shift to redo</span><kbd>Ctrl / ⌘ + S</kbd><span>Save project</span><kbd>F / /</kbd><span>Fit board / search components</span><kbd>Space + drag</kbd><span>Pan the board (middle mouse also works)</span><kbd>Ctrl + wheel</kbd><span>Zoom around the pointer</span><kbd>Esc</kbd><span>Cancel placement or wire / close a dialog</span></div><p class="help-text">Wire: click to start, Shift+click for bends, then click to finish. Drag the selected wire’s handles to edit its route. Double-click a selected segment to add a handle.</p><p class="help-text">Stripboard copper is on the bottom face. A cut breaks the strip between adjacent holes. Click the same gap to restore it. Solder bridges join adjacent holes on the selected face; click the same pair again to remove one.</p><p class="help-text">Set Plan net on pins to show missing connections. Matching net names express a goal; only physical copper establishes continuity. Insulated wires contact only at their ends. PTH joins faces at route nodes or component pins.</p>`);
  }
}
