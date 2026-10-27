/**
 * The handful of shared materials every tile uses (so a tile costs a fixed, small number of
 * draw calls). Textures that need a canvas (window pattern, plate atlas, pedestrian
 * figures) are created here as well; this file therefore needs a DOM.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';

export interface WorldMaterials {
  asphalt: THREE.MeshLambertMaterial;
  /** Kerbs, sidewalks, poles, housings and other vertex-coloured solids. */
  solid: THREE.MeshLambertMaterial;
  ground: THREE.MeshLambertMaterial;
  area: THREE.MeshLambertMaterial;
  marking: THREE.MeshLambertMaterial;
  facade: THREE.MeshLambertMaterial;
  roof: THREE.MeshLambertMaterial;
  /** Sign faces and street-name plates (atlas texture, alpha cut-out, vertex-coloured back). */
  plate: THREE.MeshLambertMaterial;
  lampHead: THREE.MeshLambertMaterial;
  tree: THREE.MeshLambertMaterial;
  prop: THREE.MeshLambertMaterial;
  /** Traffic-light lamps: unlit, coloured per instance. */
  signalLamp: THREE.MeshBasicMaterial;
  pedLampStanding: THREE.MeshBasicMaterial;
  pedLampWalking: THREE.MeshBasicMaterial;
  windowTexture: THREE.CanvasTexture;
  windowLitTexture: THREE.CanvasTexture;
}

export function createMaterials(plateAtlas: THREE.Texture): WorldMaterials {
  const windowTexture = makeWindowTexture(false);
  const windowLitTexture = makeWindowTexture(true);
  const m: WorldMaterials = {
    asphalt: new THREE.MeshLambertMaterial({ color: PALETTE.asphalt }),
    solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
    ground: new THREE.MeshLambertMaterial({ color: PALETTE.ground, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
    area: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
    marking: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, emissive: 0xffffff, emissiveIntensity: 0.08 }),
    facade: new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTexture, emissive: PALETTE.windowLit, emissiveMap: windowLitTexture, emissiveIntensity: 0 }),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true }),
    plate: new THREE.MeshLambertMaterial({ vertexColors: true, map: plateAtlas, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: plateAtlas, emissiveIntensity: 0.35 }),
    lampHead: new THREE.MeshLambertMaterial({ color: PALETTE.lampHead, emissive: PALETTE.lampHead, emissiveIntensity: 0 }),
    tree: new THREE.MeshLambertMaterial({ vertexColors: true }),
    prop: new THREE.MeshLambertMaterial({ vertexColors: true }),
    signalLamp: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    pedLampStanding: new THREE.MeshBasicMaterial({ color: 0xffffff, map: makeFigureTexture('standing'), alphaTest: 0.5 }),
    pedLampWalking: new THREE.MeshBasicMaterial({ color: 0xffffff, map: makeFigureTexture('walking'), alphaTest: 0.5 }),
    windowTexture,
    windowLitTexture,
  };
  return m;
}

export function disposeMaterials(m: WorldMaterials): void {
  for (const v of Object.values(m)) {
    if (v instanceof THREE.Material) {
      const mat = v as THREE.Material & { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null };
      mat.map?.dispose();
      mat.emissiveMap?.dispose();
      v.dispose();
    } else if (v instanceof THREE.Texture) v.dispose();
  }
}

/**
 * 4×4 grid of window cells. Facade UVs map one cell per 3 m × one floor, so the pattern
 * repeats every four windows. The lit variant is the emissive map used at night: a fixed
 * pseudo-random subset of windows glows (per-building UV offsets vary the pattern).
 */
function makeWindowTexture(lit: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = lit ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const cell = size / 4;
  // deterministic "random" lit pattern
  const litCells = new Set([0, 2, 5, 7, 9, 10, 12, 15]);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = i * cell;
      const y = j * cell;
      const wx = x + cell * 0.28;
      const wy = y + cell * 0.22;
      const ww = cell * 0.44;
      const wh = cell * 0.5;
      if (lit) {
        const k = j * 4 + i;
        if (!litCells.has(k)) continue;
        const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#d8c8a0');
        ctx.fillStyle = g;
        ctx.fillRect(wx, wy, ww, wh);
      } else {
        // frame + glass + a lighter sill so facades read as windows in daylight
        ctx.fillStyle = '#d9d9d9';
        ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        ctx.fillStyle = '#4a5466';
        ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = '#8fa0b8';
        ctx.fillRect(wx + 2, wy + 2, ww - 4, wh * 0.35);
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(wx - 5, wy + wh + 3, ww + 10, 4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** White pedestrian figure on a transparent background (coloured per instance). */
function makeFigureTexture(kind: 'standing' | 'walking'): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  // head
  ctx.beginPath();
  ctx.arc(32, 12, 7, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.beginPath();
  ctx.moveTo(32, 20);
  ctx.lineTo(32, 38);
  ctx.stroke();
  if (kind === 'standing') {
    ctx.beginPath();
    ctx.moveTo(32, 24);
    ctx.lineTo(22, 36);
    ctx.moveTo(32, 24);
    ctx.lineTo(42, 36);
    ctx.moveTo(32, 38);
    ctx.lineTo(27, 58);
    ctx.moveTo(32, 38);
    ctx.lineTo(37, 58);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(32, 24);
    ctx.lineTo(18, 30);
    ctx.moveTo(32, 24);
    ctx.lineTo(44, 34);
    ctx.moveTo(32, 38);
    ctx.lineTo(20, 54);
    ctx.moveTo(32, 38);
    ctx.lineTo(44, 52);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
