/**
 * SVG drawing primitives for the Israeli sign catalogue (used by build-signs.ts).
 *
 * Every sign is a 120×120 viewBox. Pictograms are authored in a local box centred on
 * the origin with extents ±50 and are placed/scaled by the frame helpers, so the same
 * pictogram works inside a triangle, a disc or a square.
 *
 * Shapes and proportions follow the official board (לוח התמרורים, הודעת התעבורה
 * (קביעת תמרורים) התשע"א-2010, נוסח משולב 2020): warning = red-bordered white triangle
 * with black pictogram; mandatory = blue disc with white pictogram; priority 302 = red
 * octagon with a white hand; prohibition = white disc, red ring, black pictogram; "end of"
 * signs carry a black diagonal from bottom-left to top-right; information = blue square
 * with white symbols; traffic lights as lamp diagrams; road markings as top-view diagrams.
 */

export const C = {
  red: '#d7141a',
  blue: '#1757c2',
  yellow: '#f6d20f',
  green: '#1f9d44',
  black: '#111111',
  white: '#ffffff',
  grey: '#9a9a9a',
  lightGrey: '#d9d9d9',
  asphalt: '#6f7275',
  sidewalk: '#cbc8bf',
  orange: '#ff7f11',
  housing: '#1c1c1c',
  lampOff: '#303030',
  lampRed: '#ec1c24',
  lampAmber: '#ffcb05',
  lampGreen: '#2bb24c',
} as const;

export const FONT = 'Rubik, Arial, Helvetica, sans-serif';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Wrap inner markup in a 120×120 SVG document. */
export function svgDoc(title: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${esc(title)}">\n<title>${esc(title)}</title>\n${inner}\n</svg>\n`;
}

/** Place a pictogram (authored around the origin) at (x, y) with scale s. */
export function place(inner: string, x: number, y: number, s: number, extra = ''): string {
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s)})"${extra}>${inner}</g>`;
}

const r = (n: number): number => Math.round(n * 100) / 100;

function polygonPoints(cx: number, cy: number, radius: number, n: number, startDeg: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${r(cx + radius * Math.cos(a))},${r(cy + radius * Math.sin(a))}`);
  }
  return pts.join(' ');
}

// ───────────────────────────── frames ─────────────────────────────

/** Warning triangle (101–153, 901). The pictogram is centred low, where the triangle is widest. */
export function warning(pict: string): string {
  return `<path d="M60 9 L113 101 L7 101 Z" fill="${C.white}" stroke="${C.red}" stroke-width="10" stroke-linejoin="round"/>` + place(pict, 60, 71, 0.42);
}

/** Inverted triangle (301). */
export function giveWay(): string {
  return `<path d="M7 19 L113 19 L60 111 Z" fill="${C.white}" stroke="${C.red}" stroke-width="10" stroke-linejoin="round"/>`;
}

export interface DiscOptions {
  /** Disc fill. */
  bg?: string;
  /** Ring colour ('none' for no ring). */
  ring?: string;
  ringWidth?: number;
  /** Red diagonal bar(s) over the pictogram (428–433) or the black "end of restriction" strike (427, 434…). */
  bar?: 'none' | 'red' | 'red_x' | 'end';
  /** Pictogram scale (default 0.66). */
  scale?: number;
}

/** Prohibition / restriction disc (4xx) and derived shapes. */
export function disc(pict: string, o: DiscOptions = {}): string {
  const ring = o.ring ?? C.red;
  const rw = o.ringWidth ?? 10;
  const parts = [`<circle cx="60" cy="60" r="52" fill="${o.bg ?? C.white}"${ring === 'none' ? '' : ` stroke="${ring}" stroke-width="${rw}"`}/>`];
  parts.push(place(pict, 60, 60, o.scale ?? 0.66));
  const d = 36.77; // 52·cos45°
  if (o.bar === 'red' || o.bar === 'red_x') parts.push(`<line x1="${r(60 - d)}" y1="${r(60 - d)}" x2="${r(60 + d)}" y2="${r(60 + d)}" stroke="${C.red}" stroke-width="9"/>`);
  if (o.bar === 'red_x') parts.push(`<line x1="${r(60 - d)}" y1="${r(60 + d)}" x2="${r(60 + d)}" y2="${r(60 - d)}" stroke="${C.red}" stroke-width="9"/>`);
  if (o.bar === 'end') parts.push(endStrike(20, 100, 100, 20));
  return parts.join('');
}

/** Black diagonal used by every "end of …" sign: bottom-left → top-right. */
export function endStrike(x1: number, y1: number, x2: number, y2: number, width = 6): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.black}" stroke-width="${width}" stroke-linecap="butt"/>`;
}

