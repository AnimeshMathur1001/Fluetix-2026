"""Real triangle-mesh watertightness check (open edges / non-manifold edges /
shell count / signed volume) — no external mesh library required. Same class
of check trimesh.is_watertight does, run directly on the marching-cubes output."""
from __future__ import annotations

import numpy as np


class _UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def check_watertight(positions: list[float], indices: list[int]) -> dict:
    verts = np.asarray(positions, dtype=np.float64).reshape(-1, 3)
    tris = np.asarray(indices, dtype=np.int64).reshape(-1, 3)

    edge_count: dict[tuple[int, int], list[int]] = {}
    for tri_idx, (a, b, c) in enumerate(tris.tolist()):
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            edge_count.setdefault(key, []).append(tri_idx)

    open_edges = sum(1 for owners in edge_count.values() if len(owners) == 1)
    non_manifold = sum(1 for owners in edge_count.values() if len(owners) > 2)

    uf = _UnionFind(tris.shape[0])
    for owners in edge_count.values():
        for i in range(1, len(owners)):
            uf.union(owners[0], owners[i])
    shells = len({uf.find(i) for i in range(tris.shape[0])}) if tris.shape[0] else 0

    # Divergence theorem: V = (1/6) * sum(v0 . (v1 x v2)) over triangles, exact for a closed mesh.
    v0, v1, v2 = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    volume = float(np.abs(np.sum(np.einsum("ij,ij->i", v0, np.cross(v1, v2)))) / 6.0)

    return {
        "ok": open_edges == 0 and non_manifold == 0,
        "openEdges": open_edges,
        "nonManifold": non_manifold,
        "shells": shells,
        "volume": volume,
    }
