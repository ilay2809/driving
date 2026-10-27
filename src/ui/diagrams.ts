/**
 * Inline SVG teaching diagrams used by lesson briefings (`slide.diagram`).
 * Top view, +x right, +y down; our car is blue, other road users grey.
 */

export const DIAGRAM_IDS = ['right_hand_rule', 'roundabout_lanes', 'stop_line_order', 'parking_12m', 'mirrors_blindspot', 'left_turn_yield'] as const;
export type DiagramId = (typeof DIAGRAM_IDS)[number];

const C = {
  road: '#3a4653',
  edge: '#64748b',
  dash: '#cbd5e1',
  us: '#3b82f6',
  other: '#e2e8f0',
  ok: '#22c55e',
  danger: '#ef4444',
  text: '#f2f5f8',
  muted: '#9aa7b4',
  grass: '#15301f',
  walk: '#1f2937',
  blue: '#93c5fd',
};
const FONT = 'font-family="Rubik, Heebo, sans-serif"';
let uid = 0;

function car(cx: number, cy: number, rot: number, fill: string, opacity = 1): string {
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})" opacity="${opacity}"><rect x="-8" y="-14" width="16" height="28" rx="4" fill="${fill}"/><rect x="-6" y="-9" width="12" height="6" rx="1.5" fill="rgba(0,0,0,.35)"/><rect x="-6" y="5" width="12" height="4" rx="1" fill="rgba(0,0,0,.25)"/></g>`;
}
function marker(id: string, colour: string): string {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="${colour}"/></marker>`;
}
function arrow(d: string, colour: string, mk: string, dashed = false, width = 3): string {
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${dashed ? 'stroke-dasharray="7 6"' : ''} marker-end="url(#${mk})"/>`;
}
function label(x: number, y: number, text: string, colour = C.text, size = 12, anchor: 'middle' | 'start' | 'end' = 'middle', weight = 500): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${colour}">${text}</text>`;
}
function caption(text: string, y = 20): string {
  return `<rect x="0" y="${y - 15}" width="320" height="24" rx="6" fill="rgba(0,0,0,.45)"/>${label(160, y + 2, text, C.text, 12.5, 'middle', 700)}`;
}
function dashes(x1: number, y1: number, x2: number, y2: number): string {
  return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${C.dash}" stroke-width="1.5" stroke-dasharray="8 7" opacity=".8"/>`;
}
function cross(x1: number, y1: number, x2: number, y2: number, w = 60): string {
  // + junction: horizontal road at y1..y2 (height w) and vertical road x1..x2 (width w)
  return `<rect x="0" y="${y1}" width="320" height="${w}" fill="${C.road}"/><rect x="${x1}" y="0" width="${w}" height="220" fill="${C.road}"/>` + dashes(0, y1 + w / 2, x1, y1 + w / 2) + dashes(x2, y1 + w / 2, 320, y1 + w / 2) + dashes(x1 + w / 2, 0, x1 + w / 2, y1) + dashes(x1 + w / 2, y2, x1 + w / 2, 220);
}

