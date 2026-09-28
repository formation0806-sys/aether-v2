"""Blender-backed executor for the local bridge.

The Blender module is INJECTED, never imported here. That is what lets this
module be imported and unit-tested under ordinary CPython, where `bpy` does not
exist, while the same class runs inside Blender's own interpreter.

Security posture (docs/BLENDER_TOOL_DESIGN.md section 6):

  - The object-type to operator mapping is a CLOSED ALLOWLIST of literal
    function references. There is no getattr, no name lookup, and no dynamic
    attribute access, so no user-supplied string can ever reach a Blender
    operator. Every entry is written out in full below.
  - Only seven primitives are supported and each is wired to exactly one
    operator call. No other Blender functionality is reachable: no materials,
    no camera, no lights, no rendering, no file handling, no scene deletion.
  - Nothing here interprets a string as program text.
  - The incoming object_type is re-validated against the protocol allowlist
    even though the protocol already validated it, because this module sits on
    the far side of a trust boundary.
  - Everything returned is normalised to a small, fixed structure. Blender
    internals, repr output, filesystem paths, and environment data are never
    returned.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

import protocol

#: Custom property recording which primitive this bridge created. Blender's own
#: ``object.type`` is "MESH" for every mesh primitive, which the Salpa client
#: contract does not accept, so the bridge records the requested type itself.
TYPE_PROPERTY = "salpa_object_type"


# --------------------------------------------------------------------------
# Closed allowlist: object_type -> the exact operator to call.
#
# Each builder returns the operator callable directly. Nothing is resolved by
# name, so there is no way for request data to select a different operator.
# --------------------------------------------------------------------------


def _builder_cube(bpy: Any) -> Any:
    return bpy.ops.mesh.primitive_cube_add


def _builder_uv_sphere(bpy: Any) -> Any:
    return bpy.ops.mesh.primitive_uv_sphere_add


def _builder_cylinder(bpy: Any) -> Any:
    return bpy.ops.mesh.primitive_cylinder_add


def _builder_cone(bpy: Any) -> Any:
    return bpy.ops.mesh.primitive_cone_add


def _builder_plane(bpy: Any) -> Any:
    return bpy.ops.mesh.primitive_plane_add


def _builder_torus(bpy: Any) -> Any:
    return bpy.ops.mesh.primitive_torus_add


def _builder_empty(bpy: Any) -> Any:
    return bpy.ops.object.empty_add


OBJECT_BUILDERS: Dict[str, Any] = {
    "cube": _builder_cube,
    "uv_sphere": _builder_uv_sphere,
    "cylinder": _builder_cylinder,
    "cone": _builder_cone,
    "plane": _builder_plane,
    "torus": _builder_torus,
    "empty": _builder_empty,
}


def _to_single_line(text: str) -> str:
    """Collapse whitespace and strip control characters from a Blender name."""
    cleaned = "".join(" " if ch < " " or ch == "\x7f" else ch for ch in text)

    return " ".join(cleaned.split())


def _safe_name(raw: Any) -> Optional[str]:
    """A bounded, single-line object name, or None when unusable."""
    if not isinstance(raw, str):
        return None

    cleaned = _to_single_line(raw)

    if cleaned == "":
        return None
    if len(cleaned) > protocol.MAX_NAME_LENGTH:
        return None

    return cleaned


def _safe_location(raw: Any) -> Optional[List[float]]:
    """Three finite floats, or None when unusable."""
    try:
        values = [float(component) for component in raw]
    except (TypeError, ValueError):
        return None

    if len(values) != 3:
        return None

    for value in values:
        if value != value or value in (float("inf"), float("-inf")):
            return None
        if abs(value) > protocol.MAX_LOCATION_COMPONENT:
            return None

    return values


class BpyExecutor(protocol.BlenderExecutor):
    """Runs the two allowed operations against a real Blender scene.

    The ``bpy`` module is supplied by the caller. In production that caller is
    Blender itself (see run_blender_bridge.py); in unit tests it is a fake.
    """

    name = "bpy"

    def __init__(self, bpy_module: Any) -> None:
        self._bpy = bpy_module

    def _describe(self, obj: Any) -> Optional[Dict[str, Any]]:
        """Normalise one Blender object into the Salpa response shape.

        Returns None when the object cannot be described within the closed
        contract, so an unclassifiable object is omitted rather than guessed at.

        Attributes are read directly rather than resolved dynamically: a Blender
        object always has name, type, and location, and a fixed read keeps the
        trust boundary between request data and Blender explicit.
        """
        try:
            recorded = obj.get(TYPE_PROPERTY)
            blender_type = obj.type
            name = _safe_name(obj.name)
            location = _safe_location(list(obj.location))
        except Exception:
            return None

        object_type = recorded if recorded in protocol.ALLOWED_OBJECT_TYPES else None

        if object_type is None:
            # Fall back only when Blender's own type is already in the
            # allowlist. "MESH" is not, so unclassifiable meshes are omitted.
            if blender_type in protocol.ALLOWED_OBJECT_TYPES:
                object_type = blender_type

        if object_type is None or name is None or location is None:
            return None

        return {"name": name, "object_type": object_type, "location": location}

    # -- operations --------------------------------------------------------

    def create_object(
        self,
        object_type: str,
        name: str,
        location: Sequence[float],
        scale: Sequence[float],
    ) -> Dict[str, Any]:
        """Create one primitive and return its normalised description.

        Raises BlenderUnavailable for an unsupported type. Genuine Blender
        failures propagate and handle_request converts them into the closed
        error set, so nothing internal ever reaches a response.
        """
        if object_type not in OBJECT_BUILDERS:
            raise protocol.BlenderUnavailable()

        bpy = self._bpy

        before = set(bpy.data.objects.keys())
        OBJECT_BUILDERS[object_type](bpy)(location=tuple(location))

        created = sorted(set(bpy.data.objects.keys()) - before)

        if created:
            obj = bpy.data.objects[created[0]]
        else:
            obj = bpy.context.view_layer.objects.active

        if obj is None:
            raise protocol.BlenderUnavailable()

        # Applied explicitly rather than through operator keywords, because the
        # seven operators do not share one keyword signature.
        obj.name = name
        obj.location = tuple(location)
        obj.scale = tuple(scale)
        obj[TYPE_PROPERTY] = object_type

        described = self._describe(obj)

        if described is None:
            raise protocol.BlenderUnavailable()

        return described

    def inspect_scene(self) -> List[Dict[str, Any]]:
        """Return a bounded, deterministically ordered scene summary.

        Only name, recorded primitive type, and location are returned. No
        Blender object, repr, or scene internals ever leave this method.
        """
        bpy = self._bpy

        described: List[Dict[str, Any]] = []

        for key in sorted(bpy.data.objects.keys()):
            if len(described) >= protocol.MAX_SCENE_OBJECTS:
                break

            try:
                summary = self._describe(bpy.data.objects[key])
            except Exception:
                summary = None

            if summary is not None:
                described.append(summary)

        return described
