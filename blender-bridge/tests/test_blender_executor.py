"""Hermetic unit tests for the Blender-backed executor.

The Blender module is FAKED here, so these tests need no Blender installation,
no network, and no environment. They prove the executor's mapping, its
normalisation, and its refusal to guess.
"""

import os
import sys
import unittest

_BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BRIDGE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_DIR)

import blender_executor
import protocol
from blender_executor import BpyExecutor, OBJECT_BUILDERS, TYPE_PROPERTY


class FakeObject:
    """Stands in for a bpy.types.Object."""

    def __init__(self, name, blender_type, location=(0.0, 0.0, 0.0)):
        self.name = name
        self.type = blender_type
        self.location = location
        self.scale = (1.0, 1.0, 1.0)
        self._properties = {}

    def get(self, key, default=None):
        return self._properties.get(key, default)

    def __setitem__(self, key, value):
        self._properties[key] = value

    def __getitem__(self, key):
        return self._properties[key]


class FakeObjects:
    """Stands in for bpy.data.objects.

    Blender keys its datablocks by the object's CURRENT name, so renaming an
    object changes the key. This fake does the same, which is what makes the
    executor's post-creation rename behave the way it does in Blender.
    """

    def __init__(self):
        self._objects = []
        self._counter = {}

    def add(self, name, blender_type, location):
        base = name
        count = self._counter.get(base, 0) + 1
        self._counter[base] = count
        if count > 1:
            name = "%s.%03d" % (base, count)
        self._objects.append(FakeObject(name, blender_type, location))

    def keys(self):
        return [obj.name for obj in self._objects]

    def __getitem__(self, key):
        for obj in self._objects:
            if obj.name == key:
                return obj
        raise KeyError(key)

    def __setitem__(self, key, value):
        # Keeps the fake usable for tests that inject an extra object directly.
        value.name = key
        self._objects.append(value)

    def __contains__(self, key):
        return any(obj.name == key for obj in self._objects)

    def __len__(self):
        return len(self._objects)


class _ViewLayer:
    def __init__(self, objects):
        self.objects = self
        self._objects = objects

    @property
    def active(self):
        return None


class _MeshOps:
    def __init__(self, objects):
        self._objects = objects

    def primitive_cube_add(self, location=(0.0, 0.0, 0.0)):
        self._objects.add("Cube", "MESH", location)

    def primitive_uv_sphere_add(self, location=(0.0, 0.0, 0.0)):
        self._objects.add("Sphere", "MESH", location)

    def primitive_cylinder_add(self, location=(0.0, 0.0, 0.0)):
        self._objects.add("Cylinder", "MESH", location)

    def primitive_cone_add(self, location=(0.0, 0.0, 0.0)):
        self._objects.add("Cone", "MESH", location)

    def primitive_plane_add(self, location=(0.0, 0.0, 0.0)):
        self._objects.add("Plane", "MESH", location)

    def primitive_torus_add(self, location=(0.0, 0.0, 0.0)):
        self._objects.add("Torus", "MESH", location)


class _ObjectOps:
    def __init__(self, objects):
        self._objects = objects

    def empty_add(self, location=(0.0, 0.0, 0.0)):
        self._objects.add("Empty", "EMPTY", location)


class _Data:
    def __init__(self):
        self.objects = FakeObjects()


class _Ops:
    def __init__(self, objects):
        self.mesh = _MeshOps(objects)
        self.object = _ObjectOps(objects)


class _Context:
    def __init__(self, objects):
        self.view_layer = _ViewLayer(objects)


class FakeBpy:
    """Minimal stand-in for the Blender module."""

    def __init__(self):
        self.data = _Data()
        self.ops = _Ops(self.data.objects)
        self.context = _Context(self.data.objects)


def fake_bpy():
    return FakeBpy()


