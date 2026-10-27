/**
 * All Hebrew UI copy lives here (never inline in logic). Keep HUD strings short.
 */
import type { CoachPresence, ToastKind } from './types';

export const APP_TITLE = 'סימולטור נהיגה — צפון תל אביב';
export const APP_SUBTITLE = 'לימוד נהיגה ותיאוריה לרישיון B (אוטומט) — אזור הטסטים של צפון תל אביב';

export const INSTRUCTOR_NAME = 'יוסי';

export const SPEAKER: Record<'instructor' | 'examiner' | 'system', string> = {
  instructor: 'מורה נהיגה',
  examiner: 'בוחן',
  system: 'מערכת',
};

export const PRESENCE: Record<CoachPresence, string> = {
  instructor: `מורה נהיגה — ${INSTRUCTOR_NAME}`,
  examiner: 'בוחן',
  none: 'נהיגה חופשית',
};

export const HUD = {
  kmh: 'קמ״ש',
  speedAria: 'מהירות',
  speedLimitAria: (v: number) => `מהירות מותרת ${v} קמ״ש`,
  gearAria: (g: string) => `הילוך ${g}`,
  gears: 'הילוך',
  rpm: 'סל״ד',
  seatbelt: 'חגורה!',
  handbrake: 'בלם חניה',
  indicatorLeft: 'איתות שמאלה',
  indicatorRight: 'איתות ימינה',
  hazard: 'איתות חירום',
  lights: { off: 'אורות כבויים', parking: 'אורות חניה', low: 'אור נמוך', high: 'אור גבוה' } as Record<string, string>,
  mirrors: { left: 'מראה שמאלית', rear: 'מראה פנימית', right: 'מראה ימנית' },
  paused: 'מושהה',
  step: (i: number, n: number) => `שלב ${i}/${n}`,
  lawMonitor: 'מוניטור חוקים',
  minimap: 'מפה',
  north: 'צ',
  scale: (m: number) => `${m} מ׳`,
  speedLimitPulse: 'המהירות המותרת השתנתה',
};

export const NAV = {
  now: 'עכשיו',
  inDistance: (d: string) => `בעוד ${d}`,
  metres: (n: number) => `${n} מ׳`,
  km: (s: string) => `${s} ק״מ`,
  kinds: {
    turn_right: 'פנה ימינה',
    turn_left: 'פנה שמאלה',
    straight: 'המשך ישר',
    slight_right: 'סטה קלות ימינה',
    slight_left: 'סטה קלות שמאלה',
    sharp_right: 'פנה חד ימינה',
    sharp_left: 'פנה חד שמאלה',
    roundabout_exit: 'בכיכר',
    stop_here: 'עצור כאן',
    park: 'חנה',
    uturn: 'פניית פרסה',
    pull_over: 'עצור בצד',
    reverse: 'נסיעה לאחור',
    lane_change_left: 'עבור לנתיב השמאלי',
    lane_change_right: 'עבור לנתיב הימני',
    destination: 'הגעת ליעד',
  } as Record<string, string>,
  exitNumber: (n: number) => `יציאה ${n}`,
};

export const MANEUVER: Record<string, string> = {
  parallel_park: 'חניה מקבילה',
  pull_over: 'עצירה בצד הדרך',
  reverse: 'נסיעה לאחור בקו ישר',
  uturn: 'פניית פרסה',
  emergency_stop: 'עצירת חירום',
  hill_start: 'זינוק בעלייה',
};
export const MANEUVER_STATUS: Record<string, string> = { requested: 'תמרון', completed: 'בוצע', failed: 'נכשל' };

export const SUBTITLES = {
  hintPrompt: 'לחץ ? להסבר',
};

export const TOAST_KIND_LABEL: Record<ToastKind, string> = { info: 'הודעה', ok: 'מצוין', warn: 'שים לב', danger: 'אזהרה' };

export const INTERVENTION = {
  examiner: { brake: 'הבוחן בלם!', wheel: 'הבוחן תפס את ההגה!' },
  instructor: { brake: 'המורה בלם!', wheel: 'המורה תפס את ההגה!' },
};

export const COLLISION = 'פגיעה!';

