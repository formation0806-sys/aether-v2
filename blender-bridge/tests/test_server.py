"""Hermetic tests for the loopback bridge HTTP surface.

Standard library unittest only. Every request goes to 127.0.0.1 on an ephemeral
port owned by the test. No Blender, no Salpa server, no external network, and
no environment dependency.
"""

import http.client
import json
import os
import sys
import threading
import unittest

_BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BRIDGE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_DIR)

import protocol
import server

TOKEN = "unit-test-bridge-token"


class BridgeServerTestCase(unittest.TestCase):
    """Starts one loopback server for the whole class."""

    @classmethod
    def setUpClass(cls):
        cls.log_lines = []
        cls.config = server.BridgeConfig(TOKEN, 0)
        cls.httpd = server.make_server(
            cls.config, protocol.NotConnectedExecutor(), logger=cls.log_lines.append
        )
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)

    # -- helpers -----------------------------------------------------------

    def send(self, method="POST", path="/tool", payload=None, token=TOKEN,
             content_type="application/json", raw_body=None, raw_auth=None):
        body = raw_body
        if body is None and payload is not None:
            body = json.dumps(payload)

        headers = {}
        if content_type is not None:
            headers["Content-Type"] = content_type
        if raw_auth is not None:
            headers["Authorization"] = raw_auth
        elif token is not None:
            headers["Authorization"] = (
                token if token.startswith("Bearer ") else "Bearer " + token
            )

        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            raw = response.read().decode("utf-8")
            return response.status, raw
        finally:
            connection.close()

    def send_json(self, *args, **kwargs):
        status, raw = self.send(*args, **kwargs)
        return status, json.loads(raw)

    def send_oversized(self):
        """Declare a Content-Length over the limit without sending the body."""
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.putrequest("POST", "/tool")
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Authorization", "Bearer " + TOKEN)
            connection.putheader("Content-Length", str(protocol.MAX_BODY_BYTES + 5000))
            connection.endheaders()
            response = connection.getresponse()
            return response.status, json.loads(response.read().decode("utf-8"))
        finally:
            connection.close()


class RoutingTests(BridgeServerTestCase):
    """12, 16, 17: the only route is POST /tool."""

    def test_post_tool_with_valid_auth_is_routed(self):
        status, body = self.send_json(payload={"operation": "inspect_scene"})

        self.assertEqual(status, 200)
        self.assertEqual(body["error"], "blender_unavailable")

    def test_unsupported_methods_are_refused(self):
        for method in ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]:
            with self.subTest(method=method):
                status, body = self.send_json(
                    method=method, payload={"operation": "inspect_scene"}
                )
                self.assertEqual(status, 405)
                self.assertEqual(body["error"], "method_not_allowed")

    def test_unknown_route_is_not_found(self):
        for path in ["/", "/tool/extra", "/admin", "/tools"]:
            with self.subTest(path=path):
                status, body = self.send_json(
                    path=path, payload={"operation": "inspect_scene"}
                )
                self.assertEqual(status, 404)
                self.assertEqual(body["error"], "not_found")

    def test_query_string_does_not_bypass_routing(self):
        status, body = self.send_json(path="/tool?x=1", payload={"operation": "inspect_scene"})

        self.assertEqual(status, 200)
        self.assertEqual(body["error"], "blender_unavailable")


class AuthenticationTests(BridgeServerTestCase):
    """13, 14, 15: authentication fails closed in every broken form."""

    def test_missing_authorization_header(self):
        status, body = self.send_json(token=None, payload={"operation": "inspect_scene"})

        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "unauthorized")

    def test_incorrect_token(self):
        status, body = self.send_json(
            token="wrong-token", payload={"operation": "inspect_scene"}
        )

        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "unauthorized")

    def test_malformed_authorization_values(self):
        for header in [
            TOKEN,
            "Bearer",
            "Bearer ",
            "Basic " + TOKEN,
            "bearer " + TOKEN,
            "Bearer  " + TOKEN,
            "Token " + TOKEN,
            "Bearer " + TOKEN + " extra",
        ]:
            with self.subTest(header=header):
                status, body = self.send_json(
                    raw_auth=header, payload={"operation": "inspect_scene"}
                )
                self.assertEqual(status, 401, header)
                self.assertEqual(body["error"], "unauthorized")

    def test_unauthorized_is_checked_before_routing_and_content_type(self):
        # No token, wrong path, and wrong content type: still a clean 401, so an
        # unauthenticated caller learns nothing about which routes exist.
        status, body = self.send_json(path="/nope", token=None, content_type="text/plain")

        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "unauthorized")


