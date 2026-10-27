/**
 * Small inline SVG icon set (24×24 viewBox, stroke = currentColor). No emoji anywhere
 * in production copy — icons come from here.
 */

export type IconName =
  | 'speedometer'
  | 'gear'
  | 'indicatorLeft'
  | 'indicatorRight'
  | 'hazard'
  | 'lightsLow'
  | 'lightsHigh'
  | 'lightsParking'
  | 'seatbelt'
  | 'mirror'
  | 'pedestrian'
  | 'signal'
  | 'stop'
  | 'giveWay'
  | 'warning'
  | 'check'
  | 'play'
  | 'pause'
  | 'settings'
  | 'map'
  | 'book'
  | 'car'
  | 'instructor'
  | 'examiner'
  | 'arrowStraight'
  | 'arrowLeft'
  | 'arrowRight'
  | 'arrowSlightLeft'
  | 'arrowSlightRight'
  | 'uturn'
  | 'roundabout'
  | 'park'
  | 'pullOver'
  | 'reverse'
  | 'handbrake'
  | 'info'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'clock'
  | 'sun'
  | 'moon'
  | 'rain'
  | 'fog'
  | 'cloud'
  | 'volume'
  | 'keyboard'
  | 'gamepad'
  | 'wheel'
  | 'flag'
  | 'star'
  | 'lock'
  | 'trophy'
  | 'question'
  | 'replay'
  | 'home'
  | 'list'
  | 'compass'
  | 'eye'
  | 'target'
  | 'school'
  | 'brake'
  | 'thumbsUp';

/** Inner SVG markup for each icon (paths only; stroke/fill set on the <svg>). */
export const ICON_PATHS: Record<IconName, string> = {
  speedometer: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4.2-4.8"/><circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none"/><path d="M4 16h2M18 16h2M6.3 10.3l1.4 1.4M16.3 11.7l1.4-1.4M12 8v2"/>',
  gear: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9.5 16.5v-9h3.2a2.25 2.25 0 0 1 0 4.5H9.5"/>',
  indicatorLeft: '<path d="M3 12l8-7v4h10v6H11v4z" fill="currentColor" stroke="none"/>',
  indicatorRight: '<path d="M21 12l-8-7v4H3v6h10v4z" fill="currentColor" stroke="none"/>',
  hazard: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  lightsLow: '<path d="M8 6c3.3 0 6 2.7 6 6s-2.7 6-6 6"/><path d="M8 6v12"/><path d="M15 8l6 1.5M15 11.5l6 1.5M15 15l6 1.5"/>',
  lightsHigh: '<path d="M8 6c3.3 0 6 2.7 6 6s-2.7 6-6 6"/><path d="M8 6v12"/><path d="M15 8.5h6M15 12h6M15 15.5h6"/>',
  lightsParking: '<path d="M8 8c2.2 0 4 1.8 4 4s-1.8 4-4 4"/><path d="M8 8v8"/><path d="M15 10l4 1M15 14l4-1"/>',
  seatbelt: '<circle cx="12" cy="5.5" r="2.5"/><path d="M6 21c0-4.5 2.5-7.5 6-7.5s6 3 6 7.5"/><path d="M4 9l15 9"/><rect x="16.5" y="15.5" width="4.5" height="3.5" rx=".8" fill="currentColor" stroke="none"/>',
  mirror: '<rect x="3" y="6" width="18" height="9" rx="2.5"/><path d="M12 15v4M9 19h6"/>',
  pedestrian: '<circle cx="12.5" cy="4" r="1.9"/><path d="M12 7.2l-3.2 5.3 2.4 2.1-1.4 6.2"/><path d="M12 7.2l3.1 2.6 3.1 2"/><path d="M8.8 12.5l-3.2 2.3"/><path d="M13.6 12.8l2.1 3.2 1.1 5"/>',
  signal: '<rect x="8" y="2" width="8" height="20" rx="2.5"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="17.5" r="1.8"/>',
  stop: '<path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8z"/><path d="M8 12h8"/>',
  giveWay: '<path d="M3 5h18l-9 15z"/>',
  warning: '<path d="M12 3L2 21h20z"/><path d="M12 9.5v5"/><circle cx="12" cy="17.6" r=".95" fill="currentColor" stroke="none"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  book: '<path d="M3 4h6.5A2.5 2.5 0 0 1 12 6.5V20a2 2 0 0 0-2-2H3z"/><path d="M21 4h-6.5A2.5 2.5 0 0 0 12 6.5V20a2 2 0 0 1 2-2h7z"/>',
  car: '<path d="M5 12l1.6-4.6A2 2 0 0 1 8.5 6h7a2 2 0 0 1 1.9 1.4L19 12"/><path d="M3 12h18v5.5a1 1 0 0 1-1 1h-1.5a2 2 0 0 1-4 0h-5a2 2 0 0 1-4 0H4a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16" r="1" fill="currentColor" stroke="none"/>',
  instructor: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/><path d="M12 14l-1.4 2.6L12 20l1.4-3.4z"/>',
  examiner: '<circle cx="8.5" cy="7" r="3"/><path d="M2.5 21c0-3.5 2.7-6 6-6"/><rect x="13" y="9" width="8.5" height="12" rx="1.5"/><path d="M15.2 13.5h4M15.2 17h4"/>',
  arrowStraight: '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/>',
  arrowLeft: '<path d="M18 20v-7a4 4 0 0 0-4-4H5"/><path d="M9 5L5 9l4 4"/>',
  arrowRight: '<path d="M6 20v-7a4 4 0 0 1 4-4h9"/><path d="M15 5l4 4-4 4"/>',
  arrowSlightLeft: '<path d="M15 21v-7L8.5 7.5"/><path d="M8.5 13.5v-6h6"/>',
  arrowSlightRight: '<path d="M9 21v-7l6.5-6.5"/><path d="M15.5 13.5v-6h-6"/>',
  uturn: '<path d="M16 20V9a4 4 0 0 0-8 0v4.5"/><path d="M4 10l4 4 4-4"/>',
  roundabout: '<circle cx="12" cy="14" r="5"/><path d="M12 9V2.5"/><path d="M9 5.5l3-3 3 3"/>',
  park: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>',
  pullOver: '<path d="M8 4v8a4 4 0 0 0 4 4h4"/><path d="M13 13l3 3-3 3"/><path d="M20.5 3.5v17"/>',
  reverse: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  handbrake: '<path d="M5 6.5a9 9 0 0 0 0 11"/><path d="M19 6.5a9 9 0 0 1 0 11"/><circle cx="12" cy="12" r="4.5"/><path d="M10.8 14.6V9.4h1.6a1.3 1.3 0 0 1 0 2.6h-1.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".95" fill="currentColor" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  rain: '<path d="M7 14a4 4 0 0 1-.5-8A6 6 0 0 1 18 7a3.5 3.5 0 0 1 0 7"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 11a3.5 3.5 0 0 1 0 7z"/>',
  volume: '<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>',
  gamepad: '<path d="M6.5 7h11a4.5 4.5 0 0 1 4.5 4.5v3a3 3 0 0 1-5.4 1.8L15.3 15H8.7l-1.3 1.3A3 3 0 0 1 2 14.5v-3A4.5 4.5 0 0 1 6.5 7z"/><path d="M8 10v3.5M6.3 11.8h3.4"/><circle cx="16" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="18.2" cy="13.2" r=".9" fill="currentColor" stroke="none"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M3.2 11h5.9M14.9 11h5.9M12 15v6"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 21h8M9.5 17h5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><circle cx="12" cy="17" r=".95" fill="currentColor" stroke="none"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.3 6.7-4.7.3 2.3-6.7z"/>',
  eye: '<path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  school: '<path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v5"/>',
  brake: '<circle cx="12" cy="12" r="5"/><path d="M4.5 6.5a9 9 0 0 0 0 11M19.5 6.5a9 9 0 0 1 0 11"/><path d="M12 9.5v3M12 14.8h.01"/>',
  thumbsUp: '<path d="M7 11v9H3v-9z"/><path d="M7 11l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6a2 2 0 0 1-2 1.7H7"/>',
};