export const COMMON = {
  back: 'חזרה',
  close: 'סגור',
  cancel: 'ביטול',
  next: 'הבא',
  prev: 'הקודם',
  start: 'התחל',
  continue: 'המשך',
  menu: 'תפריט ראשי',
  again: 'שוב',
  on: 'פועל',
  off: 'כבוי',
  minutes: (m: number) => `${m} דק׳`,
  help: 'עזרה',
  settings: 'הגדרות',
  loading: 'טוען…',
  points: 'נקודות',
  score: 'ציון',
  locked: 'נעול',
  completed: 'הושלם',
  available: 'זמין',
  none: '—',
};

export const MENU = {
  title: APP_TITLE,
  subtitle: APP_SUBTITLE,
  items: {
    lessons: { title: 'שיעורי נהיגה', text: 'למידה מודרכת עם מורה נהיגה וירטואלי, שלב אחרי שלב' },
    free: { title: 'נהיגה חופשית', text: 'סיבוב חופשי ברחובות צפון תל אביב, עם או בלי מורה' },
    test: { title: 'טסט', text: 'מבחן נהיגה מעשי עם בוחן — בדיוק כמו במציאות' },
    theory: { title: 'תיאוריה', text: 'שאלות מהמאגר הרשמי, תרגול ומבחן מדומה' },
    training: { title: 'מגרש אימונים', text: 'סביבה קטנה ושקטה לתרגול תמרונים וחניה' },
    settings: { title: 'הגדרות', text: 'שמע, בקרה, איכות גרפיקה ונגישות' },
  },
  footer: 'F1 — עזרה ומקשים · Esc — השהיה',
  version: (v: string) => `גרסה ${v}`,
};

export const LESSONS = {
  title: 'שיעורי נהיגה',
  subtitle: 'השיעורים נפתחים בהדרגה. אפשר לחזור על כל שיעור שהושלם.',
  resume: 'המשך מאיפה שעצרת',
  resumeCta: 'המשך שיעור',
  lesson: (n: number) => `שיעור ${n}`,
  locked: 'נעול — השלם את השיעורים הקודמים',
  completed: 'הושלם',
  available: 'זמין',
  start: 'התחל שיעור',
  repeat: 'חזור על השיעור',
  score: (s: number) => `ציון ${s}`,
  empty: 'אין שיעורים זמינים.',
};

export const BRIEFING = {
  title: 'תדריך לפני השיעור',
  slide: (i: number, n: number) => `${i} / ${n}`,
  start: 'יוצאים לדרך',
  signsLabel: 'תמרורים בשיעור',
  signAlt: (code: string) => `תמרור ${code}`,
};

export const DEBRIEF = {
  title: 'סיכום השיעור',
  passed: 'השיעור הושלם בהצלחה',
  failed: 'השיעור לא הושלם — כדאי לנסות שוב',
  score: 'ציון',
  minor: 'קלות',
  major: 'חמורות',
  critical: 'קריטיות',
  errorsTitle: 'הטעויות העיקריות',
  noErrors: 'ללא טעויות — נהיגה למופת!',
  times: (n: number) => `×${n}`,
  again: 'תרגל שוב',
  next: 'לשיעור הבא',
  menu: 'תפריט',
  violationsLabel: 'עבירות',
};

export const FREE = {
  title: 'נהיגה חופשית',
  subtitle: 'בחר נקודת התחלה ותנאים. חוקי התנועה חלים גם כאן.',
  spawn: 'נקודת התחלה',
  traffic: 'צפיפות תנועה',
  pedestrians: 'הולכי רגל',
  hour: 'שעה ביום',
  weather: 'מזג אוויר',
  weatherOptions: { clear: 'בהיר', rain: 'גשם', fog: 'ערפל' } as Record<string, string>,
  coach: 'מורה ברכב',
  coachHint: 'המורה מעיר, מסביר ומנווט — "שיעור נהיגה" בלי תסריט',
  lawMonitor: 'מוניטור חוקים',
  lawMonitorHint: 'מציג עבירות ושבחים על המסך תוך כדי נהיגה',
  start: 'התחל נסיעה',
  levels: ['ללא', 'מעט', 'בינוני', 'רב', 'עמוס'],
};

