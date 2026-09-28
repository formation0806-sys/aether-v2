"""Hermetic tests for bridge request validation and response construction.

Standard library unittest only. No network, no Blender, no filesystem writes,
no environment dependency.
"""

import os
import sys
import unittest

_BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BRIDGE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_DIR)

import protocol


class ValidRequestTests(unittest.TestCase):
    """1-2: valid payloads are accepted."""

    def test_valid_minimal_create_object(self):
        request = protocol.validate_request(
            {"operation": "create_object", "object_type": "cube"}
        )

        self.assertIsInstance(request, protocol.CreateObjectRequest)
        self.assertEqual(request.operation, "create_object")
        self.assertEqual(request.object_type, "cube")
        self.assertEqual(request.name, "SalpaObject")
        self.assertEqual(request.location, (0.0, 0.0, 0.0))
        self.assertEqual(request.scale, (1.0, 1.0, 1.0))

    def test_valid_full_create_object(self):
        request = protocol.validate_request(
            {
                "operation": "create_object",
                "object_type": "uv_sphere",
                "name": "SalpaCube",
                "location": [1, -2, 3],
                "scale": [2, 2, 2],
            }
        )

        self.assertEqual(request.object_type, "uv_sphere")
        self.assertEqual(request.name, "SalpaCube")
        self.assertEqual(request.location, (1.0, -2.0, 3.0))
        self.assertEqual(request.scale, (2.0, 2.0, 2.0))

    def test_every_allowed_object_type_is_accepted(self):
        for object_type in protocol.ALLOWED_OBJECT_TYPES:
            with self.subTest(object_type=object_type):
                request = protocol.validate_request(
                    {"operation": "create_object", "object_type": object_type}
                )
                self.assertEqual(request.object_type, object_type)

    def test_object_types_match_the_salpa_tool_contract(self):
        # Mirrors BLENDER_OBJECT_TYPES in lib/agent/tools/blender.ts.
        self.assertEqual(
            list(protocol.ALLOWED_OBJECT_TYPES),
            ["cube", "uv_sphere", "cylinder", "cone", "plane", "torus", "empty"],
        )

    def test_valid_inspect_scene(self):
        request = protocol.validate_request({"operation": "inspect_scene"})

        self.assertIsInstance(request, protocol.InspectSceneRequest)
        self.assertEqual(request.operation, "inspect_scene")

    def test_command_alias_is_accepted_for_client_compatibility(self):
        request = protocol.validate_request(
            {"command": "create_object", "object_type": "cylinder"}
        )

        self.assertIsInstance(request, protocol.CreateObjectRequest)
        self.assertEqual(request.object_type, "cylinder")

    def test_name_whitespace_is_collapsed(self):
        request = protocol.validate_request(
            {"operation": "create_object", "object_type": "cube", "name": "  My\x00 Cube\n"}
        )

        self.assertEqual(request.name, "My Cube")