/** Mandatory blue disc (2xx, 303) with a white pictogram. */
export function mandatory(pict: string, scale = 0.76): string {
  return `<circle cx="60" cy="60" r="55" fill="${C.blue}" stroke="${C.white}" stroke-width="2"/>` + place(pict, 60, 60, scale);
}

/** Stop sign octagon (302) and the small octagon pictogram (139). */
export function octagon(pict: string): string {
  return `<polygon points="${polygonPoints(60, 60, 57, 8, 22.5)}" fill="${C.red}" stroke="${C.white}" stroke-width="3"/>` + place(pict, 60, 60, 0.62);
}

export interface SquareOptions {
  w?: number;
  h?: number;
  bg?: string;
  border?: string;
  /** Black "end of" strike. */
  strike?: boolean;
  scale?: number;
}

/** Blue information square / rectangle (220–223, 306, 418, 437, 5xx, 6xx). */
export function square(pict: string, o: SquareOptions = {}): string {
  const w = o.w ?? 100;
  const h = o.h ?? 100;
  const x = (120 - w) / 2;
  const y = (120 - h) / 2;
  const bg = o.bg ?? C.blue;
  const parts = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${bg}"/>`];
  if (o.border !== 'none') parts.push(`<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="3" fill="none" stroke="${o.border ?? C.white}" stroke-width="2.5"/>`);
  parts.push(place(pict, 60, 60, o.scale ?? 0.72));
  if (o.strike) parts.push(endStrike(x + 6, y + h - 6, x + w - 6, y + 6, 7));
  return parts.join('');
}

/** Priority-road diamond (309/310). */
export function diamond(end = false): string {
  const parts = [
    `<polygon points="60,4 116,60 60,116 4,60" fill="${C.black}"/>`,
    `<polygon points="60,8 112,60 60,112 8,60" fill="${C.white}"/>`,
    `<polygon points="60,22 98,60 60,98 22,60" fill="${C.yellow}"/>`,
  ];
  if (end) parts.push(endStrike(18, 102, 102, 18, 9));
  return parts.join('');
}

/** Yellow plate (505 bus stop etc.). */
export function yellowPlate(inner: string, w = 80, h = 104): string {
  const x = (120 - w) / 2;
  const y = (120 - h) / 2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${C.yellow}" stroke="${C.black}" stroke-width="2"/>` + inner;
}

export type LampState = 'off' | 'red' | 'amber' | 'green';

export interface LampOptions {
  /** Index of a lamp that flashes (draws radiating ticks). */
  flash?: number;
  /** Draw an arrow in the lamp at this index (704). */
  arrow?: { at: number; dir: 'left' | 'right' | 'up' };
}

const lampColour = (s: LampState): string => (s === 'red' ? C.lampRed : s === 'amber' ? C.lampAmber : s === 'green' ? C.lampGreen : C.lampOff);

/** Three-lamp vehicle signal head (701–706). */
export function lamp(states: LampState[], o: LampOptions = {}): string {
  const parts = [`<rect x="38" y="4" width="44" height="112" rx="9" fill="${C.housing}" stroke="#000" stroke-width="1.5"/>`];
  const cys = states.length === 3 ? [24, 60, 96] : states.length === 2 ? [38, 82] : [60];
  states.forEach((s, i) => {
    const cy = cys[i]!;
    const lit = s !== 'off';
    const arrow = o.arrow && o.arrow.at === i;
    parts.push(`<circle cx="60" cy="${cy}" r="14" fill="${arrow ? C.lampOff : lampColour(s)}" stroke="${lit ? '#000' : '#4a4a4a'}" stroke-width="1"/>`);
    if (arrow) {
      const deg = o.arrow!.dir === 'left' ? -90 : o.arrow!.dir === 'right' ? 90 : 0;
      parts.push(place(arrow_(lampColour(s), deg), 60, cy, 0.22));
    }
    if (o.flash === i) parts.push(flashTicks(60, cy, 16, lampColour(s)));
  });
  return parts.join('');
}

function flashTicks(cx: number, cy: number, radius: number, colour: string): string {
  const out: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    out.push(`<line x1="${r(cx + radius * Math.cos(a))}" y1="${r(cy + radius * Math.sin(a))}" x2="${r(cx + (radius + 5) * Math.cos(a))}" y2="${r(cy + (radius + 5) * Math.sin(a))}" stroke="${colour}" stroke-width="2.5" stroke-linecap="round"/>`);
  }
  return out.join('');
}

