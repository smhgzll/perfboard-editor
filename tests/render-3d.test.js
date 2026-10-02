import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../js/model.js';
import { COMPONENT_CATALOG } from '../js/catalog.js';
import { Render3DService } from '../js/render-3d.js';
import { componentFamily, componentFrame, copperStripGeometry, perforatedBoardGeometry, resistorBands, roundPolyline } from '../js/geometry-3d.js';
import { copperRuns } from '../js/copper.js';

test('3D frames align every catalog pin at all rotations and on both mounting faces', () => {
  for (const { kind } of COMPONENT_CATALOG) for (const side of ['top', 'bottom']) for (const rot of [0, 90, 180, 270]) {
    const store = new ProjectStore();
    Object.assign(store.state.board, { cols: 100, rows: 100, gridUnit: '5.08mm' });
    const c = store.addComponent(kind, 20, 20); c.side = side; c.rot = rot;
    const frame = componentFrame(store, c), renderer = new Render3DService(store, null);
    for (const [i, pin] of store.pinsFor(c).entries()) {
      const p = frame.pins[i], expected = renderer.gridTo3D(pin.col, pin.row);
      const x = frame.x + p.x * Math.cos(frame.rotation) + p.z * Math.sin(frame.rotation);
      const z = frame.z - p.x * Math.sin(frame.rotation) + p.z * Math.cos(frame.rotation);
      assert.ok(Math.abs(x - expected.x) < 1e-8 && Math.abs(z - expected.z) < 1e-8, `${kind} ${side} ${rot} pin ${i}`);
    }
    assert.equal(frame.side, side === 'bottom' ? -1 : 1);
  }
});

test('3D distinguishes adapters, axial/radial packages and SMD parts', () => {
  assert.equal(componentFamily({ kind: 'ic', value: 'ADAU1701 LQFP-48 adapter' }), 'adapter');
  for (const [kind, family] of [['dip28', 'dip'], ['electrolyticRadial2', 'electrolytic'], ['smdElectrolytic', 'smd'], ['resistorVertical', 'resistor'], ['regulatorTo220', 'to220'], ['screwTerminal2', 'terminal']]) assert.equal(componentFamily({ kind }), family);
});

test('resistor markings handle decimal and embedded units, tolerance and rounding carry', () => {
  assert.deepEqual(resistorBands('2k2 1%'), resistorBands('2200R 1%'));
  assert.deepEqual(resistorBands('4.7M'), resistorBands('4700000R'));
  assert.deepEqual(resistorBands('0.47R'), resistorBands('R47'));
});

test('resistor markings handle zero, unknown values and large round-up values safely', () => {
  assert.equal(resistorBands('0R').length, 1);
  assert.deepEqual(resistorBands('unknown'), []);
  assert.equal(resistorBands('9999R').length, 5);
  assert.equal(resistorBands('10k 1%').at(-1), '#694329');
  assert.equal(resistorBands('10k 5%').at(-1), '#c8a45a');
});

test('rounded wire routes keep endpoints, continuity and bounds even with repeated vertices', () => {
  const points = [{ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }, { x: 4, y: 1, z: 5 }];
  const route = roundPolyline(points);
  assert.deepEqual(route[0], points[0]); assert.deepEqual(route.at(-1), points.at(-1));
  assert.ok(route.length > points.length);
  assert.ok(route.every(p => Number.isFinite(p.x + p.y + p.z) && p.x >= 0 && p.x <= 4 && p.z >= 0 && p.z <= 5));
  assert.ok(route.some(p => p.x < 4 && p.z > 0));
});

function covers(geometry, x, z, y) {
  const vertex = i => geometry.positions.slice(i * 3, i * 3 + 3);
  const cross = (a, b, px, pz) => (b[0] - a[0]) * (pz - a[2]) - (b[2] - a[2]) * (px - a[0]);
  for (let i = 0; i < geometry.indices.length; i += 3) {
    const [a, b, c] = geometry.indices.slice(i, i + 3).map(vertex);
    if (y !== undefined && [a, b, c].some(p => Math.abs(p[1] - y) > 1e-7)) continue;
    if (Math.abs(cross(a, b, c[0], c[2])) < 1e-8) continue;
    const sides = [cross(a, b, x, z), cross(b, c, x, z), cross(c, a, x, z)];
    if (sides.every(v => v >= -1e-8) || sides.every(v => v <= 1e-8)) return true;
  }
  return false;
}