class RejectionTests(unittest.TestCase):
    """3-11: everything invalid is rejected with a closed error code."""

    def assert_code(self, payload, expected):
        with self.assertRaises(protocol.ProtocolError) as caught:
            protocol.validate_request(payload)
        self.assertEqual(caught.exception.code, expected)

    def test_missing_operation(self):
        self.assert_code({}, "invalid_arguments")
        self.assert_code({"object_type": "cube"}, "invalid_arguments")

    def test_unknown_operation(self):
        for operation in ["delete_object", "render", "save_file", "CREATE_OBJECT", "", 7, None]:
            with self.subTest(operation=operation):
                self.assert_code({"operation": operation}, "unsupported_operation")

    def test_both_discriminator_keys_rejected(self):
        self.assert_code(
            {"operation": "inspect_scene", "command": "inspect_scene"},
            "invalid_arguments",
        )

    def test_unsupported_object_type(self):
        for value in ["monkey", "Cube", "uv sphere", "mesh", 42, None, True, {}]:
            with self.subTest(value=value):
                self.assert_code(
                    {"operation": "create_object", "object_type": value}, "invalid_arguments"
                )

    def test_missing_object_type(self):
        self.assert_code({"operation": "create_object"}, "invalid_arguments")

    def test_invalid_vectors(self):
        for location in [
            [0, 0],
            [0, 0, 0, 0],
            "0,0,0",
            [0, 0, "1"],
            [0, 0, None],
            [0, 0, True],
            [0, 0, float("nan")],
            [0, 0, float("inf")],
            [protocol.MAX_LOCATION_COMPONENT + 1, 0, 0],
            {"x": 1},
        ]:
            with self.subTest(location=location):
                self.assert_code(
                    {"operation": "create_object", "object_type": "cube", "location": location},
                    "invalid_arguments",
                )

    def test_invalid_scale(self):
        for scale in [
            [0, 1, 1],
            [-1, 1, 1],
            [1, 1, 0],
            [1, 1, None],
            [1, 1, float("nan")],
            [1, 1],
            [protocol.MAX_SCALE_COMPONENT + 1, 1, 1],
        ]:
            with self.subTest(scale=scale):
                self.assert_code(
                    {"operation": "create_object", "object_type": "cube", "scale": scale},
                    "invalid_arguments",
                )

    def test_invalid_name(self):
        for name in ["", "   ", "x" * (protocol.MAX_NAME_LENGTH + 1), 42, None, True, ["a"]]:
            with self.subTest(name=name):
                self.assert_code(
                    {"operation": "create_object", "object_type": "cube", "name": name},
                    "invalid_arguments",
                )

    def test_unknown_fields_are_rejected(self):
        self.assert_code(
            {"operation": "create_object", "object_type": "cube", "material": "red"},
            "invalid_arguments",
        )
        self.assert_code(
            {"operation": "inspect_scene", "object_type": "cube"}, "invalid_arguments"
        )
        self.assert_code({"operation": "inspect_scene", "name": "Cube"}, "invalid_arguments")

    def test_null_values_are_rejected(self):
        for field in ["location", "scale", "name"]:
            with self.subTest(field=field):
                self.assert_code(
                    {"operation": "create_object", "object_type": "cube", field: None},
                    "invalid_arguments",
                )

    def test_arbitrary_code_shaped_keys_are_rejected(self):
        for key in ["script", "python", "code", "expression", "shell", "exec"]:
            with self.subTest(key=key):
                self.assert_code(
                    {
                        "operation": "create_object",
                        "object_type": "cube",
                        key: "import os; os.system('calc')",
                    },
                    "invalid_arguments",
                )

    def test_command_value_is_never_a_passthrough(self):
        for value in ["os.system('calc')", "python -c 1", "sh -c ls", "exec"]:
            with self.subTest(value=value):
                self.assert_code({"command": value}, "unsupported_operation")

    def test_nested_structures_are_rejected(self):
        self.assert_code(
            {"operation": "create_object", "object_type": "cube", "extra": {"a": {"b": 1}}},
            "invalid_arguments",
        )

    def test_non_object_payloads_are_malformed(self):
        for payload in [None, [], "create_object", 42, True]:
            with self.subTest(payload=payload):
                self.assert_code(payload, "malformed_request")


class DecodeTests(unittest.TestCase):
    """Strict body decoding, including the size limit."""

    def assert_code(self, raw, expected):
        with self.assertRaises(protocol.ProtocolError) as caught:
            protocol.decode_body(raw)
        self.assertEqual(caught.exception.code, expected)

    def test_valid_json_is_decoded(self):
        self.assertEqual(
            protocol.decode_body(b'{"operation":"inspect_scene"}'),
            {"operation": "inspect_scene"},
        )

    def test_invalid_json_is_malformed(self):
        # Note: b"[1,2,3]" is VALID JSON, so it decodes successfully and is
        # rejected later by validate_request as malformed_request instead.
        for raw in [b"", b"not json", b"{", b"\xff\xfe"]:
            with self.subTest(raw=raw):
                self.assert_code(raw, "malformed_request")

    def test_bare_nan_and_infinity_literals_are_rejected(self):
        for raw in [b'{"location":[NaN,0,0]}', b'{"location":[Infinity,0,0]}']:
            with self.subTest(raw=raw):
                self.assert_code(raw, "malformed_request")

    def test_oversized_body_is_rejected_before_parsing(self):
        oversized = b"{" + b"x" * (protocol.MAX_BODY_BYTES + 10)

        self.assert_code(oversized, "request_too_large")

    def test_body_at_the_limit_is_not_size_rejected(self):
        prefix = b'{"p":"'
        suffix = b'"}'
        padding = b"x" * (protocol.MAX_BODY_BYTES - len(prefix) - len(suffix))
        raw = prefix + padding + suffix

        self.assertEqual(len(raw), protocol.MAX_BODY_BYTES)
        self.assertIsInstance(protocol.decode_body(raw), dict)

    def test_valid_json_that_is_not_an_object_decodes_then_fails_validation(self):
        decoded = protocol.decode_body(b"[1,2,3]")

        self.assertIsInstance(decoded, list)
        with self.assertRaises(protocol.ProtocolError) as caught:
            protocol.validate_request(decoded)
        self.assertEqual(caught.exception.code, "malformed_request")


