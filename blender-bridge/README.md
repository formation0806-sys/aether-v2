# Local Blender bridge (POC step 4)

A small local HTTP service that sits between the Salpa Blender client and a real
Blender scene.

```
Salpa Blender client
        ↓  POST /tool  (loopback only, bearer token)
Local bridge  (blender-bridge/server.py)
        ↓  validated operation
Controlled handler  (blender-bridge/protocol.py)
        ↓
BlenderExecutor  (blender-bridge/blender_executor.py)
        ↓
Real Blender scene  (bpy, running inside Blender)
```

## Status: Blender IS connected

`create_object` and `inspect_scene` act on a real Blender scene. Verified against
**Blender 5.2.1 LTS** with all seven primitives.

## Requirements

- Python 3.7 or newer — **standard library only**, nothing to install.
- Blender, installed from the official Blender Foundation source. Verified with
  Blender 5.2.1 LTS on Windows.

## Running

The token is required. The bridge refuses to start without it.

```powershell
$env:BLENDER_BRIDGE_TOKEN = "choose-a-long-random-value"
$env:BLENDER_BRIDGE_PORT  = "8765"     # optional

& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" `
  --background --factory-startup `
  --python "C:\path\to\aether-v2\blender-bridge\run_blender_bridge.py"
```

The bridge runs **inside** Blender, because Blender's Python API only exists in a
Blender process. `run_blender_bridge.py` is the only file that imports the
Blender module, and it is not reachable over HTTP.

Useful flags:

- `--factory-startup` loads the factory startup file, **never a user project**.
  Always use it.
- `--background` runs without a window, which is what the tests use.

The launcher clears the three factory default objects (Cube, Camera, Light) so
the POC scene starts empty and unambiguous. **No `.blend` file is ever written.**

The bind address is a hard-coded constant, `BIND_HOST = "127.0.0.1"`. It is
**not** configurable and there is no wildcard option, so the bridge can never be
exposed on a LAN or public interface by configuration.

## Calling it

```powershell
$body = '{"operation":"create_object","object_type":"cube","name":"SalpaCube"}'

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8765/tool" `
  -Headers @{ Authorization = "Bearer $env:BLENDER_BRIDGE_TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

The `operation` key may also be written as `command`, which is what the Salpa
client at `lib/agent/tools/blender-client.ts` sends. It is a constrained alias:
its value must still be one of the two allowed operations, so it is never a
command passthrough.

### Configuring `BLENDER_BRIDGE_URL`

`BLENDER_BRIDGE_URL` must point at the **complete tool endpoint**:

```
http://127.0.0.1:8765/tool
```

The client POSTs to `BLENDER_BRIDGE_URL` **verbatim**; it does not append a path.
The bridge serves only `POST /tool`, so the bare origin is **not** sufficient:

| `BLENDER_BRIDGE_URL` | Result |
| --- | --- |
| `http://127.0.0.1:8765/tool` | correct — the only route the bridge serves |
| `http://127.0.0.1:8765` | `404 not_found`, surfaced to the agent as `BLENDER_ERROR` |

The variable stays loopback-only: it must address this machine's bridge, never a
remote host. No public, tunneled, or LAN endpoint is supported.

## Contract

- Only `POST /tool`. Every other verb is `405`; every other path is `404`.
- Only two operations: `create_object` and `inspect_scene`.
- Only seven object types: `cube`, `uv_sphere`, `cylinder`, `cone`, `plane`,
  `torus`, `empty`. They match `BLENDER_OBJECT_TYPES` in the Salpa tool.
- Unknown fields, code-shaped keys (`script`, `python`, `code`, `expression`,
  `shell`, `exec`), and `null` values are rejected.
- Maximum request body: 64 KiB, refused before parsing.
- `application/json` only.

### How object types map to Blender

The mapping is a closed allowlist of literal function references in
`blender_executor.py`. There is no `getattr` and no name lookup, so no
user-supplied string can select a different operator.

| object_type | Blender operator |
| --- | --- |
| `cube` | `bpy.ops.mesh.primitive_cube_add` |
| `uv_sphere` | `bpy.ops.mesh.primitive_uv_sphere_add` |
| `cylinder` | `bpy.ops.mesh.primitive_cylinder_add` |
| `cone` | `bpy.ops.mesh.primitive_cone_add` |
| `plane` | `bpy.ops.mesh.primitive_plane_add` |
| `torus` | `bpy.ops.mesh.primitive_torus_add` |
| `empty` | `bpy.ops.object.empty_add` |

Name, location, and scale are applied to the created object directly, because
these seven operators do not share one keyword signature.

### A note on `object_type` in responses

Blender reports `object.type` as `MESH` for every mesh primitive, which the
Salpa client contract does not accept. The bridge therefore records the
*requested* primitive type on each object it creates and reports that, so the
client receives an allowlisted value. Objects the bridge did not create and
cannot classify (an imported mesh, a camera) are **omitted** from
`inspect_scene` rather than reported with a guessed type.

## Error codes

`unauthorized`, `malformed_request`, `unsupported_operation`,
`invalid_arguments`, `blender_unavailable`, `method_not_allowed`, `not_found`,
`request_too_large`, `unsupported_media_type`, `internal_error`.

Each body carries `code` (the closed enum the Salpa client understands) and
`error` (this bridge's own diagnostic code). Messages are fixed constants: no
request data, traceback, or filesystem path is ever returned.

## Tests

```powershell
py -3 -m unittest discover -s blender-bridge/tests -v
```

- `test_protocol.py`, `test_server.py`, `test_blender_executor.py` — **unit**,
  hermetic, no Blender required. The executor is tested against a fake `bpy`.
- `test_integration_blender.py` — **integration**, launches a real Blender in
  background mode and reads real scene state back. These **skip automatically**
  when no Blender executable is found, so the suite still passes anywhere.

Note: if `python` is not on your PATH on Windows, use the launcher: `py -3`.

## Related

- Design: `docs/BLENDER_TOOL_DESIGN.md`
- Salpa tool and client: `lib/agent/tools/blender.ts`,
  `lib/agent/tools/blender-client.ts`