test('board geometry has open holes on both faces, complete slab edges and physical thickness', () => {
  const board = { cols: 3, rows: 2, holeDiameterMm: 0.9, gridUnit: '2.54mm' }, pitch = 2.54;
  const geometry = perforatedBoardGeometry(board), renderer = new Render3DService({ state: { board } }, null);
  assert.ok(geometry.positions.every(Number.isFinite));
  assert.ok(geometry.indices.every(i => i < geometry.positions.length / 3));
  for (let row = 0; row < board.rows; row++) for (let col = 0; col < board.cols; col++) {
    const p = renderer.gridTo3D(col, row);
    for (const y of [-0.8, 0.8]) {
      assert.equal(covers(geometry, p.x, p.z, y), false);
      assert.equal(covers(geometry, p.x + 0.8, p.z, y), true);
    }
  }
  const xs = geometry.positions.filter((_, i) => i % 3 === 0), ys = geometry.positions.filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - board.cols * pitch) < 1e-8);
  assert.equal(Math.max(...ys) - Math.min(...ys), 1.6);
});

test('3D copper preserves holes and actual cut gaps in both strip directions', () => {
  for (const direction of ['horizontal', 'vertical']) {
    const store = new ProjectStore(), board = store.state.board;
    Object.assign(board, { type: 'stripboard', cols: 5, rows: 5, stripDirection: direction, cuts: [{ col: 1, row: 1, axis: direction }] });
    const renderer = new Render3DService(store, null), strips = copperRuns(board).map(([a, b]) => copperStripGeometry(board, a, b));
    assert.equal(strips.length, 6);
    for (let row = 0; row < board.rows; row++) for (let col = 0; col < board.cols; col++) {
      const p = renderer.gridTo3D(col, row);
      assert.equal(strips.some(s => covers(s, p.x, p.z)), false, `hole ${col},${row}`);
    }
    const gap = renderer.gridTo3D(direction === 'horizontal' ? 1.5 : 1, direction === 'vertical' ? 1.5 : 1);
    assert.equal(strips.some(s => covers(s, gap.x, gap.z)), false);
    const uncut = renderer.gridTo3D(direction === 'horizontal' ? 2.5 : 1, direction === 'vertical' ? 2.5 : 1);
    assert.equal(strips.some(s => covers(s, uncut.x, uncut.z)), true);
  }
});

test('jumper wires remain continuous physical conductors with contacts on the correct face', () => {
  const store = new ProjectStore(), renderer = new Render3DService(store, null), tubes = [];
  store.state.wires = [{ id: 'W1', layer: 'jumper', style: 'dashed', route: [{ col: 1, row: 1 }, { col: 4, row: 1 }, { col: 4, row: 3 }] }, { id: 'W2', layer: 'bottom', route: [{ col: 1, row: 2 }, { col: 3, row: 2 }] }];
  renderer.createTube = (B, points, wire, radius, metal) => tubes.push({ points, wire, radius, metal });
  renderer.buildWires(null);
  const jumper = tubes.filter(t => t.wire.id === 'W1');
  assert.equal(jumper.length, 3); // Two bare contacts and a single continuous jacket.
  assert.ok(jumper.every(t => t.points.every(p => p.y > 0)));
  assert.ok(jumper[2].points.length > 3);
  assert.ok(tubes.find(t => t.wire.id === 'W2').points.every(p => p.y < 0));
});

test('copper does not cap larger board holes at strip edges', () => {
  const board = { type: 'stripboard', stripDirection: 'horizontal', cols: 3, rows: 1, holeDiameterMm: 2, gridUnit: '2.54mm' };
  const geometry = copperStripGeometry(board, { col: -0.35, row: 0 }, { col: 2.35, row: 0 });
  for (const x of [-0.5, 0, 0.5]) for (const z of [-0.5, 0, 0.5]) assert.equal(covers(geometry, x, z), false);
  assert.equal(covers(geometry, 1.27, 0), true);
});
