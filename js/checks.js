import { buildConnectivity, canonicalNet, isAutomaticNet } from "./connectivity.js";
import { analyzeNetworks } from "./networks.js";
import { activeCut, cutEnds, insideBoard } from "./copper.js";

export class ElectricalChecks {
  constructor(store) { this.store = store; }

  run() {
    const problems = [], { cols, rows } = this.store.state.board;
    const connections = buildConnectivity(this.store);
    const outside = p => p.col < 0 || p.row < 0 || p.col >= cols || p.row >= rows;
    this.store.state.wires.forEach(wire => {
      if (wire.route.length < 2 || wire.route.every(p => p.col === wire.route[0].col && p.row === wire.route[0].row)) problems.push({ type: "EMPTY_ROUTE", severity: "error", selection: { type: "wire", id: wire.id }, message: `${wire.name || wire.id}: wire needs two different points.` });
      const point = wire.route.find(outside);
      if (point) problems.push({ type: "OUTSIDE_BOARD", severity: "error", point, selection: { type: "wire", id: wire.id }, message: `${wire.name || wire.id}: route leaves the board.` });
    });
    connections.groups.forEach(group => {
      const names = [...new Set([...group.nets].filter(n => !isAutomaticNet(n)).map(canonicalNet))];
      const point = group.points[0];
      if (names.length > 1) problems.push({ type: "NET_CONFLICT", severity: "warning", point, selection: point?.selection, message: `Copper connects different net names: ${names.join(" / ")}. Check strip cuts, bridges and routes.` });
    });
    const networks = analyzeNetworks(this.store, connections);
    networks.guides.forEach(guide => problems.push({ type: "UNROUTED_NET", severity: "warning", point: guide.a, selection: guide.a.selection, message: `${guide.net}: missing connection from ${guide.a.col + 1},${guide.a.row + 1} to ${guide.b.col + 1},${guide.b.row + 1}.` }));
    const occupied = new Map();
    this.store.allPins().forEach(pin => {
      const selection = { type: "component", id: pin.component.id };
      const key = `${pin.col},${pin.row}`, others = occupied.get(key) || [];
      if (others.length) problems.push({ type: "SHARED_HOLE", severity: "warning", selection, point: pin, message: `${pin.component.name}.${pin.pin.name} shares a hole with ${others.map(p => `${p.component.name}.${p.pin.name}`).join(", ")}. Check that both leads fit.` });
      others.push(pin); occupied.set(key, others);
      if (outside(pin)) problems.push({ type: "OUTSIDE_BOARD", severity: "error", selection, point: pin, message: `${pin.component.name}.${pin.pin.name}: pin is outside the board.` });
      else if (!pin.pin.noConnect && !connections.pins.has(`${pin.component.id}|${pin.pinIndex}`)) problems.push({ type: "FLOATING_PIN", severity: "warning", selection, point: pin, message: `${pin.component.name || pin.component.id}.${pin.pin.name} at ${pin.col + 1},${pin.row + 1} has no connection. Mark NC if intentional.` });
      else if (pin.pin.noConnect && connections.pins.has(`${pin.component.id}|${pin.pinIndex}`)) problems.push({ type: "NC_CONNECTED", severity: "warning", selection, point: pin, message: `${pin.component.name}.${pin.pin.name} is marked NC but touches a route, bridge or another pin.` });
    });
    (this.store.state.board.cuts || []).forEach(cut => {
      if (!activeCut(this.store.state.board, cut)) problems.push({ type: "INACTIVE_CUT", severity: "warning", point: cut, message: `Cut at ${cut.col + 1},${cut.row + 1} is outside the active strip direction. Remove it or restore the board settings.` });
      else {
        const [a, b] = cutEnds(cut);
        const touching = this.store.state.wires.some(w => w.layer === "bottom" && !["insulated", "jumper"].includes(w.bridgeType) && w.route.some((p, i) => i && segmentCrosses(w.route[i - 1], p, a, b)));
        if (touching) problems.push({ type: "CUT_BYPASSED", severity: "warning", point: cut, message: `A bare bottom route crosses the cut between ${a.col + 1},${a.row + 1} and ${b.col + 1},${b.row + 1}. The wire restores continuity.` });
      }
    });
    (this.store.state.solderBridges || []).forEach(bridge => {
      if (![bridge.a, bridge.b].every(p => insideBoard(this.store.state.board, p))) problems.push({ type: "OUTSIDE_BOARD", severity: "error", point: bridge.a, message: `${bridge.id}: solder bridge is outside the board.` });
    });
    const names = new Map();
    this.store.state.components.forEach(c => {
      if (names.has(c.name)) problems.push({ type: "DUPLICATE_NAME", severity: "warning", selection: { type: "component", id: c.id }, message: `Reference “${c.name}” is used more than once.` });
      names.set(c.name, c.id);
    });
    return problems;
  }
}

function segmentCrosses(start, end, a, b) {
  const contains = p => (end.col - start.col) * (p.row - start.row) === (end.row - start.row) * (p.col - start.col) && p.col >= Math.min(start.col, end.col) && p.col <= Math.max(start.col, end.col) && p.row >= Math.min(start.row, end.row) && p.row <= Math.max(start.row, end.row);
  return contains(a) && contains(b);
}
