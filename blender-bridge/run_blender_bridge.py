"""Launcher that runs the bridge INSIDE Blender.

Blender's Python API only exists inside a Blender process, so the bridge is
started the supported way: Blender executes this file and the HTTP server runs
in the same interpreter as the scene.

    blender --background --factory-startup --python run_blender_bridge.py

Security posture:

  - This file is the ONLY place in the bridge that imports the Blender module,
    and it is not reachable over HTTP. There is no route that launches a
    Blender process, and no route that runs this file on demand.
  - The bind address, the token rules, and the operation allowlist all still
    come from server.py and protocol.py. Nothing here loosens them.
  - The token is read from the environment and is never printed.

The scene is the factory startup scene, never a user file. --factory-startup
guarantees that, and the three factory default objects (Cube, Camera, Light)
are removed so the POC starts from an empty, clearly isolated scene. No .blend
file is ever written.
"""

import os
import sys

import bpy  # noqa: E402  (only valid inside a Blender process)

_BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
if _BRIDGE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_DIR)

import protocol  # noqa: E402
import server  # noqa: E402
from blender_executor import BpyExecutor  # noqa: E402

#: Objects present in the factory startup file. They are cleared so the POC
#: scene starts empty and the state is unambiguous.
_FACTORY_DEFAULTS = ("Cube", "Camera", "Light")


def prepare_scene() -> int:
    """Empty the factory startup scene. Returns the number of objects removed."""
    removed = 0

    for name in _FACTORY_DEFAULTS:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)
            removed += 1

    return removed


def main() -> None:
    try:
        config = server.read_config()
    except ValueError:
        print(
            "%s must be set to a non-empty value before starting the bridge."
            % server.TOKEN_VARIABLE,
            file=sys.stderr,
        )
        raise SystemExit(2)

    removed = prepare_scene()
    print(
        "blender-bridge: blender %s ready, %d factory default object(s) cleared"
        % (bpy.app.version_string, removed)
    )

    httpd = server.make_server(config, BpyExecutor(bpy), logger=print)

    print("blender-bridge: listening on http://%s:%d%s" % (server.BIND_HOST, config.port, server.TOOL_ROUTE))
    print("blender-bridge: create_object and inspect_scene are backed by a real Blender scene")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


main()