export const TEST_INTRO = {
  title: 'מבחן נהיגה מעשי — הוראות',
  intro: 'ברוך הבא למבחן הנהיגה המעשי (טסט). בוחן וירטואלי יישב לידך וייתן הוראות ניווט ותמרונים. נהג כפי שלמדת: בביטחון, לפי חוקי התנועה ובלי להסס.',
  sections: [
    {
      title: 'כיצד מתנהל המבחן',
      bullets: [
        'משך המבחן כ-20–30 דקות של נהיגה ברחובות צפון תל אביב.',
        'הבוחן מכריז את ההוראה מראש: "בצומת הבא פנה ימינה", "המשך ישר", "עצור בצד". אם לא שמעת — אפשר לבקש לחזור על ההוראה.',
        'לפני היציאה לדרך: חגורה חגורה, מראות מכוונות, בלם חניה משוחרר, הילוך D.',
        'בכל שלב נהג לפי התמרורים, הרמזורים והסימון על הכביש — גם אם ההוראה לא ציינה זאת.',
      ],
    },
    {
      title: 'התמרונים הנדרשים',
      bullets: [
        'חניה מקבילה בין שני רכבים (עד 40 ס״מ מאבן השפה, מקביל למדרכה).',
        'עצירה בצד הדרך וחזרה לנתיב — עם איתות, מראות ובדיקת נקודה מתה.',
        'נסיעה לאחור בקו ישר, פניית פרסה במקום מותר, ועצירת חירום.',
      ],
    },
    {
      title: 'מתי נכשלים',
      bullets: [
        'עבירה קריטית אחת: נסיעה באור אדום, אי-מתן זכות קדימה, סיכון הולך רגל, נסיעה נגד הכיוון, תאונה, נסיעה ללא חגורה.',
        'התערבות הבוחן — בלימה או אחיזה בהגה — פירושה כישלון מיידי.',
        'יותר משתי עבירות חמורות, או צבירת 12 נקודות של עבירות קלות וחמורות.',
      ],
    },
  ],
  route: 'מסלול המבחן',
  randomRoute: 'מסלול אקראי (כמו בטסט אמיתי)',
  start: 'התחל מבחן',
  back: 'חזרה',
};

export const TEST_RESULT = {
  title: 'תעודת תוצאות — מבחן נהיגה מעשי',
  authority: 'סימולטור נהיגה · בוחן וירטואלי (לא מסמך רשמי)',
  passed: 'עבר',
  failed: 'נכשל',
  date: 'תאריך',
  time: 'שעה',
  route: 'מסלול',
  duration: 'משך',
  points: 'נקודות',
  examiner: 'בוחן',
  pointsOf: (p: number, max: number) => `${p} / ${max}`,
  violations: 'עבירות והערות',
  noViolations: 'לא נרשמו עבירות.',
  colTime: 'זמן',
  colPlace: 'מקום',
  colLabel: 'תיאור',
  colSeverity: 'חומרה',
  maneuvers: 'תמרונים',
  colManeuver: 'תמרון',
  colStatus: 'תוצאה',
  noManeuvers: 'לא נדרשו תמרונים.',
  summary: 'סיכום הבוחן',
  newTest: 'מבחן חדש',
  replay: 'צפה בשחזור',
  menu: 'תפריט ראשי',
  maneuverStatus: { requested: 'לא הושלם', completed: 'בוצע', failed: 'נכשל', skipped: 'לא נדרש' } as Record<string, string>,
  note: 'מסמך זה מופק על ידי סימולטור ואינו תעודה רשמית.',
};

export const THEORY = {
  title: 'תיאוריה',
  practice: 'תרגול',
  exam: 'מבחן מדומה',
  question: (i: number, n: number) => `שאלה ${i}/${n}`,
  correct: 'תשובה נכונה',
  wrong: 'תשובה שגויה',
  correctIs: 'התשובה הנכונה מסומנת בירוק',
  next: 'לשאלה הבאה',
  finish: 'סיים',
  keysHint: 'מקשים 1–4 לבחירה · Enter להמשך',
  resultsTitle: 'תוצאות',
  passed: 'עברת!',
  failed: 'לא עברת הפעם',
  scoreLine: (c: number, n: number) => `${c} תשובות נכונות מתוך ${n}`,
  passMark: (m: number, n: number) => `ציון עובר: ${m} מתוך ${n}`,
  byTopic: 'פירוט לפי נושא',
  timeLeft: 'זמן שנותר',
  timeUp: 'הזמן נגמר',
  again: 'תרגול נוסף',
  close: 'סגור',
  imageAlt: 'תמונת השאלה',
  explanation: 'הסבר',
  skipped: 'לא נענתה',
  inDriveTitle: 'שאלה מהמורה',
  inDriveHint: 'בחר תשובה (1–4)',
  untagged: 'כללי',
};