const BUILDERS: Record<DiagramId, (id: string) => string> = {
  right_hand_rule: (id) =>
    `<defs>${marker(id + 'g', C.ok)}${marker(id + 'r', C.danger)}</defs>` +
    cross(130, 190, 80, 140) +
    `<rect x="162" y="146" width="26" height="4" fill="${C.danger}"/>` +
    car(175, 170, 0, C.us) +
    car(245, 95, -90, C.other) +
    arrow('M222 95 H95', C.ok, id + 'g') +
    label(197, 174, 'אתה', C.text, 12, 'start') +
    label(245, 70, 'זכות קדימה', C.ok, 12) +
    label(197, 205, 'ממתין', C.danger, 12, 'start') +
    caption('בצומת ללא תמרורים — הרכב הבא מימין עובר ראשון'),

  roundabout_lanes: (id) =>
    `<defs>${marker(id + 'g', C.ok)}${marker(id + 'b', C.blue)}</defs>` +
    `<rect x="130" y="150" width="60" height="70" fill="${C.road}"/><rect x="130" y="0" width="60" height="50" fill="${C.road}"/><rect x="210" y="70" width="110" height="60" fill="${C.road}"/><rect x="0" y="70" width="110" height="60" fill="${C.road}"/>` +
    `<circle cx="160" cy="100" r="64" fill="${C.road}"/><circle cx="160" cy="100" r="26" fill="${C.grass}" stroke="${C.edge}" stroke-width="2"/>` +
    dashes(160, 165, 160, 220) +
    dashes(175, 165, 175, 220) +
    dashes(160, 0, 160, 38) +
    dashes(222, 100, 320, 100) +
    dashes(0, 100, 98, 100) +
    arrow('M182 212 V172 Q184 128 212 117 H300', C.ok, id + 'g') +
    arrow('M167 212 V158 A50 50 0 0 0 160 50 V8', C.blue, id + 'b') +
    arrow('M112 100 H20', C.blue, id + 'b') +
    `<path d="M160 50 A50 50 0 0 0 112 100" fill="none" stroke="${C.blue}" stroke-width="3" stroke-dasharray="6 6"/>` +
    label(255, 178, 'נתיב ימני: יציאה ראשונה', C.ok, 11.5) +
    label(255, 196, '(פנייה ימינה)', C.ok, 11) +
    label(62, 178, 'נתיב שמאלי: ישר,', C.blue, 11.5) +
    label(62, 196, 'שמאלה ופרסה', C.blue, 11.5) +
    caption('בכיכר נוסעים נגד כיוון השעון — הנתיב נבחר לפי היציאה'),

  stop_line_order: (id) =>
    `<defs>${marker(id + 'b', C.blue)}</defs>` +
    `<rect x="110" y="0" width="100" height="220" fill="${C.road}"/><rect x="0" y="0" width="320" height="70" fill="${C.road}"/>` +
    dashes(0, 35, 110, 35) +
    dashes(210, 35, 320, 35) +
    dashes(160, 125, 160, 220) +
    [0, 1, 2, 3, 4, 5].map((k) => `<rect x="${114 + k * 16}" y="84" width="9" height="20" fill="#e5e7eb"/>`).join('') +
    `<rect x="160" y="116" width="50" height="4" fill="#fff"/>` +
    car(185, 150, 0, C.us) +
    `<circle cx="240" cy="118" r="9" fill="${C.us}"/>${label(240, 122, '1', '#fff', 11, 'middle', 700)}${label(255, 122, 'קו עצירה', C.text, 12, 'start')}` +
    `<circle cx="240" cy="94" r="9" fill="${C.us}"/>${label(240, 98, '2', '#fff', 11, 'middle', 700)}${label(255, 98, 'מעבר חצייה', C.text, 12, 'start')}` +
    `<circle cx="240" cy="48" r="9" fill="${C.us}"/>${label(240, 52, '3', '#fff', 11, 'middle', 700)}${label(255, 52, 'הצומת', C.text, 12, 'start')}` +
    `<rect x="0" y="190" width="320" height="24" rx="6" fill="rgba(0,0,0,.45)"/>` +
    label(160, 207, 'עוצרים לפני הראשון שקיים: קו עצירה, ואם אין — מעבר חצייה, ואם אין — הצומת', C.text, 10.5, 'middle', 700),

  parking_12m: (id) =>
    `<defs><pattern id="${id}h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="${C.danger}"/><rect x="4" width="4" height="8" fill="#fff"/></pattern>${marker(id + 'r', C.danger)}</defs>` +
    `<rect x="0" y="70" width="240" height="70" fill="${C.road}"/><rect x="240" y="0" width="80" height="220" fill="${C.road}"/>` +
    `<rect x="0" y="140" width="240" height="80" fill="${C.walk}"/><rect x="0" y="0" width="240" height="70" fill="${C.walk}"/>` +
    dashes(0, 105, 240, 105) +
    dashes(280, 0, 280, 220) +
    `<path d="M0 140 H240 V220" stroke="${C.edge}" stroke-width="2" fill="none"/>` +
    `<rect x="168" y="134" width="72" height="7" fill="url(#${id}h)"/>` +
    car(100, 123, 90, C.other) +
    `<path d="M90 100 l6 6 l12 -12" stroke="${C.ok}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    car(204, 123, 90, C.danger, 0.4) +
    `<path d="M194 112 l20 22 M214 112 l-20 22" stroke="${C.danger}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="M168 158 V170 M240 158 V170 M168 164 H240" stroke="${C.text}" stroke-width="1.5"/>` +
    label(204, 183, '12 מ׳', C.text, 12, 'middle', 700) +
    label(204, 205, 'אסור לחנות', C.danger, 12) +
    label(100, 170, 'מותר', C.ok, 12) +
    caption('אין לחנות במרחק קטן מ-12 מ׳ מצומת (ומ-12 מ׳ לפני מעבר חצייה)', 24),

  mirrors_blindspot: (id) =>
    `<defs><pattern id="${id}h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="8" fill="${C.danger}" opacity=".7"/></pattern></defs>` +
    `<polygon points="160,100 118,220 202,220" fill="rgba(56,189,248,.16)"/>` +
    `<polygon points="134,98 20,178 20,220 96,220" fill="rgba(56,189,248,.16)"/>` +
    `<polygon points="186,98 300,178 300,220 224,220" fill="rgba(56,189,248,.16)"/>` +
    `<polygon points="136,104 48,104 48,160 136,142" fill="url(#${id}h)" stroke="${C.danger}" stroke-width="1" opacity=".9"/>` +
    `<polygon points="184,104 272,104 272,160 184,142" fill="url(#${id}h)" stroke="${C.danger}" stroke-width="1" opacity=".9"/>` +
    `<rect x="138" y="78" width="44" height="84" rx="9" fill="${C.us}"/><rect x="143" y="92" width="34" height="14" rx="3" fill="rgba(0,0,0,.35)"/><rect x="143" y="142" width="34" height="9" rx="2" fill="rgba(0,0,0,.25)"/>` +
    `<rect x="130" y="94" width="8" height="5" rx="1" fill="${C.other}"/><rect x="182" y="94" width="8" height="5" rx="1" fill="${C.other}"/>` +
    `<circle cx="152" cy="118" r="5" fill="#fde68a"/>` +
    label(92, 128, 'שטח מת', C.danger, 12, 'middle', 700) +
    label(228, 128, 'שטח מת', C.danger, 12, 'middle', 700) +
    label(160, 208, 'מראה פנימית', C.blue, 11.5) +
    label(50, 208, 'מראה שמאלית', C.blue, 11.5) +
    label(270, 208, 'מראה ימנית', C.blue, 11.5) +
    caption('המראות לא מכסות הכול — לפני מעבר נתיב מפנים את הראש לכתף'),

  left_turn_yield: (id) =>
    `<defs>${marker(id + 'g', C.ok)}${marker(id + 'b', C.blue)}</defs>` +
    cross(130, 190, 80, 140) +
    car(175, 172, 0, C.us) +
    car(145, 40, 180, C.other) +
    arrow('M145 62 V200', C.ok, id + 'g') +
    arrow('M175 156 Q175 95 115 95 H40', C.blue, id + 'b', true) +
    `<circle cx="145" cy="95" r="9" fill="none" stroke="${C.danger}" stroke-width="2.5" stroke-dasharray="4 3"/>` +
    label(197, 176, 'ממתין', C.danger, 12, 'start') +
    label(118, 44, 'זכות קדימה', C.ok, 11.5, 'end') +
    `<rect x="196" y="4" width="120" height="48" rx="8" fill="rgba(0,0,0,.45)"/>` +
    label(256, 24, 'הפונה שמאלה', C.text, 12, 'middle', 700) +
    label(256, 42, 'נותן זכות קדימה לרכב ממול', C.text, 11),
};

export function isDiagramId(id: string): id is DiagramId {
  return (DIAGRAM_IDS as readonly string[]).includes(id);
}

/** Render a diagram by id (null for unknown ids). */
export function renderDiagram(id: string): SVGSVGElement | null {
  if (!isDiagramId(id)) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 220');
  svg.setAttribute('class', `diagram-svg diagram-${id}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', id);
  svg.innerHTML = BUILDERS[id](`d${++uid}`);
  return svg;
}