class RequestShapeTests(BridgeServerTestCase):
    """18, 19, 20, 21: content type, size, and the two valid operations."""

    def test_wrong_content_type_is_refused(self):
        for content_type in ["text/plain", "application/xml", "", "text/json"]:
            with self.subTest(content_type=content_type):
                status, body = self.send_json(
                    content_type=content_type, payload={"operation": "inspect_scene"}
                )
                self.assertEqual(status, 415)
                self.assertEqual(body["error"], "unsupported_media_type")

    def test_content_type_parameters_are_accepted(self):
        status, body = self.send_json(
            content_type="application/json; charset=utf-8",
            payload={"operation": "inspect_scene"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["error"], "blender_unavailable")

    def test_oversized_request_is_refused(self):
        status, body = self.send_oversized()

        self.assertEqual(status, 413)
        self.assertEqual(body["error"], "request_too_large")

    def test_malformed_json_is_refused(self):
        status, body = self.send_json(raw_body="{not json")

        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "malformed_request")

    def test_valid_create_object_request(self):
        status, body = self.send_json(
            payload={
                "operation": "create_object",
                "object_type": "cube",
                "name": "SalpaCube",
                "location": [0, 0, 0],
                "scale": [1, 1, 1],
            }
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["error"], "blender_unavailable")
        self.assertFalse(body["ok"])

    def test_valid_inspect_scene_request(self):
        status, body = self.send_json(payload={"operation": "inspect_scene"})

        self.assertEqual(status, 200)
        self.assertEqual(body["error"], "blender_unavailable")
        self.assertFalse(body["ok"])

    def test_invalid_arguments_are_refused_over_http(self):
        status, body = self.send_json(
            payload={"operation": "create_object", "object_type": "monkey"}
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_arguments")

    def test_unknown_operation_is_refused_over_http(self):
        status, body = self.send_json(payload={"operation": "delete_everything"})

        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "unsupported_operation")

    def test_code_shaped_payload_is_refused_over_http(self):
        status, body = self.send_json(
            payload={
                "operation": "create_object",
                "object_type": "cube",
                "script": "import os",
            }
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_arguments")

    def test_client_compatible_command_key_is_accepted(self):
        status, body = self.send_json(
            payload={"command": "create_object", "object_type": "cylinder"}
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["error"], "blender_unavailable")


class SecretContainmentTests(BridgeServerTestCase):
    """23, 24: the token never appears in a response, a body, or a log."""

    def test_token_never_appears_in_any_response(self):
        probes = [
            {"operation": "inspect_scene"},
            {"operation": "create_object", "object_type": "monkey"},
            {"operation": "delete_everything"},
        ]

        for payload in probes:
            with self.subTest(payload=payload):
                _, raw = self.send(payload=payload)
                self.assertNotIn(TOKEN, raw)

        for method in ["GET", "PUT", "DELETE"]:
            with self.subTest(method=method):
                _, raw = self.send(method=method, payload={"operation": "inspect_scene"})
                self.assertNotIn(TOKEN, raw)

        _, raw = self.send(path="/nope", payload={"operation": "inspect_scene"})
        self.assertNotIn(TOKEN, raw)

        _, raw = self.send(content_type="text/plain", payload={"operation": "inspect_scene"})
        self.assertNotIn(TOKEN, raw)

    def test_token_never_appears_in_error_bodies(self):
        status, body = self.send_json(token="wrong", payload={"operation": "inspect_scene"})

        self.assertEqual(status, 401)
        self.assertNotIn(TOKEN, json.dumps(body))
        self.assertNotIn("wrong", json.dumps(body))
        self.assertNotIn("Bearer", json.dumps(body))

    def test_token_never_appears_in_logs(self):
        self.log_lines.clear()

        self.send(payload={"operation": "inspect_scene"})
        self.send(token="wrong", payload={"operation": "inspect_scene"})
        self.send(method="GET")

        self.assertTrue(self.log_lines, "the bridge should log request outcomes")
        for line in self.log_lines:
            self.assertNotIn(TOKEN, line)
            self.assertNotIn("Bearer", line)
            self.assertNotIn("Authorization", line)

    def test_logs_contain_no_request_body(self):
        self.log_lines.clear()

        self.send(
            payload={"operation": "create_object", "object_type": "cube", "name": "SecretName"}
        )

        for line in self.log_lines:
            self.assertNotIn("SecretName", line)
            self.assertNotIn("cube", line)

    def test_responses_never_contain_host_detail(self):
        _, raw = self.send(payload={"operation": "create_object", "object_type": "cube"})

        for forbidden in ["Traceback", _BRIDGE_DIR, "File \"", ".py", "bpy"]:
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, raw)


