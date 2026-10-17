import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { height } from "./visibility.js";
import { loadBuildingLayer } from "./buildings.js";
import { formatMGRS } from "./coordinates.js";
import { fitCamera, OWN_PADDING, UAV_PADDING } from "./camera.js";

const ZONE_COLORS = [null, "#60a86a", "#f5c744", "#ef5456"];
const LOS_COLORS = ["#84949a", "#a8cc78", "#f1c45b", "#ff7074"];
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
    renderer.toneMappingExposure = 0.9;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    this.world = new THREE.Scene();
    this.world.fog = new THREE.Fog("#0d171b", 2500, 6500);
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.addEventListener("change", () => {
      this.needsRender = true;
    });
    this.controls.addEventListener("start", () => {
      this.autoFrame = false;
    });
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 3400;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.world.add(new THREE.HemisphereLight("#ffffff", "#45544b", 1.3));
    const sun = new THREE.DirectionalLight("#e7ede2", 1.6);
    sun.position.set(-500, 1200, 600);
    this.world.add(sun);
    this.resetCamera({ waitForSnapshot: true });
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
      if (this.autoFrame) this.fitCamera();
      for (const group of [
        this.groups.predictions,
        this.groups.traces,
        this.groups.los,
      ])
        for (const line of group.children) line.material?.resolution?.set(w, h);
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
  pathLine(points, options) {
    const geometry = new LineGeometry().setPositions(
      points.flatMap((p) => p.toArray()),
    );
    const material = new LineMaterial(options);
    material.resolution.set(this.host.clientWidth, this.host.clientHeight);
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    return line;
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
    const roadSegments = [];
    for (const road of roads) {
      const p = road.coordinates.map(([x, y]) =>
        this.point([x, y, this.elevation(x, y) + 0.5]),
      );
      for (let i = 1; i < p.length; i++)
        if (Number.isFinite(p[i - 1].y) && Number.isFinite(p[i].y))
          roadSegments.push(p[i - 1], p[i]);
    }
    this.groups.roads.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(roadSegments),
        new THREE.LineBasicMaterial({
          color: "#6e8094",
          transparent: true,
          opacity: 0.5,
        }),
      ),
    );
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
    const isNewSnapshot = result !== this.latestSnapshot;
    this.latestSnapshot = result;
    if (this.fitNextSnapshot && isNewSnapshot) {
      this.fitNextSnapshot = false;
      this.fitCamera();
    }
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
        const line = this.pathLine(points, {
          color,
          linewidth: group === "traces" ? 1.5 : 2.2,
          dashed: true,
          dashSize,
          gapSize,
          transparent: true,
          opacity,
        });
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
      const line = this.pathLine(
        [this.point(sensor.position), this.point([...result.target, tz + 2])],
        {
          color: LOS_COLORS[status.zone],
          linewidth: 3,
          dashed: false,
          dashSize: status.zone === 3 ? 100000 : 7,
          gapSize: status.zone === 3 ? 0 : 4,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        },
      );
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
        sprite.userData.anchor = this.point(sensor.position);
        const leader = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            sprite.userData.anchor,
            sprite.position,
          ]),
          new THREE.LineBasicMaterial({
            color: "#d0dfdc",
            transparent: true,
            opacity: 0.65,
            depthTest: false,
          }),
        );
        leader.renderOrder = 3;
        sprite.userData.leader = leader;
        this.groups.affiliations.add(leader);
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
    canvas.width = affiliation === "friendly" ? 192 : 512;
    canvas.height = affiliation === "friendly" ? 64 : 100;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0d171bf5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    ctx.font = "28px monospace";
    ctx.fillText(coordinate, 12, 83);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        sizeAttenuation: false,
      }),
    );
    sprite.scale.set(
      affiliation === "friendly" ? 0.12 : 0.26,
      affiliation === "friendly" ? 0.045 : 0.065,
      1,
    );
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
  resetCamera({ waitForSnapshot = false } = {}) {
    this.needsRender = true;
    this.autoFrame = true;
    this.fitNextSnapshot = waitForSnapshot || !this.latestSnapshot;
    // Drain residual orbit/pan damping before restoring the published direction.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.fitCamera();
  }
  fitCamera() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    const w = this.grid.width * this.grid.resolution,
      h = this.grid.height * this.grid.resolution;
    const snapshot = this.latestSnapshot;
    const target = snapshot?.target ?? this.data.scenario.target;
    const elevation = this.elevation(...target);
    const subjects = [
      { point: this.point([...target, elevation + 3]), padding: OWN_PADDING },
      ...(snapshot?.sensors ?? [])
        .filter((s) => s.position.every(Number.isFinite))
        .map((s) => ({ point: this.point(s.position), padding: UAV_PADDING })),
    ].filter((s) => s.point.toArray().every(Number.isFinite));
    this.controls.target.set(w * 0.5, 12, -h * 0.5);
    const distance = fitCamera(this.camera, this.controls.target,
      new THREE.Vector3(-650, 1038, 1000), subjects, width, height);
    this.controls.maxDistance = Math.max(3400, distance * 1.05);
    this.controls.update();
    this.needsRender = true;
  }
  zoom(factor) {
    this.autoFrame = false;
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
    this.autoFrame = false;
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
    this.arrangeLabels();
    this.renderer.render(this.world, this.camera);
  }
  arrangeLabels() {
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    const units =
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / height;
    this.marker.scale.set(80 * units, 27 * units, 1);
    const own = this.marker.position.clone().project(this.camera);
    const occupied =
      this.marker.visible && Math.abs(own.x) < 1 && Math.abs(own.y) < 1
        ? [
            {
              x: ((own.x + 1) * width) / 2 - 44,
              y: ((1 - own.y) * height) / 2 - 18,
              w: 88,
              h: 36,
            },
          ]
        : [];
    const labelWidth = width < 500 ? 180 : 210,
      labelHeight = labelWidth / 5.12;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    for (const sprite of this.groups.affiliations.children.filter(
      (o) => o.isSprite,
    )) {
      const anchor = sprite.userData.anchor;
      const projected = anchor.clone().project(this.camera);
      sprite.visible =
        projected.z > -1 &&
        projected.z < 1 &&
        Math.abs(projected.x) < 1.3 &&
        Math.abs(projected.y) < 1.3;
      const leader = sprite.userData.leader;
      leader.visible = sprite.visible;
      if (!sprite.visible) continue;
      const px = clamp(
        ((projected.x + 1) * width) / 2,
        labelWidth / 2 + 8,
        width - labelWidth / 2 - 8,
      );
      const py = ((1 - projected.y) * height) / 2 - 25;
      let selected;
      for (const offset of [0, -50, 50, -100, 100, -150, 150, -200, 200]) {
        const y = clamp(
          py + offset,
          135 + labelHeight / 2,
          height - 55 - labelHeight / 2,
        );
        const rect = {
          x: px - labelWidth / 2 - 3,
          y: y - labelHeight / 2 - 3,
          w: labelWidth + 6,
          h: labelHeight + 6,
        };
        if (!selected) selected = { y, rect };
        if (
          !occupied.some(
            (r) =>
              rect.x < r.x + r.w &&
              rect.x + rect.w > r.x &&
              rect.y < r.y + r.h &&
              rect.y + rect.h > r.y,
          )
        ) {
          selected = { y, rect };
          break;
        }
      }
      occupied.push(selected.rect);
      sprite.scale.set(labelWidth * units, labelHeight * units, 1);
      sprite.position
        .set((px / width) * 2 - 1, 1 - (selected.y / height) * 2, projected.z)
        .unproject(this.camera);
      const position = leader.geometry.getAttribute("position");
      position.setXYZ(0, anchor.x, anchor.y, anchor.z);
      position.setXYZ(
        1,
        sprite.position.x,
        sprite.position.y,
        sprite.position.z,
      );
      position.needsUpdate = true;
      leader.geometry.computeBoundingSphere();
    }
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
