/** Hebrew labels for the vehicle module (key-map help overlay, gamepad descriptions). */
import type { InputAction } from './keymap';

export const ACTION_LABELS_HE: Record<InputAction, string> = {
  throttle: 'גז',
  brake: 'בלם',
  steer_left: 'הגה שמאלה',
  steer_right: 'הגה ימינה',
  handbrake: 'בלם יד (הפעלה/שחרור)',
  gear_P: 'הילוך P — חניה',
  gear_R: 'הילוך R — אחורה',
  gear_N: 'הילוך N — ניוטרל',
  gear_D: 'הילוך D — נסיעה',
  gear_up: 'ידית הילוכים למעלה (P-R-N-D)',
  gear_down: 'ידית הילוכים למטה (P-R-N-D)',
  indicator_left: 'איתות שמאלה',
  indicator_right: 'איתות ימינה',
  hazard: 'מהבהבי חירום',
  lights: 'אורות (כבוי / חניה / נמוך / גבוה)',
  wipers: 'מגבים',
  horn: 'צופר (החזקה)',
  ignition: 'התנעה / כיבוי מנוע',
  seatbelt: 'חגורת בטיחות',
  glance_left_mirror: 'מבט במראה שמאלית',
  glance_rear_mirror: 'מבט במראה הפנימית',
  glance_right_mirror: 'מבט במראה ימנית',
  shoulder_left: 'מבט מעבר לכתף שמאל',
  shoulder_right: 'מבט מעבר לכתף ימין',
  free_look: 'מבט חופשי (גרירת עכבר / לחצן ימני)',
  acknowledge: 'אישור / המשך',
  pause: 'השהיה / תפריט',
  help: 'עזרה — מקשים',
  chase_camera: 'מצלמה חיצונית / פנימית',
};

export const GROUP_LABELS_HE: Record<string, string> = {
  driving: 'נהיגה',
  gear: 'ידית הילוכים',
  signals: 'איתות',
  lights: 'אורות ומגבים',
  look: 'מראות ומבט',
  system: 'מערכת',
};

export const KEY_LABELS_HE: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'רווח',
  Enter: 'Enter',
  Escape: 'Esc',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  MouseDrag: 'גרירת עכבר',
};

export const GAMEPAD_LABELS_HE = {
  gamepad: 'שלט משחק',
  wheel: 'הגה משחק',
  notConnected: 'לא מחובר',
  axes: 'צירים',
  buttons: 'כפתורים',
  pedalsInverted: 'דוושות הפוכות (זוהה אוטומטית)',
};
