"""Analytic conversion fixtures only; never published as geographic geometry."""

import json, struct, tempfile, unittest
from pathlib import Path
import numpy as np
from building_mesh import clip_triangle, matrix, write_glb, UP


class BuildingMeshTests(unittest.TestCase):
    def test_closed_clip_preserves_original_triangle_plane_and_bounds(self):
        triangle = np.array([[-1, 0, 0], [2, 0, 3], [0, 2, 5.0]])
        clipped = clip_triangle(triangle, [0, 0, 1, 1])
        self.assertGreater(len(clipped), 0)
        for t in clipped:
            self.assertTrue(np.all(t[:, :2] >= 0))
            self.assertTrue(np.all(t[:, :2] <= 1))
            np.testing.assert_allclose(t[:, 2], t[:, 0] + 2 * t[:, 1] + 1)
        self.assertEqual(clip_triangle(triangle, [4, 4, 5, 5]), [])

    def test_vertical_wall_clips_in_3d_without_inventing_a_cap(self):
        clipped = clip_triangle(
            np.array([[0.5, -1, 0], [0.5, 2, 0], [0.5, 0, 6]]), [0, 0, 1, 1]
        )
        self.assertGreater(len(clipped), 0)
        for t in clipped:
            np.testing.assert_allclose(t[:, 0], 0.5)
            self.assertGreater(np.linalg.norm(np.cross(t[1] - t[0], t[2] - t[0])), 0)

    def test_node_trs_and_column_major_matrices_and_up_axis(self):
        m = matrix(
            dict(
                translation=[1, 2, 3],
                scale=[2, 3, 4],
                rotation=[0, 0, np.sin(np.pi / 4), np.cos(np.pi / 4)],
            )
        )
        np.testing.assert_allclose(m @ [1, 0, 0, 1], [1, 4, 3, 1], atol=1e-14)
        np.testing.assert_allclose(matrix(dict(matrix=m.ravel(order="F").tolist())), m)
        np.testing.assert_allclose(UP @ [1, 2, 3, 1], [1, -3, 2, 1])

    def test_quantized_glb_is_self_contained_and_removes_collapsed_and_duplicate_faces(
        self,
    ):
        base = np.array(
            [[385200, 6671300, 20], [385202, 6671300, 20], [385200, 6671302, 20.0]]
        )
        tiny = base[0] + np.array([[0, 0, 0], [0.001, 0, 0], [0, 0.001, 0]])
        with tempfile.TemporaryDirectory(dir=Path(".cache/tmp")) as directory:
            path = Path(directory) / "fixture.glb"
            count, collapsed = write_glb(
                path,
                {0: [np.array([base, base, tiny])]},
                [385200, 6671300, 386500, 6672500],
            )
            self.assertEqual((count, collapsed), (1, 1))
            b = path.read_bytes()
            self.assertEqual(struct.unpack_from("<4sII", b), (b"glTF", 2, len(b)))
            size = struct.unpack_from("<I", b, 12)[0]
            g = json.loads(b[20 : 20 + size])
            self.assertEqual(g["extensionsRequired"], ["KHR_mesh_quantization"])
            self.assertTrue(all("uri" not in v for v in g["buffers"]))
            primitive = g["meshes"][0]["primitives"][0]
            a = g["accessors"][primitive["attributes"]["POSITION"]]
            self.assertEqual(a["componentType"], 5123)
            self.assertEqual(a["count"], 3)
            self.assertEqual(g["nodes"][0]["scale"], [0.02, 0.02, 0.02])


if __name__ == "__main__":
    unittest.main()
