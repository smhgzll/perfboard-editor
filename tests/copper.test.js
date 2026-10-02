import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, newState } from '../js/model.js';
import { buildConnectivity } from '../js/connectivity.js';
import { analyzeNetworks, exportNetlist } from '../js/networks.js';
import { ElectricalChecks } from '../js/checks.js';
import { copperRuns } from '../js/copper.js';
import { notebookMarkdown } from '../js/assembly.js';
import { PrintService } from '../js/print.js';

function stripStore(vertical = false) {
  const store = new ProjectStore();
  Object.assign(store.state.board, { type: 'stripboard', cols: 8, rows: 8, stripDirection: vertical ? 'vertical' : 'horizontal', platedThroughHoles: false });
  return store;
}
const pinKey = part => `${part.id}|0`;
function pad(store, col, row, net) {
  const part = store.addComponent('testpad', col, row); part.pins[0].net = net;
  return part;
}

test('stripboard through-hole leads connect through bottom copper, independently of PTH', () => {
  const store = stripStore(), a = pad(store, 1, 2, 'GND'), b = pad(store, 6, 2, 'GND'), other = pad(store, 1, 3, '5V');
  const graph = buildConnectivity(store);
  assert.equal(graph.pinGroups.get(pinKey(a)), graph.pinGroups.get(pinKey(b)));
  assert.notEqual(graph.pinGroups.get(pinKey(a)), graph.pinGroups.get(pinKey(other)));
  assert.ok(graph.pins.has(pinKey(a)));
  assert.equal(analyzeNetworks(store).guides.length, 0);
});

test('a cut breaks physical continuity without merging equal net names; undo restores it', () => {
  const store = stripStore(), a = pad(store, 1, 2, '3.3V'), b = pad(store, 6, 2, '3V3');
  store.toggleCut({ axis: 'horizontal', col: 3, row: 2 });
  const graph = buildConnectivity(store), plan = analyzeNetworks(store, graph);
  assert.notEqual(graph.pinGroups.get(pinKey(a)), graph.pinGroups.get(pinKey(b)));
  assert.equal(plan.nets.length, 1); assert.equal(plan.guides.length, 1);
  assert.equal(new ElectricalChecks(store).run().filter(p => p.type === 'UNROUTED_NET').length, 1);
  const runs = copperRuns(store.state.board).filter(([p]) => p.row === 2);
  assert.equal(runs.length, 2); assert.ok(runs[0][1].col < runs[1][0].col);
  store.undo(); assert.equal(analyzeNetworks(store).guides.length, 0);
  store.redo(); assert.equal(analyzeNetworks(store).guides.length, 1);
});

test('vertical strips and vertical cuts connect the intended columns', () => {
  const store = stripStore(true), a = pad(store, 2, 1, 'A'), b = pad(store, 2, 6, 'A');
  assert.equal(analyzeNetworks(store).guides.length, 0);
  store.toggleCut({ axis: 'vertical', col: 2, row: 3 });
  const graph = buildConnectivity(store);
  assert.notEqual(graph.pinGroups.get(pinKey(a)), graph.pinGroups.get(pinKey(b)));
  assert.equal(analyzeNetworks(store).guides.length, 1);
  assert.throws(() => store.toggleCut({ axis: 'horizontal', col: 2, row: 3 }), /stripboard/);
});

test('a neighboring-pad solder bridge joins separate strips and can be toggled in either order', () => {
  const store = stripStore(), a = pad(store, 1, 2, 'GND'), b = pad(store, 6, 3, 'GND');
  assert.equal(analyzeNetworks(store).guides.length, 1);
  const bridge = store.toggleSolderBridge({ col: 3, row: 2 }, { col: 3, row: 3 });
  assert.equal(bridge.layer, 'bottom'); assert.equal(analyzeNetworks(store).guides.length, 0);
  const graph = buildConnectivity(store);
  assert.equal(graph.pinGroups.get(pinKey(a)), graph.pinGroups.get(pinKey(b)));
  store.toggleSolderBridge({ col: 3, row: 3 }, { col: 3, row: 2 });
  assert.equal(store.state.solderBridges.length, 0); assert.equal(analyzeNetworks(store).guides.length, 1);
  const history = store.history.length;
  assert.throws(() => store.toggleSolderBridge({ col: 1, row: 1 }, { col: 3, row: 1 }), /neighboring/);
  assert.equal(store.history.length, history);
});

test('bottom copper, insulated wires and non-PTH top wires stay electrically distinct', () => {
  const store = stripStore(), a = pad(store, 1, 2, 'GND'), b = pad(store, 6, 2, 'GND');
  store.toggleCut({ axis: 'horizontal', col: 3, row: 2 });
  store.addWire([{ col: 1, row: 2 }, { col: 6, row: 2 }], { layer: 'top', net: 'GND' });
  const topGraph = buildConnectivity(store);
  assert.notEqual(topGraph.pinGroups.get(pinKey(a)), topGraph.pinGroups.get(pinKey(b)));
  store.addWire([{ col: 1, row: 2 }, { col: 1, row: 4 }, { col: 6, row: 4 }, { col: 6, row: 2 }], { layer: 'bottom', net: 'GND', bridgeType: 'insulated' });
  const c = pad(store, 3, 4, 'OTHER');
  const graph = buildConnectivity(store);
  assert.equal(graph.pinGroups.get(pinKey(a)), graph.pinGroups.get(pinKey(b)));
  assert.notEqual(graph.pinGroups.get(pinKey(a)), graph.pinGroups.get(pinKey(c)));
});

