/**
 * Instrument cluster drawn on a CanvasTexture: speedometer with needle, rev counter,
 * P R N D with the active gear highlighted, blinking indicator arrows and the
 * seatbelt / handbrake / lights tell-tales. Redrawn at ≤ 30 Hz and only when the
 * displayed values change.
 */
import * as THREE from 'three';
import type { VehicleState } from '@/core/types';
import { mpsToKmh } from '@/world/geo';

export interface DashboardInfo {
  /** Indicator lamp phase (true = lit) for the current time. */
  lampOn: boolean;
  /** Automatic gear 1..5 while in D (shown small under the D). */
  autoGear?: number;
}

const W = 1024;
const H = 384;

export class DashboardTexture {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private lastDraw = -1;
  private lastSig = '';
  private needleSpeed = 0;
  private needleRpm = 0;

  constructor() {
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = W;
      this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d');
    } else {
      this.canvas = null;
      this.ctx = null;
    }
    this.texture = new THREE.CanvasTexture((this.canvas ?? new ImageDataLike(W, H)) as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.draw(null, 0, { lampOn: false });
  }

  /** Aspect ratio of the cluster face (width / height). */
  get aspect(): number {
    return W / H;
  }

  draw(state: VehicleState | null, time: number, info: DashboardInfo, dt = 1 / 30): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (time - this.lastDraw < 1 / 30 && this.lastDraw >= 0) return;
    const kmh = state ? Math.abs(mpsToKmh(state.speed)) : 0;
    const rpm = state ? state.rpm : 0;
    // needles ease toward the value (mechanical damping)
    const k = Math.min(1, dt / 0.12);
    this.needleSpeed += (kmh - this.needleSpeed) * k;
    this.needleRpm += (rpm - this.needleRpm) * k;
    const sig = state
      ? `${this.needleSpeed.toFixed(1)}|${this.needleRpm.toFixed(0)}|${state.gear}|${state.indicator}|${info.lampOn}|${state.seatbelt}|${state.handbrake}|${state.lights}|${state.engineOn}|${state.wipers}|${info.autoGear ?? ''}`
      : 'off';
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.lastDraw = time;

    ctx.clearRect(0, 0, W, H);
    // panel
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#15181d');
    grad.addColorStop(1, '#090b0e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 40);
    ctx.fill();

    const on = !!state?.engineOn;
    const dim = on ? 1 : 0.35;
    this.dial(ctx, 230, 200, 150, 0, 180, 20, this.needleSpeed, 'km/h', dim, 0.0, [0, 180]);
    this.dial(ctx, 794, 200, 150, 0, 8, 1, this.needleRpm / 1000, 'rpm ×1000', dim, 6.2, [0, 8]);

    // centre: digital speed + gear
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = on ? '#e8f0f8' : '#5a6068';
    ctx.font = 'bold 86px "Rubik", "Heebo", system-ui, sans-serif';
    ctx.fillText(String(Math.round(this.needleSpeed)), 512, 150);
    ctx.font = '26px "Rubik", system-ui, sans-serif';
    ctx.fillStyle = on ? '#9aa7b4' : '#4a5058';
    ctx.fillText('km/h', 512, 205);

    const gears: ('P' | 'R' | 'N' | 'D')[] = ['P', 'R', 'N', 'D'];
    const gx = 512 - 90;
    gears.forEach((g, i) => {
      const active = state?.gear === g;
      ctx.font = `${active ? 'bold 46px' : '34px'} "Rubik", system-ui, sans-serif`;
      ctx.fillStyle = active ? (g === 'R' ? '#ff6b6b' : '#5ad66b') : on ? '#55606c' : '#3a4048';
      ctx.fillText(g, gx + i * 60, 268);
      if (active && g === 'D' && info.autoGear) {
        ctx.font = '22px "Rubik", system-ui, sans-serif';
        ctx.fillStyle = '#9fe3a8';
        ctx.fillText(String(info.autoGear), gx + i * 60 + 32, 258);
      }
    });

    // indicator arrows
    const lit = (side: 'left' | 'right') => !!state && (state.indicator === side || state.indicator === 'hazard') && info.lampOn;
    this.arrow(ctx, 430, 60, -1, lit('left'));
    this.arrow(ctx, 594, 60, 1, lit('right'));

    // tell-tales row
    const y = 330;
    this.belt(ctx, 400, y, !!state && !state.seatbelt && on);
    this.handbrake(ctx, 470, y, !!state && state.handbrake);
    this.lights(ctx, 554, y, state?.lights ?? 'off');
    this.engine(ctx, 630, y, !!state && !state.engineOn);
    this.wipers(ctx, 700, y, !!state && state.wipers);
    this.texture.needsUpdate = true;
  }

