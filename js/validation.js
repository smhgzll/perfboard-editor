const fail = message => { throw new Error(`Invalid project: ${message}`); };
const record = value => value && typeof value === "object" && !Array.isArray(value);
const number = (value, name, min = -3000, max = 3000, integer = true) => {
  if (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max || (integer && !Number.isInteger(Number(value)))) fail(`${name} must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}.`);
};
export function validateProject(raw) {
  if (!record(raw) || !record(raw.board) || !Array.isArray(raw.components) || !Array.isArray(raw.wires)) fail("expected board, components and wires.");
  if (raw.view != null && !record(raw.view)) fail("view must be an object.");
  if (raw.name != null && (typeof raw.name !== "string" || raw.name.length > 4000)) fail("invalid project name.");
  if (raw.board.type != null && !["perfboard", "stripboard"].includes(raw.board.type)) fail("invalid board type.");
  if (raw.board.stripDirection != null && !["horizontal", "vertical"].includes(raw.board.stripDirection)) fail("invalid strip direction.");
  if (raw.board.cuts != null) {
    if (!Array.isArray(raw.board.cuts) || raw.board.cuts.length > 30000) fail("invalid copper cuts.");
    raw.board.cuts.forEach(cut => {
      if (!record(cut) || !["horizontal", "vertical"].includes(cut.axis)) fail("invalid copper cut.");
      number(cut.col, "cut column"); number(cut.row, "cut row");
    });
  }
  if (raw.solderBridges != null) {
    if (!Array.isArray(raw.solderBridges) || raw.solderBridges.length > 5000) fail("invalid solder bridges.");
    raw.solderBridges.forEach(bridge => {
      if (!record(bridge) || !record(bridge.a) || !record(bridge.b) || (bridge.layer != null && !["top", "bottom"].includes(bridge.layer))) fail("invalid solder bridge.");
      if (bridge.id != null && (typeof bridge.id !== "string" || bridge.id.length > 4000)) fail("invalid bridge id.");
      for (const p of [bridge.a, bridge.b]) { number(p.col, "bridge column"); number(p.row, "bridge row"); }
      if (Math.abs(Number(bridge.a.col) - Number(bridge.b.col)) + Math.abs(Number(bridge.a.row) - Number(bridge.b.row)) !== 1) fail("solder bridges must join neighboring holes.");
    });
  }
  if (raw.notebook != null) {
    if (!record(raw.notebook) || (raw.notebook.notes != null && (typeof raw.notebook.notes !== "string" || raw.notebook.notes.length > 100000))) fail("invalid notebook.");
    if (raw.notebook.tasks != null && (!Array.isArray(raw.notebook.tasks) || raw.notebook.tasks.length > 500 || raw.notebook.tasks.some(t => !record(t) || typeof t.text !== "string" || t.text.length > 2000))) fail("invalid assembly tasks.");
  }
  for (const key of ["color"]) if (raw.board[key] != null && !/^#[0-9a-f]{6}$/i.test(raw.board[key])) fail("invalid board color.");
  number(raw.board.cols, "board columns", 1, 300); number(raw.board.rows, "board rows", 1, 220);
  for (const [key, min, max] of [["pitchPx", 4, 100], ["margin", 0, 500], ["holeDiameterMm", 0.1, 10], ["padDiameterMm", 0.1, 20]]) {
    if (raw.board[key] != null) number(raw.board[key], key, min, max, false);
  }
  let totalPoints = 0;
  for (const key of ["components", "wires", "texts", "customTemplates"]) {
    if (raw[key] == null) continue;
    if (!Array.isArray(raw[key]) || raw[key].length > 5000) fail(`${key} must be an array with at most 5000 items.`);
    raw[key].forEach(item => {
      if (!record(item)) fail(`invalid ${key} entry.`);
      for (const field of ["id", "name", "value", "text", "kind", "net"]) if (item[field] != null && (typeof item[field] !== "string" || item[field].length > 4000)) fail(`invalid ${field}.`);
      if (key === "components" || key === "texts") { number(item.col ?? 0, "column"); number(item.row ?? 0, "row"); }
      for (const field of ["w", "h", "bodyW", "bodyH"]) if (item[field] != null) number(item[field], field, 0.1, 300, false);
      if (item.pins != null) {
        if (!Array.isArray(item.pins) || item.pins.length > 512) fail("invalid pins.");
        item.pins.forEach(pin => {
          if (!record(pin)) fail("invalid pin.");
          number(pin.x ?? 0, "pin x", -300, 300); number(pin.y ?? 0, "pin y", -300, 300);
          if (pin.net != null && (typeof pin.net !== "string" || pin.net.length > 200)) fail("invalid pin net.");
        });
      }
      if (key === "wires") {
        if (!Array.isArray(item.route)) fail("wire route must be an array.");
        totalPoints += item.route.length;
        item.route.forEach(p => { if (!record(p)) fail("invalid wire point."); number(p.col, "wire column"); number(p.row, "wire row"); });
      }
    });
  }
  if (totalPoints > 30000) fail("too many wire points (maximum 30000).");
}
