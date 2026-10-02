import { buildConnectivity, canonicalNet, isAutomaticNet, holeKey } from "./connectivity.js";

// A deterministic minimum spanning tree over PHYSICAL islands. Dashed links
// suggest where a named net still needs copper; no guide is an electrical joint.
export function analyzeNetworks(store, graph = buildConnectivity(store)) {
  const byName = new Map();
  graph.groups.forEach(group => {
    const names = [...group.nets].filter(n => !isAutomaticNet(n));
    for (const name of names) {
      const key = canonicalNet(name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, { name, key, groups: new Set(), guides: [], pins: [], wireIds: new Set() });
      byName.get(key).groups.add(group);
    }
  });
  const nets = [...byName.values()].sort((a, b) => a.key.localeCompare(b.key)), guides = [];
  for (const net of nets) {
    net.groups = [...net.groups];
    net.pins = net.groups.flatMap(g => g.pins.filter(p => !p.pin.noConnect));
    net.groups.forEach(g => g.wires.forEach(w => net.wireIds.add(w.id)));
    const points = net.groups.map(g => {
      const unique = new Map();
      g.points.forEach(p => {
        const pin = p.pinIndex == null ? null : store.componentById(p.selection.id)?.pins[p.pinIndex];
        if (!pin?.noConnect) unique.set(`${p.side}:${holeKey(p)}`, p);
      });
      return [...unique.values()];
    });
    const joined = new Set(net.groups.length ? [0] : []);
    const frontier = new Map();
    const updateFrontier = i => {
      for (let j = 0; j < net.groups.length; j++) {
        if (joined.has(j)) continue;
        for (const a of points[i]) for (const b of points[j]) {
          const cost = Math.abs(a.col - b.col) + Math.abs(a.row - b.row) + (a.side === b.side ? 0 : 0.25);
          if (!frontier.has(j) || cost < frontier.get(j).cost) frontier.set(j, { a, b, cost, next: j });
        }
      }
    };
    if (net.groups.length) updateFrontier(0);
    while (joined.size < net.groups.length) {
      let best;
      frontier.forEach(candidate => { if (!best || candidate.cost < best.cost) best = candidate; });
      if (!best) break;
      joined.add(best.next); frontier.delete(best.next); updateFrontier(best.next);
      const guide = { id: `${net.key}:${net.guides.length}`, net: net.name, a: best.a, b: best.b };
      net.guides.push(guide); guides.push(guide);
    }
  }
  return { nets, guides };
}

export function exportNetlist(store) {
  const graph = buildConnectivity(store), networks = analyzeNetworks(store, graph);
  const pinRecord = p => ({ componentId: p.component.id, reference: p.component.name, number: p.pin.number, name: p.pin.name, net: p.pin.net || "", noConnect: !!p.pin.noConnect, col: p.col + 1, row: p.row + 1 });
  return {
    format: "perfboard-connectivity", version: 1, project: store.state.name,
    coordinateBase: 1, board: { type: store.state.board.type, cols: store.state.board.cols, rows: store.state.board.rows, pitchMm: parseFloat(store.state.board.gridUnit) || 2.54 },
    physicalIslands: graph.groups.map((g, i) => ({ id: `island-${i + 1}`, nets: [...g.nets], wires: g.wires.map(w => w.id), solderBridges: g.bridges.map(b => b.id), pins: g.pins.map(pinRecord) })),
    plannedNets: networks.nets.map(n => ({ name: n.name, physicalIslands: n.groups.length, missingConnections: n.guides.length })),
    missingConnections: networks.guides.map(g => ({ net: g.net, from: { col: g.a.col + 1, row: g.a.row + 1, side: g.a.side }, to: { col: g.b.col + 1, row: g.b.row + 1, side: g.b.side } }))
  };
}
