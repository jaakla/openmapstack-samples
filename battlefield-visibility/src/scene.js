import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { height } from "./visibility.js";
import { loadBuildingLayer } from "./buildings.js";
import { formatMGRS } from "./coordinates.js";

const ZONE_COLORS = [null, "#60a86a", "#f5c744", "#ef5456"];
export class VisibilityScene {
  constructor(host, data, onPosition) {
    this.host = host;
    this.data = data;
    this.lastUpdate = 0;
    this.layers = {};
    this.disposed = false;
    this.needsRender = true;
    const { grid, config } = data;
    this.grid = grid;
    this.config = config;
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "low-power",
    }));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor("#0d171b");
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    this.world = new THREE.Scene();
    this.world.fog = new THREE.Fog("#0d171b", 2500, 6500);
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.addEventListener("change", () => {
      this.needsRender = true;
    });
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 3400;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.world.add(new THREE.HemisphereLight("#ffffff", "#45544b", 2.1));
    const sun = new THREE.DirectionalLight("#e7ede2", 2.0);
    sun.position.set(-500, 1200, 600);
    this.world.add(sun);
    this.resetCamera();
    this.buildTerrain();
    this.buildBuildings();
    this.groups = {
      vegetation: new THREE.Group(),
      roads: new THREE.Group(),
      predictions: new THREE.Group(),
      traces: new THREE.Group(),
      uncertainty: new THREE.Group(),
      los: new THREE.Group(),
      affiliations: new THREE.Group(),
      vectors: new THREE.Group(),
    };
    Object.values(this.groups).forEach((g) => this.world.add(g));
    this.marker = this.label("OWN", "friendly");
    this.marker.renderOrder = 10;
    this.world.add(this.marker);
    this.loadAssets().catch((error) => {
      if (!this.disposed) this.error(error);
    });
    const raycaster = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let down = null;
    this.pointerDown = (e) => {
      down = { x: e.clientX, y: e.clientY, time: performance.now() };
    };
    this.pointerUp = (e) => {
      if (
        !down ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 ||
        performance.now() - down.time > 500
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, this.camera);
      const hit = raycaster.intersectObject(this.terrain)[0];
      if (hit) onPosition([hit.point.x, -hit.point.z]);
    };
    renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.resize = new ResizeObserver(() => {
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.needsRender = true;
    });
    this.resize.observe(host);
  }
  error(e) {
    this.host.dispatchEvent(
      new CustomEvent("scene-error", { bubbles: true, detail: String(e) }),
    );
  }
  elevation(x, y) {
    return height(this.grid, this.grid.dtm, x, y);
  }
  point([x, y, z]) {
    return new THREE.Vector3(x, z, -y);
  }
  buildTerrain() {
    const { grid } = this,
      step = 4,
      w = grid.width * grid.resolution,
      h = grid.height * grid.resolution;
    const positions = [],
      uv = [],
      indices = [];
    const cols = Math.floor(w / step),
      rows = Math.floor(h / step);
    for (let y = 0; y <= rows; y++)
      for (let x = 0; x <= cols; x++) {
        const xx = Math.min(w - 0.01, x * step),
          yy = Math.min(h - 0.01, y * step),
          z = this.elevation(xx, yy);
        positions.push(xx, Number.isFinite(z) ? z : -20, -yy);
        uv.push(x / cols, y / rows);
      }
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const a = y * (cols + 1) + x,
          b = a + 1,
          c = a + cols + 1,
          d = c + 1;
        if ([a, b, c, d].some((i) => positions[i * 3 + 1] === -20)) continue;
        indices.push(a, b, c, b, d, c);
      }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const texture = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}data/basemap.jpg`,
      () => {},
      undefined,
      (e) => this.error(e),
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    this.terrain = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 1,
        color: "#a8b5b0",
        side: THREE.DoubleSide,
      }),
    );
    this.world.add(this.terrain);
  }
  buildBuildings() {
    this.buildingGroup = new THREE.Group();
    this.world.add(this.buildingGroup);
    // Independent source-backed building GLB can be replaced without touching LOS.
  }
  async loadAssets() {
    const base = import.meta.env.BASE_URL;
    const checked = async (path) => {
      const r = await fetch(base + path);
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r;
    };
    const [buildings, vegetationBuffer, roads, uav] = await Promise.all([
      loadBuildingLayer(this.config.buildingMesh, base),
      checked("data/vegetation.bin").then((r) => r.arrayBuffer()),
      checked("data/roads.json").then((r) => r.json()),
      new GLTFLoader().loadAsync(base + "models/uav.glb"),
    ]);
    if (this.disposed) return;
    this.buildingGroup.add(buildings);
    const vp = new Float32Array(vegetationBuffer),
      vg = new THREE.BufferGeometry();
    vg.setAttribute("position", new THREE.BufferAttribute(vp, 3));
    this.groups.vegetation.add(
      new THREE.Points(
        vg,
        new THREE.PointsMaterial({
          color: "#487452",
          size: 2.7,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.85,
        }),
      ),
    );
    for (const road of roads) {
      const p = road.coordinates
        .map(([x, y]) => this.point([x, y, this.elevation(x, y) + 0.5]))
        .filter((p) => Number.isFinite(p.y));
      if (p.length > 1)
        this.groups.roads.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(p),
            new THREE.LineBasicMaterial({
              color: "#6e8094",
              transparent: true,
              opacity: 0.5,
            }),
          ),
        );
    }
    this.models = {
      uav: this.prepareModel(uav.scene, 1.2),
    };
    if (this.latestSnapshot) this.updateSnapshot(this.latestSnapshot);
    this.setLayers(this.layers);
  }
  prepareModel(object, length) {
    const box = new THREE.Box3().setFromObject(object),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    const scale = length / Math.max(size.x, size.z);
    object.scale.multiplyScalar(scale);
    object.position.sub(center.multiplyScalar(scale));
    object.position.y -= new THREE.Box3().setFromObject(object).min.y;
    const group = new THREE.Group();
    group.add(object);
    return group;
  }
  clear(group) {
    while (group.children.length) {
      const c = group.children[0];
      group.remove(c);
      c.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            m.map?.dispose();
            m.dispose();
          }
        }
      });
    }
  }
  updateSnapshot(result) {
    this.needsRender = true;
    this.latestSnapshot = result;
    if (this.zoneMesh) {
      this.world.remove(this.zoneMesh);
      this.zoneMesh.geometry.dispose();
      this.zoneMesh.material.dispose();
    }
    const positions = [],
      colors = [];
    for (let row = 0; row < result.rows; row++)
      for (let col = 0; col < result.cols; col++) {
        const zone = result.zones[row * result.cols + col],
          key = ["unknown", "green", "yellow", "red"][zone];
        if (!zone || this.layers[key] === false) continue;
        const x = col * result.spacing,
          y = row * result.spacing,
          s = result.spacing;
        const points = [
          [x, y],
          [x + s, y],
          [x, y + s],
          [x + s, y + s],
        ].map(([xx, yy]) => [
          xx,
          this.elevation(
            Math.min(xx, this.grid.width - 0.01),
            Math.min(yy, this.grid.height - 0.01),
          ) + 1.1,
          -yy,
        ]);
        if (points.some((p) => !Number.isFinite(p[1]))) continue;
        const c = new THREE.Color(ZONE_COLORS[zone]);
        for (const i of [0, 1, 2, 1, 3, 2]) {
          positions.push(...points[i]);
          colors.push(c.r, c.g, c.b);
        }
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.zoneMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.zoneMesh.renderOrder = 1;
    this.zoneMesh.visible = this.layers.scenario !== false;
    this.world.add(this.zoneMesh);
    for (const key of [
      "predictions",
      "traces",
      "uncertainty",
      "los",
      "affiliations",
    ])
      this.clear(this.groups[key]);
    const drawPath = (path, group, color, dashSize, gapSize, opacity) => {
      let points = [];
      const flush = () => {
        if (points.length < 2) {
          points = [];
          return;
        }
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineDashedMaterial({
            color,
            dashSize,
            gapSize,
            transparent: true,
            opacity,
          }),
        );
        line.computeLineDistances();
        this.groups[group].add(line);
        points = [];
      };
      for (const p of path) {
        if (p.every(Number.isFinite)) points.push(this.point(p));
        else flush(); // Never draw a fabricated chord across missing terrain.
      }
      flush();
    };
    for (const trace of result.traces)
      drawPath(trace.path, "traces", "#d2e1dc", 1.3, 7, 0.35);
    for (const future of result.futures) {
      future.paths.forEach((path, i) =>
        drawPath(
          path,
          "predictions",
          i === 1 ? "#f1c45b" : "#bd9747",
          12,
          7,
          i === 1 ? 1 : 0.28,
        ),
      );
      // Terminal along-route range from the 0.8x/1.2x speed hypotheses.
      // Band width is a display annotation, not lateral positional uncertainty.
      const vertices = [];
      for (let i = 1; i < future.uncertaintyPath.length; i++) {
        const a = this.point(future.uncertaintyPath[i - 1]),
          b = this.point(future.uncertaintyPath[i]);
        if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) continue;
        const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x)
          .normalize()
          .multiplyScalar(8);
        const corners = [
          a.clone().add(side),
          a.clone().sub(side),
          b.clone().add(side),
          b.clone().sub(side),
        ];
        for (const j of [0, 1, 2, 1, 3, 2])
          vertices.push(...corners[j].toArray());
      }
      const band = new THREE.BufferGeometry();
      band.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      this.groups.uncertainty.add(
        new THREE.Mesh(
          band,
          new THREE.MeshBasicMaterial({
            color: "#f1c45b",
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        ),
      );
    }
    const tz = this.elevation(...result.target);
    for (const status of result.sightlines) {
      const sensor = result.sensors.find((s) => s.id === status.id);
      if (!Number.isFinite(tz) || !sensor.position.every(Number.isFinite))
        continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          this.point(sensor.position),
          this.point([...result.target, tz + 2]),
        ]),
        new THREE.LineDashedMaterial({
          color: ZONE_COLORS[status.zone] ?? "#84949a",
          dashSize: status.zone === 3 ? 100000 : 7,
          gapSize: status.zone === 3 ? 0 : 4,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 4;
      line.userData = { id: status.id, zone: status.zone };
      this.groups.los.add(line);
    }
    // Model clones share geometry/materials; remove without disposing shared originals.
    this.groups.vectors.clear();
    if (this.models)
      for (const sensor of result.sensors) {
        if (!sensor.position.every(Number.isFinite)) continue;
        const model = this.models.uav.clone(true);
        model.position.copy(
          this.point([
            sensor.position[0],
            sensor.position[1],
            sensor.position[2],
          ]),
        );
        model.rotation.y = sensor.heading;
        this.groups.vectors.add(model);
        // Distant-zoom display magnification is explicitly an annotation, not dimensions.
        model.userData.magnify = 9;
        const sprite = this.label(
          sensor.id,
          "hostile",
          formatMGRS(this.config.origin, sensor.position),
        );
        sprite.position.copy(this.point(sensor.position));
        sprite.position.y += 20;
        this.groups.affiliations.add(sprite);
      }
    this.marker.visible =
      Number.isFinite(tz) &&
      this.layers.affiliations !== false &&
      this.layers.scenario !== false;
    this.marker.position.copy(this.point([...result.target, tz + 3]));
  }
  label(text, affiliation, coordinate = "") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0d171be8";
    ctx.fillRect(0, 0, 512, 100);
    ctx.strokeStyle = affiliation === "hostile" ? "#ff7074" : "#75baff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    if (affiliation === "hostile") {
      ctx.moveTo(30, 12);
      ctx.lineTo(49, 35);
      ctx.lineTo(30, 58);
      ctx.lineTo(11, 35);
      ctx.closePath();
    } else ctx.rect(10, 17, 40, 30);
    ctx.stroke();
    ctx.fillStyle = "#e4ece7";
    ctx.font = "bold 30px monospace";
    ctx.fillText(text, 66, 44);
    ctx.font = "23px monospace";
    ctx.fillText(coordinate, 12, 83);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        sizeAttenuation: false,
      }),
    );
    sprite.scale.set(0.18, 0.035, 1);
    sprite.renderOrder = 5;
    return sprite;
  }
  setLayers(layers) {
    this.layers = layers;
    this.terrain.visible = layers.ground !== false;
    this.buildingGroup.visible =
      layers.buildings !== false && layers.obstructions !== false;
    if (this.groups)
      for (const key of [
        "vegetation",
        "roads",
        "predictions",
        "traces",
        "uncertainty",
        "los",
        "affiliations",
      ])
        this.groups[key].visible =
          layers[key] !== false &&
          layers[
            key === "vegetation"
              ? "obstructions"
              : key === "roads"
                ? "ground"
                : "scenario"
          ] !== false;
    this.groups.vectors.visible = layers.scenario !== false;
    this.marker.visible = layers.affiliations !== false;
    if (this.latestSnapshot) this.updateSnapshot(this.latestSnapshot);
  }
  resetCamera() {
    this.needsRender = true;
    const w = this.grid.width,
      h = this.grid.height;
    this.controls.target.set(w * 0.5, 12, -h * 0.5);
    this.camera.position.set(w * 0.5 - 650, 1050, -h * 0.5 + 1000);
    this.controls.update();
  }
  zoom(factor) {
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(factor)
      .add(this.controls.target);
    this.controls.update();
  }
  focusVector(type, id) {
    const sensor = this.latestSnapshot?.sensors.find(
      (s) => s.type === type && (!id || s.id === id),
    );
    if (!sensor || !sensor.position.every(Number.isFinite)) return;
    const p = this.point(sensor.position);
    this.controls.target.copy(p);
    this.camera.position.copy(p).add(new THREE.Vector3(-10, 100, 15));
    this.controls.update();
  }
  render() {
    const changed = this.controls.update();
    if (!changed && !this.needsRender) return;
    this.needsRender = false;
    for (const model of this.groups.vectors.children)
      model.scale.setScalar(model.userData.magnify ?? 1);
    this.renderer.render(this.world, this.camera);
  }
  dispose() {
    this.disposed = true;
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.world.traverse((o) => {
      o.geometry?.dispose();
      if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.map?.dispose();
          m.dispose();
        }
    });
    this.renderer.dispose();
    this.host.replaceChildren();
  }
}
