import { clone } from "./core.js";

const AUTOSAVE_KEY = "perfboard.clean.activeProject";

export class ProjectStorage {
  constructor(store, onStatus) {
    this.store = store;
    this.onStatus = onStatus;
    this.fileHandle = null;
  }

  payload() {
    return JSON.stringify({
      app: "Perfboard Editor Clean Build",
      savedAt: new Date().toISOString(),
      state: this.store.state
    }, null, 2);
  }

  autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, this.payload());
      this.onStatus("Autosaved");
      return true;
    } catch (error) {
      this.onStatus(`Autosave failed: ${error.message}`);
      return false;
    }
  }

  restoreAutosave() {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return false;
      this.store.load(JSON.parse(text));
      this.onStatus("Restored browser autosave");
      return true;
    } catch (error) {
      this.onStatus(`Autosave restore failed: ${error.message}`);
      return false;
    }
  }

  async openWithPicker(fileInput) {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Perfboard JSON", accept: { "application/json": [".json", ".perfboard.json"] } }],
        multiple: false
      });
      const file = await handle.getFile();
      await this.openFile(file);
      this.fileHandle = handle;
      this.onStatus(`Opened ${file.name}`);
      return;
    }
    fileInput.click();
  }

  async openFile(file) {
    const text = await file.text();
    this.store.load(JSON.parse(text));
    this.onStatus(`Opened ${file.name}`);
  }

  async save() {
    if (this.fileHandle) {
      await this.writeHandle(this.fileHandle);
      this.autosave();
      this.onStatus(`Saved ${this.fileHandle.name}`);
      return;
    }
    await this.saveAs();
  }

  async saveAs() {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${this.safeName(this.store.state.name)}.perfboard.json`,
        types: [{ description: "Perfboard JSON", accept: { "application/json": [".json", ".perfboard.json"] } }]
      });
      this.fileHandle = handle;
      await this.writeHandle(handle);
      this.autosave();
      this.onStatus(`Saved as ${handle.name}`);
      return;
    }
    this.downloadBackup();
  }

  async writeHandle(handle) {
    const writable = await handle.createWritable();
    await writable.write(this.payload());
    await writable.close();
  }

  downloadBackup() {
    const blob = new Blob([this.payload()], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${this.safeName(this.store.state.name)}.perfboard.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.autosave();
    this.onStatus("Downloaded backup JSON");
  }

  safeName(value) {
    return String(value || "perfboard-project").trim().replace(/[^a-z0-9_\-]+/gi, "_").replace(/^_+|_+$/g, "") || "perfboard-project";
  }
}
