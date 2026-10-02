import { clamp } from "./core.js";
import { copperRuns } from "./copper.js";
import { BOARD_THICKNESS, copperStripGeometry, perforatedBoardGeometry, roundPolyline } from "./geometry-3d.js";
import { ComponentModels3D } from "./models-3d.js";

export class Render3DService {
  constructor(store, modal) {
    this.store = store; this.modal = modal;
    this.options = { parts: true, wires: true, copper: true, labels: false, xray: false, rotate: false, explode: 0 };
    this.engine = null; this.scene = null;
    this.parts = []; this.labels = []; this.wireMeshes = []; this.copperMeshes = [];
    this.materials = new Map(); this.xrayMaterials = new Map();
  }

  async show() {
    this.modal.open("3D board preview", `
      <div class="viewer3d">
        <div class="view3d-toolbar" aria-label="3D view controls">
          <div class="view3d-presets" aria-label="Camera views">
            <button data-view3d="perspective" aria-pressed="true">3D</button><button data-view3d="top" aria-pressed="false">Top</button><button data-view3d="bottom" aria-pressed="false">Bottom</button><button data-view3d="front" aria-pressed="false">Front</button><button id="fit3dBtn">Fit</button>
          </div>
          <div class="view3d-actions"><button id="refresh3dBtn">Refresh</button><button id="save3dBtn" disabled>Save PNG</button><button id="fullscreen3dBtn" aria-label="Full screen 3D preview" title="Full screen">⛶</button></div>
        </div>
        <div class="view3d-stage">
          <canvas id="view3dCanvas" tabindex="0" aria-label="Interactive 3D board. Drag to orbit, right-drag to pan, scroll to zoom."></canvas>
          <div class="view3d-loading" role="status">Preparing 3D preview…</div>
          <div class="view3d-info" aria-live="polite"></div>
          <div class="view3d-selection" hidden></div>
        </div>
        <div class="view3d-settings" aria-label="Display settings">
          ${["parts", "wires", "copper", "labels", "xray", "rotate"].map(key => `<label><input type="checkbox" data-option3d="${key}" ${this.options[key] ? "checked" : ""}>${({ parts: "Parts", wires: "Wires", copper: "Copper", labels: "Labels", xray: "X-ray", rotate: "Auto rotate" })[key]}</label>`).join("")}
          <label class="view3d-explode">Lift parts <input id="explode3d" type="range" min="0" max="14" step="1" value="${this.options.explode}" aria-label="Lift parts above the board"><output id="explode3dValue">${this.options.explode} mm</output></label>
        </div>
        <div class="view3d-help"><span>Drag to orbit · Right-drag to pan · Scroll to zoom · Click a part for details</span><span>Pin positions follow the layout. Body sizes are approximate.</span></div>
      </div>
    `, () => { this.dispose(); document.querySelector(".modal-card")?.classList.remove("modal-3d"); });
    document.querySelector(".modal-card").classList.add("modal-3d");
    this.canvas = document.querySelector("#view3dCanvas");
    this.bindControls();
    await this.start(this.canvas);
  }

  async start(canvas) {
    const current = () => canvas.isConnected && document.querySelector("#view3dCanvas") === canvas;
    this.loadingStatus("Preparing 3D preview…");
    try {
      if (!window.BABYLON) await this.loadLibrary();
      if (!current()) return;
      this.render();
    } catch (error) {
      if (current()) { this.dispose(); document.querySelector("#save3dBtn").disabled = true; this.loadingStatus(`${error.message} Use Refresh to retry.`, true); }
    }
  }

