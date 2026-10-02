import { clamp } from "./core.js";
import { BOARD_THICKNESS, componentFamily, componentFrame, resistorBands, roundPolyline } from "./geometry-3d.js";

// Procedural display models. Pin positions come from the saved footprint;
// body dimensions are illustrative, not manufacturer mechanical drawings.
export class ComponentModels3D {
  constructor(renderer, B) { this.renderer = renderer; this.B = B; }

  create(component) {
    const B = this.B, frame = componentFrame(this.renderer.store, component);
    this.component = component; this.frame = frame; this.serial = 0; this.height = 0;
    this.root = new B.TransformNode(`part-${component.id}`, this.renderer.scene);
    this.root.position.set(frame.x, frame.side * BOARD_THICKNESS / 2, frame.z);
    this.root.rotation.y = frame.rotation;
    this.root.scaling.y = frame.side;
    this.root.metadata = { type: "component", id: component.id, side: frame.side, family: componentFamily(component), height: 0 };
    const pins = frame.pins;
    if (!pins.length) return this.root;
    pins.forEach(pin => {
      const anchor = new B.TransformNode(`pin-${component.id}-${pin.index}`, this.renderer.scene);
      anchor.parent = this.root; anchor.position.set(pin.x, 0, pin.z);
      anchor.metadata = { type: "pin", componentId: component.id, pinIndex: pin.index };
    });
    const family = this.root.metadata.family;
    if (["resistor", "diode", "inductor", "fuse"].includes(family)) this.axial(family, pins);
    else if (["electrolytic", "led", "buzzer"].includes(family)) this.radial(family, pins);
    else if (family === "ceramic") this.ceramic(pins);
    else if (family === "dip") this.dip(pins);
    else if (family === "header") this.header(pins);
    else if (family === "terminal") this.terminal(pins);
    else if (family === "to92" || family === "to220") this.transistor(family, pins);
    else if (family === "pot") this.pot(pins);
    else if (family === "switch" || family === "dipSwitch") this.switch(family, pins);
    else if (family === "adapter") this.adapter(pins);
    else if (family === "smd") this.smd(pins);
    else if (family === "pads") this.pads(pins);
    else this.generic(family, pins);
    this.root.metadata.height = this.height;
    return this.root;
  }

  mat(hex, metallic = 0, roughness = 0.55, alpha = 1) {
    return this.renderer.material(this.B, "part", hex, { metallic, roughness, alpha });
  }
  get metal() { return this.mat("#bdc7cc", 0.85, 0.28); }
  get plastic() { return this.mat(this.component.color || "#344352", 0, 0.5); }
  get black() { return this.mat("#242931", 0, 0.65); }
  get gold() { return this.mat("#d6b35e", 0.78, 0.25); }

  finish(mesh, position, material, role = "body") {
    mesh.parent = this.root; mesh.position.set(...position); mesh.material = material;
    mesh.metadata = { type: "component", id: this.component.id, role };
    mesh.isPickable = role !== "lead";
    if (role === "body") this.renderer.shadow?.addShadowCaster(mesh);
    return mesh;
  }