  private dial(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, min: number, max: number, step: number, value: number, label: string, dim: number, redFrom: number, range: [number, number]): void {
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const toAngle = (v: number) => a0 + ((v - min) / (max - min)) * (a1 - a0);
    ctx.save();
    ctx.globalAlpha = dim;
    // face
    ctx.beginPath();
    ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1014';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2b3139';
    ctx.stroke();
    // red zone
    if (redFrom > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - 4, toAngle(redFrom), toAngle(max));
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(239,68,68,0.8)';
      ctx.stroke();
    }
    // ticks
    for (let v = range[0]; v <= range[1] + 1e-6; v += step / 2) {
      const major = Math.abs((v / step) % 1) < 1e-6;
      const a = toAngle(v);
      const r0 = r - (major ? 22 : 12);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.lineWidth = major ? 4 : 2;
      ctx.strokeStyle = major ? '#d7dde4' : '#6b7682';
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#d7dde4';
        ctx.font = 'bold 22px "Rubik", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(v)), cx + Math.cos(a) * (r - 44), cy + Math.sin(a) * (r - 44));
      }
    }
    ctx.fillStyle = '#8b96a2';
    ctx.font = '18px "Rubik", system-ui, sans-serif';
    ctx.fillText(label, cx, cy + 62);
    // needle
    const a = toAngle(Math.max(min, Math.min(max, value)));
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 18, cy - Math.sin(a) * 18);
    ctx.lineTo(cx + Math.cos(a) * (r - 18), cy + Math.sin(a) * (r - 18));
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ff5a4e';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#20242a';
    ctx.fill();
    ctx.restore();
  }

  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1, lit: boolean): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(0, -22);
    ctx.lineTo(0, -10);
    ctx.lineTo(-26, -10);
    ctx.lineTo(-26, 10);
    ctx.lineTo(0, 10);
    ctx.lineTo(0, 22);
    ctx.closePath();
    ctx.fillStyle = lit ? '#34d058' : '#243028';
    ctx.fill();
    if (lit) {
      ctx.shadowColor = '#34d058';
      ctx.shadowBlur = 18;
      ctx.fill();
    }
    ctx.restore();
  }

  private belt(ctx: CanvasRenderingContext2D, x: number, y: number, warn: boolean): void {
    ctx.save();
    ctx.strokeStyle = warn ? '#ff4d4d' : '#2c3238';
    ctx.fillStyle = warn ? '#ff4d4d' : '#2c3238';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y - 14, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x - 11, y - 4, 22, 20, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 8);
    ctx.lineTo(x + 16, y + 14);
    ctx.stroke();
    ctx.restore();
  }

  private handbrake(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
    ctx.save();
    const c = on ? '#ff4d4d' : '#2c3238';
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 22, Math.PI * 0.7, Math.PI * 1.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 22, -Math.PI * 0.3, Math.PI * 0.3);
    ctx.stroke();
    ctx.font = 'bold 16px "Rubik", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', x, y + 1);
    ctx.restore();
  }

  private lights(ctx: CanvasRenderingContext2D, x: number, y: number, lights: VehicleState['lights']): void {
    ctx.save();
    const c = lights === 'high' ? '#4da3ff' : lights === 'low' || lights === 'parking' ? '#5ad66b' : '#2c3238';
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x + 8, y, 9, 15, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x - 4, y + i * 9);
      ctx.lineTo(x - 22, y + i * 9 + (lights === 'high' ? 0 : 4));
      ctx.stroke();
    }
    ctx.restore();
  }

  private engine(ctx: CanvasRenderingContext2D, x: number, y: number, warn: boolean): void {
    ctx.save();
    ctx.fillStyle = warn ? '#f5a623' : '#2c3238';
    ctx.beginPath();
    ctx.roundRect(x - 16, y - 8, 30, 20, 4);
    ctx.fill();
    ctx.fillRect(x - 8, y - 14, 10, 6);
    ctx.fillRect(x + 14, y - 2, 6, 8);
    ctx.restore();
  }

  private wipers(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
    ctx.save();
    ctx.strokeStyle = on ? '#5ad66b' : '#2c3238';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y + 10, 22, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + 10);
    ctx.lineTo(x - 14, y - 8);
    ctx.stroke();
    ctx.restore();
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Placeholder image for environments without a DOM (node tests). */
class ImageDataLike {
  readonly data: Uint8ClampedArray;
  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(4);
  }
}