  loadLibrary() {
    if (!this.loading) this.loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.babylonjs.com/babylon.js";
      const fail = message => { script.remove(); this.loading = null; reject(new Error(message)); };
      const timer = setTimeout(() => fail("3D could not load. Check your internet connection."), 15000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); fail("3D needs an internet connection. The 2D editor remains available."); };
      document.head.append(script);
    });
    return this.loading;
  }

  loadingStatus(message, error = false) {
    const el = document.querySelector(".view3d-loading");
    if (el) { el.textContent = message; el.hidden = !message; el.classList.toggle("modal-error", error); }
  }

  bindControls() {
    document.querySelectorAll("[data-view3d]").forEach(button => { button.onclick = () => this.setView(button.dataset.view3d); });
    document.querySelector("#fit3dBtn").onclick = () => this.fitCamera();
    document.querySelector("#refresh3dBtn").onclick = () => this.start(this.canvas);
    document.querySelectorAll("[data-option3d]").forEach(input => {
      input.onchange = () => { this.options[input.dataset.option3d] = input.checked; this.updateDisplay(); };
    });
    document.querySelector("#explode3d").oninput = event => {
      this.options.explode = Number(event.target.value);
      document.querySelector("#explode3dValue").textContent = `${this.options.explode} mm`;
      this.updateDisplay();
    };
    document.querySelector("#save3dBtn").onclick = () => this.saveImage();
    const fullscreen = document.querySelector("#fullscreen3dBtn");
    fullscreen.hidden = !document.fullscreenEnabled;
    fullscreen.onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.querySelector(".viewer3d").requestFullscreen();
      } catch (error) { this.loadingStatus(`Full screen unavailable: ${error.message}`, true); }
    };
  }

  pitchMm() { return parseFloat(this.store.state.board.gridUnit) || 2.54; }

  dispose() {
    this.resizeObserver?.disconnect(); this.resizeObserver = null;
    if (this.engine) this.engine.stopRenderLoop();
    this.scene?.dispose(); this.engine?.dispose();
    this.scene = null; this.engine = null; this.camera = null; this.shadow = null;
    this.parts = []; this.labels = []; this.wireMeshes = []; this.copperMeshes = [];
    this.materials = new Map(); this.xrayMaterials = new Map(); this.selectedId = null;
  }

  render() {
    const previous = this.camera && { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, target: this.camera.target.clone() };
    this.dispose();
    const B = window.BABYLON, canvas = document.querySelector("#view3dCanvas");
    if (!B?.Engine || !canvas) return;
    this.canvas = canvas;
    this.engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new B.Scene(this.engine);
    this.scene.clearColor = B.Color4.FromHexString(document.body.classList.contains("light") ? "#e5edeeff" : "#101b26ff");
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.imageProcessingConfiguration.exposure = 0.9;
    this.buildCameraAndLights(B);
    this.buildBoard(B); this.buildSolderBridges(B); this.buildWires(B); this.buildComponents(B);
    this.fitCamera();
    if (previous) { this.camera.setTarget(previous.target); Object.assign(this.camera, { alpha: previous.alpha, beta: previous.beta, radius: previous.radius }); }
    this.updateDisplay();
    this.scene.onPointerObservable.add(event => {
      if (event.type !== B.PointerEventTypes.POINTERPICK) return;
      const data = event.pickInfo?.pickedMesh?.metadata;
      this.selectPart(data?.type === "component" ? data.id : null);
    });
    this.engine.runRenderLoop(() => {
      if (this.options.rotate) this.camera.alpha += this.engine.getDeltaTime() * 0.00016;
      for (const label of this.labels) this.positionLabel(label);
      this.scene.render();
    });
    this.resizeObserver = new ResizeObserver(() => this.engine?.resize());
    this.resizeObserver.observe(canvas);
    const board = this.store.state.board;
    document.querySelector(".view3d-info").textContent = `${board.cols} × ${board.rows} holes · ${(board.cols * this.pitchMm()).toFixed(1)} × ${(board.rows * this.pitchMm()).toFixed(1)} mm · ${this.parts.length} parts`;
    document.querySelector(".view3d-selection").hidden = true;
    document.querySelector("#save3dBtn").disabled = false;
    this.loadingStatus("");
  }

  buildCameraAndLights(B) {
    const camera = this.camera = new B.ArcRotateCamera("camera", -Math.PI / 2.8, Math.PI / 3.2, 100, B.Vector3.Zero(), this.scene);
    camera.lowerBetaLimit = 0.015; camera.upperBetaLimit = Math.PI - 0.015;
    camera.minZ = 0.1; camera.maxZ = 5000;
    camera.wheelDeltaPercentage = 0.012; camera.pinchDeltaPercentage = 0.01;
    camera.panningSensibility = 100; camera.inertia = 0.75;
    camera.attachControl(this.canvas, true);
    this.scene.activeCamera = camera;
    const fill = new B.HemisphericLight("fill", new B.Vector3(0, 1, 0), this.scene);
    fill.intensity = 0.65; fill.groundColor = B.Color3.FromHexString("#7791a2");
    const key = new B.DirectionalLight("key", new B.Vector3(-0.45, -1, 0.35), this.scene);
    key.position.set(50, 100, -70); key.intensity = 1.5;
    const rim = new B.DirectionalLight("rim", new B.Vector3(0.5, 0.7, -0.4), this.scene);
    rim.intensity = 0.8;
    this.shadow = new B.ShadowGenerator(1024, key);
    this.shadow.usePercentageCloserFiltering = true;
    this.shadow.bias = 0.003; this.shadow.normalBias = 0.02;
  }

  fitCamera() {
    if (!this.camera) return;
    const B = window.BABYLON, board = this.store.state.board, pitch = this.pitchMm();
    let low = -BOARD_THICKNESS / 2, high = BOARD_THICKNESS / 2;
    for (const root of this.parts) {
      const extent = BOARD_THICKNESS / 2 + this.options.explode + root.metadata.height;
      if (root.metadata.side > 0) high = Math.max(high, extent); else low = Math.min(low, -extent);
    }
    const width = board.cols * pitch / 2, depth = board.rows * pitch / 2, height = (high - low) / 2;
    const bound = Math.hypot(width, depth, height);
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const { alpha, beta } = this.camera;
    const eye = [Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta)];
    const right = [Math.sin(alpha), 0, -Math.cos(alpha)], up = [-Math.cos(alpha) * Math.cos(beta), Math.sin(beta), -Math.sin(alpha) * Math.cos(beta)];
    const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0), tangent = Math.tan(this.camera.fov / 2);
    let radius = 0;
    for (const x of [-width, width]) for (const y of [-height, height]) for (const z of [-depth, depth]) {
      const p = [x, y, z], towardCamera = dot(p, eye);
      radius = Math.max(radius, towardCamera + Math.abs(dot(p, right)) / (tangent * aspect), towardCamera + Math.abs(dot(p, up)) / tangent);
    }
    radius *= 1.14;
    this.camera.setTarget(new B.Vector3(0, (high + low) / 2, 0));
    // Babylon rebuilds the orbit when the target moves; retain the chosen view.
    Object.assign(this.camera, { alpha, beta, inertialPanningX: 0, inertialPanningY: 0 });
    this.camera.radius = radius; this.camera.lowerRadiusLimit = Math.max(2, bound * 0.1); this.camera.upperRadiusLimit = radius * 5;
  }

  setView(view) {
    if (!this.camera) return;
    const angles = { perspective: [-Math.PI / 2.8, Math.PI / 3.2], top: [-Math.PI / 2, 0.015], bottom: [Math.PI / 2, Math.PI - 0.015], front: [-Math.PI / 2, Math.PI / 2] }[view];
    if (!angles) return;
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
    [this.camera.alpha, this.camera.beta] = angles;
    this.options.rotate = false; document.querySelector('[data-option3d="rotate"]').checked = false;
    this.fitCamera();
    document.querySelectorAll("[data-view3d]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.view3d === view)));
  }

  geometryMesh(B, name, geometry) {
    const mesh = new B.Mesh(name, this.scene), data = new B.VertexData();
    data.positions = geometry.positions; data.indices = geometry.indices; data.normals = [];
    B.VertexData.ComputeNormals(data.positions, data.indices, data.normals); data.applyToMesh(mesh);
    return mesh;
  }

  buildBoard(B) {
    const board = this.store.state.board, pitch = this.pitchMm();
    const detailed = board.cols * board.rows <= 2000;
    const mesh = detailed ? this.geometryMesh(B, "perfboard", perforatedBoardGeometry(board, pitch)) : B.MeshBuilder.CreateBox("perfboard", { width: board.cols * pitch, height: BOARD_THICKNESS, depth: board.rows * pitch }, this.scene);
    mesh.material = this.material(B, "board", board.color || "#284969", { roughness: 0.85 });
    mesh.isPickable = false; mesh.receiveShadows = true;
    for (const [index, [a, b]] of copperRuns(board).entries()) {
      let strip;
      if (detailed) strip = this.geometryMesh(B, `copper-${index}`, copperStripGeometry(board, a, b, pitch));
      else {
        const start = this.gridTo3D(a.col, a.row), end = this.gridTo3D(b.col, b.row), vertical = board.stripDirection === "vertical";
        strip = B.MeshBuilder.CreateBox(`copper-${index}`, { width: vertical ? pitch * 0.65 : Math.abs(end.x - start.x), depth: vertical ? Math.abs(end.z - start.z) : pitch * 0.65, height: 0.015 }, this.scene);
        strip.position.set((start.x + end.x) / 2, -0.82, (start.z + end.z) / 2);
      }
      strip.material = this.material(B, "copper", "#b78542", { metallic: 0.72, roughness: 0.36 });
      strip.isPickable = false; this.copperMeshes.push(strip);
    }
    this.instantiateHoleSurface(B, board, BOARD_THICKNESS / 2 + 0.025, "top", detailed);
    this.instantiateHoleSurface(B, board, -BOARD_THICKNESS / 2 - 0.025, "bottom", detailed);
  }

  instantiateHoleSurface(B, board, y, side, detailed = true) {
    const pitch = this.pitchMm(), hole = clamp(board.holeDiameterMm, 0.2, pitch * 0.8), pad = clamp(board.padDiameterMm, hole + 0.15, pitch * 0.9);
    const thickness = (pad - hole) / 2;
    const ring = B.MeshBuilder.CreateTorus(`pads-${side}`, { diameter: (pad + hole) / 2, thickness, tessellation: 16 }, this.scene);
    ring.material = this.material(B, "pads", "#c79d58", { metallic: 0.8, roughness: 0.32 }); ring.isPickable = false;
    const matrices = new Float32Array(board.cols * board.rows * 16);
    let index = 0;
    for (let row = 0; row < board.rows; row++) for (let col = 0; col < board.cols; col++) {
      const p = this.gridTo3D(col, row);
      B.Matrix.Compose(new B.Vector3(1, 0.12, 1), B.Quaternion.Identity(), new B.Vector3(p.x, y, p.z)).copyToArray(matrices, index * 16); index++;
    }
    ring.thinInstanceSetBuffer("matrix", matrices, 16, true); this.copperMeshes.push(ring);
    if (!detailed) {
      const holes = B.MeshBuilder.CreateCylinder(`holes-${side}`, { diameter: hole, height: 0.045, tessellation: 12 }, this.scene);
      holes.material = this.material(B, "hole", "#071015", { roughness: 1 }); holes.isPickable = false;
      const markers = matrices.slice();
      for (let i = 13; i < markers.length; i += 16) markers[i] += side === "top" ? 0.055 : -0.055;
      holes.thinInstanceSetBuffer("matrix", markers, 16, true);
    }
  }

  buildComponents(B) {
    const models = new ComponentModels3D(this, B);
    for (const component of this.store.state.components) {
      const root = models.create(component); this.parts.push(root);
      this.addLabel(B, root, component.name || component.id);
    }
    this.buildPinSolder(B);
  }

  buildPinSolder(B) {
    const pads = new Map(), board = this.store.state.board;
    for (const component of this.store.state.components) {
      if (String(component.kind).startsWith("smd")) continue;
      for (const pin of this.store.pinsFor(component)) {
        const side = board.type === "stripboard" || component.side !== "bottom" ? -1 : 1;
        pads.set(`${side}:${pin.col},${pin.row}`, { ...this.gridTo3D(pin.col, pin.row), side });
      }
    }
    if (!pads.size) return;
    const blob = B.MeshBuilder.CreateSphere("pin-solder", { diameter: 1, segments: 12 }, this.scene);
    blob.material = this.material(B, "solder", "#bfcbd1", { metallic: 0.85, roughness: 0.25 }); blob.isPickable = false;
    const matrices = new Float32Array(pads.size * 16);
    let i = 0;
    for (const pad of pads.values()) B.Matrix.Compose(new B.Vector3(1.1, 0.4, 1.1), B.Quaternion.Identity(), new B.Vector3(pad.x, pad.side * 0.99, pad.z)).copyToArray(matrices, i++ * 16);
    blob.thinInstanceSetBuffer("matrix", matrices, 16, true); this.wireMeshes.push(blob);
  }

  addLabel(B, root, text) {
    const safe = String(text || "").slice(0, 22);
    const texture = new B.DynamicTexture(`label-${root.name}`, { width: 256, height: 64 }, this.scene, false);
    const ctx = texture.getContext();
    ctx.fillStyle = "rgba(15,26,36,0.86)"; ctx.fillRect(0, 0, 256, 64);
    ctx.font = "600 30px system-ui, Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#edf6f4"; ctx.fillText(safe, 128, 32, 240);
    texture.hasAlpha = true; texture.update();
    const mat = new B.StandardMaterial(`label-${root.name}`, this.scene);
    mat.diffuseTexture = texture; mat.emissiveColor = B.Color3.White(); mat.disableLighting = true; mat.backFaceCulling = false;
    const plane = B.MeshBuilder.CreatePlane(`label-${root.metadata.id}`, { width: clamp(safe.length * 0.65 + 1.2, 3.4, 12), height: 1.65 }, this.scene);
    plane.material = mat; plane.billboardMode = B.Mesh.BILLBOARDMODE_ALL; plane.isPickable = false;
    plane.metadata = { root }; this.labels.push(plane); this.positionLabel(plane);
  }

  positionLabel(label) {
    const root = label.metadata.root;
    label.position.set(root.position.x, root.position.y + root.metadata.side * (root.metadata.height + 1.1), root.position.z);
  }

  buildWires(B) {
    for (const wire of this.store.state.wires) {
      if (!wire.route || wire.route.length < 2) continue;
      const side = wire.layer === "bottom" ? -1 : 1;
      const insulated = wire.layer === "jumper" || wire.bridgeType === "insulated" || wire.bridgeType === "jumper";
      const y = side * (BOARD_THICKNESS / 2 + (insulated ? 2.4 : 0.23));
      const points = wire.route.map(p => ({ ...this.gridTo3D(p.col, p.row), y }));
      if (insulated) {
        for (const p of [points[0], points[points.length - 1]]) this.createTube(B, [{ x: p.x, z: p.z, y: side * (BOARD_THICKNESS / 2 + 0.1) }, p], wire, 0.18, true, true);
      }
      this.createTube(B, roundPolyline(points, insulated ? 1.1 : 0.4), wire, insulated ? 0.32 : 0.17, !insulated);
    }
  }

  createTube(B, points, wire, radius = 0.17, metal = false, contact = false) {
    const path = points.filter((p, i) => !i || B.Vector3.Distance(new B.Vector3(p.x, p.y, p.z), new B.Vector3(points[i - 1].x, points[i - 1].y, points[i - 1].z)) > 1e-6).map(p => new B.Vector3(p.x, p.y, p.z));
    if (path.length < 2) return;
    const mesh = B.MeshBuilder.CreateTube(`wire-${wire.id}-${this.wireMeshes.length}`, { path, radius, tessellation: 10, cap: B.Mesh.CAP_ALL }, this.scene);
    mesh.material = this.material(B, "wire", contact ? "#b9c5cd" : wire.color || this.wireColor(wire), { metallic: metal ? 0.8 : 0, roughness: metal ? 0.3 : 0.5 });
    mesh.metadata = { type: "wire", id: wire.id }; this.wireMeshes.push(mesh);
  }

  buildSolderBridges(B) {
    for (const bridge of this.store.state.solderBridges || []) {
      const side = bridge.layer === "bottom" ? -1 : 1, a = this.gridTo3D(bridge.a.col, bridge.a.row), b = this.gridTo3D(bridge.b.col, bridge.b.row);
      const blob = B.MeshBuilder.CreateSphere(`solder-${bridge.id}`, { diameter: 1, segments: 16 }, this.scene);
      blob.position.set((a.x + b.x) / 2, side * 0.98, (a.z + b.z) / 2);
      blob.scaling.set(Math.hypot(b.x - a.x, b.z - a.z) + 0.85, 0.38, 0.85); blob.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      blob.material = this.material(B, "solder", "#bfcbd1", { metallic: 0.85, roughness: 0.25 }); blob.isPickable = false; this.wireMeshes.push(blob);
    }
  }

  updateDisplay() {
    if (!this.scene) return;
    const B = window.BABYLON;
    for (const root of this.parts) {
      root.setEnabled(this.options.parts); root.position.y = root.metadata.side * (BOARD_THICKNESS / 2 + this.options.explode);
      for (const mesh of root.getChildMeshes()) {
        mesh._solidMaterial ||= mesh.material;
        if (this.options.xray && mesh.metadata.role !== "lead") {
          const base = mesh._solidMaterial;
          if (!this.xrayMaterials.has(base.uniqueId)) {
            const mat = base.clone(`xray-${base.name}`); mat.alpha = Math.min(base.alpha, 0.28); mat.transparencyMode = B.Material.MATERIAL_ALPHABLEND; mat.needDepthPrePass = true;
            this.xrayMaterials.set(base.uniqueId, mat);
          }
          mesh.material = this.xrayMaterials.get(base.uniqueId);
        } else mesh.material = mesh._solidMaterial;
      }
    }
    for (const mesh of this.wireMeshes) mesh.setEnabled(this.options.wires);
    for (const mesh of this.copperMeshes) mesh.setEnabled(this.options.copper);
    for (const label of this.labels) { this.positionLabel(label); label.setEnabled(this.options.parts && (this.options.labels || label.metadata.root.metadata.id === this.selectedId)); }
    const info = document.querySelector(".view3d-selection"); if (info) info.hidden = !this.options.parts || !this.selectedId;
  }

  selectPart(id) {
    this.selectedId = id;
    for (const root of this.parts) for (const mesh of root.getChildMeshes()) {
      mesh.renderOutline = root.metadata.id === id && mesh.metadata.role === "body";
      mesh.outlineColor = window.BABYLON.Color3.FromHexString("#83d6b5"); mesh.outlineWidth = 0.07;
    }
    const component = this.store.state.components.find(c => c.id === id), info = document.querySelector(".view3d-selection");
    if (info) info.textContent = component ? `${component.name || component.id}${component.value ? ` · ${component.value}` : ""} · ${component.side === "bottom" ? "Bottom" : "Top"} · ${component.pins.length} pins` : "";
    this.updateDisplay();
  }

  saveImage() {
    if (!this.scene) return;
    this.scene.render();
    this.canvas.toBlob(blob => {
      if (!blob) { this.loadingStatus("Could not save the 3D image. Try Refresh.", true); return; }
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${(this.store.state.name || "board").replace(/[^a-z0-9_-]+/gi, "-")}-3d.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  gridTo3D(col, row) {
    const board = this.store.state.board;
    return { x: (col - (board.cols - 1) / 2) * this.pitchMm(), z: ((board.rows - 1) / 2 - row) * this.pitchMm() };
  }

  wireColor(wire) { return wire.layer === "bottom" ? "#78bafa" : wire.layer === "jumper" ? "#c59cf2" : "#efc77a"; }

  material(B, name, hex, options = {}) {
    const key = JSON.stringify([name, hex, options]);
    if (this.materials.has(key)) return this.materials.get(key);
    const mat = new B.PBRMaterial(`${name}-${this.materials.size}`, this.scene);
    mat.albedoColor = B.Color3.FromHexString(hex || "#cccccc"); mat.metallic = options.metallic || 0; mat.roughness = options.roughness ?? 0.55;
    mat.alpha = options.alpha ?? 1; mat.backFaceCulling = false;
    if (mat.alpha < 1) { mat.transparencyMode = B.Material.MATERIAL_ALPHABLEND; mat.needDepthPrePass = true; }
    this.materials.set(key, mat); return mat;
  }
}