/** Hebrew labels for machine topic tags used by questions / lessons. */
export const TOPIC_LABELS: Record<string, string> = {
  priority: 'זכות קדימה',
  roundabout: 'כיכרות',
  parking: 'חניה',
  speed: 'מהירות',
  signals: 'רמזורים',
  signs: 'תמרורים',
  distance: 'מרחק עקיבה',
  pedestrians: 'הולכי רגל',
  overtaking: 'עקיפה',
  lanes: 'נתיבים',
  lights: 'תאורה',
  safety: 'בטיחות',
  mirrors: 'מראות',
  signalling: 'איתות',
  weather: 'מזג אוויר',
  highway: 'דרך מהירה',
  alcohol: 'אלכוהול וסמים',
  vehicle: 'הרכב',
  first_aid: 'עזרה ראשונה',
  turns: 'פניות',
  stopping: 'עצירה',
  markings: 'סימוני כביש',
  junctions: 'צמתים',
  seatbelt: 'חגורת בטיחות',
  emergency: 'מצבי חירום',
  bus_lane: 'נת״צ',
  one_way: 'חד-סטרי',
};

export const SIGNS = {
  title: 'ספריית תמרורים',
  search: 'חיפוש לפי מספר או שם',
  all: 'הכול',
  categories: {
    warning: 'אזהרה',
    mandatory: 'הוריה',
    priority: 'זכות קדימה',
    prohibition: 'איסור',
    public_transport: 'תחבורה ציבורית',
    information: 'מודיעין',
    signals: 'רמזורים',
    markings: 'סימוני כביש',
    work_zone: 'אתרי עבודה',
  } as Record<string, string>,
  meaning: 'משמעות',
  action: 'מה עושים',
  code: (c: string) => `תמרור ${c}`,
  empty: 'לא נמצאו תמרורים.',
  pick: 'בחר תמרור מהרשימה כדי לראות פרטים',
  count: (n: number) => `${n} תמרורים`,
};

