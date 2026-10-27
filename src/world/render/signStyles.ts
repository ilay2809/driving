/**
 * Procedural sign faces by Israeli catalogue number — the fallback used when
 * /signs/<code>.svg is not available. Pure (no canvas) so it can be unit-tested.
 *
 * Catalogue families: 1xx warning (red-bordered triangle), 2xx instruction (blue disc),
 * 3xx priority (301 give way, 302 stop, 303 roundabout), 4xx prohibition (red ring),
 * 5xx public transport, 6xx information (blue), 7xx signals, 8xx road markings, 9xx works.
 */
import { SIGN_TEXT } from './strings.he';

export type PlateShape = 'octagon' | 'triangle' | 'triangle_down' | 'circle' | 'square' | 'rect' | 'diamond';
export type PlateSymbol = 'bar' | 'arrow_up' | 'x' | 'slash' | 'pedestrian' | 'bump' | 'roundabout' | 'bus';

export interface SignStyle {
  shape: PlateShape;
  fill: string;
  border: string;
  /** Border width as a fraction of the plate size. */
  borderWidth: number;
  text: string;
  textColour: string;
  symbol?: PlateSymbol;
}

const RED = '#d22b22';
const BLUE = '#1f57b5';
const WHITE = '#ffffff';
const BLACK = '#111111';
const ORANGE = '#f28c1e';

export function signCellKey(code: string, value?: number | string): string {
  return value === undefined || value === '' ? `sign:${code}` : `sign:${code}:${value}`;
}

export function signStyle(code: string, value?: number | string): SignStyle {
  const v = value === undefined ? '' : String(value);
  const family = code.charAt(0);
  switch (code) {
    case '301':
      return { shape: 'triangle_down', fill: WHITE, border: RED, borderWidth: 0.1, text: '', textColour: BLACK };
    case '302':
      return { shape: 'octagon', fill: RED, border: WHITE, borderWidth: 0.04, text: SIGN_TEXT.stop, textColour: WHITE };
    case '303':
      return { shape: 'circle', fill: BLUE, border: WHITE, borderWidth: 0.03, text: '', textColour: WHITE, symbol: 'roundabout' };
    case '402':
      return { shape: 'circle', fill: RED, border: RED, borderWidth: 0.03, text: '', textColour: WHITE, symbol: 'bar' };
    case '432':
      return { shape: 'circle', fill: BLUE, border: RED, borderWidth: 0.1, text: '', textColour: WHITE, symbol: 'slash' };
    case '433':
      return { shape: 'circle', fill: BLUE, border: RED, borderWidth: 0.1, text: '', textColour: WHITE, symbol: 'x' };
    case '135':
      return { shape: 'triangle', fill: WHITE, border: RED, borderWidth: 0.1, text: '', textColour: BLACK, symbol: 'pedestrian' };
    case '144':
      return { shape: 'triangle', fill: WHITE, border: RED, borderWidth: 0.1, text: '', textColour: BLACK, symbol: 'bump' };
    case '618':
      return { shape: 'rect', fill: BLUE, border: WHITE, borderWidth: 0.03, text: '', textColour: WHITE, symbol: 'arrow_up' };
    case '501':
    case '613':
      return { shape: 'square', fill: BLUE, border: WHITE, borderWidth: 0.03, text: SIGN_TEXT.busLane, textColour: WHITE, symbol: 'bus' };
    default:
      break;
  }
  switch (family) {
    case '1':
      return { shape: 'triangle', fill: WHITE, border: RED, borderWidth: 0.1, text: v || code, textColour: BLACK };
    case '2':
      return { shape: 'circle', fill: BLUE, border: WHITE, borderWidth: 0.03, text: v || code, textColour: WHITE };
    case '3':
      return { shape: 'triangle', fill: WHITE, border: RED, borderWidth: 0.1, text: v || code, textColour: BLACK };
    case '4':
      return { shape: 'circle', fill: WHITE, border: RED, borderWidth: 0.1, text: v || code, textColour: BLACK };
    case '5':
    case '6':
      return { shape: 'square', fill: BLUE, border: WHITE, borderWidth: 0.03, text: v || code, textColour: WHITE };
    case '7':
      return { shape: 'square', fill: BLACK, border: WHITE, borderWidth: 0.03, text: v || code, textColour: WHITE };
    case '8':
      return { shape: 'rect', fill: WHITE, border: BLACK, borderWidth: 0.03, text: v || code, textColour: BLACK };
    case '9':
      return { shape: 'diamond', fill: ORANGE, border: BLACK, borderWidth: 0.04, text: v || code, textColour: BLACK };
    default:
      return { shape: 'circle', fill: WHITE, border: BLACK, borderWidth: 0.05, text: v || code, textColour: BLACK };
  }
}