class AllowlistTests(unittest.TestCase):
    """The operator mapping is a closed allowlist, not a name lookup."""

    def test_mapping_covers_exactly_the_allowed_object_types(self):
        self.assertEqual(sorted(OBJECT_BUILDERS), sorted(protocol.ALLOWED_OBJECT_TYPES))
        self.assertEqual(len(OBJECT_BUILDERS), 7)

    def test_mapping_holds_plain_function_references(self):
        for key, builder in OBJECT_BUILDERS.items():
            with self.subTest(key=key):
                self.assertTrue(callable(builder))
                self.assertNotIsInstance(builder, str)

    def _source(self):
        import re

        with open(
            os.path.join(_BRIDGE_DIR, "blender_executor.py"), "r", encoding="utf-8"
        ) as handle:
            source = handle.read()

        return re, source

    def test_source_has_no_dynamic_operator_dispatch(self):
        re, source = self._source()

        # No getattr, no locals/globals lookup, no operator name built from data.
        for forbidden in [r"\bgetattr\s*\(", r"\bvars\s*\(", r"\bglobals\s*\("]:
            with self.subTest(forbidden=forbidden):
                self.assertIsNone(
                    re.search(forbidden, source),
                    "blender_executor.py must not contain %s" % forbidden,
                )

    def test_source_never_imports_the_blender_module(self):
        re, source = self._source()

        self.assertIsNone(re.search(r"^\s*import\s+bpy\b", source, re.M))
        self.assertIsNone(re.search(r"^\s*from\s+bpy\b", source, re.M))


class CreateObjectTests(unittest.TestCase):
    """create_object against a faked Blender."""

    def test_creates_and_describes_a_cube(self):
        bpy = fake_bpy()
        described = BpyExecutor(bpy).create_object(
            "cube", "SalpaCube", (1.0, 2.0, 3.0), (2.0, 2.0, 2.0)
        )

        self.assertEqual(
            described, {"name": "SalpaCube", "object_type": "cube", "location": [1.0, 2.0, 3.0]}
        )
        self.assertIn("SalpaCube", bpy.data.objects)

    def test_applies_name_location_and_scale_to_the_object(self):
        bpy = fake_bpy()
        BpyExecutor(bpy).create_object("cube", "SalpaCube", (1.0, 2.0, 3.0), (2.0, 3.0, 4.0))

        obj = bpy.data.objects["SalpaCube"]

        self.assertEqual(tuple(obj.location), (1.0, 2.0, 3.0))
        self.assertEqual(tuple(obj.scale), (2.0, 3.0, 4.0))
        self.assertEqual(obj[TYPE_PROPERTY], "cube")

    def test_every_allowed_type_is_creatable(self):
        for object_type in protocol.ALLOWED_OBJECT_TYPES:
            with self.subTest(object_type=object_type):
                bpy = fake_bpy()
                described = BpyExecutor(bpy).create_object(
                    object_type, "Obj_" + object_type, (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)
                )
                self.assertEqual(described["object_type"], object_type)

    def test_unsupported_type_is_refused_without_touching_blender(self):
        bpy = fake_bpy()

        with self.assertRaises(protocol.BlenderUnavailable):
            BpyExecutor(bpy).create_object("monkey", "X", (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))

        self.assertEqual(len(bpy.data.objects), 0)

    def test_reports_the_requested_type_even_though_blender_says_mesh(self):
        bpy = fake_bpy()
        described = BpyExecutor(bpy).create_object(
            "cube", "SalpaCube", (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)
        )

        self.assertEqual(bpy.data.objects["SalpaCube"].type, "MESH")
        self.assertEqual(described["object_type"], "cube")


