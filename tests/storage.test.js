import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, newState } from '../js/model.js';
import { ProjectStorage } from '../js/storage.js';
let values;
beforeEach(() => {
  values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
});
const setup = () => { const store = new ProjectStore(); return { store, storage: new ProjectStorage(store, () => {}) }; };

test('opening a new project archives work and releases the previous file handle', () => {
  const { store, storage } = setup(); store.addComponent('resistor', 0, 0);
  storage.fileHandle = { name: 'old.json' }; storage.replaceProject(newState());
  assert.equal(store.state.components.length, 0); assert.equal(storage.fileHandle, null);
  assert.equal(storage.recoveryProjects()[0].state.components.length, 1);
});

test('recovery quota failure does not replace current work', () => {
  const { store, storage } = setup(); store.addText(1, 1, 'Do not lose me');
  const original = store.state;
  globalThis.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.throws(() => storage.replaceProject(newState()), /Quota/);
  assert.equal(store.state, original);
});

test('malformed imports do not archive, change the file handle or replace work', () => {
  const { store, storage } = setup(); store.addComponent('resistor', 0, 0);
  const handle = { name: 'original.json' }; storage.fileHandle = handle;
  assert.throws(() => storage.replaceProject({ something: [] }), /Invalid project/);
  assert.equal(storage.fileHandle, handle); assert.equal(store.state.components.length, 1); assert.equal(storage.recoveryProjects().length, 0);
});

test('browser autosave does not mark edits as saved to disk', () => {
  const { store, storage } = setup(); store.addText(0, 0, 'Unsaved');
  assert.equal(storage.dirty, true); assert.equal(storage.autosave(), true); assert.equal(storage.dirty, true);
  const restored = setup(); assert.equal(restored.storage.restoreAutosave(), true); assert.equal(restored.store.state.texts[0].text, 'Unsaved');
});

test('file writes preserve edits made while the write is in progress as dirty', async () => {
  const { store, storage } = setup(); store.addText(0, 0, 'Original');
  let written;
  const handle = { createWritable: async () => ({ write: async data => { written = JSON.parse(data); store.state.texts[0].text = 'New edit'; }, close: async () => {} }) };
  await storage.writeHandle(handle);
  assert.equal(written.state.texts[0].text, 'Original'); assert.equal(storage.dirty, true);
});

test('a file save finishing after a project switch cannot adopt the old file or saved baseline', async () => {
  const { store, storage } = setup(); store.addText(0, 0, 'First project');
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; });
  storage.fileHandle = { name: 'first.json', createWritable: async () => ({ write: async () => delayed, close: async () => {} }) };
  const saving = storage.save();
  storage.replaceProject(newState());
  const baseline = storage.savedContent;
  finish(); await saving;
  assert.equal(storage.fileHandle, null); assert.equal(storage.savedContent, baseline);
});
