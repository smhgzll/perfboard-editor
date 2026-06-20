import { clone, Geometry } from "./core.js";

export const DEFAULT_STATE = Object.freeze({
  version: "clean-1.2.0-custom-history-labels",
  name: "Untitled Project",
  board: {
    cols: 30,
    rows: 20,
    pitchPx: 22,
    margin: 46,
    holeDiameterMm: 0.9,
    padDiameterMm: 1.8,
    gridUnit: "2.54mm",
    platedThroughHoles: true,
    color: "#284969",
    coordinateLabels: true,
    coordinateMode: "numbersTopLettersSide"
  },
  view: {
    face: "top",
    showLabels: true,
    showPinNames: true,
    showRulers: true,
    showBack: true,
    wiresOnTop: true,
    theme: "dark",
    layoutPrintMode: "auto",
    labelFontSize: 8.4,
    pinFontSize: 6,
    labelWrapChars: 20
  },
  components: [],
  wires: [],
  customTemplates: [],
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
    Object.assign(component, this.bodyFor(kind));
    if (this.isDipKind(kind)) {
      component.w = Math.ceil(component.pins.length / 2);
      component.h = 4;
    }
    return component;
  }

  prefixFor(kind) {
    return ({
      resistor: "R", resistorAxial3: "R", resistorAxial5: "R", resistorVertical: "R",
      capacitor: "C", ceramicCapacitor2: "C", capacitorRadial3: "C", filmCapacitor5: "C",
      electrolytic: "C", electrolyticRadial2: "C", led: "D", diode: "D", diodeAxial4: "D", crystal: "Y",
      inductorAxial5: "L", smdResistor: "RS", smdCapacitor: "CS", smdElectrolytic: "ES", smdLed: "DS",
      ic: "U", dip8: "U", dip14: "U", dip16: "U", dip28: "U", header: "J", jackpads: "J",
      screwTerminal2: "J", screwTerminal3: "J", transistor: "Q", potentiometer: "RV", trimpot: "RV",
      regulatorTo220: "U", tactSwitch: "SW", testpad: "TP", custom: "X"
    }[kind] || "X");
  }

  defaultName(kind) {
    return ({
      resistor: "R?", resistorAxial3: "R?_AX3", resistorAxial5: "R?_MF5", resistorVertical: "R?_VERT",
      capacitor: "C?", ceramicCapacitor2: "C?_CER2", capacitorRadial3: "C?_RAD3", filmCapacitor5: "C?_FILM5",
      electrolytic: "C?", electrolyticRadial2: "C?_ELEC2", led: "D?", diode: "D?", diodeAxial4: "D?_AX4", crystal: "Y?",
      inductorAxial5: "L?_AX5", smdResistor: "R?_SMD", smdCapacitor: "C?_SMD", smdElectrolytic: "C?_SMD", smdLed: "D?_SMD",
      ic: "U?", dip8: "U?_DIP8", dip14: "U?_DIP14", dip16: "U?_DIP16", dip28: "U?_DIP28",
      header: "J?", jackpads: "JACK", screwTerminal2: "J?_TERM2", screwTerminal3: "J?_TERM3",
      transistor: "Q?_TO92", potentiometer: "RV?", trimpot: "RV?_TRIM", regulatorTo220: "U?_TO220",
      tactSwitch: "SW?", testpad: "TP", custom: "X?"
    }[kind] || "X?");
  }

  defaultValue(kind) {
    return ({
      resistor: "10k", resistorAxial3: "10k / 3-hole", resistorAxial5: "10k metal film / 5-hole", resistorVertical: "10k vertical / 2-hole",
      capacitor: "100n", ceramicCapacitor2: "100n ceramic / 2-hole", capacitorRadial3: "100n radial / 3-hole", filmCapacitor5: "100n film / 5-hole",
      electrolytic: "10uF", electrolyticRadial2: "10uF radial / 2-hole", led: "LED", diode: "1N4148", diodeAxial4: "1N4148 / 4-hole", crystal: "12.288MHz",
      inductorAxial5: "inductor / 5-hole", smdResistor: "10k", smdCapacitor: "100n", smdElectrolytic: "10uF", smdLed: "LED",
      ic: "DIP-14", dip8: "DIP-8", dip14: "DIP-14", dip16: "DIP-16", dip28: "DIP-28",
      header: "1x4", jackpads: "TRS", screwTerminal2: "2P 5.08mm", screwTerminal3: "3P 5.08mm",
      transistor: "TO-92", potentiometer: "B10K", trimpot: "10K", regulatorTo220: "7805/AMS?",
      tactSwitch: "6x6", testpad: "", custom: "custom"
    }[kind] || "");
  }

  defaultColor(kind) {
    return ({
      resistor: "#b88c4a", resistorAxial3: "#b88c4a", resistorAxial5: "#b88c4a", resistorVertical: "#b88c4a",
      capacitor: "#4aa3df", ceramicCapacitor2: "#4aa3df", capacitorRadial3: "#4aa3df", filmCapacitor5: "#38bdf8",
      electrolytic: "#7b61ff", electrolyticRadial2: "#7b61ff", led: "#e45050", diode: "#2dd4bf", diodeAxial4: "#2dd4bf", crystal: "#b9c0c8",
      inductorAxial5: "#a3e635", smdResistor: "#b88c4a", smdCapacitor: "#4aa3df", smdElectrolytic: "#7b61ff", smdLed: "#e45050",
      ic: "#111827", dip8: "#111827", dip14: "#111827", dip16: "#111827", dip28: "#111827",
      header: "#d7dce4", jackpads: "#d7dce4", screwTerminal2: "#22c55e", screwTerminal3: "#22c55e",
      transistor: "#0f172a", potentiometer: "#64748b", trimpot: "#64748b", regulatorTo220: "#1f2937",
      tactSwitch: "#94a3b8", testpad: "#ffe08a", custom: "#cbd5e1"
    }[kind] || "#cbd5e1");
  }

  bodyFor(kind) {
    return ({
      transistor: { bodyShape: "roundrect", bodyW: 3, bodyH: 2, w: 3, h: 2 },
      potentiometer: { bodyShape: "ellipse", bodyW: 5, bodyH: 4, w: 5, h: 4 },
      trimpot: { bodyShape: "roundrect", bodyW: 3, bodyH: 3, w: 3, h: 3 },
      regulatorTo220: { bodyShape: "roundrect", bodyW: 3, bodyH: 4, w: 3, h: 4 },
      tactSwitch: { bodyShape: "roundrect", bodyW: 4, bodyH: 4, w: 4, h: 4 },
      screwTerminal2: { bodyShape: "roundrect", bodyW: 2, bodyH: 2, w: 2, h: 2 },
      screwTerminal3: { bodyShape: "roundrect", bodyW: 3, bodyH: 2, w: 3, h: 2 },
      custom: { bodyShape: "roundrect", bodyW: 4, bodyH: 3, w: 4, h: 3 }
    }[kind] || {});
  }

  isDipKind(kind) {
    return ["ic", "dip8", "dip14", "dip16", "dip28"].includes(kind);
  }

  pinsFor(kind) {
    const pin = (name, x, y, number = undefined) => ({ name, x, y, number: number ?? name });
    switch (kind) {
      case "resistor": return [pin("1", 0, 0), pin("2", 3, 0)];
      case "resistorAxial3": return [pin("1", 0, 0), pin("2", 2, 0)];
      case "resistorAxial5": return [pin("1", 0, 0), pin("2", 4, 0)];
      case "resistorVertical": return [pin("1", 0, 0), pin("2", 0, 1)];
      case "capacitor": return [pin("1", 0, 0), pin("2", 2, 0)];
      case "ceramicCapacitor2": return [pin("1", 0, 0), pin("2", 1, 0)];
      case "capacitorRadial3": return [pin("1", 0, 0), pin("2", 2, 0)];
      case "filmCapacitor5": return [pin("1", 0, 0), pin("2", 4, 0)];
      case "electrolytic": return [pin("+", 0, 0, 1), pin("-", 2, 0, 2)];
      case "electrolyticRadial2": return [pin("+", 0, 0, 1), pin("-", 1, 0, 2)];
      case "led": return [pin("A", 0, 0, 1), pin("K", 2, 0, 2)];
      case "diode": return [pin("A", 0, 0, 1), pin("K", 3, 0, 2)];
      case "diodeAxial4": return [pin("A", 0, 0, 1), pin("K", 3, 0, 2)];
      case "inductorAxial5": return [pin("1", 0, 0), pin("2", 4, 0)];
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
      case "screwTerminal2": return [pin("1", 0, 0), pin("2", 1, 0)];
      case "screwTerminal3": return [pin("1", 0, 0), pin("2", 1, 0), pin("3", 2, 0)];
      case "transistor": return [pin("E", 0, 1, 1), pin("B", 1, 0, 2), pin("C", 2, 1, 3)];
      case "potentiometer": return [pin("1", 0, 3), pin("W", 2, 0, 2), pin("3", 4, 3)];
      case "trimpot": return [pin("1", 0, 2), pin("W", 1, 0, 2), pin("3", 2, 2)];
      case "regulatorTo220": return [pin("IN", 0, 3, 1), pin("GND", 1, 3, 2), pin("OUT", 2, 3, 3)];
      case "tactSwitch": return [pin("1A", 0, 0, 1), pin("1B", 3, 0, 2), pin("2A", 0, 3, 3), pin("2B", 3, 3, 4)];
      case "dip8": return this.icPins(8);
      case "dip14": return this.icPins(14);
      case "dip16": return this.icPins(16);
      case "dip28": return this.icPins(28);
      case "ic": return this.icPins(14);
      default: return [pin("1", 0, 0), pin("2", 1, 0)];
    }
  }

  icPins(count = 14, rowGap = 3) {
    const pins = [];
    const evenCount = Math.max(2, Math.round(count / 2) * 2);
    const perSide = evenCount / 2;
    for (let i = 0; i < perSide; i += 1) pins.push({ name: `P${i + 1}`, number: i + 1, x: i, y: 0 });
    for (let i = 0; i < perSide; i += 1) {
      const number = perSide + i + 1;
      pins.push({ name: `P${number}`, number, x: (perSide - 1) - i, y: rowGap });
    }
    return pins;
  }

  fromTemplate(template, col, row) {
    const kind = template.kind || "custom";
    const id = this.ids.next(this.prefixFor(kind));
    const component = {
      id,
      kind,
      name: template.name || this.defaultName(kind),
      value: template.value || "",
      col,
      row,
      rot: 0,
      color: template.color || this.defaultColor(kind),
      bodyShape: template.bodyShape || "roundrect",
      bodyW: Number(template.bodyW) || 4,
      bodyH: Number(template.bodyH) || 3,
      w: Number(template.w || template.bodyW) || 4,
      h: Number(template.h || template.bodyH) || 3,
      pins: Array.isArray(template.pins) && template.pins.length ? template.pins.map((pin, index) => ({
        number: pin.number ?? index + 1,
        name: pin.name || String(pin.number ?? index + 1),
        x: Number(pin.x) || 0,
        y: Number(pin.y) || 0
      })) : this.pinsFor(kind)
    };
    return component;
  }
}