/** Two-lamp pedestrian / bicycle signal head (718–721). */
export function twoLamp(kind: 'ped' | 'bike', state: 'red' | 'green'): string {
  const parts = [`<rect x="28" y="6" width="64" height="108" rx="8" fill="${C.housing}" stroke="#000" stroke-width="1.5"/>`];
  parts.push(`<circle cx="60" cy="36" r="24" fill="${C.lampOff}" stroke="#4a4a4a"/>`);
  parts.push(`<circle cx="60" cy="86" r="24" fill="${C.lampOff}" stroke="#4a4a4a"/>`);
  if (state === 'red') parts.push(place(kind === 'ped' ? pedStanding(C.lampRed) : bicycle(C.lampRed), 60, 36, 0.36));
  else parts.push(place(kind === 'ped' ? pedestrian(C.lampGreen) : bicycle(C.lampGreen), 60, 86, 0.36));
  return parts.join('');
}

/** Alternating double red flasher before a level crossing (722). */
export function railLamp(): string {
  return (
    `<rect x="12" y="34" width="96" height="52" rx="6" fill="${C.housing}" stroke="#000" stroke-width="1.5"/>` +
    `<circle cx="38" cy="60" r="17" fill="${C.lampRed}" stroke="#000"/>` +
    flashTicks(38, 60, 19, C.lampRed) +
    `<circle cx="82" cy="60" r="17" fill="${C.lampOff}" stroke="#4a4a4a"/>`
  );
}

/** Lane-control signals (723 closed / 724 open). */
export function laneControl(kind: 'closed' | 'open'): string {
  const frame = `<rect x="14" y="14" width="92" height="92" rx="4" fill="${C.white}" stroke="${C.black}" stroke-width="2"/>`;
  if (kind === 'closed') return frame + `<path d="M34 34 L86 86 M86 34 L34 86" stroke="${C.red}" stroke-width="13" stroke-linecap="square"/>`;
  return frame + place(arrow_(C.green, 180), 60, 60, 0.78);
}

/** Top-view road-marking diagram background (8xx, 503, 511, 515). */
export function marking(inner: string, o: { sidewalk?: 'top' | 'right' | 'bottom' | 'none' } = {}): string {
  const parts = [`<rect width="120" height="120" fill="${C.asphalt}"/>`];
  if (o.sidewalk === 'top') parts.push(`<rect width="120" height="26" fill="${C.sidewalk}"/><rect y="24" width="120" height="4" fill="${C.lightGrey}"/>`);
  if (o.sidewalk === 'bottom') parts.push(`<rect y="94" width="120" height="26" fill="${C.sidewalk}"/><rect y="92" width="120" height="4" fill="${C.lightGrey}"/>`);
  if (o.sidewalk === 'right') parts.push(`<rect x="94" width="26" height="120" fill="${C.sidewalk}"/><rect x="92" width="4" height="120" fill="${C.lightGrey}"/>`);
  parts.push(inner);
  return parts.join('');
}

/** Kerb painted in alternating colours (511, 816, 817, 818), drawn as a slanted kerb like the official board. */
export function kerb(a: string, b: string): string {
  const segs: string[] = [];
  // kerb runs from bottom-left to top-right across the square; 8 alternating segments
  for (let i = 0; i < 8; i++) segs.push(`<rect x="${i * 20 - 20}" y="-8" width="20" height="16" fill="${i % 2 === 0 ? a : b}"/>`);
  return (
    `<rect width="120" height="120" fill="${C.asphalt}"/>` +
    `<polygon points="0,120 120,0 120,120" fill="${C.sidewalk}"/>` +
    `<g transform="translate(60 60) rotate(-45)">${segs.join('')}</g>`
  );
}

// ───────────────────────────── pictograms (±50 box) ─────────────────────────────

/** Straight arrow pointing up (rotate with `deg`). */
export function arrow_(c: string, deg = 0): string {
  return `<path d="M-8 46 L-8 -14 L-26 -14 L0 -48 L26 -14 L8 -14 L8 46 Z" fill="${c}"${deg ? ` transform="rotate(${deg})"` : ''}/>`;
}
export const arrow = arrow_;

/** Short, wide arrow for lane diagrams. */
export function arrowShort(c: string, deg = 0): string {
  return `<path d="M-7 36 L-7 -8 L-22 -8 L0 -36 L22 -8 L7 -8 L7 36 Z" fill="${c}"${deg ? ` transform="rotate(${deg})"` : ''}/>`;
}

/** Arrow going up then bending to a side ("turn after the sign", 206/207, 428/429). */
export function bentArrow(c: string, side: 'left' | 'right'): string {
  const d = 'M-24 46 L-24 -6 Q-24 -30 0 -30 L12 -30 L12 -46 L44 -20 L12 6 L12 -10 L0 -10 Q-6 -10 -6 -4 L-6 46 Z';
  return `<path d="${d}" fill="${c}"${side === 'left' ? ' transform="scale(-1 1)"' : ''}/>`;
}

