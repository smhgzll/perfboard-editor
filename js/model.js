import { clone, Geometry } from "./core.js";

export const DEFAULT_STATE = Object.freeze({
  version: "clean-1.1.0",
  name: "Untitled Project",
  board: {
    cols: 100,
    rows: 70,
    pitchPx: 22,
    margin: 46,
    holeDiameterMm: 0.9,
    padDiameterMm: 1.8,
    gridUnit: "2.54mm",
    platedThroughHoles: true,
    color: "#284969"
  },
  view: {
    face: "top",
    showLabels: true,
    showPinNames: true,
    showRulers: true,
    showBack: true,
    wiresOnTop: true,
    theme: "dark",
    layoutPrintMode: "auto"
  },
  components: [],
  wires: [],
  texts: []
});

export function newState() {
  return clone(DEFAULT_STATE);
}

export class IdService {
  constructor(getState) {
    this.getState = getState;
  }

  next(prefix) {
    const state = this.getState();
    const taken = new Set([
      ...state.components.map(item => item.id),
      ...state.wires.map(item => item.id),
      ...state.texts.map(item => item.id)
    ]);
    let i = 1;
    while (taken.has(`${prefix}${i}`)) i += 1;
    return `${prefix}${i}`;
  }
}

export class ComponentFactory {
  constructor(idService) {
    this.ids = idService;
  }

  create(kind, col, row) {
    const prefix = this.prefixFor(kind);
    const id = this.ids.next(prefix);
    const component = {
      id,
      kind,
      name: this.defaultName(kind),
      value: this.defaultValue(kind),
      col,
      row,
      rot: 0,
      color: this.defaultColor(kind),
      pins: this.pinsFor(kind)
    };
    return component;
  }

  prefixFor(kind) {
    return ({
      resistor: "R", capacitor: "C", electrolytic: "C", led: "D", crystal: "Y",
      smdResistor: "RS", smdCapacitor: "CS", smdElectrolytic: "ES", smdLed: "DS",
      ic: "U", header: "J", jackpads: "J", testpad: "TP"
    }[kind] || "X");
  }

  defaultName(kind) {
    return ({
      resistor: "R?", capacitor: "C?", electrolytic: "C?", led: "D?", crystal: "Y?",
      smdResistor: "R?_SMD", smdCapacitor: "C?_SMD", smdElectrolytic: "C?_SMD", smdLed: "D?_SMD",
      ic: "U?", header: "J?", jackpads: "JACK", testpad: "TP"
    }[kind] || "X?");
  }

  defaultValue(kind) {
    return ({
      resistor: "10k", capacitor: "100n", electrolytic: "10uF", led: "LED", crystal: "12.288MHz",
      smdResistor: "10k", smdCapacitor: "100n", smdElectrolytic: "10uF", smdLed: "LED",
      ic: "IC", header: "1x4", jackpads: "TRS", testpad: ""
    }[kind] || "");
  }

  defaultColor(kind) {
    return ({
      resistor: "#b88c4a", capacitor: "#4aa3df", electrolytic: "#7b61ff", led: "#e45050", crystal: "#b9c0c8",
      smdResistor: "#b88c4a", smdCapacitor: "#4aa3df", smdElectrolytic: "#7b61ff", smdLed: "#e45050",
      ic: "#111827", header: "#d7dce4", jackpads: "#d7dce4", testpad: "#ffe08a"
    }[kind] || "#cbd5e1");
  }

  pinsFor(kind) {
    const pin = (name, x, y, number = undefined) => ({ name, x, y, number: number ?? name });
    switch (kind) {
      case "resistor": return [pin("1", 0, 0), pin("2", 3, 0)];
      case "capacitor": return [pin("1", 0, 0), pin("2", 2, 0)];
      case "electrolytic": return [pin("+", 0, 0, 1), pin("-", 2, 0, 2)];
      case "led": return [pin("A", 0, 0, 1), pin("K", 2, 0, 2)];
      case "crystal": return [pin("1", 0, 0), pin("2", 2, 0)];
      // SMD variants are intentionally one pitch long. They sit between two adjacent
      // perfboard holes and match the compact footprint used in the supplied layout.
      case "smdResistor": return [pin("1", 0, 0), pin("2", 1, 0)];
      case "smdCapacitor": return [pin("1", 0, 0), pin("2", 1, 0)];
      case "smdElectrolytic": return [pin("+", 0, 0, 1), pin("-", 1, 0, 2)];
      case "smdLed": return [pin("A", 0, 0, 1), pin("K", 1, 0, 2)];
      case "testpad": return [pin("TP", 0, 0, 1)];
      case "jackpads": return [pin("L", 0, 0, 1), pin("R", 0, 1, 2), pin("G", 0, 2, 3), pin("SW", 0, 3, 4)];
      case "header": return [pin("1", 0, 0), pin("2", 1, 0), pin("3", 2, 0), pin("4", 3, 0)];
      case "ic": return this.icPins(14);
      default: return [pin("1", 0, 0), pin("2", 1, 0)];
    }
  }

