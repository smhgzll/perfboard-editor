import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../js/model.js';
import { buildConnectivity, routeHoles, routeContains } from '../js/connectivity.js';
import { ElectricalChecks } from '../js/checks.js';
const wire = (store, route, net, options = {}) => store.addWire(route.map(([col, row]) => ({ col, row })), { net, ...options });

test('a T junction on a bare segment is connected and conflicting names are reported', () => {
  const store = new ProjectStore();
  wire(store, [[0, 0], [4, 0]], 'GND'); wire(store, [[2, 0], [2, 3]], '5V');
  assert.equal(buildConnectivity(store).groups.length, 1);
  assert.equal(new ElectricalChecks(store).run()[0].type, 'NET_CONFLICT');
});

test('same-side shared endpoints remain connected with PTH disabled', () => {
  const store = new ProjectStore(); store.state.board.platedThroughHoles = false;
  wire(store, [[0, 0], [3, 0]], 'GND'); wire(store, [[0, 0], [0, 3]], '5V');
  assert.equal(new ElectricalChecks(store).run()[0].type, 'NET_CONFLICT');
});

test('opposite faces join only through a PTH contact', () => {
  const store = new ProjectStore(); store.state.board.platedThroughHoles = false;
  wire(store, [[0, 0], [3, 0]], 'GND'); wire(store, [[0, 0], [0, 3]], '5V', { layer: 'bottom' });
  assert.equal(buildConnectivity(store).groups.length, 2);
  store.state.board.platedThroughHoles = true;
  assert.equal(buildConnectivity(store).groups.length, 1);
});

test('crossing insulated wire interiors do not join or connect pins', () => {
  const store = new ProjectStore();
  wire(store, [[0, 2], [2, 2], [4, 2]], '5V', { bridgeType: 'insulated' });
  wire(store, [[2, 0], [2, 4]], 'GND');
  assert.equal(buildConnectivity(store).groups.length, 2);
  const pin = store.addComponent('testpad', 1, 2);
  assert.ok(new ElectricalChecks(store).run().some(p => p.type === 'FLOATING_PIN' && p.selection.id === pin.id));
});

test('insulated wire ends connect and automatic net names do not create conflicts', () => {
  const store = new ProjectStore();
  wire(store, [[0, 0], [2, 0]], '3.3V'); wire(store, [[2, 0], [3, 3]], '3V3', { bridgeType: 'insulated' });
  wire(store, [[3, 3], [4, 4]], 'W3');
  assert.equal(buildConnectivity(store).groups.length, 1); assert.equal(new ElectricalChecks(store).run().length, 0);
});

test('pin on a bare route interior connects; NC suppresses intentional floating warnings', () => {
  const store = new ProjectStore(); const part = store.addComponent('resistor', 2, 0);
  wire(store, [[0, 0], [3, 0]], 'SIGNAL');
  assert.ok(buildConnectivity(store).pins.has(`${part.id}|0`));
  assert.equal(new ElectricalChecks(store).run().filter(p => p.type === 'FLOATING_PIN').length, 1);
  part.pins[1].noConnect = true;
  assert.equal(new ElectricalChecks(store).run().length, 0);
});

test('off-board pins and wire points are reported independently of connections', () => {
  const store = new ProjectStore(); const part = store.addComponent('resistor', 0, 0); part.col = 30;
  wire(store, [[30, 0], [33, 0]], 'OUT');
  assert.equal(new ElectricalChecks(store).run().filter(p => p.type === 'OUTSIDE_BOARD').length, 3);
});

test('diagonal routes enumerate only integer grid holes, and eraser hit testing covers segments', () => {
  const w = { route: [{ col: 0, row: 0 }, { col: 6, row: 4 }] };
  assert.deepEqual(routeHoles(w).map(p => [p.col, p.row]).sort(), [[0, 0], [3, 2], [6, 4]].sort());
  assert.equal(routeContains(w.route, { col: 3, row: 2 }), true);
  assert.equal(routeContains(w.route, { col: 3, row: 3 }), false);
});
