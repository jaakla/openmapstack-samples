import { BufferGeometry, Float32BufferAttribute } from "three";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

export function updateLineGeometry(line, points) {
  const segments = points.length - 1;
  if (line.geometry.getAttribute("instanceStart")?.count !== segments) {
    line.geometry.dispose();
    line.geometry = new LineGeometry().setPositions(points.flatMap((p) => p.toArray()));
    line.computeLineDistances();
  }
  const positions = line.geometry.getAttribute("instanceStart").data;
  const distances = line.geometry.getAttribute("instanceDistanceStart").data;
  let distance = 0;
  for (let i = 0; i < segments; i++) {
    positions.array.set([...points[i].toArray(), ...points[i + 1].toArray()], i * 6);
    distances.array[i * 2] = distance;
    distance += points[i].distanceTo(points[i + 1]);
    distances.array[i * 2 + 1] = distance;
  }
  positions.needsUpdate = distances.needsUpdate = true;
  line.geometry.computeBoundingBox();
  line.geometry.computeBoundingSphere();
}

export function updateMeshGeometry(mesh, positions) {
  let attribute = mesh.geometry.getAttribute("position");
  if (attribute?.array.length !== positions.length) {
    mesh.geometry.dispose();
    mesh.geometry = new BufferGeometry();
    attribute = new Float32BufferAttribute(positions, 3);
    mesh.geometry.setAttribute("position", attribute);
  } else {
    attribute.array.set(positions);
    attribute.needsUpdate = true;
  }
  mesh.geometry.computeBoundingSphere();
}