class BridgeDoesNotClaimExecutionTests(BridgeServerTestCase):
    """22: Blender is not connected, and the bridge must not pretend it is."""

    def test_create_object_response_makes_no_creation_claim(self):
        status, raw = self.send(
            payload={
                "operation": "create_object",
                "object_type": "cube",
                "name": "SalpaCube",
                "location": [1, 2, 3],
            }
        )
        body = json.loads(raw)

        self.assertEqual(status, 200)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"], "blender_unavailable")
        self.assertNotIn("object", body)
        self.assertNotIn("objects", body)

        for forbidden in ["created", "Created", "success", "SalpaCube"]:
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, raw)

    def test_inspect_scene_response_returns_no_scene(self):
        status, raw = self.send(payload={"operation": "inspect_scene"})
        body = json.loads(raw)

        self.assertEqual(status, 200)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"], "blender_unavailable")
        self.assertNotIn("objects", body)
        self.assertNotIn("object", body)

    def test_response_is_usable_by_the_salpa_client_contract(self):
        _, raw = self.send(payload={"operation": "inspect_scene"})
        body = json.loads(raw)

        # blender-client.ts reads `ok` and `code`, and accepts only the closed
        # enum rejected | unavailable | timeout | internal_error.
        self.assertIn(
            body["code"], ["rejected", "unavailable", "timeout", "internal_error"]
        )
        self.assertEqual(body["code"], "unavailable")


class BindingTests(unittest.TestCase):
    """The bind address is loopback and is not configurable."""

    def test_bind_host_is_loopback(self):
        self.assertEqual(server.BIND_HOST, "127.0.0.1")

    def test_server_listens_on_loopback_only(self):
        httpd = server.make_server(server.BridgeConfig(TOKEN, 0), protocol.NotConnectedExecutor())

        try:
            self.assertEqual(httpd.server_address[0], "127.0.0.1")
        finally:
            httpd.server_close()

    def test_read_config_fails_closed_without_a_token(self):
        for env in [{}, {server.TOKEN_VARIABLE: ""}, {server.TOKEN_VARIABLE: "   "}]:
            with self.subTest(env=env):
                with self.assertRaises(ValueError):
                    server.read_config(env)

    def test_read_config_reads_the_port_but_never_a_host(self):
        config = server.read_config({server.TOKEN_VARIABLE: TOKEN, server.PORT_VARIABLE: "9123"})

        self.assertEqual(config.port, 9123)
        self.assertFalse(hasattr(config, "host"))
        self.assertEqual(server.BIND_HOST, "127.0.0.1")

    def test_read_config_ignores_an_invalid_port(self):
        for value in ["", "abc", "-1", "0", "70000"]:
            with self.subTest(value=value):
                config = server.read_config(
                    {server.TOKEN_VARIABLE: TOKEN, server.PORT_VARIABLE: value}
                )
                self.assertEqual(config.port, server.DEFAULT_PORT)
