import { Geometry } from "./core.js";

export class ElectricalChecks {
  constructor(store) {
    this.store = store;
  }

  run() {
    const problems = [];
    const usedPins = new Set();
    const occupied = new Map();
    const pinMap = new Map();

    this.store.allPins().forEach(pin => {
      const key = `${pin.col},${pin.row}`;
      if (!pinMap.has(key)) pinMap.set(key, []);
      pinMap.get(key).push(pin);
    });

    this.store.state.wires.forEach(wire => {
      if (!wire.route || wire.route.length < 2) {
        problems.push({ type: "EMPTY_ROUTE", message: `${wire.name || wire.id} has no route` });
        return;
      }
      wire.route.forEach(point => {
        const key = `${point.col},${point.row}`;
        const net = wire.net || wire.id;
        if (!occupied.has(key)) occupied.set(key, new Set());
        occupied.get(key).add(net);
        (pinMap.get(key) || []).forEach(pin => usedPins.add(`${pin.component.id}|${pin.pinIndex}`));
      });
    });

    if (this.store.state.board.platedThroughHoles) {
      occupied.forEach((nets, key) => {
        if (nets.size > 1) problems.push({ type: "PTH_SAME_HOLE_SHORT", message: `${key} has ${Array.from(nets).join(" / ")}` });
      });
    }

    this.store.state.components.forEach(component => {
      component.pins.forEach((pin, pinIndex) => {
        const key = `${component.id}|${pinIndex}`;
        if (!usedPins.has(key)) {
          const p = Geometry.pinAbsolute(component, pin);
          problems.push({ type: "FLOATING_PIN", message: `${component.name || component.id}.${pin.name} @ ${p.col + 1},${p.row + 1}` });
        }
      });
    });
    return problems;
  }
}
