"""Minimal ASCII STL writer — positions/indices straight from tpms.build_lattice.

ASCII, not binary: OpenFOAM's STL reader guesses the format by checking
whether the file starts with the literal bytes "solid" — which a binary
file's 80-byte header can accidentally spell if the region name is "solid",
crashing the parser. ASCII sidesteps the ambiguity outright.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np


def write_ascii_stl(path: Path, positions: np.ndarray, indices: np.ndarray, name: str = "region") -> None:
    """positions: (N,3) float, indices: (M,3) int — triangle soup, any winding."""
    tri = positions[indices]
    v0, v1, v2 = tri[:, 0], tri[:, 1], tri[:, 2]
    normals = np.cross(v1 - v0, v2 - v0)
    lengths = np.linalg.norm(normals, axis=1)
    lengths[lengths == 0] = 1.0
    normals = (normals.T / lengths).T

    lines = [f"solid {name}"]
    for i in range(tri.shape[0]):
        nx, ny, nz = normals[i]
        lines.append(f"facet normal {nx:.6e} {ny:.6e} {nz:.6e}")
        lines.append("outer loop")
        for v in (v0[i], v1[i], v2[i]):
            lines.append(f"vertex {v[0]:.6e} {v[1]:.6e} {v[2]:.6e}")
        lines.append("endloop")
        lines.append("endfacet")
    lines.append(f"endsolid {name}")

    path.write_text("\n".join(lines) + "\n")