class ResponseContractTests(unittest.TestCase):
    """The response bodies stay compatible with the Salpa client contract."""

    def test_every_error_code_maps_to_a_status_and_a_client_code(self):
        for code in protocol.ERROR_CODES:
            with self.subTest(code=code):
                self.assertIn(code, protocol.ERROR_STATUS)
                self.assertIn(code, protocol.ERROR_CLIENT_CODE)
                self.assertIn(
                    protocol.ERROR_CLIENT_CODE[code],
                    ["rejected", "unavailable", "timeout", "internal_error"],
                )

    def test_failure_bodies_are_closed_and_content_free(self):
        for code in protocol.ERROR_CODES:
            with self.subTest(code=code):
                response = protocol.failure_response(code)

                self.assertFalse(response.body["ok"])
                self.assertEqual(response.body["error"], code)
                self.assertEqual(
                    response.body["message"], protocol.ERROR_MESSAGES[code]
                )
                self.assertEqual(
                    sorted(response.body.keys()),
                    ["code", "error", "message", "ok"],
                )

    def test_unknown_error_code_falls_back_to_internal_error(self):
        self.assertEqual(protocol.failure_response("nope").body["error"], "internal_error")

    def test_blender_unavailable_is_a_200_application_answer(self):
        response = protocol.failure_response("blender_unavailable")

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["code"], "unavailable")

    def test_success_shape_matches_the_salpa_client_expectation(self):
        response = protocol.created_object_response("Cube", "cube", [0, 0, 0])

        self.assertEqual(response.status, 200)
        self.assertEqual(
            response.body,
            {
                "ok": True,
                "code": "ok",
                "object": {"name": "Cube", "object_type": "cube", "location": [0.0, 0.0, 0.0]},
            },
        )

    def test_scene_success_shape_matches_the_client_expectation(self):
        response = protocol.scene_response(
            [{"name": "Cube", "object_type": "cube", "location": [0, 0, 0]}]
        )

        self.assertEqual(
            response.body,
            {
                "ok": True,
                "code": "ok",
                "objects": [{"name": "Cube", "object_type": "cube", "location": [0, 0, 0]}],
            },
        )


class HandlerTests(unittest.TestCase):
    """Step 3 does not execute anything: every valid request is unavailable."""

    def test_create_object_does_not_claim_success(self):
        request = protocol.validate_request(
            {"operation": "create_object", "object_type": "cube"}
        )
        response = protocol.handle_request(request, protocol.NotConnectedExecutor())

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["error"], "blender_unavailable")
        self.assertNotIn("object", response.body)
        self.assertNotIn("objects", response.body)
        self.assertFalse(response.body["ok"])

    def test_inspect_scene_does_not_claim_a_scene(self):
        request = protocol.validate_request({"operation": "inspect_scene"})
        response = protocol.handle_request(request, protocol.NotConnectedExecutor())

        self.assertEqual(response.body["error"], "blender_unavailable")
        self.assertNotIn("objects", response.body)

    def test_an_executor_failure_never_escapes(self):
        class ExplodingExecutor(protocol.BlenderExecutor):
            def create_object(self, *args):
                raise RuntimeError("C:\\Users\\dev\\secret.blend exploded")

            def inspect_scene(self):
                raise RuntimeError("C:\\Users\\dev\\secret.blend exploded")

        request = protocol.validate_request(
            {"operation": "create_object", "object_type": "cube"}
        )
        response = protocol.handle_request(request, ExplodingExecutor())

        self.assertEqual(response.body["error"], "internal_error")
        self.assertNotIn("secret.blend", str(response.body))
        self.assertNotIn("Traceback", str(response.body))


