import { Geometry, htmlEscape, clamp } from "./core.js";

export class Render3DService {
  constructor(store, modal) {
    this.store = store;
    this.modal = modal;
    this.engine = null;
    this.scene = null;
    this.resizeHandler = null;
  }

  show() {
    this.modal.open("3D View", `
      <div class="print-actions">
        <button id="refresh3dBtn">Refresh 3D</button>
      </div>
      <div class="view3d-stage"><canvas id="view3dCanvas"></canvas></div>
    `);
    document.querySelector("#refresh3dBtn").onclick = () => this.render();
    this.render();
  }

  dispose() {
    if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
    this.resizeHandler = null;
    if (this.scene) this.scene.dispose();
    if (this.engine) this.engine.dispose();
    this.scene = null;
    this.engine = null;
  }

  render() {
    this.dispose();
    const B = window.BABYLON;
    const canvas = document.querySelector("#view3dCanvas");
    if (!B || !B.Engine || !canvas) {
      const body = document.querySelector("#modalBody");
      if (body) body.insertAdjacentHTML("beforeend", `<p class="check-results">BabylonJS yüklenemedi. İnternet erişimi yoksa 3D görünüm çalışmayabilir.</p>`);
      return;
    }

    this.engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, alpha: true, adaptToDeviceRatio: true });
    this.scene = new B.Scene(this.engine);
    // Keep the Babylon canvas transparent so the CSS navy gradient remains visible.
    this.scene.clearColor = new B.Color4(0, 0, 0, 0);
    this.scene.ambientColor = new B.Color3(1, 1, 1);
    this.buildCameraAndLights(B);
    this.buildBoard(B);
    this.buildWires(B);
    this.buildComponents(B);
    this.engine.runRenderLoop(() => this.scene.render());
    this.resizeHandler = () => this.engine.resize();
    window.addEventListener("resize", this.resizeHandler);
  }

  buildCameraAndLights(B) {
    const board = this.store.state.board;
    const widthMm = (board.cols - 1) * 2.54;
    const heightMm = (board.rows - 1) * 2.54;
    const radius = Math.max(widthMm, heightMm) * 1.25;
    const camera = new B.ArcRotateCamera("camera", -Math.PI / 4, Math.PI / 3.1, radius, new B.Vector3(0, 0, 0), this.scene);
    camera.lowerRadiusLimit = Math.max(35, radius * 0.25);
    camera.upperRadiusLimit = radius * 3;
    camera.wheelPrecision = 22;
    camera.panningSensibility = 70;
    camera.attachControl(document.querySelector("#view3dCanvas"), true);
    this.scene.activeCamera = camera;

    const light = new B.HemisphericLight("flat-light", new B.Vector3(0, 1, 0), this.scene);
    light.intensity = 1.0;
  }

  buildBoard(B) {
    const board = this.store.state.board;
    const boardT = 1.6;
    const width = Math.max(2.54, (board.cols - 1) * 2.54 + 2.54);
    const depth = Math.max(2.54, (board.rows - 1) * 2.54 + 2.54);
    const boardMesh = B.MeshBuilder.CreateBox("perfboard", { width, height: boardT, depth }, this.scene);
    boardMesh.position.y = 0;
    boardMesh.material = this.material(B, "board", board.color || "#284969", 0.34);

    this.instantiateHoleSurface(B, board, boardT / 2 + 0.018, "top");
    this.instantiateHoleSurface(B, board, -boardT / 2 - 0.018, "bottom");
  }

  instantiateHoleSurface(B, board, y, side) {
    const padRadius = Math.max(0.22, board.padDiameterMm * 0.34);
    const holeRadius = Math.max(0.12, board.holeDiameterMm * 0.24);
    const padMat = this.material(B, `pad-${side}`, "#d2a64c", 0.24);
    const holeMat = this.material(B, `hole-${side}`, "#070b12", 0.8);
    const padMaster = B.MeshBuilder.CreateCylinder(`pad-master-${side}`, { diameter: padRadius * 2, height: 0.035, tessellation: 20 }, this.scene);
    const holeMaster = B.MeshBuilder.CreateCylinder(`hole-master-${side}`, { diameter: holeRadius * 2, height: 0.044, tessellation: 16 }, this.scene);
    padMaster.material = padMat;
    holeMaster.material = holeMat;
    padMaster.isVisible = false;
    holeMaster.isVisible = false;

    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const p = this.gridTo3D(col, row);
        const pad = padMaster.createInstance(`pad-${side}-${col}-${row}`);
        pad.position.set(p.x, y, p.z);
        const hole = holeMaster.createInstance(`hole-${side}-${col}-${row}`);
        hole.position.set(p.x, y + (side === "top" ? 0.008 : -0.008), p.z);
      }
    }
  }

  buildComponents(B) {
    this.store.state.components.forEach(component => {
      const pins = this.store.pinsFor(component).map(pin => ({ ...pin, pos: this.gridTo3D(pin.col, pin.row) }));
      if (!pins.length) return;
      if (this.isCompactSmdFootprint(component, pins)) {
        this.buildSmdComponent(B, component, pins);
        return;
      }

      const xs = pins.map(pin => pin.pos.x), zs = pins.map(pin => pin.pos.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const center = new B.Vector3((minX + maxX) / 2, 1.55, (minZ + maxZ) / 2);
      const width = Math.max(1.6, maxX - minX + 1.1);
      const depth = Math.max(1.6, maxZ - minZ + 1.1);
      const height = component.kind === "ic" ? 1.05 : component.kind === "header" ? 1.8 : 0.9;

      const body = B.MeshBuilder.CreateBox(`comp-${component.id}`, { width, depth, height }, this.scene);
      body.position = center;
      body.material = this.material(B, `mat-${component.id}`, component.color || "#cbd5e1", { alpha: 0.48, transparentDepth: false });
      body.renderingGroupId = 2;
      body.alphaIndex = 20;
      // Pin positions are already rotation-aware; the body box is fitted to those pins.

      pins.forEach(pin => this.addPinPeg(B, pin.pos, component.kind === "header" ? 2.2 : 0.9));
      this.addLabel(B, body, `${component.name || component.id}${component.value ? " " + component.value : ""}`);
    });
  }


  isCompactSmdFootprint(component, pins) {
    if (!pins || pins.length !== 2) return false;
    if (String(component.kind || "").startsWith("smd")) return true;
    const compactKind = ["resistor", "capacitor", "electrolytic", "led", "crystal"].includes(component.kind);
    const dx = Math.abs((pins[1].col || 0) - (pins[0].col || 0));
    const dy = Math.abs((pins[1].row || 0) - (pins[0].row || 0));
    return compactKind && Math.max(dx, dy) <= 1;
  }

  buildSmdComponent(B, component, pins) {
    const [a, b] = pins;
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const len = Math.max(1.2, Math.hypot(dx, dz));
    const mid = new B.Vector3((a.pos.x + b.pos.x) / 2, 1.03, (a.pos.z + b.pos.z) / 2);
    const angleY = Math.atan2(-dz, dx);
    const bodyWidth = Math.max(1.25, Math.min(len * 0.58, 2.15));
    const bodyDepth = component.kind === "smdElectrolytic" || component.kind === "electrolytic" ? 1.45 : 1.2;
    const bodyHeight = component.kind === "smdElectrolytic" || component.kind === "electrolytic" ? 0.42 : 0.32;

    const body = B.MeshBuilder.CreateBox(`smd-${component.id}`, { width: bodyWidth, depth: bodyDepth, height: bodyHeight }, this.scene);
    body.position = mid;
    body.rotation.y = angleY;
    body.material = this.material(B, `smd-mat-${component.id}`, component.color || "#cbd5e1", { alpha: 0.58, transparentDepth: false });
    body.renderingGroupId = 3;
    body.alphaIndex = 30;

    const terminalMat = this.material(B, `smd-terminal-${component.id}`, "#dce4ef", { alpha: 0.78, transparentDepth: false });
    [a, b].forEach((pin, index) => {
      const terminal = B.MeshBuilder.CreateBox(`smd-terminal-${component.id}-${index}`, { width: 0.68, depth: bodyDepth + 0.18, height: 0.12 }, this.scene);
      terminal.position.set(pin.pos.x, 0.93, pin.pos.z);
      terminal.rotation.y = angleY;
      terminal.material = terminalMat;
      terminal.renderingGroupId = 2;
      terminal.alphaIndex = 21;
    });

    this.addLabel(B, body, `${component.name || component.id}${component.value ? " " + component.value : ""}`);
  }

  addPinPeg(B, pos, height) {
    const peg = B.MeshBuilder.CreateCylinder("pin-peg", { diameter: 0.5, height, tessellation: 12 }, this.scene);
    peg.position.set(pos.x, 1.0 + height / 2, pos.z);
    peg.material = this.material(B, "pin-metal", "#e6edf3");
    peg.renderingGroupId = 3;
  }

  addLabel(B, parent, text) {
    const safe = String(text || "").slice(0, 28);
    if (!safe) return;
    const texture = new B.DynamicTexture(`label-tex-${parent.name}`, { width: 768, height: 192 }, this.scene, true);
    const ctx = texture.getContext();
    ctx.clearRect(0, 0, 768, 192);
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.strokeStyle = "rgba(0,0,0,0.82)";
    ctx.lineWidth = 10;
    ctx.font = "bold 66px system-ui, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(safe, 384, 96, 720);
    ctx.fillText(safe, 384, 96, 720);
    texture.hasAlpha = true;
    texture.update();

    const mat = new B.StandardMaterial(`label-mat-${parent.name}`, this.scene);
    mat.diffuseTexture = texture;
    mat.opacityTexture = texture;
    mat.emissiveTexture = texture;
    mat.disableLighting = true;
    mat.backFaceCulling = false;

    const labelWidth = clamp(safe.length * 0.52, 3.2, 9.5);
    const plane = B.MeshBuilder.CreatePlane(`label-${parent.name}`, { width: labelWidth, height: 1.25 }, this.scene);
    plane.parent = parent;
    plane.position.set(0, parent.getBoundingInfo().boundingBox.extendSize.y + 0.07, 0);
    plane.rotation.x = Math.PI / 2;
    plane.material = mat;
    plane.isPickable = false;
  }

  buildWires(B) {
    this.store.state.wires.forEach(wire => {
      if (!wire.route || wire.route.length < 2) return;
      const y = wire.layer === "bottom" ? -1.02 : 1.02;
      const points = wire.route.map(point => {
        const p = this.gridTo3D(point.col, point.row);
        return new B.Vector3(p.x, wire.layer === "jumper" ? y + 3.2 : y, p.z);
      });
      if (wire.style === "dashed" || wire.layer === "jumper") this.createDashedTubes(B, points, wire);
      else this.createTube(B, points, wire, 0.08);
    });
  }

  createTube(B, points, wire, radius = 0.07) {
    const mesh = B.MeshBuilder.CreateTube(`wire-${wire.id}`, { path: points, radius, tessellation: 8, cap: B.Mesh.CAP_ALL }, this.scene);
    mesh.material = this.material(B, `wire-mat-${wire.layer}-${wire.color || "default"}`, this.wireColor(wire));
    mesh.renderingGroupId = 1;
  }

  createDashedTubes(B, points, wire) {
    const dash = 1.25;
    const gap = 0.75;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const length = B.Vector3.Distance(a, b);
      if (length <= 0.01) continue;
      const dir = b.subtract(a).normalize();
      let cursor = 0;
      let segment = 0;
      while (cursor < length) {
        const end = Math.min(cursor + dash, length);
        const p0 = a.add(dir.scale(cursor));
        const p1 = a.add(dir.scale(end));
        this.createTube(B, [p0, p1], { ...wire, id: `${wire.id}-${i}-${segment}` }, 0.065);
        cursor += dash + gap;
        segment += 1;
      }
    }
  }

  gridTo3D(col, row) {
    const board = this.store.state.board;
    return {
      x: (col - (board.cols - 1) / 2) * 2.54,
      z: ((board.rows - 1) / 2 - row) * 2.54
    };
  }

  rotationToY(deg) {
    return -((deg || 0) * Math.PI / 180);
  }

  wireColor(wire) {
    if (wire.color) return wire.color;
    if (wire.layer === "bottom") return "#5fa7ff";
    if (wire.layer === "jumper") return "#40d7ff";
    return "#d6a11e";
  }

  material(B, name, hex, options = {}) {
    const mat = new B.StandardMaterial(name, this.scene);
    const opts = typeof options === "object" && options ? options : {};
    mat.diffuseColor = B.Color3.FromHexString(hex || "#cccccc");
    mat.emissiveColor = B.Color3.FromHexString(hex || "#cccccc");
    mat.specularColor = new B.Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.backFaceCulling = false;

    if (opts.alpha != null && opts.alpha < 1) {
      mat.alpha = opts.alpha;
      mat.transparencyMode = B.Material.MATERIAL_ALPHABLEND;
      // Keep traces visible through transparent component bodies.
      mat.disableDepthWrite = opts.transparentDepth === false ? true : false;
    }

    return mat;
  }
}
