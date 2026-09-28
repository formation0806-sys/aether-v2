"""Loopback HTTP server for the local Blender bridge.

This module owns ONLY transport concerns:

  - binding exclusively to the loopback interface
  - bearer-token authentication
  - content-type enforcement
  - request size enforcement
  - routing
  - delegating to the pure handlers in protocol.py

It contains no validation logic, no Blender code, and no response shaping; all
of that lives in protocol.py. There is no code path here that turns a request
into interpreted source: the request can only select one of two pre-defined
operations.

The only endpoint is POST /tool. Every other verb or path is refused.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional, Tuple

# The bridge directory is not a Python package (its name is hyphenated), so
# make sure sibling modules resolve however this file is loaded.
_BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
if _BRIDGE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_DIR)

import protocol  # noqa: E402  (path shim must run first)

#: The bridge binds to the loopback interface and nothing else. This is a
#: constant, not a setting: there is deliberately no environment override and
#: no wildcard option, so the bridge can never be exposed on a LAN or public
#: interface by configuration.
BIND_HOST = "127.0.0.1"

DEFAULT_PORT = 8765
TOKEN_VARIABLE = "BLENDER_BRIDGE_TOKEN"
PORT_VARIABLE = "BLENDER_BRIDGE_PORT"

#: The only route this bridge serves.
TOOL_ROUTE = "/tool"

CONTENT_TYPE = "application/json"
_AUTH_SCHEME = "Bearer"


class BridgeConfig:
    """Startup configuration. The token is required and is never logged."""

    def __init__(self, token: str, port: int = DEFAULT_PORT) -> None:
        if not isinstance(token, str) or token.strip() == "":
            raise ValueError("A non-empty bridge token is required.")
        self._token = token.strip()
        self.port = port

    def token_bytes(self) -> bytes:
        """The token as bytes, for constant-time comparison."""
        return self._token.encode("utf-8")


def read_config(env: Optional[dict] = None) -> BridgeConfig:
    """Build a BridgeConfig from the environment.

    Fails closed when the token is absent or blank. The port is read from the
    environment when it is a valid integer; the host is never read.
    """
    source = env if env is not None else os.environ

    token = source.get(TOKEN_VARIABLE, "")
    if not isinstance(token, str) or token.strip() == "":
        raise ValueError(
            TOKEN_VARIABLE + " must be set to a non-empty value before starting the bridge."
        )

    raw_port = source.get(PORT_VARIABLE, "")
    port = DEFAULT_PORT
    if isinstance(raw_port, str) and raw_port.strip().isdigit():
        candidate = int(raw_port.strip())
        if 1 <= candidate <= 65535:
            port = candidate

    return BridgeConfig(token, port)


def is_authorized(header_value: Optional[str], expected: bytes) -> bool:
    """Constant-time bearer-token check.

    Rejects a missing header, a wrong scheme, a missing value, a wrong value,
    and any header that is not exactly "Bearer <token>".
    """
    if not isinstance(header_value, str) or header_value == "":
        return False

    parts = header_value.split(" ", 1)
    if len(parts) != 2:
        return False

    scheme = parts[0]
    presented = parts[1]

    if scheme != _AUTH_SCHEME or presented == "":
        return False

    return hmac.compare_digest(presented.encode("utf-8"), expected)


def is_json_content_type(header_value: Optional[str]) -> bool:
    """True only for application/json, ignoring parameters such as charset."""
    if not isinstance(header_value, str):
        return False

    media_type = header_value.split(";", 1)[0].strip().lower()

    return media_type == CONTENT_TYPE


class BlenderBridgeHandler(BaseHTTPRequestHandler):
    """Serves POST /tool and refuses everything else."""

    server_version = "SalpaBlenderBridge/1"
    sys_version = ""  # do not advertise the host Python version

    #: Injected by make_server. Never read from the environment per request.
    config: BridgeConfig = None  # type: ignore[assignment]
    executor: protocol.BlenderExecutor = None  # type: ignore[assignment]
    logger: Any = None

    # -- logging -----------------------------------------------------------
    # Only the path, the verb, and the outcome are ever logged. Headers,
    # credentials, and bodies are never written anywhere.

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _log(self, outcome: str, error: str = "-") -> None:
        if self.logger is None:
            return
        try:
            self.logger("%s %s -> %s %s" % (self.command, self.path, outcome, error))
        except Exception:
            pass

    # -- responses ---------------------------------------------------------

    def _send(self, response: protocol.BridgeResponse, error_code: str) -> None:
        body = json.dumps(response.body).encode("utf-8")

        self.send_response(response.status)
        self.send_header("Content-Type", CONTENT_TYPE)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

        self._log(str(response.status), error_code)

    def _send_error_code(self, code: str) -> None:
        self._send(protocol.failure_response(code), code)

    def _drain_pending_body(self) -> None:
        """Discard an unread request body before answering.

        Without this, answering 404/401/405/415 while the body is still in
        flight closes the socket with unread data, which makes the operating
        system reset the connection and the client sees its write aborted
        (WinError 10053 on Windows). The drain is bounded by the same limit the
        bridge already enforces, so it cannot make the bridge read an unbounded
        amount.
        """
        try:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None or not str(raw_length).strip().isdigit():
                return

            remaining = min(int(raw_length), protocol.MAX_BODY_BYTES)
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 8192))
                if not chunk:
                    return
                remaining -= len(chunk)
        except Exception:
            # A half-sent or reset connection is not this bridge's problem.
            return

    # -- routing -----------------------------------------------------------

    def do_POST(self) -> None:  # noqa: N802
        # Authentication runs FIRST, before routing, so an unauthenticated caller
        # learns nothing about which routes exist.
        if not is_authorized(self.headers.get("Authorization"), self.config.token_bytes()):
            self._drain_pending_body()
            self._send_error_code("unauthorized")
            return

        if self.path.split("?", 1)[0] != TOOL_ROUTE:
            self._drain_pending_body()
            self._send_error_code("not_found")
            return

        if not is_json_content_type(self.headers.get("Content-Type")):
            self._drain_pending_body()
            self._send_error_code("unsupported_media_type")
            return

        raw_length = self.headers.get("Content-Length")
        if raw_length is None or not str(raw_length).strip().isdigit():
            self._send_error_code("malformed_request")
            return

        if int(raw_length) > protocol.MAX_BODY_BYTES:
            # Refused before any body is read or parsed.
            self._send_error_code("request_too_large")
            return

        try:
            raw = self.rfile.read(int(raw_length))
        except Exception:
            self._send_error_code("malformed_request")
            return

        try:
            payload = protocol.decode_body(raw)
        except protocol.ProtocolError as error:
            self._send_error_code(error.code)
            return

        try:
            request = protocol.validate_request(payload)
        except protocol.ProtocolError as error:
            self._send_error_code(error.code)
            return

        self._send(protocol.handle_request(request, self.executor), "blender_unavailable")

    def _refuse(self) -> None:
        self._drain_pending_body()
        self._send_error_code("method_not_allowed")

    # Every other verb is refused with the same deterministic response. There is
    # no GET route, so no operation can ever be triggered by a link, a prefetch,
    # or a browser navigation.
    do_GET = _refuse  # noqa: N815
    do_PUT = _refuse  # noqa: N815
    do_PATCH = _refuse  # noqa: N815
    do_DELETE = _refuse  # noqa: N815
    do_HEAD = _refuse  # noqa: N815
    do_OPTIONS = _refuse  # noqa: N815


def make_server(
    config: BridgeConfig,
    executor: Optional[protocol.BlenderExecutor] = None,
    logger: Any = None,
) -> ThreadingHTTPServer:
    """Create a server bound to the loopback interface only.

    The host argument is always BIND_HOST. It is not configurable, not read from
    the environment, and not reachable from a request.
    """
    handler = type(
        "ConfiguredBlenderBridgeHandler",
        (BlenderBridgeHandler,),
        {
            "config": config,
            "executor": executor or protocol.NotConnectedExecutor(),
            "logger": logger,
        },
    )

    server = ThreadingHTTPServer((BIND_HOST, config.port), handler)
    server.daemon_threads = True

    return server


def main() -> int:
    """Start the bridge on the loopback interface."""
    try:
        config = read_config()
    except ValueError:
        # Message is a fixed sentence. The token is never echoed.
        print(
            "%s must be set to a non-empty value before starting the bridge." % TOKEN_VARIABLE,
            file=sys.stderr,
        )
        return 2

    server = make_server(config, protocol.NotConnectedExecutor(), logger=print)

    print("blender-bridge listening on http://%s:%d%s" % (BIND_HOST, config.port, TOOL_ROUTE))
    print("blender is not connected in this build; every valid request returns blender_unavailable")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
