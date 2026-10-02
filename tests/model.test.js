import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ProjectStore, newState } from '../js/model.js';
import { Geometry } from '../js/core.js';
import { COMPONENT_CATALOG } from '../js/catalog.js';

for (const file of readdirSync(new URL('../examples/', import.meta.url))) {
  test(`legacy example round trip preserves coordinates: ${file}`, () => {
    const raw = JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url)));
    const originalPins = raw.state.components.flatMap(c => c.pins.map(p => Geometry.pinAbsolute(c, p)));
    const store = new ProjectStore(); store.load(raw);
    assert.deepEqual(store.allPins().map(({ col, row }) => ({ col, row })), originalPins);
    assert.deepEqual(store.state.wires.map(w => w.route), raw.state.wires.map(w => w.route));
    const copy = new ProjectStore(); copy.load(JSON.parse(JSON.stringify({ state: store.state })));
    assert.deepEqual(copy.state, store.state);
  });
}

test('all catalog footprints have unique pins and a usable reference', () => {
  const store = new ProjectStore();
  store.state.board.cols = 100; store.state.board.rows = 100;
  for (const item of COMPONENT_CATALOG) {
    const part = store.addComponent(item.kind, 0, 0);
    assert.ok(part.pins.length);
    assert.equal(new Set(part.pins.map(p => String(p.number))).size, part.pins.length, item.kind);
    assert.equal(part.name, part.id);
    assert.equal(new Set(part.pins.map(p => `${p.x},${p.y}`)).size, part.pins.length, item.kind);
  }
});

test('5.08mm terminals use two grid pitches', () => {
  const store = new ProjectStore();
  for (const kind of ['screwTerminal2', 'screwTerminal3', 'screwTerminal4']) {
    const p = store.components.create(kind, 0, 0).pins;
    assert.equal(p[1].x - p[0].x, 2);
  }
});

test('placement fits all rotations at the board edge and rejects oversized parts', () => {
  const store = new ProjectStore();
  for (const rot of [0, 90, 180, 270]) {
    const c = store.addComponent('dip14', 29, 19, rot);
    assert.ok(store.pinsFor(c).every(p => p.col >= 0 && p.row >= 0 && p.col < 30 && p.row < 20));
  }
  store.state.board.cols = 5; store.state.board.rows = 5;
  const count = store.state.components.length, history = store.history.length;
  assert.throws(() => store.addComponent('dip40', 0, 0), /larger than/);
  assert.equal(store.state.components.length, count); assert.equal(store.history.length, history);
});

test('missing and duplicate IDs are repaired without changing unique imported IDs', () => {
  const store = new ProjectStore();
  const raw = newState(); raw.components = [{ kind: 'resistor', id: 'R1' }, { kind: 'resistor' }, { kind: 'resistor', id: 'R1' }, { kind: 'resistor', id: 'R2' }];
  raw.wires = [{ id: 'R2', route: [] }, { route: [] }];
  store.load(raw);
  const ids = [...store.state.components, ...store.state.wires].map(i => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(store.state.components[0].id, 'R1'); assert.equal(store.state.components[3].id, 'R2');
});

test('invalid project leaves current state and history untouched', () => {
  const store = new ProjectStore(); store.addComponent('resistor', 0, 0);
  const before = JSON.stringify(store.state), history = store.history.length;
  for (const data of [{}, { ...newState(), board: { cols: Infinity, rows: 20 } }, { ...newState(), components: [null] }, { ...newState(), wires: [{ route: [{ col: 'bad', row: 2 }] }] }]) {
    assert.throws(() => store.load(data), /Invalid project/);
    assert.equal(JSON.stringify(store.state), before); assert.equal(store.history.length, history);
  }
});

test('notes and board settings participate in undo and redo', () => {
  const store = new ProjectStore(); const note = store.addText(1, 2, 'Voltage test');
  assert.equal(store.state.texts[0].text, 'Voltage test');
  store.undo(); assert.equal(store.state.texts.length, 0);
  store.redo(); assert.equal(store.state.texts[0].id, note.id);
  store.snapshot('Resize board'); store.state.board.cols = 40;
  store.undo(); assert.equal(store.state.board.cols, 30);
  store.redo(); assert.equal(store.state.board.cols, 40);
});

test('zero-length wire gestures do not create a wire or history entry', () => {
  const store = new ProjectStore();
  assert.equal(store.addWire([{ col: 2, row: 2 }, { col: 2, row: 2 }]), null);
  assert.equal(store.history.length, 0); assert.equal(store.state.wires.length, 0);
});

test('numeric strings from legacy projects are normalized before coordinate arithmetic', () => {
  const raw = newState(); raw.board.cols = '30'; raw.board.margin = '46';
  raw.texts = [{ id: 'T1', text: 'Label', col: '1', row: '2' }];
  const store = new ProjectStore(); store.load(raw);
  assert.deepEqual(Geometry.gridToSvg(store.state.board, store.state.texts[0]), { x: 68, y: 90 });
  assert.equal(store.state.texts[0].col + 1, 2);
});