class InspectSceneTests(unittest.TestCase):
    """inspect_scene against a faked Blender."""

    def test_empty_scene_is_an_empty_list(self):
        self.assertEqual(BpyExecutor(fake_bpy()).inspect_scene(), [])

    def test_returns_every_created_object_sorted_by_name(self):
        bpy = fake_bpy()
        executor = BpyExecutor(bpy)

        for object_type in ["torus", "cube", "empty"]:
            executor.create_object(object_type, "Z_" + object_type, (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))
            executor.create_object(object_type, "A_" + object_type, (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))

        names = [entry["name"] for entry in executor.inspect_scene()]

        self.assertEqual(names, sorted(names))
        self.assertEqual(len(names), 6)

    def test_omits_objects_it_cannot_classify(self):
        bpy = fake_bpy()
        executor = BpyExecutor(bpy)
        executor.create_object("cube", "SalpaCube", (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))

        # A camera-like object: Blender type not in the allowlist, no recorded type.
        bpy.data.objects["Camera"] = FakeObject("Camera", "CAMERA", (0.0, 0.0, 0.0))

        self.assertEqual([e["name"] for e in executor.inspect_scene()], ["SalpaCube"])

    def test_is_bounded(self):
        bpy = fake_bpy()
        executor = BpyExecutor(bpy)

        for index in range(protocol.MAX_SCENE_OBJECTS + 5):
            executor.create_object("cube", "Obj%03d" % index, (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))

        self.assertEqual(len(executor.inspect_scene()), protocol.MAX_SCENE_OBJECTS)

    def test_entries_contain_only_the_contract_fields(self):
        bpy = fake_bpy()
        executor = BpyExecutor(bpy)
        executor.create_object("cube", "SalpaCube", (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))

        for entry in executor.inspect_scene():
            self.assertEqual(sorted(entry.keys()), ["location", "name", "object_type"])
            self.assertIn(entry["object_type"], protocol.ALLOWED_OBJECT_TYPES)
            self.assertEqual(len(entry["location"]), 3)


class NormalisationTests(unittest.TestCase):
    """Outgoing values are bounded and sanitised."""

    def test_name_is_collapsed_to_one_line(self):
        bpy = fake_bpy()
        described = BpyExecutor(bpy).create_object(
            "cube", "My  Cube\n", (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)
        )

        self.assertEqual(described["name"], "My Cube")

    def test_over_long_name_is_omitted_rather_than_truncated(self):
        bpy = fake_bpy()
        executor = BpyExecutor(bpy)
        obj = FakeObject("x" * (protocol.MAX_NAME_LENGTH + 1), "MESH", (0.0, 0.0, 0.0))
        obj[TYPE_PROPERTY] = "cube"
        bpy.data.objects[obj.name] = obj

        self.assertEqual(executor.inspect_scene(), [])

    def test_safe_helpers_reject_unusable_values(self):
        self.assertIsNone(blender_executor._safe_name(None))
        self.assertIsNone(blender_executor._safe_name(""))
        self.assertIsNone(blender_executor._safe_name(42))
        self.assertIsNone(blender_executor._safe_location([1.0, 2.0]))
        self.assertIsNone(blender_executor._safe_location("nope"))
        self.assertIsNone(
            blender_executor._safe_location([1.0, 2.0, protocol.MAX_LOCATION_COMPONENT + 1])
        )
        self.assertIsNone(blender_executor._safe_location([1.0, float("nan"), 0.0]))


class HandlerIntegrationTests(unittest.TestCase):
    """handle_request returns real success bodies when Blender is present."""

    def test_success_bodies_are_produced_for_a_connected_executor(self):
        executor = BpyExecutor(fake_bpy())

        created = protocol.handle_request(
            protocol.validate_request(
                {"operation": "create_object", "object_type": "cube", "name": "SalpaCube"}
            ),
            executor,
        )
        self.assertEqual(created.status, 200)
        self.assertTrue(created.body["ok"])
        self.assertEqual(created.body["code"], "ok")
        self.assertEqual(created.body["object"]["name"], "SalpaCube")

        scene = protocol.handle_request(
            protocol.validate_request({"operation": "inspect_scene"}), executor
        )
        self.assertTrue(scene.body["ok"])
        self.assertEqual(len(scene.body["objects"]), 1)

    def test_not_connected_executor_still_reports_unavailable(self):
        request = protocol.validate_request({"operation": "inspect_scene"})
        response = protocol.handle_request(request, protocol.NotConnectedExecutor())

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["error"], "blender_unavailable")
        self.assertFalse(response.body["ok"])

    def test_success_body_matches_the_client_contract(self):
        response = protocol.created_object_response("Cube", "cube", [0, 0, 0])

        self.assertEqual(
            sorted(response.body["object"].keys()), ["location", "name", "object_type"]
        )
        self.assertIn(response.body["object"]["object_type"], protocol.ALLOWED_OBJECT_TYPES)