/** Straight-or-turn arrow (201/202): straight shaft with a side branch. */
export function straightOrTurn(c: string, side: 'left' | 'right'): string {
  const d = 'M-18 48 L-18 -16 L-34 -16 L-10 -48 L14 -16 L-2 -16 L-2 -4 L22 -4 L22 -18 L48 4 L22 26 L22 12 L-2 12 L-2 48 Z';
  return `<path d="${d}" fill="${c}"${side === 'left' ? ' transform="scale(-1 1)"' : ''}/>`;
}

/** Left-or-right arrow (208). */
export function leftOrRight(c: string): string {
  return `<path d="M-8 48 L-8 -2 L-24 -2 L-24 10 L-48 -10 L-24 -30 L-24 -18 L24 -18 L24 -30 L48 -10 L24 10 L24 -2 L8 -2 L8 48 Z" fill="${c}"/>`;
}

/**
 * U-turn arrow. 'left' = goes up on the right and comes back down on the left (the usual
 * U-turn in right-hand traffic); 'right' is the mirror image.
 */
export function uturn(c: string, side: 'left' | 'right'): string {
  const inner = `<path d="M14 46 L14 -4 A18 18 0 0 0 -22 -4 L-22 6" fill="none" stroke="${c}" stroke-width="14"/><path d="M-40 2 L-4 2 L-22 34 Z" fill="${c}"/>`;
  return side === 'left' ? inner : `<g transform="scale(-1 1)">${inner}</g>`;
}

/** Straight-or-U-turn (209/210). */
export function straightOrUturn(c: string, side: 'left' | 'right'): string {
  const inner =
    `<path d="M-10 48 L-10 -16 L-26 -16 L-2 -48 L22 -16 L6 -16 L6 48 Z" fill="${c}"/>` +
    `<path d="M22 24 L22 4 A14 14 0 0 1 50 4 L50 14" fill="none" stroke="${c}" stroke-width="10"/><path d="M38 12 L62 12 L50 34 Z" fill="${c}"/>`;
  return side === 'right' ? `<g transform="translate(-10 0) scale(0.9)">${inner}</g>` : `<g transform="translate(10 0) scale(-0.9 0.9)">${inner}</g>`;
}

/** Keep right / keep left (214/215): diagonal arrow. */
export function diagonalArrow(c: string, side: 'left' | 'right'): string {
  return arrow_(c, side === 'right' ? 135 : -135);
}

/** Pass either side (213). */
export function bothDiagonals(c: string): string {
  return `<g transform="translate(-18 6) scale(0.7)">${arrow_(c, -135)}</g><g transform="translate(18 6) scale(0.7)">${arrow_(c, 135)}</g>`;
}

/** Three arrows circling counter-clockwise (121, 303). */
export function roundaboutArrows(c: string): string {
  const one = `<path d="M0 32 A32 32 0 0 0 32 0" fill="none" stroke="${c}" stroke-width="9"/><path d="M20 4 L44 4 L32 -18 Z" fill="${c}"/>`;
  return `<g>${one}</g><g transform="rotate(120)">${one}</g><g transform="rotate(240)">${one}</g>`;
}

/** Walking pedestrian. */
export function pedestrian(c: string): string {
  return (
    `<g fill="${c}"><circle cx="5" cy="-38" r="8.5"/>` +
    `<path d="M-6 -27 L10 -27 L18 -2 L10 2 L14 44 L4 46 L-2 14 L-12 44 L-22 42 L-10 -4 Z"/>` +
    `<path d="M-5 -24 L-22 -2 L-15 3 L-1 -12 Z"/><path d="M9 -24 L26 -8 L21 -1 L6 -13 Z"/></g>`
  );
}

/** Standing pedestrian (718). */
export function pedStanding(c: string): string {
  return `<g fill="${c}"><circle cx="0" cy="-37" r="9"/><path d="M-12 -25 L12 -25 L15 6 L8 6 L8 46 L1.5 46 L1.5 12 L-1.5 12 L-1.5 46 L-8 46 L-8 6 L-15 6 Z"/></g>`;
}

/** Adult holding a child's hand (136, 226, 413). */
export function adultChild(c: string): string {
  return (
    `<g transform="translate(-12 0)">${pedStanding(c)}</g>` +
    `<g transform="translate(20 14) scale(0.62)">${pedStanding(c)}</g>` +
    `<path d="M-2 -8 L12 4" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`
  );
}

