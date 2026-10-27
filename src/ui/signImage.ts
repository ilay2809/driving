/**
 * Sign images: <img src="{BASE_URL}signs/{code}.svg"> with an onerror fallback to a drawn
 * placeholder (shape by catalogue family + the code).
 */
import type { SignCategorySchema } from '@/content/schema';
import type { z } from 'zod';
import { baseUrl, el } from './dom';
import { BRIEFING } from './strings.he';

export type SignCategory = z.infer<typeof SignCategorySchema>;

/** Israeli catalogue families by leading digit. */
export function signCategoryFromCode(code: string): SignCategory {
  switch (code.trim()[0]) {
    case '1':
      return 'warning';
    case '2':
      return 'mandatory';
    case '3':
      return 'priority';
    case '4':
      return 'prohibition';
    case '5':
      return 'public_transport';
    case '6':
      return 'information';
    case '7':
      return 'signals';
    case '8':
      return 'markings';
    case '9':
      return 'work_zone';
    default:
      return 'information';
  }
}

export function signSrc(code: string, svgName?: string): string {
  return `${baseUrl()}signs/${svgName ?? code + '.svg'}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Drawn placeholder: shape + code (used when the SVG file is missing). */
export function signPlaceholder(code: string, category: SignCategory = signCategoryFromCode(code)): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', `sign-ph sign-ph-${category}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', BRIEFING.signAlt(code));
  const text = (fill: string, y = 58, size = 24) => `<text x="50" y="${y}" text-anchor="middle" font-family="Rubik, Heebo, sans-serif" font-weight="700" font-size="${size}" fill="${fill}">${code}</text>`;
  let body: string;
  if (code === '302') {
    body = `<path d="M30 4h40l26 26v40L70 96H30L4 70V30z" fill="#d7261e" stroke="#fff" stroke-width="4"/>${text('#fff', 59, 22)}`;
  } else if (code === '402') {
    body = `<circle cx="50" cy="50" r="46" fill="#d7261e" stroke="#fff" stroke-width="3"/><rect x="18" y="42" width="64" height="16" rx="2" fill="#fff"/>${text('#fff', 84, 14)}`;
  } else {
    switch (category) {
      case 'warning':
        body = `<path d="M50 6L96 90H4z" fill="#fff" stroke="#d7261e" stroke-width="9" stroke-linejoin="round"/>${text('#111', 78, 20)}`;
        break;
      case 'mandatory':
        body = `<circle cx="50" cy="50" r="46" fill="#1d4ed8" stroke="#fff" stroke-width="3"/>${text('#fff')}`;
        break;
      case 'priority':
        body = `<path d="M4 10h92L50 94z" fill="#fff" stroke="#d7261e" stroke-width="9" stroke-linejoin="round"/>${text('#111', 46, 20)}`;
        break;
      case 'prohibition':
        body = `<circle cx="50" cy="50" r="46" fill="#fff" stroke="#d7261e" stroke-width="9"/>${text('#111')}`;
        break;
      case 'public_transport':
        body = `<rect x="6" y="6" width="88" height="88" rx="8" fill="#1d4ed8" stroke="#fff" stroke-width="3"/>${text('#fff')}`;
        break;
      case 'information':
        body = `<rect x="6" y="6" width="88" height="88" rx="8" fill="#1d4ed8" stroke="#fff" stroke-width="3"/><rect x="18" y="18" width="64" height="64" rx="4" fill="#fff"/>${text('#1d4ed8')}`;
        break;
      case 'signals':
        body = `<rect x="28" y="4" width="44" height="92" rx="10" fill="#111" stroke="#555" stroke-width="2"/><circle cx="50" cy="22" r="11" fill="#ef4444"/><circle cx="50" cy="50" r="11" fill="#f59e0b"/><circle cx="50" cy="78" r="11" fill="#22c55e"/>`;
        break;
      case 'markings':
        body = `<rect x="4" y="4" width="92" height="92" rx="8" fill="#374151"/><path d="M50 10v80" stroke="#fff" stroke-width="6" stroke-dasharray="14 10"/>${text('#fff', 90, 14)}`;
        break;
      case 'work_zone':
        body = `<path d="M50 4l46 46-46 46L4 50z" fill="#f97316" stroke="#fff" stroke-width="3"/>${text('#111')}`;
        break;
      default:
        body = `<rect x="6" y="6" width="88" height="88" rx="8" fill="#334155"/>${text('#fff')}`;
    }
  }
  svg.innerHTML = body;
  return svg;
}

export interface SignImageOptions {
  size?: number;
  alt?: string;
  /** Explicit file name under /signs/ (defaults to `${code}.svg`). */
  svgName?: string;
  title?: string;
}

/** `.sign` element with the catalogue image and a drawn fallback. */
export function signImage(code: string, opts: SignImageOptions = {}): HTMLElement {
  const wrap = el('span', { class: 'sign', attrs: { 'data-code': code, title: opts.title } });
  if (opts.size) {
    wrap.style.width = `${opts.size}px`;
    wrap.style.height = `${opts.size}px`;
  }
  const img = el('img', { attrs: { src: signSrc(code, opts.svgName), alt: opts.alt ?? BRIEFING.signAlt(code), loading: 'lazy', decoding: 'async' } });
  img.addEventListener('error', () => {
    if (!img.isConnected && !wrap.contains(img)) return;
    wrap.replaceChildren(signPlaceholder(code));
    wrap.classList.add('fallback');
  });
  wrap.appendChild(img);
  return wrap;
}