export class ProjectStore {
  constructor() {
    this.state = newState();
    this.history = [];
    this.future = [];
    this.historyMeta = [];
    this.futureMeta = [];
    this.ids = new IdService(() => this.state);
    this.components = new ComponentFactory(this.ids);
  }

  snapshot(label = "Edit") {
    this.history.push(clone(this.state));
    this.historyMeta.push({ label, at: new Date().toISOString() });
    if (this.history.length > 80) this.history.shift();
    if (this.historyMeta.length > 80) this.historyMeta.shift();
    this.future = [];
    this.futureMeta = [];
    this.lastAction = label;
  }

  undo() {
    if (!this.history.length) return false;
    this.future.push(clone(this.state));
    this.futureMeta.push(this.historyMeta[this.historyMeta.length - 1] || { label: "Redo point", at: new Date().toISOString() });
    this.state = this.history.pop();
    this.historyMeta.pop();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(clone(this.state));
    this.historyMeta.push(this.futureMeta[this.futureMeta.length - 1] || { label: "Redo", at: new Date().toISOString() });
    this.state = this.future.pop();
    this.futureMeta.pop();
    return true;
  }

  load(raw) {
    const payload = raw?.state ? raw.state : raw;
    const next = this.normalize(payload || {});
    this.state = next;
    this.history = [];
    this.future = [];
    this.historyMeta = [];
    this.futureMeta = [];
  }