test('nets on opposite sides of a cut conflict only after a conductor restores continuity', () => {
  const store = stripStore(); pad(store, 1, 2, 'GND'); pad(store, 6, 2, '5V');
  assert.ok(new ElectricalChecks(store).run().some(p => p.type === 'NET_CONFLICT'));
  store.toggleCut({ axis: 'horizontal', col: 3, row: 2 });
  assert.ok(!new ElectricalChecks(store).run().some(p => p.type === 'NET_CONFLICT'));
  store.addWire([{ col: 1, row: 2 }, { col: 6, row: 2 }], { layer: 'bottom', net: 'GND' });
  const problems = new ElectricalChecks(store).run();
  assert.ok(problems.some(p => p.type === 'NET_CONFLICT'));
  assert.ok(problems.some(p => p.type === 'CUT_BYPASSED'));
});

test('NC pins are excluded from planned links, but physical connections still raise a warning', () => {
  const store = new ProjectStore(), a = pad(store, 1, 2, 'GND'), b = pad(store, 6, 2, 'GND');
  b.pins[0].noConnect = true;
  assert.equal(analyzeNetworks(store).guides.length, 0);
  store.addWire([{ col: 1, row: 2 }, { col: 6, row: 2 }], { net: 'GND' });
  assert.ok(buildConnectivity(store).pins.has(pinKey(a)));
  assert.ok(new ElectricalChecks(store).run().some(p => p.type === 'NC_CONNECTED'));
});

test('routing guides span islands without redundant links, and vanish when routes complete', () => {
  const store = new ProjectStore(); pad(store, 1, 2, 'BUS'); pad(store, 6, 2, 'BUS'); pad(store, 6, 6, 'BUS');
  assert.equal(analyzeNetworks(store).guides.length, 2);
  store.addWire([{ col: 1, row: 2 }, { col: 6, row: 2 }], { net: 'BUS' });
  assert.equal(analyzeNetworks(store).guides.length, 1);
  store.addWire([{ col: 6, row: 2 }, { col: 6, row: 6 }], { net: 'BUS' });
  assert.equal(analyzeNetworks(store).guides.length, 0);
  assert.equal(exportNetlist(store).physicalIslands.length, 1);
});

test('stripboard, pin plans, solder bridges and notebook survive a project round trip', () => {
  const store = stripStore(), c = pad(store, 1, 2, 'GND');
  store.toggleCut({ axis: 'horizontal', col: 3, row: 2 });
  store.toggleSolderBridge({ col: 3, row: 2 }, { col: 3, row: 3 });
  store.state.notebook = { notes: '# Supply\nCheck polarity', tasks: [{ text: 'Inspect cut', done: true }] };
  const copy = new ProjectStore(); copy.load(JSON.parse(JSON.stringify(store.state)));
  assert.equal(copy.componentById(c.id).pins[0].net, 'GND');
  assert.deepEqual(copy.state.board.cuts, store.state.board.cuts);
  assert.deepEqual(copy.state.solderBridges, store.state.solderBridges);
  assert.deepEqual(copy.state.notebook, store.state.notebook);
  assert.match(notebookMarkdown(copy.state), /- \[x\] Inspect cut/);
});

test('malformed copper and notebook imports preserve the current project', () => {
  const store = stripStore(); pad(store, 1, 2, 'GND');
  const before = JSON.stringify(store.state);
  for (const raw of [
    { ...newState(), board: { ...newState().board, type: 'unknown' } },
    { ...newState(), solderBridges: [{ a: { col: 0, row: 0 }, b: { col: 3, row: 0 } }] },
    { ...newState(), notebook: { notes: {}, tasks: [] } },
    { ...newState(), board: { ...newState().board, cuts: [{ col: 1, row: 1, axis: 'bad' }] } }
  ]) { assert.throws(() => store.load(raw), /Invalid project/); assert.equal(JSON.stringify(store.state), before); }
});

test('assembly and mirrored bottom layout export actual copper work and escape user notes', () => {
  const store = stripStore(); pad(store, 1, 2, 'GND');
  store.toggleCut({ axis: 'horizontal', col: 3, row: 2 }); store.toggleSolderBridge({ col: 3, row: 2 }, { col: 3, row: 3 });
  store.state.notebook.notes = '<script>oops</script>'; store.state.notebook.tasks = [{ text: 'Inspect <LED>', done: false }];
  const printer = new PrintService(store, null), bottom = printer.buildBoardLayoutSvg('bottom'), top = printer.buildBoardLayoutSvg('top');
  assert.match(bottom, /scale\(-1 1\)/); assert.match(bottom, /class="copper-strip"/); assert.match(bottom, /class="copper-cut"/); assert.match(bottom, /class="solder-bridge"/);
  assert.doesNotMatch(top, /class="copper-strip"/);
  const document = printer.buildAssemblyDocument();
  assert.match(document, /C1/); assert.match(document, /SB1/); assert.match(document, /&lt;script&gt;/); assert.doesNotMatch(document, /<script>oops/);
  const exported = exportNetlist(store); assert.equal(exported.coordinateBase, 1); assert.equal(exported.physicalIslands[0].pins[0].col, 2);
});