/** Pedestrian on zebra stripes (135, 306). */
export function zebraPed(c: string): string {
  const stripes: string[] = [];
  for (let i = -2; i <= 2; i++) stripes.push(`<path d="M${i * 18 - 6} 46 L${i * 18 + 4} 24 L${i * 18 + 12} 24 L${i * 18 + 2} 46 Z" fill="${c}"/>`);
  return stripes.join('') + `<g transform="translate(0 -8) scale(0.78)">${pedestrian(c)}</g>`;
}

/** Car, front view. */
export function carFront(c: string, window: string = C.white): string {
  return (
    `<g fill="${c}"><path d="M-40 14 L-32 -12 L32 -12 L40 14 L40 30 L-40 30 Z"/><path d="M-27 -12 L-20 -32 L20 -32 L27 -12 Z"/>` +
    `<rect x="-36" y="26" width="14" height="12" rx="2"/><rect x="22" y="26" width="14" height="12" rx="2"/></g>` +
    `<path d="M-20 -10 L-15 -27 L15 -27 L20 -10 Z" fill="${window}"/>`
  );
}

/** Car, side view (facing left). */
export function carSide(c: string): string {
  return (
    `<g fill="${c}"><path d="M-46 12 L-40 -4 L-20 -8 L-8 -24 L22 -24 L38 -8 L46 -4 L46 14 Z"/>` +
    `<circle cx="-26" cy="16" r="9"/><circle cx="26" cy="16" r="9"/></g>`
  );
}

/** Car, top view (for 141 slippery / 151 accident). */
export function carTop(c: string): string {
  return `<g fill="${c}"><rect x="-16" y="-38" width="32" height="76" rx="10"/><rect x="-22" y="-26" width="6" height="16" rx="2"/><rect x="16" y="-26" width="6" height="16" rx="2"/><rect x="-22" y="12" width="6" height="16" rx="2"/><rect x="16" y="12" width="6" height="16" rx="2"/></g>`;
}

/** Overturned car (151 accident). */
export function accident(c: string): string {
  return (
    `<g transform="translate(-4 6) rotate(-110)">${carTop(c)}</g>` +
    `<g stroke="${c}" stroke-width="4" stroke-linecap="round"><line x1="24" y1="-40" x2="34" y2="-30"/><line x1="38" y1="-44" x2="40" y2="-30"/><line x1="12" y1="-46" x2="20" y2="-36"/></g>`
  );
}

/** Skidding car (141). */
export function slippery(c: string): string {
  return (
    `<g transform="translate(6 -10) rotate(22)">${carTop(c)}</g>` +
    `<path d="M-30 40 q6 -10 12 0 t12 0 t12 0" fill="none" stroke="${c}" stroke-width="4"/>` +
    `<path d="M-40 26 q6 -10 12 0 t12 0" fill="none" stroke="${c}" stroke-width="4"/>`
  );
}

/** Bus, side view (windows cut in `bg`). */
export function bus(c: string, bg: string): string {
  return (
    `<g fill="${c}"><rect x="-46" y="-26" width="92" height="46" rx="6"/><circle cx="-28" cy="24" r="8"/><circle cx="28" cy="24" r="8"/></g>` +
    `<g fill="${bg}"><rect x="-40" y="-20" width="16" height="16" rx="2"/><rect x="-20" y="-20" width="16" height="16" rx="2"/><rect x="0" y="-20" width="16" height="16" rx="2"/><rect x="20" y="-20" width="20" height="16" rx="2"/></g>`
  );
}

/** Taxi (car with a roof sign). */
export function taxi(c: string, bg: string): string {
  return carSide(c) + `<rect x="-14" y="-36" width="28" height="12" rx="2" fill="${c}"/>` + `<text x="0" y="-26" font-family="${FONT}" font-size="9" font-weight="700" text-anchor="middle" fill="${bg}">taxi</text>`;
}

export function bicycle(c: string): string {
  return (
    `<g fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="-26" cy="14" r="17"/><circle cx="26" cy="14" r="17"/>` +
    `<path d="M-26 14 L-8 -16 L18 -16 L26 14 M-8 -16 L2 14 L26 14 M18 -16 L12 -30 L22 -30 M-8 -16 L-16 -16"/></g>`
  );
}

export function motorcycle(c: string): string {
  return (
    `<g fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round">` +
    `<circle cx="-26" cy="16" r="14"/><circle cx="28" cy="16" r="14"/>` +
    `<path d="M-26 16 L-4 -8 L20 -8 L28 16 M-4 -8 L-14 -28 M4 -8 L4 -22 L20 -22"/></g>` +
    `<circle cx="-2" cy="-30" r="6" fill="${c}"/>`
  );
}

