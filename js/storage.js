const AUTOSAVE_KEY = "perfboard.clean.activeProject";
const RECOVERY_KEY = "perfboard.recovery.v1";

export function downloadFile(filename, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class ProjectStorage {
  constructor(store, onStatus) {
    this.store = store;
    this.onStatus = onStatus;
    this.fileHandle = null;
    this.savedContent = JSON.stringify(store.state);
    this.lastAutosave = "";
  }

  get dirty() { return JSON.stringify(this.store.state) !== this.savedContent; }

  payload() {
    return JSON.stringify({ app: "Perfboard Editor", savedAt: new Date().toISOString(), state: this.store.state }, null, 2);
  }

  autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, this.payload());
      this.lastAutosave = JSON.stringify(this.store.state);
      this.onStatus(this.dirty ? "Browser saved · file unsaved" : "Saved");
      return true;
    } catch (error) {
      this.onStatus(`Browser save failed: ${error.message}. Export a backup.`);
      return false;
    }
  }

  recoveryProjects() {
    const value = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "[]");
    if (!Array.isArray(value)) throw new Error("Recovery history could not be read. Export a backup before switching projects.");
    return value;
  }

  archiveCurrent() {
    if (!this.store.state.components.length && !this.store.state.wires.length && !this.store.state.texts.length && !this.store.state.customTemplates.length && !this.store.state.solderBridges.length && !this.store.state.board.cuts.length && !this.store.state.notebook.notes && !this.store.state.notebook.tasks.length) return;
    const payload = JSON.parse(this.payload());
    const projects = this.recoveryProjects();
    if (projects[0] && JSON.stringify(projects[0].state) === JSON.stringify(payload.state)) return;
    // Write the recovery copy before replacing the current project. On quota
    // failure the caller keeps the current project intact.
    localStorage.setItem(RECOVERY_KEY, JSON.stringify([payload, ...projects].slice(0, 20)));
  }

  restoreAutosave() {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return false;
      this.store.load(JSON.parse(text));
      this.lastAutosave = JSON.stringify(this.store.state);
      this.onStatus("Restored browser copy · export to save a file");
      return true;
    } catch (error) { this.onStatus(`Restore failed: ${error.message}`); return false; }
  }

  replaceProject(raw, { fileHandle = null, saved = false } = {}) {
    // Validation is transactional: a bad file must not clear the current work.
    const next = this.store.normalizeValidated(raw);
    this.archiveCurrent();
    this.store.load(next);
    this.fileHandle = fileHandle;
    this.savedContent = saved ? JSON.stringify(this.store.state) : "";
    this.autosave();
  }

  async openWithPicker(fileInput) {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: "Perfboard project", accept: { "application/json": [".json", ".perfboard.json"] } }], multiple: false });
      await this.openFile(await handle.getFile(), handle);
      return true;
    }
    fileInput.click();
    return false;
  }

  async openFile(file, handle = null) {
    if (file.size > 10 * 1024 * 1024) throw new Error("Project file is too large (maximum 10 MB).");
    this.replaceProject(JSON.parse(await file.text()), { fileHandle: handle, saved: true });
    this.onStatus(`Opened ${file.name}`);
  }

  async save() {
    if (!this.fileHandle) return this.saveAs();
    const handle = this.fileHandle, projectId = this.store.state.projectId;
    await this.writeHandle(handle);
    if (this.store.state.projectId !== projectId) return;
    this.autosave();
    this.onStatus(this.dirty ? "New changes · file unsaved" : `Saved ${handle.name}`);
  }

  async saveAs() {
    if (!window.showSaveFilePicker) return this.downloadBackup();
    const projectId = this.store.state.projectId;
    const handle = await window.showSaveFilePicker({ suggestedName: `${this.safeName(this.store.state.name)}.perfboard.json`, types: [{ description: "Perfboard project", accept: { "application/json": [".json", ".perfboard.json"] } }] });
    if (this.store.state.projectId !== projectId) return;
    await this.writeHandle(handle);
    if (this.store.state.projectId !== projectId) return;
    this.fileHandle = handle;
    this.autosave();
    this.onStatus(this.dirty ? "New changes · file unsaved" : `Saved ${handle.name}`);
  }

  async writeHandle(handle) {
    const content = JSON.stringify(this.store.state), payload = this.payload(), projectId = this.store.state.projectId;
    const writable = await handle.createWritable();
    try { await writable.write(payload); await writable.close(); }
    catch (error) { await writable.abort?.().catch(() => {}); throw error; }
    if (this.store.state.projectId === projectId) this.savedContent = content;
  }

  downloadBackup() {
    downloadFile(`${this.safeName(this.store.state.name)}.perfboard.json`, this.payload());
    this.savedContent = JSON.stringify(this.store.state);
    this.autosave();
    this.onStatus("Project downloaded");
  }

  safeName(value) {
    return String(value || "perfboard-project").trim().replace(/[^a-z0-9_\-]+/gi, "_").replace(/^_+|_+$/g, "") || "perfboard-project";
  }
}
