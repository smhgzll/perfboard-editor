import { copperLinks, pinContactSide } from "./copper.js";

export const holeKey = point => `${point.col},${point.row}`;
export const isInsulated = wire => wire.layer === "jumper" || ["jumper", "insulated"].includes(wire.bridgeType);
export function segmentContains(a, b, p) {
  return (b.col - a.col) * (p.row - a.row) === (b.row - a.row) * (p.col - a.col)
    && p.col >= Math.min(a.col, b.col) && p.col <= Math.max(a.col, b.col)
    && p.row >= Math.min(a.row, b.row) && p.row <= Math.max(a.row, b.row);
}
export function routeContains(route, point) {
  return route.some((p, i) => i > 0 && segmentContains(route[i - 1], p, point));
}
export function routeHoles(wire) {
  const route = wire.route || [];
  if (isInsulated(wire)) return route.length ? [route[0], route[route.length - 1]] : [];
  const points = new Map();
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  route.forEach((end, i) => {
    points.set(holeKey(end), end);
    if (!i) return;
    const start = route[i - 1], dx = end.col - start.col, dy = end.row - start.row;
    const steps = gcd(Math.abs(dx), Math.abs(dy));
    for (let j = 1; j < steps; j++) {
      const p = { col: start.col + dx * j / steps, row: start.row + dy * j / steps };
      points.set(holeKey(p), p);
    }
  });
  return [...points.values()];
}

// One physical graph powers the editor, checks, routing guides and exports.
// Net names express intended connections; they NEVER join disconnected copper.
export function buildConnectivity(store) {
  const { board, wires } = store.state, allPins = store.allPins();
  const parents = new Map(), ranks = new Map();
  const root = key => {
    if (!parents.has(key)) { parents.set(key, key); ranks.set(key, 0); }
    let r = key;
    while (parents.get(r) !== r) r = parents.get(r);
    while (parents.get(key) !== key) { const next = parents.get(key); parents.set(key, r); key = next; }
    return r;
  };
  const join = (a, b) => {
    a = root(a); b = root(b); if (a === b) return;
    if (ranks.get(a) < ranks.get(b)) [a, b] = [b, a];
    parents.set(b, a); if (ranks.get(a) === ranks.get(b)) ranks.set(a, ranks.get(a) + 1);
  };
  const face = layer => layer === "jumper" ? "top" : layer;
  const contact = (side, point) => `${side}:${holeKey(point)}`;
  const through = p => { if (board.platedThroughHoles) join(contact("top", p), contact("bottom", p)); };
  const holes = new Map();
  copperLinks(board).forEach(([a, b]) => join(contact("bottom", a), contact("bottom", b)));
  wires.forEach((wire, index) => {
    const anchor = `wire:${wire.id}`, nodes = new Set((wire.route || []).map(holeKey));
    root(anchor);
    routeHoles(wire).forEach(point => {
      const key = holeKey(point);
      if (!holes.has(key)) holes.set(key, []);
      holes.get(key).push({ wire, index, node: nodes.has(key) });
      join(anchor, contact(face(wire.layer), point));
      if (nodes.has(key)) through(point);
    });
  });
  const bridges = store.state.solderBridges || [];
  bridges.forEach(bridge => {
    join(contact(bridge.layer, bridge.a), contact(bridge.layer, bridge.b));
    through(bridge.a); through(bridge.b);
  });
  allPins.forEach(pin => { root(contact(pinContactSide(board, pin), pin)); through(pin); });
  const groups = new Map(), wireGroups = new Map(), pinGroups = new Map(), pins = new Map();
  const groupFor = key => {
    const id = root(key);
    if (!groups.has(id)) groups.set(id, { id, wires: [], bridges: [], nets: new Set(), pins: [], points: [] });
    return groups.get(id);
  };
  wires.forEach(wire => {
    const group = groupFor(`wire:${wire.id}`);
    group.wires.push(wire); group.nets.add(wire.net || wire.id); wireGroups.set(wire.id, group);
    // Guide endpoints land on real solder contacts, including insulated ends.
    routeHoles(wire).forEach(p => group.points.push({ ...p, side: face(wire.layer), selection: { type: "wire", id: wire.id } }));
  });
  bridges.forEach(bridge => groupFor(contact(bridge.layer, bridge.a)).bridges.push(bridge));
  allPins.forEach(pin => {
    const group = groupFor(contact(pinContactSide(board, pin), pin)), key = `${pin.component.id}|${pin.pinIndex}`;
    group.pins.push(pin); pinGroups.set(key, group);
    if (pin.pin.net && !pin.pin.noConnect) group.nets.add(pin.pin.net);
    group.points.push({ col: pin.col, row: pin.row, side: pinContactSide(board, pin), selection: { type: "component", id: pin.component.id }, pinIndex: pin.pinIndex });
  });
  pinGroups.forEach((group, key) => {
    if (group.wires.length || group.bridges.length || group.pins.length > 1) pins.set(key, { nets: group.nets, wires: new Set(group.wires.map(w => w.id)), group });
  });
  const groupAt = (side, point) => {
    const key = contact(side, point);
    return parents.has(key) ? groups.get(root(key)) : undefined;
  };
  return { holes, groups: [...groups.values()], wireGroups, pinGroups, pins, groupAt };
}

export function canonicalNet(name) {
  return String(name || "").trim().toUpperCase().replace(/^\+/, "").replace(/^(\d+)\.(\d+)V$/, "$1V$2");
}
export function isAutomaticNet(name) { return /^(W\d+|NET)$/i.test(name || ""); }
