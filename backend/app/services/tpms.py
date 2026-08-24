"""Port of src/lib/tpms.ts. Kept numerically identical so results match the
in-browser preview exactly once the front end is pointed at this endpoint."""
from __future__ import annotations

import time
from typing import Literal

import numpy as np

SurfaceType = Literal["gyroid", "schwarzp", "diamond", "iwp"]
RegionKey = Literal["solid", "hot", "cold"]

TAU = 2 * np.pi

GRAD_SCALE: dict[str, float] = {
    "gyroid": 1.5,
    "schwarzp": 1.35,
    "diamond": 1.6,
    "iwp": 3.0,
}

try:
    from skimage import measure as _sk_measure

    HAVE_SKIMAGE = True
except ImportError:
    _sk_measure = None
    HAVE_SKIMAGE = False


def tpms_field(surface: SurfaceType, x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    if surface == "schwarzp":
        return np.cos(x) + np.cos(y) + np.cos(z)
    if surface == "diamond":
        return (
            np.sin(x) * np.sin(y) * np.sin(z)
            + np.sin(x) * np.cos(y) * np.cos(z)
            + np.cos(x) * np.sin(y) * np.cos(z)
            + np.cos(x) * np.cos(y) * np.sin(z)
        )
    if surface == "iwp":
        return 2 * (np.cos(x) * np.cos(y) + np.cos(y) * np.cos(z) + np.cos(z) * np.cos(x)) - (
            np.cos(2 * x) + np.cos(2 * y) + np.cos(2 * z)
        )
    return np.sin(x) * np.cos(y) + np.sin(y) * np.cos(z) + np.sin(z) * np.cos(x)


def iso_offset(cell_x: float, cell_y: float, cell_z: float, thickness: float, surface: SurfaceType) -> float:
    a = (cell_x + cell_y + cell_z) / 3
    return (thickness * np.pi) / a * GRAD_SCALE[surface]


def build_scalar_field(
    surface: SurfaceType,
    cell: tuple[float, float, float],
    thickness: float,
    grading: float,
    grad_axis: Literal["x", "y", "z"],
    n: tuple[int, int, int],
    region: RegionKey,
    voxels_per_cell: int,
    open_faces: frozenset[str] = frozenset(),
) -> tuple[np.ndarray, float]:
    """Returns (field[nx,ny,nz], solid_fraction). Border is forced solid so the
    extracted surface is watertight, matching the front-end behaviour exactly —
    except on any face in `open_faces` (blockMeshDict face-key form, e.g. "X-"),
    which is left uncapped so the region's true channel cross-section is cut
    open by the background mesh boundary instead of being sealed shut by the
    STL. Needed for flow-through inlet/outlet faces: capping every face
    (the old unconditional behaviour) leaves snappyHexMesh with no real
    opening to bound with the background Xmin/Xmax/etc patch, so those patches
    get entirely absorbed into the region's own surface patch during
    castellation and inlet/outlet BCs — written against the Xmin/Xmax patch
    names — never attach to any real face (confirmed: velocity stayed
    numerically zero everywhere despite a nonzero inlet BC)."""
    cell_x, cell_y, cell_z = cell
    nx_cells, ny_cells, nz_cells = n
    nx = max(10, round(voxels_per_cell * nx_cells))
    ny = max(10, round(voxels_per_cell * ny_cells))
    nz = max(10, round(voxels_per_cell * nz_cells))

    u = np.linspace(0, 1, nx)
    v = np.linspace(0, 1, ny)
    w = np.linspace(0, 1, nz)
    x = TAU * nx_cells * u
    y = TAU * ny_cells * v
    z = TAU * nz_cells * w

    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    uu, vv, ww = np.meshgrid(u, v, w, indexing="ij")

    f = tpms_field(surface, xx, yy, zz)
    c_base = iso_offset(cell_x, cell_y, cell_z, thickness, surface)
    g = {"x": uu, "y": vv, "z": ww}[grad_axis]
    c = c_base * (1 + grading * (g - 0.5) * 2)

    if region == "solid":
        data = np.abs(f) - c
    elif region == "hot":
        data = c - f
    else:
        data = f + c

    # Force the outer voxel shell positive (= outside the extracted region) so the mesh
    # closes, except on faces the caller has marked open (see docstring).
    if "X-" not in open_faces:
        data[0, :, :] = 1.0
    if "X+" not in open_faces:
        data[-1, :, :] = 1.0
    if "Y-" not in open_faces:
        data[:, 0, :] = 1.0
    if "Y+" not in open_faces:
        data[:, -1, :] = 1.0
    if "Z-" not in open_faces:
        data[:, :, 0] = 1.0
    if "Z+" not in open_faces:
        data[:, :, -1] = 1.0

    solid_mask = np.abs(f) < c
    solid_mask[0, :, :] = solid_mask[-1, :, :] = False
    solid_mask[:, 0, :] = solid_mask[:, -1, :] = False
    solid_mask[:, :, 0] = solid_mask[:, :, -1] = False
    interior = max(1, (nx - 2) * (ny - 2) * (nz - 2))
    solid_fraction = float(solid_mask.sum()) / interior

    return data, solid_fraction


def build_lattice(
    surface: SurfaceType,
    cell: tuple[float, float, float],
    thickness: float,
    grading: float,
    grad_axis: Literal["x", "y", "z"],
    n: tuple[int, int, int],
    region: RegionKey,
    voxels_per_cell: int,
    open_faces: frozenset[str] = frozenset(),
) -> dict:
    """Marching-cubes surface extraction. Raises RuntimeError if scikit-image
    isn't installed — callers should catch this and fall back or 501."""
    if not HAVE_SKIMAGE:
        raise RuntimeError("the server-side geometry engine isn't installed – see the server's own README")

    t0 = time.perf_counter()
    field, solid_fraction = build_scalar_field(surface, cell, thickness, grading, grad_axis, n, region, voxels_per_cell, open_faces)

    verts, faces, _normals, _values = _sk_measure.marching_cubes(field, level=0.0)

    cell_x, cell_y, cell_z = cell
    nx_cells, ny_cells, nz_cells = n
    lx, ly, lz = cell_x * nx_cells, cell_y * ny_cells, cell_z * nz_cells
    dx, dy, dz = field.shape

    # Voxel index i corresponds to physical fraction i/(n-1) (see build_scalar_field's
    # own u = linspace(0, 1, n)), spanning the full [0, n-1] index range including the
    # forced-outside border shell at 0 and n-1 -- NOT [0, n-2]. Dividing by (dx - 2)
    # here previously mapped index dx-2 to the box's +edge exactly while the mirror
    # vertex near index 1 landed well short of the -edge, leaving Xmin/Ymin/Zmin with
    # no faces after snapping (confirmed via checkMesh's asymmetric bounding box).
    positions = np.empty_like(verts)
    positions[:, 0] = (verts[:, 0] / (dx - 1)) * lx - lx / 2
    positions[:, 1] = (verts[:, 1] / (dy - 1)) * ly - ly / 2
    positions[:, 2] = (verts[:, 2] / (dz - 1)) * lz - lz / 2

    tri = positions[faces]
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = 0.5 * np.linalg.norm(cross, axis=1).sum()

    return {
        "positions": positions.astype(np.float32).flatten().tolist(),
        "indices": faces.astype(np.int32).flatten().tolist(),
        "triangles": int(faces.shape[0]),
        "vertices": int(positions.shape[0]),
        "solidFraction": solid_fraction,
        "specificArea": float(area / (lx * ly * lz)) * 1000,
        "box": [lx, ly, lz],
        "ms": round((time.perf_counter() - t0) * 1000, 1),
    }
