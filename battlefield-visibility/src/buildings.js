import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Source-backed display layer contract: self-contained GLB, local metric frame
// [EPSG:3067 easting-originE, N2000 height, -(northing-originN)]. No DSM mutation.
export async function loadBuildingLayer(definition, base) {
  if (!definition?.path)
    throw new Error("Missing published building mesh definition");
  const { scene } = await new GLTFLoader().loadAsync(base + definition.path);
  let meshes = 0;
  scene.traverse((object) => {
    if (object.isMesh) {
      if (!object.geometry.getAttribute("normal"))
        object.geometry.computeVertexNormals();
      meshes++;
    }
  });
  if (!meshes) throw new Error("Published building layer contains no meshes");
  scene.userData.source = definition.source;
  return scene;
}
