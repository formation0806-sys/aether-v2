"""Integration tests against a REAL Blender installation.

These tests are SKIPPED when no Blender executable can be found, so the unit
suite still runs anywhere. Nothing here is faked: each test launches Blender in
background mode with the factory startup file, runs a small script inside it,
and reads real scene state back as JSON.

Blender is located from, in order:
  1. BLENDER_BRIDGE_BLENDER_EXE
  2. the official Windows install location
  3. PATH

No user file is ever loaded (--factory-startup) and no .blend is ever written.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

_BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BRIDGE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_DIR)

MARKER_START = "SALPA_RESULT_START"
MARKER_END = "SALPA_RESULT_END"


def find_blender():
    """Locate a Blender executable, or None."""
    explicit = os.environ.get("BLENDER_BRIDGE_BLENDER_EXE", "").strip()
    if explicit and os.path.isfile(explicit):
        return explicit

    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    foundation = os.path.join(program_files, "Blender Foundation")
    if os.path.isdir(foundation):
        for entry in sorted(os.listdir(foundation), reverse=True):
            candidate = os.path.join(foundation, entry, "blender.exe")
            if os.path.isfile(candidate):
                return candidate

    from shutil import which

    return which("blender")


BLENDER = find_blender()

requires_blender = unittest.skipIf(
    BLENDER is None, "no Blender executable found; integration tests skipped"
)


def run_in_blender(body, timeout=180):
    """Run a snippet inside Blender and return the JSON it prints.

    The snippet gets `bpy` and the bridge modules already imported.
    """
    script = (
        "import json, sys\n"
        "sys.path.insert(0, %r)\n"
        "import bpy\n"
        "import protocol\n"
        "from blender_executor import BpyExecutor\n"
        "ex = BpyExecutor(bpy)\n"
        "for _n in ('Cube', 'Camera', 'Light'):\n"
        "    if _n in bpy.data.objects:\n"
        "        bpy.data.objects.remove(bpy.data.objects[_n], do_unlink=True)\n"
        "def emit(value):\n"
        "    print(%r + json.dumps(value) + %r)\n"
        % (_BRIDGE_DIR, MARKER_START, MARKER_END)
    ) + body

    handle, path = tempfile.mkstemp(suffix=".py", prefix="salpa_poc_")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            file.write(script)

        completed = subprocess.run(
            [BLENDER, "--background", "--factory-startup", "--python", path],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    match = re.search(
        re.escape(MARKER_START) + r"(.*?)" + re.escape(MARKER_END),
        completed.stdout,
        re.S,
    )
    if match is None:
        raise AssertionError(
            "Blender did not emit a result marker. stdout=%r stderr=%r"
            % (completed.stdout[-2000:], completed.stderr[-2000:])
        )

    return json.loads(match.group(1))


@requires_blender
class RealBlenderTests(unittest.TestCase):
    """End-to-end proof against a real Blender scene."""

    def test_blender_reports_a_version(self):
        result = run_in_blender("emit({'version': bpy.app.version_string})")

        self.assertIn("version", result)
        self.assertRegex(result["version"], r"^\d+\.\d+")

    def test_cube_is_really_created_with_the_requested_state(self):
        result = run_in_blender(
            "d = ex.create_object('cube', 'SalpaCube', (1.0, 2.0, 3.0), (2.0, 3.0, 4.0))\n"
            "o = bpy.data.objects[d['name']]\n"
            "emit({'described': d, 'blender_type': o.type,\n"
            "      'location': [round(v, 5) for v in o.location],\n"
            "      'scale': [round(v, 5) for v in o.scale],\n"
            "      'verts': len(o.data.vertices),\n"
            "      'total': len(bpy.data.objects)})\n"
        )

        self.assertEqual(
            result["described"],
            {"name": "SalpaCube", "object_type": "cube", "location": [1.0, 2.0, 3.0]},
        )
        # A cube primitive is a MESH with 8 vertices, not an empty or a proxy.
        self.assertEqual(result["blender_type"], "MESH")
        self.assertEqual(result["verts"], 8)
        self.assertEqual(result["location"], [1.0, 2.0, 3.0])
        self.assertEqual(result["scale"], [2.0, 3.0, 4.0])
        self.assertEqual(result["total"], 1)

    def test_inspect_scene_reports_the_real_object(self):
        result = run_in_blender(
            "ex.create_object('cube', 'SalpaCube', (1.0, 2.0, 3.0), (1.0, 1.0, 1.0))\n"
            "emit({'objects': ex.inspect_scene()})\n"
        )

        self.assertEqual(
            result["objects"],
            [{"name": "SalpaCube", "object_type": "cube", "location": [1.0, 2.0, 3.0]}],
        )

    def test_a_second_primitive_appears_in_the_real_scene(self):
        result = run_in_blender(
            "ex.create_object('cube', 'SalpaCube', (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))\n"
            "ex.create_object('uv_sphere', 'SalpaSphere', (5.0, 0.0, 0.0), (1.0, 1.0, 1.0))\n"
            "emit({'objects': ex.inspect_scene(),\n"
            "      'sphere_verts': len(bpy.data.objects['SalpaSphere'].data.vertices),\n"
            "      'sphere_type': bpy.data.objects['SalpaSphere'].type})\n"
        )

        names = [entry["name"] for entry in result["objects"]]

        self.assertEqual(names, ["SalpaCube", "SalpaSphere"])
        self.assertEqual(result["sphere_type"], "MESH")
        self.assertGreater(result["sphere_verts"], 100)
        self.assertEqual(result["objects"][1]["object_type"], "uv_sphere")

    def test_every_allowed_primitive_is_really_created(self):
        result = run_in_blender(
            "out = {}\n"
            "for t in ['cube','uv_sphere','cylinder','cone','plane','torus','empty']:\n"
            "    d = ex.create_object(t, 'Salpa_' + t, (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))\n"
            "    o = bpy.data.objects[d['name']]\n"
            "    out[t] = {'type': o.type,\n"
            "              'verts': len(o.data.vertices) if hasattr(o.data, 'vertices') else None}\n"
            "emit({'created': out, 'total': len(bpy.data.objects)})\n"
        )

        self.assertEqual(result["total"], 7)
        self.assertEqual(result["created"]["cube"]["verts"], 8)
        self.assertEqual(result["created"]["empty"]["type"], "EMPTY")
        self.assertIsNone(result["created"]["empty"]["verts"])
        for object_type in ["uv_sphere", "cylinder", "cone", "plane", "torus"]:
            with self.subTest(object_type=object_type):
                self.assertEqual(result["created"][object_type]["type"], "MESH")
                self.assertGreater(result["created"][object_type]["verts"], 1)

    def test_malformed_requests_never_reach_blender(self):
        result = run_in_blender(
            "out = []\n"
            "for payload in [{'operation':'create_object','object_type':'monkey'},\n"
            "                {'operation':'delete_everything'},\n"
            "                {'operation':'create_object','object_type':'cube','script':'import os'},\n"
            "                {'operation':'create_object','object_type':'cube','scale':None},\n"
            "                {'operation':'create_object','object_type':'cube','material':'red'}]:\n"
            "    try:\n"
            "        protocol.validate_request(payload)\n"
            "        out.append('ACCEPTED')\n"
            "    except protocol.ProtocolError as e:\n"
            "        out.append(e.code)\n"
            "emit({'codes': out, 'total': len(bpy.data.objects)})\n"
        )

        self.assertEqual(
            result["codes"],
            [
                "invalid_arguments",
                "unsupported_operation",
                "invalid_arguments",
                "invalid_arguments",
                "invalid_arguments",
            ],
        )
        self.assertEqual(result["total"], 0)

    def test_responses_carry_no_host_detail(self):
        result = run_in_blender(
            "d = ex.create_object('cube', 'SalpaCube', (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))\n"
            "r = protocol.handle_request(\n"
            "    protocol.validate_request({'operation':'create_object','object_type':'cube'}), ex)\n"
            "s = protocol.handle_request(\n"
            "    protocol.validate_request({'operation':'inspect_scene'}), ex)\n"
            "emit({'create': r.body, 'scene': s.body, 'describes': d})\n"
        )

        rendered = json.dumps(result)

        self.assertNotIn("Traceback", rendered)
        self.assertNotIn(_BRIDGE_DIR, rendered)
        self.assertNotIn("bpy", rendered)
        self.assertNotIn(".blend", rendered)
