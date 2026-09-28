"""Request validation and response construction for the local Blender bridge.

This module is PURE. It performs no I/O of any kind: no sockets, no files, no
child processes, no dynamic module loading, and no access to the Blender API.
It turns an untrusted JSON payload into either a validated request object or a
deterministic error, and it builds the response bodies.

The flow is strictly:

    HTTP request -> validated operation -> controlled handler

There is no path from a request to interpreted source. A payload can only ever
select one of two hard-coded operations and supply a small set of bounded
primitive values. There is no field anywhere in this module that carries
program text, a file path, a URL, or a shell fragment.

The object-type list, the name length limit, and the vector bounds are kept
byte-for-byte consistent with the Salpa tool contract in
``lib/agent/tools/blender.ts`` (POC step 2). The response bodies produced here
are the closed contract that ``lib/agent/tools/blender-client.ts`` consumes.

Blender is NOT connected in this build. See ``BlenderExecutor`` below.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

# --------------------------------------------------------------------------
# Contract constants. These mirror lib/agent/tools/blender.ts.
# --------------------------------------------------------------------------

#: The only two operations this bridge will ever accept.
ALLOWED_OPERATIONS: Tuple[str, ...] = ("create_object", "inspect_scene")

#: The only object types this bridge will ever accept. Must match the Salpa
#: tool contract exactly. Each maps 1:1 to a Blender primitive operator.
ALLOWED_OBJECT_TYPES: Tuple[str, ...] = (
    "cube",
    "uv_sphere",
    "cylinder",
    "cone",
    "plane",
    "torus",
    "empty",
)

#: Accepted discriminator keys. "operation" is the documented HTTP field.
#: "command" is accepted as a CONSTRAINED ALIAS whose value must itself be one
#: of ALLOWED_OPERATIONS, because the Salpa client at
#: lib/agent/tools/blender-client.ts sends that key. It is never a passthrough:
#: any value outside the allowlist is rejected.
DISCRIMINATOR_KEYS: Tuple[str, ...] = ("operation", "command")

#: Keys that are always rejected, whatever their value, because they are the
#: shapes an attempt to smuggle program text or a host action would take.
FORBIDDEN_KEYS: Tuple[str, ...] = (
    "script",
    "python",
    "code",
    "expression",
    "shell",
    "exec",
    "file",
    "path",
    "module",
    "import",
)

#: Keys accepted by create_object, excluding the discriminator.
CREATE_OBJECT_KEYS: Tuple[str, ...] = ("object_type", "name", "location", "scale")

#: Keys accepted by inspect_scene, excluding the discriminator.
INSPECT_SCENE_KEYS: Tuple[str, ...] = ()

MAX_NAME_LENGTH = 64
MAX_LOCATION_COMPONENT = 10000.0
MAX_SCALE_COMPONENT = 1000.0
MIN_SCALE_COMPONENT = 0.0001

#: Maximum accepted request body, in bytes. Rejected before parsing.
MAX_BODY_BYTES = 64 * 1024

#: Maximum number of objects returned by inspect_scene. Matches
#: MAX_SCENE_OBJECTS in lib/agent/tools/blender-client.ts, so the scene summary
#: stays inside the same bound the client already enforces.
MAX_SCENE_OBJECTS = 20

#: The closed set of deterministic error codes this bridge can emit.
ERROR_CODES: Tuple[str, ...] = (
    "unauthorized",
    "malformed_request",
    "unsupported_operation",
    "invalid_arguments",
    "blender_unavailable",
    "method_not_allowed",
    "not_found",
    "request_too_large",
    "unsupported_media_type",
    "internal_error",
)

#: Fixed, content-free message per error code. No request data is ever
#: interpolated into these strings.
ERROR_MESSAGES: Dict[str, str] = {
    "unauthorized": "Authentication is required for this bridge.",
    "malformed_request": "The request body is not a valid JSON object.",
    "unsupported_operation": "The requested operation is not supported by this bridge.",
    "invalid_arguments": "The request arguments are not valid for this operation.",
    "blender_unavailable": "The bridge is running, but Blender execution is not connected in this build.",
    "method_not_allowed": "This endpoint only accepts POST.",
    "not_found": "No such endpoint.",
    "request_too_large": "The request body is larger than this bridge accepts.",
    "unsupported_media_type": "The request must use application/json.",
    "internal_error": "The bridge could not complete the request.",
}

#: HTTP status per error code. blender_unavailable is 200 on purpose: the bridge
#: itself is healthy, so this is an application-level answer, not a transport
#: failure, and the Salpa client can read the body.
ERROR_STATUS: Dict[str, int] = {
    "unauthorized": 401,
    "malformed_request": 400,
    "unsupported_operation": 400,
    "invalid_arguments": 400,
    "blender_unavailable": 200,
    "method_not_allowed": 405,
    "not_found": 404,
    "request_too_large": 413,
    "unsupported_media_type": 415,
    "internal_error": 500,
}

#: Maps each error code onto the closed failure enum that
#: lib/agent/tools/blender-client.ts understands. The client only reads "code",
#: so this is the field that keeps the two sides compatible.
ERROR_CLIENT_CODE: Dict[str, str] = {
    "unauthorized": "rejected",
    "malformed_request": "rejected",
    "unsupported_operation": "rejected",
    "invalid_arguments": "rejected",
    "blender_unavailable": "unavailable",
    "method_not_allowed": "rejected",
    "not_found": "rejected",
    "request_too_large": "rejected",
    "unsupported_media_type": "rejected",
    "internal_error": "internal_error",
}


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class ProtocolError(Exception):
    """A deterministic, content-free validation failure.

    Carries only an error code from ERROR_CODES. The message is the fixed
    constant from ERROR_MESSAGES, so no request data can leak into it.
    """

    def __init__(self, code: str) -> None:
        if code not in ERROR_MESSAGES:  # defensive: never trust a caller
            code = "internal_error"
        self.code = code
        super().__init__(ERROR_MESSAGES[code])


# --------------------------------------------------------------------------
# Validated request shapes
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class CreateObjectRequest:
    """A fully validated create_object request."""

    operation: str
    object_type: str
    name: str
    location: Tuple[float, float, float]
    scale: Tuple[float, float, float]


@dataclass(frozen=True)
class InspectSceneRequest:
    """A fully validated inspect_scene request."""

    operation: str


# --------------------------------------------------------------------------
# Primitive validators. All are total, never raise, and never coerce.
# --------------------------------------------------------------------------


def _is_number(value: Any) -> bool:
    """True for a real finite number. Booleans are explicitly NOT numbers."""
    if isinstance(value, bool):
        return False
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def _validate_vector(
    raw: Any,
    limit: float,
    minimum: Optional[float],
) -> Tuple[float, float, float]:
    """Validate a three-component numeric vector."""
    if not isinstance(raw, (list, tuple)):
        raise ProtocolError("invalid_arguments")
    if len(raw) != 3:
        raise ProtocolError("invalid_arguments")

    values: List[float] = []
    for component in raw:
        if not _is_number(component):
            raise ProtocolError("invalid_arguments")
        number = float(component)
        if abs(number) > limit:
            raise ProtocolError("invalid_arguments")
        if minimum is not None and number < minimum:
            raise ProtocolError("invalid_arguments")
        values.append(number)

    return (values[0], values[1], values[2])


def _validate_name(raw: Any) -> str:
    """Validate an object name: printable, single line, length capped.

    Rejects rather than truncates, so the caller is never silently given a
    different name than it asked for.
    """
    if not isinstance(raw, str):
        raise ProtocolError("invalid_arguments")

    cleaned = "".join(" " if ch < " " or ch == "\x7f" else ch for ch in raw)
    cleaned = " ".join(cleaned.split())

    if cleaned == "":
        raise ProtocolError("invalid_arguments")
    if len(cleaned) > MAX_NAME_LENGTH:
        raise ProtocolError("invalid_arguments")

    return cleaned


def _reject_forbidden(payload: Dict[str, Any]) -> None:
    """Reject any key that could carry program text or a host action."""
    for key in FORBIDDEN_KEYS:
        if key in payload:
            raise ProtocolError("invalid_arguments")


def _validate_create_object(payload: Dict[str, Any]) -> CreateObjectRequest:
    allowed = set(DISCRIMINATOR_KEYS) | set(CREATE_OBJECT_KEYS)
    for key in payload:
        if key not in allowed:
            raise ProtocolError("invalid_arguments")

    raw_type = payload.get("object_type")
    if not isinstance(raw_type, str):
        raise ProtocolError("invalid_arguments")
    if raw_type not in ALLOWED_OBJECT_TYPES:
        raise ProtocolError("invalid_arguments")

    name = "SalpaObject"
    if "name" in payload:
        name = _validate_name(payload["name"])

    location: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    if "location" in payload:
        location = _validate_vector(payload["location"], MAX_LOCATION_COMPONENT, None)

    scale: Tuple[float, float, float] = (1.0, 1.0, 1.0)
    if "scale" in payload:
        scale = _validate_vector(payload["scale"], MAX_SCALE_COMPONENT, MIN_SCALE_COMPONENT)

    return CreateObjectRequest(
        operation="create_object",
        object_type=raw_type,
        name=name,
        location=location,
        scale=scale,
    )


def _validate_inspect_scene(payload: Dict[str, Any]) -> InspectSceneRequest:
    allowed = set(DISCRIMINATOR_KEYS) | set(INSPECT_SCENE_KEYS)
    for key in payload:
        if key not in allowed:
            raise ProtocolError("invalid_arguments")

    return InspectSceneRequest(operation="inspect_scene")


def validate_request(payload: Any) -> Any:
    """Validate an untrusted decoded payload into a request object.

    Raises ProtocolError with a code from ERROR_CODES for every rejection. The
    only two accepted outcomes are CreateObjectRequest and InspectSceneRequest.
    """
    if not isinstance(payload, dict):
        raise ProtocolError("malformed_request")

    _reject_forbidden(payload)

    present = [key for key in DISCRIMINATOR_KEYS if key in payload]
    if len(present) == 0:
        raise ProtocolError("invalid_arguments")
    if len(present) > 1:
        raise ProtocolError("invalid_arguments")

    operation = payload[present[0]]
    if not isinstance(operation, str):
        raise ProtocolError("unsupported_operation")
    if operation not in ALLOWED_OPERATIONS:
        raise ProtocolError("unsupported_operation")

    if operation == "create_object":
        return _validate_create_object(payload)
    return _validate_inspect_scene(payload)


# --------------------------------------------------------------------------
# JSON decoding
# --------------------------------------------------------------------------


def _reject_json_constant(name: str) -> Any:
    """Reject the bare NaN / Infinity / -Infinity literals Python would accept.

    Without this, json.loads would happily produce non-finite floats. They are
    rejected downstream by _is_number too, but failing at decode time is
    clearer and strictly bounded.
    """
    raise ProtocolError("malformed_request")


def decode_body(raw: bytes) -> Any:
    """Decode a request body into a Python value, strictly.

    Raises ProtocolError("request_too_large") before decoding when the body is
    over the limit, and ProtocolError("malformed_request") for anything that is
    not valid JSON.
    """
    if len(raw) > MAX_BODY_BYTES:
        raise ProtocolError("request_too_large")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise ProtocolError("malformed_request")

    try:
        return json.loads(text, parse_constant=_reject_json_constant)
    except ProtocolError:
        raise
    except (ValueError, RecursionError):
        raise ProtocolError("malformed_request")


# --------------------------------------------------------------------------
# Response construction
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class BridgeResponse:
    """An HTTP status plus the JSON body to send."""

    status: int
    body: Dict[str, Any]


def failure_response(code: str) -> BridgeResponse:
    """Build a deterministic failure body for a code from ERROR_CODES.

    The body carries both vocabularies on purpose:
      - "code"  is the closed enum the Salpa client understands, keeping the
                tool compatible with lib/agent/tools/blender-client.ts.
      - "error" is this bridge's own richer diagnostic code.
    No request data, exception text, or host detail is ever included.
    """
    if code not in ERROR_MESSAGES:
        code = "internal_error"

    return BridgeResponse(
        status=ERROR_STATUS[code],
        body={
            "ok": False,
            "code": ERROR_CLIENT_CODE[code],
            "error": code,
            "message": ERROR_MESSAGES[code],
        },
    )


def created_object_response(
    name: str,
    object_type: str,
    location: Sequence[float],
) -> BridgeResponse:
    """Build the create_object success body the Salpa client expects.

    Reached from the HTTP path: the handler below returns this body for every
    create_object the injected executor carries out, so a real Blender scene
    reaches the Salpa client through this exact shape.
    """
    return BridgeResponse(
        status=200,
        body={
            "ok": True,
            "code": "ok",
            "object": {
                "name": name,
                "object_type": object_type,
                "location": [float(value) for value in location],
            },
        },
    )


def scene_response(objects: Sequence[Dict[str, Any]]) -> BridgeResponse:
    """Build the inspect_scene success body the Salpa client expects.

    Reached from the HTTP path: the handler below returns this body for every
    inspect_scene the injected executor answers.
    """
    return BridgeResponse(status=200, body={"ok": True, "code": "ok", "objects": list(objects)})


# --------------------------------------------------------------------------
# Blender executor abstraction
# --------------------------------------------------------------------------


class BlenderUnavailable(Exception):
    """Raised when no Blender executor is connected."""


class BlenderExecutor:
    """The seam the Blender-backed executor fills.

    blender_executor.BpyExecutor is that implementation; run_blender_bridge.py
    constructs it with the real bpy module inside a Blender process. Any other
    executor, including the NotConnectedExecutor below, must not change the HTTP
    protocol: the handlers already own validation, status codes, and response
    shapes.
    """

    name = "abstract"

    def create_object(
        self,
        object_type: str,
        name: str,
        location: Tuple[float, float, float],
        scale: Tuple[float, float, float],
    ) -> Dict[str, Any]:
        raise BlenderUnavailable()

    def inspect_scene(self) -> List[Dict[str, Any]]:
        raise BlenderUnavailable()


class NotConnectedExecutor(BlenderExecutor):
    """The default executor for this build.

    It performs no Blender work at all. It never claims an object was created
    and never returns scene contents, so nothing here can be mistaken for real
    Blender state.
    """

    name = "not-connected"

    def create_object(
        self,
        object_type: str,
        name: str,
        location: Tuple[float, float, float],
        scale: Tuple[float, float, float],
    ) -> Dict[str, Any]:
        raise BlenderUnavailable()

    def inspect_scene(self) -> List[Dict[str, Any]]:
        raise BlenderUnavailable()


# --------------------------------------------------------------------------
# Handlers
# --------------------------------------------------------------------------


def handle_request(request: Any, executor: BlenderExecutor) -> BridgeResponse:
    """Run a validated request through a controlled handler.

    Only two handlers exist. Neither reaches anything beyond the injected
    executor, and neither can be parameterised by anything other than the
    already-validated primitives.

    An executor that is not connected raises BlenderUnavailable, so a bridge
    running without a Blender executor still answers every valid request with
    blender_unavailable and never claims that anything was created.
    """
    try:
        if isinstance(request, CreateObjectRequest):
            described = executor.create_object(
                request.object_type, request.name, request.location, request.scale
            )

            if not isinstance(described, dict):
                return failure_response("blender_unavailable")

            return created_object_response(
                described["name"], described["object_type"], described["location"]
            )

        objects = executor.inspect_scene()

        if not isinstance(objects, list):
            return failure_response("blender_unavailable")

        return scene_response(objects)
    except BlenderUnavailable:
        return failure_response("blender_unavailable")
    except Exception:
        # Deliberately opaque. A host traceback or a Blender error string must
        # never cross this boundary.
        return failure_response("internal_error")