export interface IconOptions {
  size?: number;
  className?: string;
  /** Accessible name; without it the icon is decorative (aria-hidden). */
  title?: string;
  strokeWidth?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an <svg> element for the icon. */
export function icon(name: IconName, opts: IconOptions = {}): SVGSVGElement {
  const size = opts.size ?? 20;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(opts.strokeWidth ?? 2));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `icon icon-${name}${opts.className ? ' ' + opts.className : ''}`);
  if (opts.title) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}

/** Icon as an HTML string (for innerHTML templates). */
export function iconHtml(name: IconName, opts: IconOptions = {}): string {
  const size = opts.size ?? 20;
  const aria = opts.title ? `role="img" aria-label="${escapeAttr(opts.title)}"` : 'aria-hidden="true"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${opts.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round" class="icon icon-${name}${opts.className ? ' ' + opts.className : ''}" ${aria}>${ICON_PATHS[name]}</svg>`;
}

/** Map a navigation instruction kind (see NavInstruction.kind) to an icon. */
export function navIcon(kind: string): IconName {
  switch (kind) {
    case 'turn_right':
    case 'right':
      return 'arrowRight';
    case 'turn_left':
    case 'left':
      return 'arrowLeft';
    case 'slight_right':
      return 'arrowSlightRight';
    case 'slight_left':
      return 'arrowSlightLeft';
    case 'sharp_right':
      return 'arrowRight';
    case 'sharp_left':
      return 'arrowLeft';
    case 'roundabout_exit':
    case 'roundabout':
      return 'roundabout';
    case 'stop_here':
    case 'stop':
      return 'stop';
    case 'park':
      return 'park';
    case 'uturn':
      return 'uturn';
    case 'pull_over':
      return 'pullOver';
    case 'reverse':
      return 'reverse';
    case 'lane_change_left':
      return 'arrowSlightLeft';
    case 'lane_change_right':
      return 'arrowSlightRight';
    case 'destination':
      return 'flag';
    default:
      return 'arrowStraight';
  }
}

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
