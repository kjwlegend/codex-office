"""Validate the shipped office coworkers without Blender or account data."""
import json
import struct
import unittest
from pathlib import Path


class OfficeAssetTests(unittest.TestCase):
    def test_glb_is_self_contained_skinned_and_has_both_lods(self):
        root = Path(__file__).resolve().parents[1] / "dashboard/assets"
        for species in ("employee", "cow", "horse"):
            with self.subTest(species=species):
                self.validate_character(root, species)

    def validate_character(self, root, species):
        raw = (root / f"office-{species}.glb").read_bytes()
        magic, version, size = struct.unpack_from("<4sII", raw)
        self.assertEqual((magic, version, size), (b"glTF", 2, len(raw)))
        length, kind = struct.unpack_from("<I4s", raw, 12)
        self.assertEqual(kind, b"JSON")
        gltf = json.loads(raw[20:20 + length])
        self.assertTrue(all("uri" not in b for b in gltf["buffers"]))
        self.assertTrue(all("bufferView" in i for i in gltf["images"]))
        self.assertEqual(len(gltf["skins"][0]["joints"]), 9)
        self.assertEqual({gltf["nodes"][j]["name"] for j in gltf["skins"][0]["joints"]}, {
            "rig_root", "rig_spine", "rig_head", "rig_arm_L", "rig_arm_R",
            "rig_elbow_L", "rig_elbow_R", "rig_wrist_L", "rig_wrist_R",
        })
        names = {n.get("name") for n in gltf["nodes"]}
        parts = ("Skin", "Shirt", "Trousers", "Shoes", "Trim")
        if species == "employee":
            parts += ("Hair0", "Hair1", "Hair2")
        for part in parts:
            for lod in (0, 1):
                self.assertIn(f"SM_Employee_{part}_LOD{lod}", names)
        for mesh in gltf["meshes"]:
            for primitive in mesh["primitives"]:
                self.assertTrue({"POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"} <= primitive["attributes"].keys())
                self.assertEqual(primitive.get("mode", 4), 4, "Character geometry must be triangles")
        report = json.loads((root / f"office-{species}.validation.json").read_text())
        self.assertLessEqual(report["character_lod0_triangles"], 40000)
        self.assertLess(report["character_lod1_triangles"], report["character_lod0_triangles"] * .4)
        self.assertTrue(all(o["nonmanifold_edges"] == 0 and o["uv_layers"] for o in report["objects"]))
        # Confirm that the exported geometry agrees with the Blender report;
        # stale reports cannot hide an accidentally oversized or missing LOD.
        actual = {}
        for node in gltf["nodes"]:
            if "mesh" in node:
                mesh = gltf["meshes"][node["mesh"]]
                actual[node["name"]] = sum(gltf["accessors"][p["indices"]]["count"] // 3
                                           for p in mesh["primitives"])
        self.assertEqual(actual, {o["name"]: o["triangles"] for o in report["objects"]})
        for lod in (0, 1):
            visible = sum(count for name, count in actual.items() if name.endswith(f"LOD{lod}")
                          and "Hair1" not in name and "Hair2" not in name)
            self.assertEqual(visible, report[f"character_lod{lod}_triangles"])