export const SETTINGS = {
  title: 'הגדרות',
  audio: 'שמע',
  volume: 'עוצמת שמע',
  tts: 'הקראת המורה (TTS)',
  voice: 'קול',
  voiceDefault: 'ברירת מחדל של הדפדפן',
  subtitles: 'כתוביות',
  driving: 'נהיגה',
  steeringAssist: 'עזרת היגוי (מקלדת)',
  steeringHint: '0 = היגוי ישיר, 100 = החלקה חזקה',
  mirrors: 'מראות',
  mirrorsHint: 'ביטול המראות משפר ביצועים',
  display: 'תצוגה',
  quality: 'איכות גרפיקה',
  qualityOptions: { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' } as Record<string, string>,
  lawMonitor: 'מוניטור חוקים על המסך',
  minimapHeadingUp: 'מפה מסתובבת עם כיוון הנסיעה',
  hintPrompt: 'הצג "לחץ ? להסבר" בשיעורים',
  controls: 'בקרה',
  scheme: 'אמצעי בקרה',
  schemeOptions: { keyboard: 'מקלדת', gamepad: 'בקר משחק', wheel: 'הגה' } as Record<string, string>,
  gamepad: 'מצב בקר',
  reset: 'איפוס לברירת מחדל',
  close: 'סגור',
  autoDetect: 'זיהוי אוטומטי — חבר בקר או הגה והוא יזוהה',
};

export const HELP = {
  title: 'עזרה — מקשים ובקרה',
  keyboard: 'מקלדת',
  gamepad: 'בקר משחק',
  wheel: 'הגה',
  colKeys: 'מקש',
  colAction: 'פעולה',
  close: 'סגור (F1 / Esc)',
  defaultKeymap: [
    { keys: ['↑', 'W'], action: 'גז' },
    { keys: ['↓', 'S'], action: 'בלם' },
    { keys: ['←', '→', 'A', 'D'], action: 'היגוי' },
    { keys: ['רווח'], action: 'בלם חניה' },
    { keys: ['Q'], action: 'איתות שמאלה' },
    { keys: ['E'], action: 'איתות ימינה' },
    { keys: ['Z'], action: 'איתות חירום' },
    { keys: ['Shift + ↑/↓'], action: 'החלפת הילוך (P R N D)' },
    { keys: ['B'], action: 'חגורת בטיחות' },
    { keys: ['L'], action: 'אורות' },
    { keys: ['1', '2', '3'], action: 'מבט במראה שמאלית / פנימית / ימנית' },
    { keys: ['4', '5'], action: 'מבט מעבר לכתף שמאל / ימין' },
    { keys: ['H'], action: 'צופר' },
    { keys: ['?'], action: 'בקש הסבר מהמורה' },
    { keys: ['R'], action: 'חזור על ההוראה האחרונה' },
    { keys: ['Esc'], action: 'השהיה / תפריט' },
    { keys: ['F1'], action: 'עזרה' },
  ],
  defaultGamepadNotes: ['מקל שמאלי — היגוי · R2 גז · L2 בלם', 'כפתורי הכתף — איתותים · X חגורה · Y אורות', 'מקל ימני — מבט במראות ומעבר לכתף'],
  defaultWheelNotes: ['הגה עם דוושות מזוהה אוטומטית (כולל משוב כוח אם נתמך)', 'ידיות האיתות שליד ההגה — איתות; כפתורי ההגה — הילוכים'],
};

export const PAUSE = {
  title: 'מושהה',
  resume: 'המשך נהיגה',
  restart: 'התחל מחדש',
  settings: 'הגדרות',
  help: 'עזרה',
  menu: 'תפריט ראשי',
};

export const LOADING = {
  title: APP_TITLE,
  loading: 'טוען…',
  tipLabel: 'ידעת?',
  tips: [
    'בכיכר, מי שבפנים — קודם: נותנים זכות קדימה לרכב שכבר נמצא בכיכר.',
    'בתמרור עצור חייבים לעצור עצירה מוחלטת לפני קו העצירה — גם כשהדרך נראית פנויה.',
    'אור ירוק מהבהב מזהיר שהאור עומד להתחלף לצהוב. התכוננו לעצור.',
    'מרחק עקיבה: לפחות 2 שניות מהרכב שלפניך, ו-3 שניות בגשם.',
    'הולך רגל שמתכוון לחצות במעבר חצייה — עוצרים ומאפשרים לו לחצות.',
    'אסור לחנות במרחק של פחות מ-12 מטרים מצומת.',
    'אבן שפה אדומה-לבנה: אסור לעצור ולחנות. אדומה-צהובה: תחנת אוטובוס.',
    'בצומת ללא תמרורים — זכות קדימה לרכב הבא מימין.',
    'לפני כל פנייה, החלפת נתיב ויציאה מחניה: מאותתים, בודקים מראות ונקודה מתה.',
    'פונים שמאלה? נותנים זכות קדימה לרכב שבא ממול וממשיך ישר או פונה ימינה.',
    'המהירות המרבית בדרך עירונית היא 50 קמ״ש, אלא אם סומן אחרת.',
    'הנתיב הצהוב מיועד לתחבורה ציבורית בלבד.',
    'חוגרים חגורת בטיחות לפני שמתחילים לנסוע — תמיד, גם בנסיעה קצרה.',
    'בטסט, התערבות של הבוחן — בלימה או אחיזה בהגה — פירושה כישלון מיידי.',
    'אור צהוב פירושו עצור — אלא אם אי אפשר לעצור בבטחה.',
  ],
};

export const SEVERITY_LABEL: Record<string, string> = { info: 'הערה', minor: 'קלה', major: 'חמורה', critical: 'קריטית' };

export const SIGN_SHAPE_LABEL: Record<string, string> = {
  warning: 'אזהרה',
  mandatory: 'הוריה',
  priority: 'זכות קדימה',
  prohibition: 'איסור',
  public_transport: 'תח״צ',
  information: 'מודיעין',
  signals: 'רמזור',
  markings: 'סימון',
  work_zone: 'עבודות',
};