  icPins(count = 14) {
    const pins = [];
    const perSide = Math.ceil(count / 2);
    for (let i = 0; i < perSide; i += 1) pins.push({ name: `P${i + 1}`, number: i + 1, x: 0, y: i });
    for (let i = 0; i < count - perSide; i += 1) {
      const number = perSide + i + 1;
      pins.push({ name: `P${number}`, number, x: 3, y: (count - perSide - 1) - i });
    }
    return pins;
  }
}

export class ProjectStore {
  constructor() {
    this.state = newState();
    this.history = [];
    this.future = [];
    this.ids = new IdService(() => this.state);
    this.components = new ComponentFactory(this.ids);
  }

  snapshot(label = "Edit") {
    this.history.push(clone(this.state));
    if (this.history.length > 80) this.history.shift();
    this.future = [];
    this.lastAction = label;
  }

  undo() {
    if (!this.history.length) return false;
    this.future.push(clone(this.state));
    this.state = this.history.pop();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(clone(this.state));
    this.state = this.future.pop();
    return true;
  }

  load(raw) {
    const payload = raw?.state ? raw.state : raw;
    const next = this.normalize(payload || {});
    this.state = next;
    this.history = [];
    this.future = [];
  }

  normalize(raw) {
    const state = newState();
    Object.assign(state, raw);
    state.board = { ...newState().board, ...(raw.board || {}) };
    state.view = { ...newState().view, ...(raw.view || {}) };
    state.components = Array.isArray(raw.components) ? raw.components.map(component => this.normalizeComponent(component)) : [];
    state.wires = Array.isArray(raw.wires) ? raw.wires.map(wire => this.normalizeWire(wire)) : [];
    state.texts = Array.isArray(raw.texts) ? raw.texts : [];
    return state;
  }

  normalizeComponent(component) {
    const base = this.components.create(component.kind || "resistor", Number(component.col) || 0, Number(component.row) || 0);
    return {
      ...base,
      ...component,
      col: Number(component.col) || 0,
      row: Number(component.row) || 0,
      rot: this.normalizeRotation(component.rot),
      pins: Array.isArray(component.pins) && component.pins.length ? component.pins : base.pins
    };
  }

  normalizeWire(wire) {
    return {
      id: wire.id || this.ids.next("W"),
      name: wire.name || wire.net || wire.id || "Wire",
      net: wire.net || wire.name || "NET",
      layer: ["top", "bottom", "jumper"].includes(wire.layer) ? wire.layer : "top",
      style: wire.style || (wire.layer === "jumper" ? "dashed" : "solid"),
      color: wire.color || "",
      route: Array.isArray(wire.route) ? wire.route.map(p => ({ col: Number(p.col) || 0, row: Number(p.row) || 0 })) : []
    };
  }

  normalizeRotation(value) {
    return ((Math.round((Number(value) || 0) / 90) * 90) % 360 + 360) % 360;
  }

  addComponent(kind, col, row) {
    this.snapshot(`Place ${kind}`);
    const component = this.components.create(kind, col, row);
    this.state.components.push(component);
    return component;
  }

  addWire(route, options = {}) {
    if (!Array.isArray(route) || route.length < 2) return null;
    this.snapshot("Add wire");
    const id = this.ids.next("W");
    const wire = this.normalizeWire({
      id,
      name: id,
      net: options.net || id,
      layer: options.layer || this.state.view.face || "top",
      style: options.style || ((options.layer || this.state.view.face) === "jumper" ? "dashed" : "solid"),
      route
    });
    this.state.wires.push(wire);
    return wire;
  }

  deleteSelection(selection) {
    if (!selection) return false;
    this.snapshot("Delete");
    if (selection.type === "component") {
      this.state.components = this.state.components.filter(item => item.id !== selection.id);
      this.state.wires = this.state.wires.filter(wire => !wire.componentId || wire.componentId !== selection.id);
      return true;
    }
    if (selection.type === "wire") {
      this.state.wires = this.state.wires.filter(item => item.id !== selection.id);
      return true;
    }
    return false;
  }

  componentById(id) {
    return this.state.components.find(component => component.id === id);
  }

  wireById(id) {
    return this.state.wires.find(wire => wire.id === id);
  }

  pinsFor(component) {
    return component.pins.map((pin, pinIndex) => ({
      component,
      pin,
      pinIndex,
      ...Geometry.pinAbsolute(component, pin)
    }));
  }

  pinAt(col, row) {
    for (const component of this.state.components) {
      const match = this.pinsFor(component).find(pin => pin.col === col && pin.row === row);
      if (match) return match;
    }
    return null;
  }

  allPins() {
    return this.state.components.flatMap(component => this.pinsFor(component));
  }
}
