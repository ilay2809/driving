/**
 * Buildings: extruded footprints (holes supported) with flat roofs. Facades carry UVs
 * that tile the shared window texture one window per 3 m horizontally and one per floor
 * (floors = round(height / 3)); colour variation is a pastel vertex colour hashed from
 * the id, so all buildings share two materials (facade + roof).
 */
import { dist2, type Vec2 } from '@/world/geo';
import type { Building } from '@/world/schema';
import { signedArea } from '@/world/roadGeometry';
import type { MeshBuffer, Vec3 } from './MeshBuffer';
import { buildingColour, hashString } from './palette';

/** Window cell size in metres (horizontal) — matches the 4×4 cell texture (0.25 uv per cell). */
const WINDOW_SPACING = 3;
const CELL_UV = 0.25;

export function addBuilding(b: Building, facade: MeshBuffer, roof: MeshBuffer): void {
  if (b.footprint.length < 3 || b.height <= 0) return;
  const colours = buildingColour(b.id, b.kind);
  const floors = Math.max(1, Math.round(b.height / 3));
  const h = b.height;
  // shift the lit-window pattern per building so night facades do not all look alike
  const uOffset = (hashString(b.id) % 4) * CELL_UV;
  const rings: readonly (readonly Vec2[])[] = [b.footprint, ...b.holes.filter((r) => r.length >= 3)];
  rings.forEach((ring, r) => {
    const isHole = r > 0;
    const ccw = signedArea(ring) > 0;
    // outward normal of each wall: see signedArea; holes face inwards (into the courtyard)
    const sign = ccw !== isHole ? 1 : -1;
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const len = dist2(p, q);
      if (len < 1e-6) continue;
      const dx = (q[0] - p[0]) / len;
      const dz = (q[1] - p[1]) / len;
      const normal: Vec3 = [sign * dz, 0, -sign * dx];
      const u0 = uOffset + (u / WINDOW_SPACING) * CELL_UV;
      const u1 = uOffset + ((u + len) / WINDOW_SPACING) * CELL_UV;
      const v1 = floors * CELL_UV;
      facade.quad3([p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], h, q[1]], [p[0], h, p[1]], colours.facade, normal, [
        [u0, 0],
        [u1, 0],
        [u1, v1],
        [u0, v1],
      ]);
      u += len;
    }
  });
  roof.polygon(b.footprint, b.holes, h, colours.roof);
}