/** Three-colour traffic light pictogram (122). */
export function trafficLight(): string {
  return (
    `<rect x="-14" y="-40" width="28" height="80" rx="6" fill="${C.black}"/>` +
    `<circle cx="0" cy="-24" r="9" fill="${C.lampRed}"/><circle cx="0" cy="0" r="9" fill="${C.lampAmber}"/><circle cx="0" cy="24" r="9" fill="${C.lampGreen}"/>`
  );
}

/** Speed bump (144). */
export function bump(c: string): string {
  return `<g fill="${c}"><rect x="-46" y="14" width="92" height="7"/><path d="M-28 14 Q0 -30 28 14 Z"/></g>`;
}

/** Small octagon (139). */
export function octagonSmall(c: string): string {
  return `<polygon points="${polygonPoints(0, 0, 40, 8, 22.5)}" fill="${c}"/>`;
}

/** Exclamation mark (150). */
export function exclaim(c: string): string {
  return `<g fill="${c}"><rect x="-7" y="-44" width="14" height="56" rx="5"/><circle cx="0" cy="32" r="8.5"/></g>`;
}

/** Two-way traffic (145). */
export function twoWay(c: string): string {
  return `<g transform="translate(-16 0) scale(0.72)">${arrow_(c)}</g><g transform="translate(16 0) scale(0.72)">${arrow_(c, 180)}</g>`;
}

/** Crossroads (114). */
export function crossroads(c: string): string {
  return `<g fill="${c}"><rect x="-9" y="-46" width="18" height="92"/><rect x="-46" y="-9" width="92" height="18"/></g>`;
}

/** Side road joining from one side (115 right / 116 left). */
export function sideRoad(c: string, side: 'left' | 'right'): string {
  return `<g fill="${c}"><rect x="-9" y="-46" width="18" height="92"/><rect x="${side === 'right' ? 0 : -46}" y="-16" width="46" height="16"/></g>`;
}

/** T-junction ahead (117). */
export function tee(c: string): string {
  return `<g fill="${c}"><rect x="-46" y="-40" width="92" height="18"/><rect x="-9" y="-40" width="18" height="86"/></g>`;
}

/** Road narrows (109 both / 110 right / 111 left). */
export function narrowing(c: string, side: 'both' | 'left' | 'right'): string {
  const curved = 'M22 46 L22 8 Q22 -8 12 -22 L12 -46';
  const straight = 'M22 46 L22 -46';
  const rightD = side === 'left' ? straight : curved;
  const leftD = side === 'right' ? straight : curved;
  // the left line is the right line mirrored about the vertical axis
  return `<g fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"><path d="${rightD}"/><path d="${leftD}" transform="scale(-1 1)"/></g>`;
}

/** Sharp curve (102 right / 103 left). */
export function curve(c: string, side: 'left' | 'right'): string {
  const inner = `<path d="M-16 46 L-16 -4 Q-16 -24 4 -24 L20 -24" fill="none" stroke="${c}" stroke-width="9"/><path d="M18 -38 L40 -24 L18 -10 Z" fill="${c}"/>`;
  return side === 'right' ? inner : `<g transform="scale(-1 1)">${inner}</g>`;
}

/** Open palm (302). */
export function hand(c: string): string {
  return (
    `<g fill="${c}">` +
    `<rect x="-26" y="-10" width="52" height="40" rx="14"/>` +
    `<rect x="-26" y="-42" width="11" height="40" rx="5.5"/><rect x="-12" y="-50" width="11" height="48" rx="5.5"/>` +
    `<rect x="2" y="-48" width="11" height="46" rx="5.5"/><rect x="16" y="-38" width="10" height="36" rx="5"/>` +
    `<rect x="-18" y="26" width="36" height="20" rx="4"/></g>` +
    `<line x1="22" y1="8" x2="40" y2="-18" stroke="${c}" stroke-width="11" stroke-linecap="round"/>`
  );
}

export function wheelchair(c: string): string {
  return (
    `<g fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="-6" cy="18" r="22"/><path d="M-6 -34 L-6 4 L22 4 L34 32 M22 4 L22 -4"/></g>` +
    `<circle cx="-4" cy="-42" r="8" fill="${c}"/>`
  );
}

/** Road worker with a shovel (901). */
export function worker(c: string): string {
  return (
    `<g fill="${c}"><circle cx="8" cy="-34" r="8"/>` +
    `<path d="M-2 -22 L16 -26 L28 2 L18 8 L22 44 L10 44 L4 14 L-10 40 L-20 36 L-6 -2 Z"/>` +
    `<path d="M-40 44 Q-30 26 -14 26 Q-4 26 2 44 Z"/></g>` +
    `<path d="M-6 -18 L-34 18" stroke="${c}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M-40 10 L-28 24 L-36 30 Z" fill="${c}"/>`
  );
}