  normalize(raw) {
    const state = newState();
    Object.assign(state, raw);
    state.board = { ...newState().board, ...(raw.board || {}) };
    state.view = { ...newState().view, ...(raw.view || {}) };
    state.components = Array.isArray(raw.components) ? raw.components.map(component => this.normalizeComponent(component)) : [];
    state.wires = Array.isArray(raw.wires) ? raw.wires.map(wire => this.normalizeWire(wire)) : [];
    state.customTemplates = Array.isArray(raw.customTemplates) ? raw.customTemplates : [];
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
      bodyW: Number(component.bodyW || component.w || base.bodyW || base.w || 1),
      bodyH: Number(component.bodyH || component.h || base.bodyH || base.h || 1),
      w: Number(component.w || component.bodyW || base.w || base.bodyW || 1),
      h: Number(component.h || component.bodyH || base.h || base.bodyH || 1),
      pins: Array.isArray(component.pins) && component.pins.length ? component.pins.map((pin, index) => ({
        number: pin.number ?? index + 1,
        name: pin.name ?? String(pin.number ?? index + 1),
        x: Number(pin.x) || 0,
        y: Number(pin.y) || 0
      })) : base.pins
    };
  }

  normalizeWire(wire) {
    return {
      id: wire.id || this.ids.next("W"),
      name: wire.name || wire.net || wire.id || "Wire",
      net: wire.net || wire.name || "NET",
      layer: ["top", "bottom", "jumper"].includes(wire.layer) ? wire.layer : "top",
      bridgeType: ["normal", "jumper", "insulated"].includes(wire.bridgeType) ? wire.bridgeType : (wire.layer === "jumper" ? "jumper" : "normal"),
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

  addComponentFromTemplate(template, col, row) {
    this.snapshot(`Place ${template?.name || "custom component"}`);
    const component = this.components.fromTemplate(template || {}, col, row);
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
      bridgeType: options.bridgeType || ((options.layer || this.state.view.face) === "jumper" ? "jumper" : "normal"),
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

  resetProject() {
    this.state = newState();
    this.history = [];
    this.future = [];
    this.historyMeta = [];
    this.futureMeta = [];
  }

  isDipComponent(component) {
    return component && ["ic", "dip8", "dip14", "dip16", "dip28"].includes(component.kind);
  }

  reflowDipPins(component, count = component?.pins?.length || 14) {
    if (!component) return;
    const old = Array.isArray(component.pins) ? component.pins : [];
    const byNumber = new Map(old.map((pin, index) => [String(pin.number ?? index + 1), pin]));
    const yValues = old.map(pin => Number(pin.y) || 0);
    const rowGap = Math.max(2, Math.round(Math.max(...yValues, 3) - Math.min(...yValues, 0)) || 3);
    const evenCount = Math.max(2, Math.round(count / 2) * 2);
    const perSide = evenCount / 2;
    const pins = [];
    for (let i = 0; i < perSide; i += 1) {
      const number = i + 1;
      const previous = byNumber.get(String(number));
      pins.push({ number, name: previous?.name || `P${number}`, x: i, y: 0 });
    }
    for (let i = 0; i < perSide; i += 1) {
      const number = perSide + i + 1;
      const previous = byNumber.get(String(number));
      pins.push({ number, name: previous?.name || `P${number}`, x: (perSide - 1) - i, y: rowGap });
    }
    component.pins = pins;
    component.w = Math.max(Number(component.w) || 0, perSide);
    component.h = Math.max(Number(component.h) || 0, rowGap + 1);
  }
}