  box(width, height, depth, position, material = this.plastic, role = "body") {
    this.height = Math.max(this.height, position[1] + height / 2);
    return this.finish(this.B.MeshBuilder.CreateBox(`${this.component.id}-box-${this.serial++}`, { width, height, depth }, this.renderer.scene), position, material, role);
  }
  cylinder(diameter, height, position, material = this.plastic, role = "body", topDiameter = diameter) {
    this.height = Math.max(this.height, position[1] + height / 2);
    return this.finish(this.B.MeshBuilder.CreateCylinder(`${this.component.id}-cylinder-${this.serial++}`, { diameterTop: topDiameter, diameterBottom: diameter, height, tessellation: 24 }, this.renderer.scene), position, material, role);
  }
  sphere(diameter, position, material = this.plastic, role = "body") {
    this.height = Math.max(this.height, position[1] + diameter / 2);
    return this.finish(this.B.MeshBuilder.CreateSphere(`${this.component.id}-sphere-${this.serial++}`, { diameter, segments: 16 }, this.renderer.scene), position, material, role);
  }
  tube(points, radius = 0.22, material = this.metal, role = "lead") {
    const path = roundPolyline(points, 0.5).map(p => new this.B.Vector3(p.x, p.y, p.z));
    return this.finish(this.B.MeshBuilder.CreateTube(`${this.component.id}-lead-${this.serial++}`, { path, radius, tessellation: 8, cap: this.B.Mesh.CAP_ALL }, this.renderer.scene), [0, 0, 0], material, role);
  }
  torus(diameter, thickness, position, material = this.metal, role = "detail") {
    return this.finish(this.B.MeshBuilder.CreateTorus(`${this.component.id}-ring-${this.serial++}`, { diameter, thickness, tessellation: 24 }, this.renderer.scene), position, material, role);
  }
  peg(pin, top = 1.2) {
    return this.tube([{ x: pin.x, y: -BOARD_THICKNESS - 0.4, z: pin.z }, { x: pin.x, y: top, z: pin.z }]);
  }
  bounds(pins) {
    const xs = pins.map(p => p.x), zs = pins.map(p => p.z);
    return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs), minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) };
  }
  orientCylinder(mesh, a, b) {
    const B = this.B, direction = new B.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    const axis = B.Vector3.Cross(B.Axis.Y, direction), angle = Math.acos(clamp(B.Vector3.Dot(B.Axis.Y, direction), -1, 1));
    mesh.rotationQuaternion = B.Quaternion.RotationAxis(axis.length() < 1e-7 ? B.Axis.X : axis.normalize(), angle);
    return mesh;
  }

  axial(family, pins) {
    const [a, b] = pins;
    if (!b) { this.pads(pins); return; }
    const span = Math.hypot(b.x - a.x, b.z - a.z), upright = this.component.kind === "resistorVertical";
    const diameter = family === "fuse" ? 2.8 : family === "inductor" ? 2.4 : family === "diode" ? 1.9 : 2.1;
    const length = upright ? 5 : clamp(span * 0.58, 1.4, family === "fuse" ? 10 : 7);
    const center = { x: (a.x + b.x) / 2, y: upright ? 3.5 : diameter / 2 + 0.65, z: (a.z + b.z) / 2 };
    const direction = upright ? { x: 0, y: 1, z: 0 } : { x: (b.x - a.x) / Math.max(span, 0.01), y: 0, z: (b.z - a.z) / Math.max(span, 0.01) };
    const along = offset => ({ x: center.x + direction.x * offset, y: center.y + direction.y * offset, z: center.z + direction.z * offset });
    const material = family === "diode" ? this.black : family === "fuse" ? this.mat("#dce9ec", 0, 0.2, 0.48) : this.plastic;
    const body = this.cylinder(diameter, length, [center.x, center.y, center.z], material);
    this.orientCylinder(body, along(-1), along(1)); this.height = center.y + (upright ? length / 2 : diameter / 2);
    [a, b].forEach((pin, i) => {
      const end = along((i ? 1 : -1) * length / 2);
      this.tube([{ x: pin.x, y: -BOARD_THICKNESS - 0.35, z: pin.z }, { x: pin.x, y: end.y, z: pin.z }, end]);
    });
    if (family === "resistor") {
      const bands = resistorBands(this.component.value), count = bands.length;
      bands.forEach((color, i) => {
        const p = along((i - (count - 1) / 2) * length / (count + 2));
        this.orientCylinder(this.cylinder(diameter + 0.025, length * 0.07, [p.x, p.y, p.z], this.mat(color, 0, 0.55), "detail"), along(-1), along(1));
      });
    } else if (family === "diode") {
      const p = along(length * 0.3);
      this.orientCylinder(this.cylinder(diameter + 0.03, length * 0.14, [p.x, p.y, p.z], this.metal, "detail"), along(-1), along(1));
    } else if (family === "fuse") {
      for (const offset of [-0.43, 0.43]) {
        const p = along(length * offset);
        this.orientCylinder(this.cylinder(diameter + 0.12, length * 0.17, [p.x, p.y, p.z], this.metal, "detail"), along(-1), along(1));
      }
      this.tube([along(-length / 2), along(length / 2)], 0.07);
    } else if (family === "inductor") {
      for (let i = 0; i < 7; i++) {
        const p = along((i - 3) * length / 9), ring = this.torus(diameter + 0.1, 0.18, [p.x, p.y, p.z], this.mat("#b77842", 0.7, 0.35));
        this.orientCylinder(ring, along(-1), along(1));
      }
    }
  }

  radial(family, pins) {
    pins.forEach(pin => this.peg(pin, 1));
    const span = pins.length > 1 ? Math.hypot(pins[1].x - pins[0].x, pins[1].z - pins[0].z) : 2.54;
    const diameter = family === "buzzer" ? Math.max(6, span + 2) : clamp(span + 1.4, 3, family === "led" ? 5 : 7);
    if (family === "led") {
      let color = this.component.color || "#e45050";
      if (color === "#e45050" && /green/i.test(this.component.value)) color = "#49c185";
      const resin = this.mat(color, 0, 0.22, 0.9);
      this.cylinder(diameter + 0.5, 0.55, [0, 0.8, 0], resin);
      this.cylinder(diameter, 2.5, [0, 2.25, 0], resin);
      const dome = this.sphere(diameter, [0, 3.35, 0], resin); dome.scaling.y = 0.75;
      this.box(0.2, 1.5, diameter * 0.65, [diameter / 2 - 0.12, 1.7, 0], this.mat("#f0d9d2", 0, 0.6), "detail");
    } else {
      const height = family === "buzzer" ? 5.2 : clamp(diameter * 1.45, 4.5, 10);
      this.cylinder(diameter, 0.5, [0, 0.75, 0], this.black);
      this.cylinder(diameter, height, [0, height / 2 + 1, 0], family === "buzzer" ? this.black : this.plastic);
      this.cylinder(diameter * 0.87, 0.14, [0, height + 1.05, 0], family === "buzzer" ? this.black : this.metal, "detail");
      if (family === "buzzer") this.cylinder(1.3, 0.03, [0, height + 1.14, 0], this.mat("#080d13"), "detail");
      else {
        this.box(0.12, height * 0.85, diameter * 0.32, [diameter / 2 + 0.02, height / 2 + 1, 0], this.mat("#c7d7e3"), "detail");
        for (const angle of [Math.PI / 4, -Math.PI / 4]) {
          const score = this.box(diameter * 0.65, 0.025, 0.08, [0, height + 1.13, 0], this.mat("#647079"), "detail"); score.rotation.y = angle;
        }
      }
    }
  }

  ceramic(pins) {
    const bounds = this.bounds(pins), diameter = clamp(Math.max(bounds.width, bounds.depth) + 1, 2.8, 5.5);
    pins.forEach(pin => this.peg(pin, 2));
    const disc = this.cylinder(diameter, 1.05, [0, diameter / 2 + 1.4, 0], this.plastic);
    disc.rotation.x = Math.PI / 2; this.height = diameter + 1.4;
  }

  dip(pins) {
    const bounds = this.bounds(pins), width = Math.max(3, bounds.width + 1.8), depth = Math.max(3, bounds.depth - 1.8);
    this.box(width, 2.8, depth, [0, 2.2, 0], this.black);
    const marker = this.cylinder(0.8, 0.04, [-width / 2 + 1, 3.63, depth / 2 - 0.7], this.mat("#b7bdc2"), "detail"); marker.isPickable = false;
    this.box(1.2, 0.06, depth * 0.48, [-width / 2 + 0.05, 3.64, 0], this.mat("#11151c"), "detail");
    pins.forEach(pin => {
      const z = Math.sign(pin.z || 1) * depth / 2;
      this.tube([{ x: pin.x, y: -BOARD_THICKNESS - 0.3, z: pin.z }, { x: pin.x, y: 1.1, z: pin.z }, { x: pin.x, y: 1.8, z }], 0.18);
    });
  }

  header(pins) {
    const bounds = this.bounds(pins);
    this.box(bounds.width + 2.25, 2.2, bounds.depth + 2.25, [0, 1.25, 0], this.black);
    pins.forEach(pin => this.box(0.55, 7.2, 0.55, [pin.x, 1.2, pin.z], this.gold, "lead"));
    this.height = 4.8;
  }

  terminal(pins) {
    const bounds = this.bounds(pins), depth = Math.max(4.6, bounds.depth + 3.2);
    this.box(Math.max(3.8, bounds.width + 3.8), 5.7, depth, [0, 3.1, 0], this.plastic);
    pins.forEach(pin => {
      this.peg(pin, 1);
      this.cylinder(2.6, 0.4, [pin.x, 5.9, pin.z], this.metal, "detail");
      this.box(1.85, 0.035, 0.25, [pin.x, 6.12, pin.z], this.black, "detail");
      this.box(2.4, 2.25, 0.025, [pin.x, 2.5, depth / 2 + 0.02], this.black, "detail");
    });
  }

  transistor(family, pins) {
    const bounds = this.bounds(pins);
    if (family === "to92") {
      const diameter = clamp(bounds.width + 1.2, 3.5, 5.2);
      this.cylinder(diameter, 3.8, [0, 3.2, 0], this.black);
      this.box(diameter * 0.8, 3.5, 0.16, [0, 3.2, diameter * 0.38], this.black);
      pins.forEach(pin => this.tube([{ x: pin.x, y: -2, z: pin.z }, { x: pin.x, y: 1.7, z: pin.z }, { x: pin.x * 0.5, y: 2.2, z: 0 }], 0.18));
    } else {
      const width = Math.max(6.5, bounds.width + 2.4);
      this.box(width, 6.2, 2.1, [0, 4.7, 0], this.black);
      this.box(width, 2.7, 0.45, [0, 8.8, -0.65], this.metal);
      this.cylinder(1.8, 0.05, [0, 9.05, -0.91], this.black, "detail").rotation.x = Math.PI / 2;
      pins.forEach(pin => this.peg(pin, 2.2));
    }
  }

  pot(pins) {
    pins.forEach(pin => this.peg(pin, 1.3));
    const trim = this.component.kind === "trimpot", diameter = trim ? 4.7 : 7.4;
    this.cylinder(diameter, 3.3, [0, 2.1, 0], this.plastic);
    this.cylinder(trim ? 3 : 2.6, trim ? 0.65 : 5.6, [0, trim ? 4.1 : 6.3, 0], trim ? this.mat("#d4ddd8") : this.metal, "detail");
    if (trim) this.box(2.4, 0.04, 0.25, [0, 4.46, 0], this.black, "detail");
  }

  switch(family, pins) {
    const bounds = this.bounds(pins), w = Math.max(4.4, bounds.width + 1), d = Math.max(4.4, bounds.depth + 1);
    this.box(w, 2.3, d, [0, 1.5, 0], family === "dipSwitch" ? this.plastic : this.black);
    pins.forEach(pin => this.peg(pin, 1));
    if (family === "dipSwitch") {
      for (let i = 0; i < 4; i++) this.box(0.8, 0.4, 1.5, [(i - 1.5) * w / 4, 2.86, i % 2 ? -0.4 : 0.4], this.mat("#e8e9e4"), "detail");
    } else {
      this.box(w * 0.9, 0.3, d * 0.9, [0, 2.85, 0], this.metal, "detail");
      this.cylinder(2.3, 1.2, [0, 3.6, 0], this.plastic);
    }
  }

  adapter(pins) {
    const bounds = this.bounds(pins), w = Math.max(6, bounds.width + 2), d = Math.max(5, bounds.depth + 2);
    this.box(w, 0.8, d, [0, 1.1, 0], this.mat("#336d64"));
    pins.forEach(pin => {
      this.peg(pin, 1.6);
      const ring = this.torus(0.9, 0.25, [pin.x, 1.52, pin.z], this.gold); ring.scaling.y = 0.3;
    });
    const chip = Math.min(w * 0.45, d * 0.6, 10);
    this.box(chip, 1.05, chip, [0, 2.05, 0], this.black);
    for (let i = 0; i < 6; i++) for (const side of [-1, 1]) this.box(0.2, 0.12, 0.65, [(i - 2.5) * chip / 7, 1.6, side * (chip / 2 + 0.22)], this.metal, "detail");
  }

  smd(pins) {
    const bounds = this.bounds(pins), width = Math.max(1.2, bounds.width * 0.65 + 0.4), depth = Math.max(1.2, bounds.depth * 0.65 + 0.4);
    this.box(width, 0.65, depth, [0, 0.5, 0], this.plastic);
    pins.forEach(pin => this.box(0.75, 0.16, 1.05, [pin.x, 0.2, pin.z], this.metal, "lead"));
  }

  pads(pins) {
    pins.forEach(pin => { this.peg(pin, 0.3); const pad = this.torus(1.4, 0.35, [pin.x, 0.16, pin.z], this.gold); pad.scaling.y = 0.3; });
    this.height = 0.35;
  }

  generic(family, pins) {
    const bounds = this.bounds(pins), pitch = this.frame.pitch;
    const width = Math.max(bounds.width + 1.6, ((this.component.bodyW || this.component.w || 1) - 1) * pitch + 1.8);
    const depth = Math.max(bounds.depth + 1.6, ((this.component.bodyH || this.component.h || 1) - 1) * pitch + 1.8);
    pins.forEach(pin => this.peg(pin, 1.3));
    if (family === "crystal") {
      this.box(width * 0.8, 2.7, Math.min(depth, 3.5), [0, 2.15, 0], this.metal);
      this.box(width, 0.35, Math.min(depth + 0.4, 4), [0, 0.7, 0], this.metal, "detail");
    } else if (["circle", "ellipse"].includes(this.component.bodyShape)) {
      const body = this.cylinder(Math.max(width, depth), 2.2, [0, 1.7, 0], this.plastic);
      if (this.component.bodyShape === "ellipse") { body.scaling.x = width / Math.max(width, depth); body.scaling.z = depth / Math.max(width, depth); }
    } else if (this.component.bodyShape !== "none") this.box(width, family === "film" ? 3.8 : 2.4, depth, [0, family === "film" ? 2.7 : 1.9, 0], this.plastic);
  }
}