/** House + car + playing child (220 living street). */
export function livingStreet(c: string): string {
  return (
    `<g fill="${c}"><path d="M-46 -8 L-30 -26 L-14 -8 Z"/><rect x="-42" y="-8" width="24" height="18"/></g>` +
    `<g transform="translate(22 -8) scale(0.5)">${carSide(c)}</g>` +
    `<g transform="translate(-24 30) scale(0.42)">${pedestrian(c)}</g>` +
    `<circle cx="10" cy="40" r="6" fill="${c}"/>` +
    `<g transform="translate(28 26) scale(0.5)">${pedStanding(c)}</g>`
  );
}

/** Stylised town silhouette (424/425 urban area). */
export function town(c: string): string {
  return `<g fill="${c}"><path d="M-44 44 L-44 4 L-30 4 L-30 -14 L-16 -14 L-16 -34 L0 -48 L16 -34 L16 -14 L30 -14 L30 4 L44 4 L44 44 Z"/></g>` + `<g fill="${C.white}"><rect x="-36" y="12" width="7" height="10"/><rect x="-22" y="-4" width="7" height="10"/><rect x="-6" y="-26" width="7" height="12"/><rect x="8" y="-26" width="7" height="12"/><rect x="16" y="-4" width="7" height="10"/><rect x="30" y="12" width="7" height="10"/></g>`;
}

/** Large number (speed limits). */
export function number(c: string, value: number | string, size = 56): string {
  const s = String(value);
  const fs = s.length >= 3 ? size * 0.72 : size;
  return `<text x="0" y="0" font-family="${FONT}" font-size="${fs}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${c}">${esc(s)}</text>`;
}

/** Hebrew text. */
export function heb(c: string, text: string, size = 40, weight = 700, y = 0): string {
  return `<text x="0" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="middle" dominant-baseline="central" direction="rtl" fill="${c}">${esc(text)}</text>`;
}

/** Parking glyph: Hebrew "ח" with the right leg extended like the stem of a "P" (626–628). */
export function parkingGlyph(c: string): string {
  return (
    `<g fill="${c}"><path d="M-30 -36 L30 -36 L30 46 L16 46 L16 -22 L-16 -22 L-16 24 L-30 24 Z"/></g>`
  );
}

/** Dead-end pictograms (623 straight / 624 right / 625 left). */
export function deadEnd(side: 'straight' | 'right' | 'left'): string {
  if (side === 'straight') return `<rect x="-8" y="-24" width="16" height="72" fill="${C.white}"/><rect x="-30" y="-36" width="60" height="14" fill="${C.red}"/>`;
  const inner = `<rect x="-8" y="-48" width="16" height="96" fill="${C.white}"/><rect x="0" y="-6" width="30" height="12" fill="${C.white}"/><rect x="26" y="-22" width="12" height="44" fill="${C.red}"/>`;
  return side === 'right' ? inner : `<g transform="scale(-1 1)">${inner}</g>`;
}

/** Lane drop (621 right lane ends / 622 left lane ends). */
export function laneDrop(c: string, side: 'left' | 'right'): string {
  const inner = `<path d="M-18 46 L-18 -30" fill="none" stroke="${c}" stroke-width="10"/><path d="M-32 -26 L-18 -48 L-4 -26 Z" fill="${c}"/><path d="M18 46 L18 10 Q18 -4 4 -10 L-10 -16" fill="none" stroke="${c}" stroke-width="10"/>`;
  return side === 'right' ? inner : `<g transform="scale(-1 1)">${inner}</g>`;
}

/** Opposing arrows for the narrow-road priority pair (307/308). */
export function narrowRoad(upColour: string, downColour: string): string {
  return `<g transform="translate(14 0) scale(0.78)">${arrow_(upColour)}</g><g transform="translate(-16 0) scale(0.78)">${arrow_(downColour, 180)}</g>`;
}

/** Two cars side by side (420 no overtaking). */
export function twoCars(leftColour: string, rightColour: string): string {
  return `<g transform="translate(-22 4) scale(0.52)">${carFront(leftColour)}</g><g transform="translate(22 4) scale(0.52)">${carFront(rightColour)}</g>`;
}

/** Learner-driver "ל" plate (418/419). */
export function learner(bg: string, fg: string): string {
  return `<rect x="-34" y="-34" width="68" height="68" rx="4" fill="${bg}"/>` + heb(fg, 'ל', 50, 700, 2);
}