class SourceSecurityTests(unittest.TestCase):
    """25: no execution primitive may exist anywhere in the bridge source."""

    #: Modules that must not reach for the Blender API at all. They stay
    #: importable under plain CPython, which is what the unit suite relies on.
    SOURCES = ("protocol.py", "server.py", "blender_executor.py")

    #: The launcher legitimately imports the Blender module; it is scanned for
    #: every other forbidden primitive.
    LAUNCHER = "run_blender_bridge.py"

    def read_source(self, name):
        with open(os.path.join(_BRIDGE_DIR, name), "r", encoding="utf-8") as handle:
            return handle.read()

    def assert_no_primitive(self, pattern, label, sources=None):
        import re

        for name in sources if sources is not None else self.SOURCES:
            with self.subTest(source=name, primitive=label):
                self.assertIsNone(
                    re.search(pattern, self.read_source(name)),
                    "%s must not contain %s" % (name, label),
                )

    def test_no_dynamic_evaluation_primitive(self):
        self.assert_no_primitive(r"\beval\s*\(", "eval(")
        self.assert_no_primitive(r"\bexec\s*\(", "exec(")
        self.assert_no_primitive(r"\bcompile\s*\(", "compile(")
        self.assert_no_primitive(r"\b__import__\s*\(", "__import__(")
        self.assert_no_primitive(r"\bimportlib\b", "importlib")

    def test_no_child_process_primitive(self):
        self.assert_no_primitive(r"\bsubprocess\b", "subprocess")
        self.assert_no_primitive(r"\bos\s*\.\s*system\s*\(", "os.system(")
        self.assert_no_primitive(r"\bos\s*\.\s*popen\s*\(", "os.popen(")
        self.assert_no_primitive(r"\bpty\b", "pty")
        self.assert_no_primitive(r"shell\s*=\s*True", "shell=True")

    def test_no_blender_api_import_outside_the_launcher(self):
        import re

        for name in self.SOURCES:
            with self.subTest(source=name):
                self.assertIsNone(re.search(r"^\s*import\s+bpy\b", self.read_source(name), re.M))
                self.assertIsNone(re.search(r"^\s*from\s+bpy\b", self.read_source(name), re.M))

    def test_the_launcher_imports_blender_and_nothing_dangerous(self):
        import re

        source = self.read_source(self.LAUNCHER)

        # The one legitimate Blender import in the whole bridge.
        self.assertIsNotNone(re.search(r"^\s*import\s+bpy\b", source, re.M))
        # But still no execution, process, or filesystem primitive.
        for pattern, label in [
            (r"\beval\s*\(", "eval("),
            (r"\bexec\s*\(", "exec("),
            (r"\bsubprocess\b", "subprocess"),
            (r"\bos\s*\.\s*system\s*\(", "os.system("),
            (r"\bgetattr\s*\(", "getattr("),
            (r"(?<![\w.])open\s*\(", "open("),
            (r"^\s*import\s+socket\b", "import socket"),
        ]:
            with self.subTest(primitive=label):
                self.assertIsNone(re.search(pattern, source, re.M))

    def test_no_filesystem_primitive(self):
        self.assert_no_primitive(r"(?<![\w.])open\s*\(", "open(")
        self.assert_no_primitive(r"\bos\s*\.\s*(remove|unlink|rmdir|makedirs|mkdir)\b", "os fs call")
        self.assert_no_primitive(r"\bshutil\b", "shutil")
        self.assert_no_primitive(r"\bpathlib\b", "pathlib")

    def test_no_outbound_socket_primitive(self):
        # The server listens; it must never dial out.
        self.assert_no_primitive(r"^\s*import\s+socket\b", "import socket")
        self.assert_no_primitive(r"\brequests\b", "requests")
        self.assert_no_primitive(r"\burllib\b", "urllib")
        self.assert_no_primitive(r"\bhttp\.client\b", "http.client")

    def test_no_serialization_primitive(self):
        self.assert_no_primitive(r"\bpickle\b", "pickle")
        self.assert_no_primitive(r"\bmarshal\b", "marshal")
        self.assert_no_primitive(r"\byaml\b", "yaml")

    def test_loopback_only_is_a_constant(self):
        import re

        source = self.read_source("server.py")

        self.assertIn('BIND_HOST = "127.0.0.1"', source)
        # No environment-driven host and no wildcard anywhere.
        self.assertIsNone(re.search(r'BIND_HOST\s*=\s*os\.environ', source))
        self.assertIsNone(re.search(r'"0\.0\.0\.0"', source))
        self.assertIsNone(re.search(r'"::"', source))

    def test_http_surface_is_still_only_the_two_operations(self):
        import re

        source = self.read_source("protocol.py")

        for forbidden in ["/execute", "/run-python", "/script", "/eval", "/exec", "/python"]:
            with self.subTest(route=forbidden):
                self.assertIsNone(re.search(re.escape(forbidden), source))