/** Lane arrows for 613 (rightmost yellow = bus lane). */
export function laneArrows613(): string {
  const sep = `<path d="M-18 -42 L-18 42 M18 -42 L18 42" stroke="${C.white}" stroke-width="3" stroke-dasharray="8 6"/>`;
  return sep + `<g transform="translate(-36 0) scale(0.5)">${bentArrow(C.white, 'left')}</g><g transform="translate(0 0) scale(0.5)">${arrow_(C.white)}</g><g transform="translate(36 0) scale(0.5)">${arrow_(C.yellow)}</g>`;
}

/** Up (white) + contraflow yellow arrow (504). */
export function contraflow(): string {
  return `<g transform="translate(16 0) scale(0.8)">${arrow_(C.white)}</g><g transform="translate(-20 0) scale(0.8)">${arrow_(C.yellow, 180)}</g>`;
}

/** Stacked public-transport pictograms (501/502). */
export function publicTransport(): string {
  return (
    `<g transform="translate(0 -34) scale(0.5)">${bus(C.white, C.blue)}</g>` +
    `<g transform="translate(0 -2) scale(0.5)">${bus(C.yellow, C.blue)}</g>` +
    `<g transform="translate(0 28) scale(0.46)">${taxi(C.white, C.blue)}</g>` +
    `<text x="0" y="50" font-family="${FONT}" font-size="14" font-weight="700" text-anchor="middle" fill="${C.white}">3+</text>`
  );
}

/** Bus-stop plate content (505). */
export function busStopPlate(): string {
  const rows = [10, 24, 59].map((n, i) => `<rect x="-30" y="${-8 + i * 18}" width="60" height="14" fill="${C.white}" stroke="${C.black}" stroke-width="1"/><text x="-14" y="${-1 + i * 18}" font-family="${FONT}" font-size="10" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${C.black}">${n}</text><rect x="-2" y="${-5 + i * 18}" width="30" height="8" fill="${C.lightGrey}"/>`);
  return `<rect x="-36" y="-50" width="72" height="26" fill="${C.blue}"/><g transform="translate(0 -37) scale(0.24)">${bus(C.white, C.blue)}</g>` + rows.join('');
}

/** Taxi-rank content (507). */
export function taxiRank(): string {
  return (
    `<rect x="-40" y="-46" width="80" height="22" rx="3" fill="${C.yellow}"/>` +
    `<text x="0" y="-35" font-family="${FONT}" font-size="14" font-weight="700" text-anchor="middle" dominant-baseline="central" direction="rtl" fill="${C.black}">מוניות</text>` +
    `<circle cx="0" cy="14" r="30" fill="${C.blue}" stroke="${C.red}" stroke-width="7"/>` +
    `<line x1="-21" y1="-7" x2="21" y2="35" stroke="${C.red}" stroke-width="6"/>`
  );
}

// ───────────────────────────── marking pieces (0..120 frame coordinates) ─────────────────────────────

export function dashedLine(x: number, dash = '14 10', width = 4, colour: string = C.white): string {
  return `<line x1="${x}" y1="0" x2="${x}" y2="120" stroke="${colour}" stroke-width="${width}" stroke-dasharray="${dash}"/>`;
}
export function solidLine(x: number, width = 4, colour: string = C.white): string {
  return `<line x1="${x}" y1="0" x2="${x}" y2="120" stroke="${colour}" stroke-width="${width}"/>`;
}
export function yellowDiamonds(x: number): string {
  const out: string[] = [];
  for (let y = 16; y < 120; y += 30) out.push(`<polygon points="${x},${y - 7} ${x + 5},${y} ${x},${y + 7} ${x - 5},${y}" fill="${C.yellow}"/>`);
  return out.join('');
}
/** Zebra: stripes parallel to the travel direction (road runs bottom→top). */
export function zebra(y0: number, h: number): string {
  const out: string[] = [];
  for (let x = 10; x < 120; x += 20) out.push(`<rect x="${x}" y="${y0}" width="11" height="${h}" fill="${C.white}"/>`);
  return out.join('');
}
export function hatched(): string {
  const out = [`<polygon points="8,112 112,112 60,20" fill="none" stroke="${C.white}" stroke-width="4"/>`];
  for (let k = 0; k < 6; k++) out.push(`<line x1="${30 + k * 12}" y1="${112 - k * 0}" x2="${60}" y2="${26 + k * 14}" stroke="${C.white}" stroke-width="3"/>`);
  return `<clipPath id="hatch"><polygon points="8,112 112,112 60,20"/></clipPath><g clip-path="url(#hatch)">${[-60, -36, -12, 12, 36, 60, 84].map((d) => `<line x1="${d}" y1="120" x2="${d + 120}" y2="0" stroke="${C.white}" stroke-width="4"/>`).join('')}</g>` + out[0];
}
