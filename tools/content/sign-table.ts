/**
 * The sign catalogue used by the simulator: the signs a class-B driver meets in North
 * Tel Aviv, plus the ones the theory exam asks about. Numbers, names and meanings were
 * verified against the official board (לוח התמרורים — הודעת התעבורה (קביעת תמרורים),
 * התשע"א-2010, נוסח משולב ספטמבר 2020, משרד התחבורה). Wording of `meaning` paraphrases
 * the official "פירושו" column; `action` is the instructor's practical advice.
 *
 * Non-official code: "703f" (flashing green) — officially part of 703; the simulator needs
 * a separate picture for it (see docs/CONTENT_NOTES.md).
 */
import type { SignDef } from '../../src/content/schema';
import {
  C,
  accident,
  adultChild,
  arrow,
  arrowShort,
  bentArrow,
  bicycle,
  bothDiagonals,
  bump,
  busStopPlate,
  carSide,
  contraflow,
  crossroads,
  curve,
  dashedLine,
  deadEnd,
  diagonalArrow,
  diamond,
  disc,
  exclaim,
  giveWay,
  hand,
  hatched,
  kerb,
  lamp,
  laneArrows613,
  laneControl,
  laneDrop,
  learner,
  leftOrRight,
  livingStreet,
  mandatory,
  marking,
  narrowRoad,
  narrowing,
  number,
  octagon,
  octagonSmall,
  parkingGlyph,
  place,
  publicTransport,
  railLamp,
  roundaboutArrows,
  sideRoad,
  slippery,
  solidLine,
  square,
  straightOrTurn,
  straightOrUturn,
  taxiRank,
  tee,
  town,
  trafficLight,
  twoCars,
  twoLamp,
  twoWay,
  uturn,
  warning,
  wheelchair,
  worker,
  yellowDiamonds,
  yellowPlate,
  zebra,
  zebraPed,
} from './sign-primitives';

export interface SignSpec extends Omit<SignDef, 'svg' | 'hasValue' | 'topics'> {
  hasValue?: boolean;
  topics?: string[];
  /** Returns the SVG body (inside the 120×120 document). */
  draw: () => string;
}

const B = C.black;
const W = C.white;

const warn = (code: string, name: string, meaning: string, action: string, pict: () => string, topics: string[] = []): SignSpec => ({
  code,
  name,
  category: 'warning',
  meaning,
  action,
  shape: 'triangle',
  topics,
  draw: () => warning(pict()),
});

const must = (code: string, name: string, meaning: string, action: string, pict: () => string, topics: string[] = []): SignSpec => ({
  code,
  name,
  category: 'mandatory',
  meaning,
  action,
  shape: 'circle',
  topics,
  draw: () => mandatory(pict()),
});

const light = (code: string, name: string, meaning: string, action: string, draw: () => string, topics: string[] = ['signals']): SignSpec => ({
  code,
  name,
  category: 'signals',
  meaning,
  action,
  shape: 'light',
  topics,
  draw,
});

const mark = (code: string, name: string, meaning: string, action: string, draw: () => string, topics: string[] = ['markings'], category: SignDef['category'] = 'markings'): SignSpec => ({
  code,
  name,
  category,
  meaning,
  action,
  shape: 'marking',
  topics,
  draw,
});

const thinEnd = { ring: C.black, ringWidth: 2, bar: 'end' as const };

export const SIGN_TABLE: SignSpec[] = [
  // ───────── אזהרה והתראה (101–152) ─────────
  warn('102', 'עקומה חדה ימינה', 'עקומה חדה ימינה בדרך שלפניך.', 'האט לפני העקומה, אל תבלום בתוכה והישאר במרכז הנתיב.', () => curve(B, 'right'), ['speed']),
  warn('103', 'עקומה חדה שמאלה', 'עקומה חדה שמאלה בדרך שלפניך.', 'האט לפני העקומה, אל תבלום בתוכה ואל תחתוך לנתיב הנגדי.', () => curve(B, 'left'), ['speed']),
  warn('109', 'הכביש הולך וצר', 'הכביש הולך וצר משני צדדיו בדרך שלפניך.', 'האט, הישאר בימין והיה מוכן לתת זכות קדימה לרכב ממול.', () => narrowing(B, 'both'), ['lanes']),
  warn('110', 'הכביש הולך וצר מצד ימין', 'הכביש הולך וצר מצד ימין בדרך שלפניך.', 'האט ושים לב שהנתיב הימני מצטמצם — אל תיצמד לאבן השפה.', () => narrowing(B, 'right'), ['lanes']),
  warn('111', 'הכביש הולך וצר מצד שמאל', 'הכביש הולך וצר מצד שמאל בדרך שלפניך.', 'האט והיערך להתמזגות מצד שמאל.', () => narrowing(B, 'left'), ['lanes']),
  warn('114', 'צומת הצטלבות', 'צומת הצטלבות בדרך שלפניך.', 'האט, הבט ימינה ושמאלה ותן זכות קדימה לפי כללי הצומת — ללא תמרור, לבא מימין.', () => crossroads(B), ['priority']),
  warn('115', 'צומת קמץ — דרך מימין', 'דרך מצטרפת מימין בצומת שלפניך.', 'האט ושים לב לרכב שעשוי להיכנס מימין; ללא תמרור הוא בעל זכות הקדימה.', () => sideRoad(B, 'right'), ['priority']),
  warn('116', 'צומת קמץ — דרך משמאל', 'דרך מצטרפת משמאל בצומת שלפניך.', 'האט ושים לב לרכב המצטרף משמאל, במיוחד לפונים שמאלה.', () => sideRoad(B, 'left'), ['priority']),
  warn('117', 'צומת קמץ (T)', 'הדרך שלפניך מסתיימת בצומת T.', 'האט, היערך לפנות ימינה או שמאלה ותן זכות קדימה לתנועה בדרך החוצה.', () => tee(B), ['priority']),
  warn('121', 'מעגל תנועה לפניך', 'מעגל תנועה (כיכר) בדרך שלפניך.', 'האט, הבט שמאלה ותן זכות קדימה לרכב שכבר נמצא בכיכר.', () => roundaboutArrows(B), ['roundabout', 'priority']),
  warn('122', 'רמזור לפניך', 'רמזור בדרך שלפניך.', 'האט והתכונן לעצור — הרמזור עלול להתחלף כשתגיע אליו.', () => trafficLight(), ['signals']),
  warn('135', 'מעבר חצייה בקרבת מקום', 'מעבר חצייה להולכי רגל בקרבת מקום.', 'האט, בדוק אם הולכי רגל מתכוונים לחצות והיה מוכן לעצור לפני המעבר.', () => zebraPed(B), ['pedestrians']),
  warn('136', 'הולכי רגל בקרבת מקום', 'הולכי רגל בקרבת מקום (לרוב ליד בתי ספר וגני ילדים).', 'האט במיוחד — ילדים עלולים לרוץ לכביש בלי להסתכל.', () => adultChild(B), ['pedestrians']),
  warn('137', 'תנועת אופניים בקרבת מקום', 'תנועת אופניים בקרבת מקום.', 'האט, שמור מרחק צד של 1.5 מטר לפחות מרוכבי אופניים ובדוק נקודה מתה לפני פנייה ימינה.', () => bicycle(B), ['safety']),
  warn('139', 'תמרור עצור בהמשך הדרך', 'תמרור "עצור" (302) בהמשך הדרך.', 'האט כבר עכשיו והתכונן לעצירה מוחלטת לפני קו העצירה.', () => octagonSmall(B), ['priority']),
  warn('141', 'סכנת החלקה', 'סכנת החלקה בדרך שלפניך.', 'האט, הימנע מבלימות ומתמרוני היגוי חדים; בגשם הגדל את מרחק העקיבה.', () => slippery(B), ['weather', 'speed']),
  warn('144', 'פסי האטה', 'פסי האטה בדרך שלפניך.', 'האט לפני הפס, עבור אותו באיטיות ואל תבלום עליו.', () => bump(B), ['speed']),
  warn('145', 'תנועה דו-סטרית', 'תנועה דו-סטרית בדרך שלפניך (לרוב בסוף קטע חד-סטרי).', 'הישאר בצד הימני של הכביש — תנועה מגיעה ממול.', () => twoWay(B), ['lanes', 'one_way']),
  warn('150', 'מקום מסוכן', 'מקום מסוכן שלגביו לא נקבע תמרור מיוחד.', 'האט והגבר ערנות; לעיתים מוצב מתחתיו שלט הסבר (629).', () => exclaim(B), ['safety']),
  warn('151', 'תאונה', 'תאונה בדרך שלפניך.', 'האט מאוד, היה מוכן לעצור ולציית להוראות השוטרים; אל תעצור כדי להתבונן.', () => accident(B), ['safety', 'emergency']),

  // ───────── הוריה (201–231) ─────────
  must('201', 'סע ישר או ימינה', 'סע ישר או ימינה. פניית פרסה ימינה מותרת אלא אם נאסרה בתמרור אחר.', 'אין לפנות שמאלה בצומת זה; בחר נתיב לפי סימון 813.', () => straightOrTurn(W, 'right'), ['turning']),
  must('202', 'סע ישר או שמאלה', 'סע ישר או שמאלה. פניית פרסה שמאלה מותרת אלא אם נאסרה בתמרור אחר.', 'אין לפנות ימינה בצומת זה.', () => straightOrTurn(W, 'left'), ['turning']),
  must('203', 'סע ישר', 'סע ישר בלבד; פניית פרסה אסורה.', 'אין לפנות ימינה או שמאלה ואין לבצע פניית פרסה.', () => arrow(W), ['turning']),
  must('204', 'פנה ימינה לפני התמרור', 'סע ימינה — פנה לפני התמרור.', 'פנה ימינה בצומת שלפני התמרור.', () => arrow(W, 90), ['turning']),
  must('205', 'פנה שמאלה לפני התמרור', 'סע שמאלה — פנה לפני התמרור.', 'פנה שמאלה בצומת שלפני התמרור, לאחר מתן זכות קדימה לבא ממול.', () => arrow(W, -90), ['turning']),
  must('206', 'פנה ימינה אחרי התמרור', 'סע ימינה — פנה אחרי התמרור.', 'המשך מעט והפנייה ימינה היא מיד אחרי התמרור.', () => bentArrow(W, 'right'), ['turning']),
  must('207', 'פנה שמאלה אחרי התמרור', 'סע שמאלה — פנה אחרי התמרור.', 'המשך מעט והפנייה שמאלה היא מיד אחרי התמרור.', () => bentArrow(W, 'left'), ['turning']),
  must('208', 'סע ימינה או שמאלה', 'סע ימינה או שמאלה; אין להמשיך ישר.', 'בחר כיוון, אותת בזמן והיערך לנתיב המתאים.', () => leftOrRight(W), ['turning']),
  must('209', 'סע ישר או בפניית פרסה ימינה', 'סע ישר או בפניית פרסה ימינה; פניית פרסה שמאלה אסורה.', 'פניית פרסה מותרת רק ימינה, לרוב במחלף או בכביש עם מפרדה.', () => straightOrUturn(W, 'right'), ['turning']),
  must('210', 'סע ישר או בפניית פרסה שמאלה', 'סע ישר או בפניית פרסה שמאלה; פניית פרסה ימינה אסורה.', 'לפניית פרסה שמאלה היערך בנתיב השמאלי ותן זכות קדימה לתנועה ממול.', () => straightOrUturn(W, 'left'), ['turning']),
  must('211', 'סע בפניית פרסה ימינה', 'סע בפניית פרסה ימינה.', 'בצע פניית פרסה ימינה במקום המסומן.', () => uturn(W, 'right'), ['turning']),
  must('212', 'סע בפניית פרסה שמאלה', 'סע בפניית פרסה שמאלה.', 'בצע פניית פרסה שמאלה במקום המסומן, לאחר מתן זכות קדימה.', () => uturn(W, 'left'), ['turning']),
  must('213', 'עבור מימין או משמאל', 'עבור את המקום המסומן מימין או משמאל (חץ צהוב — לתחבורה ציבורית בלבד).', 'עקוף את האי או המכשול מצד ימין או שמאל, לפי הנוח.', () => bothDiagonals(W), ['lanes']),
  must('214', 'עבור מימין', 'עבור את המקום המסומן מצדו הימני.', 'סע מימין לאי התנועה או למכשול.', () => diagonalArrow(W, 'right'), ['lanes']),
  must('215', 'עבור משמאל', 'עבור את המקום המסומן מצדו השמאלי.', 'סע משמאל לאי התנועה או למכשול.', () => diagonalArrow(W, 'left'), ['lanes']),
  { code: '220', name: 'רחוב משולב', category: 'mandatory', meaning: 'רחוב משולב להולכי רגל ולכלי רכב, עד תמרור 221. הולכי הרגל רשאים להשתמש בכל רוחב הדרך.', action: 'סע במהירות הליכה, תן זכות קדימה להולכי רגל ולילדים משחקים, וחנה רק במקומות המסומנים.', shape: 'square', topics: ['pedestrians', 'speed'], draw: () => square(livingStreet(W)) },
  { code: '221', name: 'קצה רחוב משולב', category: 'mandatory', meaning: 'קצה הרחוב המשולב.', action: 'חוזרים לכללי דרך עירונית רגילה; עדיין תן זכות קדימה להולכי רגל.', shape: 'square', topics: ['pedestrians'], draw: () => square(livingStreet(W), { strike: true }) },
  { code: '222', name: 'אזור מיתון תנועה', category: 'mandatory', meaning: 'תחילת אזור מיתון תנועה — המהירות המרבית בו 30 קמ״ש, עד תמרור 223.', action: 'האט ל-30 קמ״ש ושים לב לפסי האטה, להצרות ולהולכי רגל.', shape: 'square', hasValue: true, topics: ['speed'], draw: () => square(`<circle r="40" fill="${W}" stroke="${C.red}" stroke-width="8"/>` + number(B, 30, 42)) },
  { code: '223', name: 'קצה אזור מיתון תנועה', category: 'mandatory', meaning: 'קצה אזור מיתון התנועה.', action: 'מכאן חלה המהירות המרבית הרגילה בדרך עירונית — 50 קמ״ש אלא אם סומן אחרת.', shape: 'square', hasValue: true, topics: ['speed'], draw: () => square(`<circle r="40" fill="${W}" stroke="${C.red}" stroke-width="8"/>` + number(B, 30, 42), { strike: true }) },
  must('226', 'שביל להולכי רגל בלבד', 'שביל להולכי רגל בלבד.', 'אין להיכנס עם רכב.', () => adultChild(W), ['pedestrians']),
  must('227', 'שביל לאופניים', 'שביל לתנועת אופניים.', 'אין לנסוע או לחנות עליו ברכב; חצה אותו בזהירות ותן זכות קדימה לרוכבים.', () => bicycle(W), ['safety']),

  // ───────── זכות קדימה (301–310) ─────────
  { code: '301', name: 'תן זכות קדימה', category: 'priority', meaning: 'תן זכות קדימה לתנועה בדרך החוצה, לרבות מסילה.', action: 'האט, הבט לשני הצדדים ותן לתנועה בדרך החוצה לעבור; עצור אם נדרש. אין חובת עצירה כשהדרך פנויה.', shape: 'inverted_triangle', topics: ['priority'], draw: () => giveWay() },
  { code: '302', name: 'עצור', category: 'priority', meaning: 'עצור! תן זכות קדימה לתנועה בדרך החוצה.', action: 'עצור עצירה מוחלטת לפני קו העצירה (ואם אין קו — לפני הצומת), הבט לכל הכיוונים וצא רק כשהדרך פנויה.', shape: 'octagon', topics: ['priority'], draw: () => octagon(hand(W)) },
  { code: '303', name: 'מעגל תנועה', category: 'priority', meaning: 'מעגל תנועה: תן זכות קדימה לתנועה החוצה את דרכך במעגל התנועה או במסילה; עבור את מעגל התנועה מצדו הימני.', action: 'האט בכניסה, תן זכות קדימה לרכב שכבר בכיכר (משמאלך), סע נגד כיוון השעון ואותת ימינה לפני היציאה.', shape: 'circle', topics: ['roundabout', 'priority'], draw: () => mandatory(roundaboutArrows(W)) },
  { code: '306', name: 'תן זכות קדימה להולכי רגל החוצים', category: 'priority', meaning: 'תן זכות קדימה להולכי הרגל החוצים במעבר החצייה המסומן.', action: 'האט לפני מעבר החצייה ועצור כאשר הולך רגל חוצה או עומד לחצות; אל תעקוף רכב שעצר לפני המעבר.', shape: 'square', topics: ['pedestrians'], draw: () => square(`<polygon points="0,-40 44,36 -44,36" fill="${W}"/><g transform="translate(0 10) scale(0.52)">${zebraPed(B)}</g>`) },
  { code: '307', name: 'תן זכות קדימה בקטע דרך צרה', category: 'priority', meaning: 'תן זכות קדימה בקטע דרך צרה לתנועה מהכיוון הנגדי.', action: 'המתן לפני הקטע הצר עד שהרכב ממול יעבור.', shape: 'circle', topics: ['priority'], draw: () => disc(narrowRoad(C.red, B)) },
  { code: '308', name: 'זכות קדימה בקטע דרך צרה', category: 'priority', meaning: 'לך זכות קדימה בקטע הדרך הצרה לגבי התנועה מהכיוון הנגדי.', action: 'המשך בזהירות; ודא שהרכב ממול אכן ממתין.', shape: 'square', topics: ['priority'], draw: () => square(narrowRoad(W, C.red)) },
  { code: '309', name: 'זכות קדימה בדרך', category: 'priority', meaning: 'לך זכות קדימה בדרך, עד לצומת הקרוב, עד למחלף הקרוב או עד תמרור 310.', action: 'המשך בנסיעה, אך זכות קדימה אינה פוטרת מזהירות — הבט לצדדים בכל צומת.', shape: 'diamond', topics: ['priority'], draw: () => diamond() },
  { code: '310', name: 'קצה הדרך שבה יש לך זכות קדימה', category: 'priority', meaning: 'קצה הדרך שבה יש לך זכות קדימה.', action: 'מכאן חלים כללי זכות הקדימה הרגילים — ללא תמרור, לבא מימין.', shape: 'diamond', topics: ['priority'], draw: () => diamond(true) },

  // ───────── איסורים והגבלות (401–441) ─────────
  { code: '401', name: 'כביש סגור', category: 'prohibition', meaning: 'כביש סגור — בשני הכיוונים — בפני כל רכב.', action: 'אין להיכנס; מצא דרך אחרת.', shape: 'circle', topics: ['one_way'], draw: () => disc('') },
  { code: '402', name: 'אין כניסה', category: 'prohibition', meaning: 'אסורה הכניסה לכל רכב.', action: 'אין להיכנס. לרוב מוצב בקצה רחוב חד-סטרי מהצד הנגדי — כניסה פירושה נסיעה נגד כיוון התנועה.', shape: 'circle', topics: ['one_way'], draw: () => disc(`<rect x="-36" y="-10" width="72" height="20" fill="${W}"/>`, { bg: C.red }) },
  { code: '418', name: 'אזור אסור ללימוד נהיגה', category: 'prohibition', meaning: 'אזור אסור ללימוד נהיגה, עד תמרור 419.', action: 'רכב לימוד נהיגה לא ייכנס לאזור; הבוחן והמורה לא ינחו לנסוע כאן.', shape: 'circle', topics: ['test'], draw: () => disc(learner(C.blue, W)) },
  { code: '419', name: 'קצה האזור האסור ללימוד נהיגה', category: 'prohibition', meaning: 'קצה האזור האסור ללימוד נהיגה.', action: 'מכאן מותר ללמד נהיגה.', shape: 'circle', topics: ['test'], draw: () => disc(learner(C.grey, W), thinEnd) },
  { code: '420', name: 'אסור לעקוף', category: 'prohibition', meaning: 'אסור לעקוף או לעבור על פניו של רכב מנועי הנע על יותר משני גלגלים באותו כיוון נסיעה.', action: 'אל תעקוף רכב (למעט דו-גלגלי) עד הצומת הקרוב או עד תמרור 421.', shape: 'circle', topics: ['overtaking'], draw: () => disc(twoCars(C.red, B)) },
  { code: '421', name: 'קצה קטע איסור העקיפה', category: 'prohibition', meaning: 'קצה קטע הדרך שעליו חל איסור העקיפה.', action: 'עקיפה מותרת שוב — רק כשהיא בטוחה ובקו הפרדה מקווקו.', shape: 'circle', topics: ['overtaking'], draw: () => disc(twoCars(C.grey, C.grey), thinEnd) },
  { code: '424', name: 'אזור דרכים עירוניות', category: 'prohibition', meaning: 'תחילת אזור דרכים עירוניות (עד תמרור 216 או 425).', action: 'מהירות מרבית 50 קמ״ש אלא אם סומן אחרת; חלים כללי הנהיגה בדרך עירונית.', shape: 'circle', topics: ['speed'], draw: () => disc(town(B)) },
  { code: '425', name: 'קצה אזור דרכים עירוניות', category: 'prohibition', meaning: 'קצה אזור הדרכים העירוניות.', action: 'מכאן דרך שאינה עירונית: 80 קמ״ש אלא אם סומן אחרת, וחובת אורות ביום בחורף (1.11–31.3).', shape: 'circle', topics: ['speed', 'lights'], draw: () => disc(town(C.grey), thinEnd) },
  { code: '426', name: 'מהירות מיוחדת', category: 'prohibition', meaning: 'אסורה הנסיעה במהירות העולה על מספר הקמ״ש הרשום בתמרור (עד הצומת הקרוב או עד תמרור מבטל).', action: 'התאם את המהירות לערך שבתמרור — זו המהירות המרבית, לא היעד.', shape: 'circle', hasValue: true, topics: ['speed'], draw: () => disc(number(B, 50)) },
  { code: '427', name: 'קצה המהירות המיוחדת', category: 'prohibition', meaning: 'קצה הקטע של המהירות המיוחדת.', action: 'חוזרת המהירות המרבית הרגילה של הדרך (50 בעירונית).', shape: 'circle', hasValue: true, topics: ['speed'], draw: () => disc(number(C.grey, 50), thinEnd) },
  { code: '428', name: 'אסורה הפנייה ימינה', category: 'prohibition', meaning: 'אסורה הפנייה ימינה בצומת הקרוב. הוצב מעל הרמזור — אסורה הפנייה לרבות פניית פרסה.', action: 'המשך ישר או פנה שמאלה; תכנן מסלול חלופי.', shape: 'circle', topics: ['turning'], draw: () => disc(bentArrow(B, 'right'), { bar: 'red' }) },
  { code: '429', name: 'אסורה הפנייה שמאלה', category: 'prohibition', meaning: 'אסורה הפנייה שמאלה בצומת הקרוב. הוצב מעל הרמזור — אסורה הפנייה לרבות פניית פרסה.', action: 'המשך ישר או פנה ימינה; פניית פרסה גם היא אסורה.', shape: 'circle', topics: ['turning'], draw: () => disc(bentArrow(B, 'left'), { bar: 'red' }) },
  { code: '430', name: 'אסורה פניית פרסה לימין', category: 'prohibition', meaning: 'אסורה פניית פרסה לימין בפנייה הקרובה.', action: 'אין לבצע פניית פרסה ימינה בצומת זה.', shape: 'circle', topics: ['turning'], draw: () => disc(uturn(B, 'right'), { bar: 'red' }) },
  { code: '431', name: 'אסורה פניית פרסה לשמאל', category: 'prohibition', meaning: 'אסורה פניית פרסה לשמאל בפנייה הקרובה.', action: 'אין לבצע פניית פרסה שמאלה בצומת זה; המשך לצומת הבא או לכיכר.', shape: 'circle', topics: ['turning'], draw: () => disc(uturn(B, 'left'), { bar: 'red' }) },
  { code: '432', name: 'אסורה חניית רכב', category: 'prohibition', meaning: 'אסורה חניית רכב בדרך בצד שבו הוצב התמרור, עד הצומת הקרוב או עד תמרור מבטל.', action: 'מותר לעצור לזמן קצר להעלאת והורדת נוסעים — אסור להשאיר את הרכב.', shape: 'circle', topics: ['parking'], draw: () => disc('', { bg: C.blue, bar: 'red' }) },
  { code: '433', name: 'אסורה כל עצירה וחניה', category: 'prohibition', meaning: 'אסורה כל עצירה וחניה של רכב בדרך בצד שבו הוצב התמרור, אלא אם הדבר דרוש למילוי הוראות כל דין.', action: 'אין לעצור כלל בצד זה — גם לא לרגע.', shape: 'circle', topics: ['parking'], draw: () => disc('', { bg: C.blue, bar: 'red_x' }) },
  { code: '434', name: 'קצה קטע איסור החניה/העצירה', category: 'prohibition', meaning: 'קצה קטע הוראות התמרורים 432 ו-433 בלבד.', action: 'מכאן העצירה והחניה מותרות לפי הכללים הרגילים (12 מ׳ מצומת, לא על מעבר חצייה וכו׳).', shape: 'circle', topics: ['parking'], draw: () => disc('', { bg: C.blue, bar: 'end' }) },
  { code: '437', name: 'חניה לרכב של נכה', category: 'prohibition', meaning: 'חניה בלעדית לרכב של נכה הנושא תג נכה מקורי תקף, בעת שהרכב משמש את הנכה.', action: 'אין לחנות כאן ללא תג נכה — גם לא לדקה.', shape: 'square', topics: ['parking'], draw: () => square(wheelchair(W)) },

  // ───────── תחבורה ציבורית (501–516) ─────────
  { code: '501', name: 'נתיב לתחבורה ציבורית', category: 'public_transport', meaning: 'כביש, נתיב או שול לתחבורה ציבורית: הנסיעה מותרת רק לסוגי הרכב המסומנים (אוטובוסים, מוניות, ורכב עם 3 נוסעים ומעלה כשמסומן "3+") ובשעות הרשומות. עצירה או חניה אסורות.', action: 'רכב פרטי לא ייסע בנתיב, למעט לפנייה בצומת הקרוב לפי סימון 514.', shape: 'rectangle', topics: ['bus_lane', 'lanes'], draw: () => square(publicTransport(), { w: 76, h: 108, scale: 0.92 }) },
  { code: '502', name: 'קצה נתיב לתחבורה ציבורית', category: 'public_transport', meaning: 'קצה הכביש, הנתיב או השול לתחבורה ציבורית.', action: 'מכאן הנתיב פתוח לכל כלי הרכב.', shape: 'rectangle', topics: ['bus_lane', 'lanes'], draw: () => square(publicTransport(), { w: 76, h: 108, scale: 0.92, strike: true }) },
  mark('503', 'סימון נתיב לתחבורה ציבורית (קו קטעים)', 'קו קטעים כפול משולב עם מעוינים בצבע צהוב. הנסיעה בנתיב מותרת לרכב המצוין בתמרור 501 או לרכב הפונה בצומת הקרוב לפי סימון 514.', 'אל תיסע בנתיב הצהוב; חצה אותו רק כדי לפנות בצומת הקרוב.', () => marking(dashedLine(40, '12 8', 4, C.yellow) + dashedLine(80, '12 8', 4, C.yellow) + yellowDiamonds(60)), ['bus_lane', 'markings'], 'public_transport'),
  { code: '504', name: 'התנועה בכיוון החץ הלבן מותרת לכל רכב', category: 'public_transport', meaning: 'התנועה בכיוון המסומן בחץ הלבן מותרת לכל כלי הרכב; לרכב שנסיעתו הותרה לפי תמרור 501 — גם בכיוון הנגדי.', action: 'רחוב חד-סטרי עם נתיב תחבורה ציבורית נגדי: סע רק בכיוון החץ הלבן וצפה לאוטובוסים ממול.', shape: 'square', topics: ['bus_lane', 'one_way'], draw: () => square(contraflow()) },
  { code: '505', name: 'תחנת אוטובוסים', category: 'public_transport', meaning: 'תחנת אוטובוסים ציבוריים; על גב התמרור יירשם האמור בו בשפה אחרת.', action: 'אין לעצור או לחנות בתחום התחנה (אבני שפה אדום-צהוב, סימון 511); האט כשאוטובוס עוצר — נוסעים עלולים לחצות.', shape: 'rectangle', topics: ['parking', 'bus_lane'], draw: () => yellowPlate(place(busStopPlate(), 60, 60, 1)) },
  { code: '507', name: 'תחנת מוניות', category: 'public_transport', meaning: 'תחנת מוניות: אסורה עצירה וחניית כל רכב אחר, פרט להורדת נוסעים.', action: 'אין לעצור או לחנות בתחום התחנה.', shape: 'square', topics: ['parking'], draw: () => square(taxiRank()) },
  mark('511', 'אבני שפה אדום-צהוב (תחנת אוטובוס)', 'מקום עצירה לסוג מסוים של רכב ליד אבני שפה צבועות אדום-צהוב: אסורה עצירה, למעט סוג הרכב שעצירתו הותרה על ידי תמרור, לשם העלאה והורדת נוסעים בלבד.', 'אל תעצור ואל תחנה לאורך הסימון.', () => kerb(C.red, C.yellow), ['parking', 'markings'], 'public_transport'),
  mark('515', 'סימון נתיב לתחבורה ציבורית (קו רצוף)', 'קו רצוף כפול משולב עם מעוינים בצבע צהוב — חציית הקווים אסורה.', 'אל תחצה את הקו הרצוף הצהוב ואל תיסע בנתיב.', () => marking(solidLine(40, 4, C.yellow) + solidLine(80, 4, C.yellow) + yellowDiamonds(60)), ['bus_lane', 'markings'], 'public_transport'),

  // ───────── מודיעין והדרכה (601–637) ─────────
  { code: '613', name: 'הגדרת תנועות בנתיבים', category: 'information', meaning: 'חצים על רקע כחול (בדרך עירונית) מגדירים את כיווני הנסיעה המותרים מכל נתיב; חץ בצבע צהוב — נתיב לתחבורה ציבורית כמפורט בתמרור 501.', action: 'היערך מראש לנתיב המתאים לכיוונך; אל תיכנס לנתיב עם חץ צהוב.', shape: 'rectangle', topics: ['lanes', 'bus_lane'], draw: () => square(laneArrows613(), { w: 108, h: 84, scale: 0.8 }) },
  { code: '618', name: 'כביש חד-סטרי', category: 'information', meaning: 'כניסה לקטע כביש שבו התנועה מותרת רק בכיוון המסומן בחץ (עד הצומת הקרוב או עד תמרור 145 או 504).', action: 'סע רק בכיוון החץ. ברחוב חד-סטרי פונים שמאלה מהנתיב השמאלי ביותר, ומותר לחנות גם בצד שמאל.', shape: 'square', topics: ['one_way'], draw: () => square(arrow(W)) },
  { code: '621', name: 'מספר הנתיבים קטן — מימין', category: 'information', meaning: 'שינוי במספר הנתיבים: הנתיב הימני מסתיים.', action: 'אם אתה בנתיב הימני — אותת שמאלה, בדוק מראה ונקודה מתה והתמזג בזמן.', shape: 'square', topics: ['lanes'], draw: () => square(laneDrop(W, 'right')) },
  { code: '622', name: 'מספר הנתיבים קטן — משמאל', category: 'information', meaning: 'שינוי במספר הנתיבים: הנתיב השמאלי מסתיים.', action: 'אם אתה בנתיב השמאלי — אותת ימינה והתמזג; בנתיב הממשיך — אפשר לרכב מתמזג להשתלב.', shape: 'square', topics: ['lanes'], draw: () => square(laneDrop(W, 'left')) },
  { code: '623', name: 'כביש ללא מוצא', category: 'information', meaning: 'כביש ללא מוצא.', action: 'אל תיכנס אם אין לך צורך; בסוף הרחוב בצע פניית פרסה או נסיעה לאחור בזהירות.', shape: 'square', topics: ['turning', 'reverse'], draw: () => square(deadEnd('straight')) },
  { code: '624', name: 'כביש ללא מוצא מימין', category: 'information', meaning: 'הכביש המסתעף ימינה הוא ללא מוצא.', action: 'אם אינך צריך להגיע אליו — המשך ישר.', shape: 'square', topics: ['turning'], draw: () => square(deadEnd('right')) },
  { code: '625', name: 'כביש ללא מוצא משמאל', category: 'information', meaning: 'הכביש המסתעף שמאלה הוא ללא מוצא.', action: 'אם אינך צריך להגיע אליו — המשך ישר.', shape: 'square', topics: ['turning'], draw: () => square(deadEnd('left')) },
  { code: '626', name: 'חניה לכלי רכב', category: 'information', meaning: 'חניה לכלי רכב (למעט תחנות אוטובוס ותחנות מוניות), בתנאים הרשומים בתמרור הנלווה (439): שעות, תשלום, סוג רכב.', action: 'מותר לחנות כאן לפי התנאים בשלט; עד 40 ס״מ מאבן השפה ובכיוון התנועה.', shape: 'square', topics: ['parking'], draw: () => square(parkingGlyph(W)) },
  { code: '627', name: 'חניה על המדרכה', category: 'information', meaning: 'מותרת החניה על המדרכה לרכב שמשקלו הכולל עד 2,200 ק״ג, בתחום הסימון (819) ובלי לחסום מעבר ברוחב סביר להולכי רגל ולכיסאות גלגלים.', action: 'חנה רק בתחום הסימון על המדרכה; השאר מעבר להולכי רגל ולעגלות.', shape: 'square', topics: ['parking'], draw: () => square(`<g transform="translate(-16 -20) scale(0.56)">${parkingGlyph(W)}</g><g transform="translate(16 20) scale(0.5)">${carSide(W)}</g><path d="M-48 42 L-6 42 L-6 32 L48 32" fill="none" stroke="${W}" stroke-width="5"/>`) },
  { code: '628', name: 'קצה המקום המותר לחניה', category: 'information', meaning: 'קצה המקום או הקטע המותר לחניה על הכביש או על המדרכה לפי תמרור 626 או 627.', action: 'מכאן אין לחנות על פי היתר התמרור הקודם.', shape: 'square', topics: ['parking'], draw: () => square(parkingGlyph(W), { strike: true }) },

  // ───────── רמזורים (701–729) ─────────
  light('701', 'אור אדום', 'אור אדום: עצור! אסור לעבור את קו העצירה, את מעבר החצייה או להיכנס לצומת כל עוד האור האדום דולק.', 'עצור לפני קו העצירה; אם אין קו — לפני מעבר החצייה, ואם אין — סמוך לרמזור.', () => lamp(['red', 'off', 'off'])),
  light('702', 'אור אדום וצהוב יחד', 'אור אדום ואור צהוב יחד: עצור כאמור באור אדום עד להופעת האור הירוק; היכון לנסיעה.', 'הישאר עצור, שחרר בלם חניה והיכון — אל תזוז לפני הירוק.', () => lamp(['red', 'amber', 'off'])),
  light('703', 'אור ירוק', 'אור ירוק: התקדם. מותר לנסוע ישר, ימינה, שמאלה או פרסה אלא אם תמרור הוריה מורה אחרת. אור ירוק מהבהב — האור הירוק מסתיים ועומד להופיע הצהוב.', 'לפני היציאה ודא שהצומת פנוי ותן זכות קדימה להולכי רגל ולרכב שכבר בצומת.', () => lamp(['off', 'off', 'green'])),
  light('703f', 'אור ירוק מהבהב', 'אור ירוק מהבהב (חלק מהוראת תמרור 703): האור הירוק מסתיים ועומד להופיע האור הצהוב.', 'אם אפשר לעצור בבטחה לפני הצומת — התכונן לעצור; אם אתה קרוב מאוד — המשך ופנה את הצומת.', () => lamp(['off', 'off', 'green'], { flash: 2 })),
  light('704', 'חץ ירוק', 'חץ ירוק: התקדם — מותר לנסוע רק בכיוון המסומן על ידי החץ. חץ ירוק מהבהב — עומד להופיע הצהוב.', 'סע רק בכיוון החץ; פניית פרסה מותרת בכיוון החץ אלא אם נאסרה.', () => lamp(['off', 'off', 'green'], { arrow: { at: 2, dir: 'left' } })),
  light('705', 'אור צהוב', 'אור צהוב: עצור כאמור באור אדום. אם אינך יכול לעצור בבטחה לפני הצומת או שכבר נכנסת אליו — השלם את מעבר הצומת ופנה אותו מיד.', 'עצור אם אפשר לעצור בבטחה; אל "תרוץ" על הצהוב.', () => lamp(['off', 'amber', 'off'])),
  light('706', 'אור צהוב מהבהב', 'אור צהוב מהבהב: התקדם בזהירות תוך שמירת הוראות כל דין. ליד מעבר חצייה — תן להולך הרגל לחצות בבטחה.', 'האט והתנהג לפי התמרורים וכללי זכות הקדימה הרגילים בצומת.', () => lamp(['off', 'amber', 'off'], { flash: 1 })),
  light('718', 'אור אדום להולכי רגל', 'דמות הולך רגל עומד בצבע אדום: אל תתחיל בחציית הכביש; אם אתה כבר בכביש — פנה אותו מיד.', 'לנהג: הולכי רגל אינם אמורים לחצות — אך עדיין תן זכות קדימה למי שכבר על המעבר.', () => twoLamp('ped', 'red'), ['signals', 'pedestrians']),
  light('719', 'אור ירוק להולכי רגל', 'דמות הולך רגל בצבע ירוק: מותר לחצות את הכביש בזהירות.', 'לנהג הפונה: להולכי הרגל יש ירוק — עצור ותן להם לסיים את החצייה.', () => twoLamp('ped', 'green'), ['signals', 'pedestrians']),
  light('720', 'אור אדום לאופניים', 'צורת אופניים בצבע אדום: אל תתחיל בחציית הכביש באופניים.', 'לנהג: שים לב לרוכבים שעלולים לחצות גם באדום.', () => twoLamp('bike', 'red')),
  light('721', 'אור ירוק לאופניים', 'צורת אופניים בצבע ירוק: מותר לחצות את הכביש בזהירות.', 'לנהג הפונה ימינה: תן זכות קדימה לרוכבי אופניים החוצים בירוק.', () => twoLamp('bike', 'green')),
  light('722', 'אור אדום מהבהב כפול לפני מפגש מסילה', 'אור אדום מהבהב כפול לפני מפגש מסילת ברזל: עצור לפני קו העצירה או לפני המחסום, ובאין מחסום — 4 מ׳ לפחות מפס המסילה. אסור לחצות עד להפסקת ההבהוב.', 'עצור והמתן עד שהאור יפסיק להבהב והמחסום יעלה.', () => railLamp()),
  light('723', 'נתיב סגור', 'נתיב סגור: אסור לנסוע בנתיב שמעליו הוצב התמרור.', 'עבור בזמן לנתיב פתוח.', () => laneControl('closed'), ['signals', 'lanes']),
  light('724', 'נתיב פתוח', 'נתיב פתוח: מותר לנסוע בנתיב שמעליו הוצב התמרור.', 'המשך בנתיב זה.', () => laneControl('open'), ['signals', 'lanes']),

  // ───────── סימון על פני הדרך (801–821) ─────────
  mark('801', 'קו נתיב / קו ציר הכביש — קו קטעים', 'קו נתיב או קו ציר הכביש — קו קטעים בצבע לבן: נהג בנתיב הימני ביותר ואל תעבור את הקו בגוף הרכב או בחלקו, אלא לשם עקיפה או לשם ביצוע הוראות כל דין ותוך שמירת הוראות כל דין.', 'מותר לחצות קו מקווקו לעקיפה או להחלפת נתיב — אחרי איתות ובדיקת מראות.', () => marking(dashedLine(60))),
  mark('803', 'קו הפרדה רצוף כפול', 'קו הפרדה רצוף כפול בצבע לבן: נהג בצדם הימני של הקווים; אל תעבור את הקווים בגוף הרכב או בחלקו.', 'אסור לחצות, לעקוף או לפנות שמאלה דרך קו רצוף.', () => marking(solidLine(55) + solidLine(65)), ['markings', 'lanes', 'overtaking']),
  mark('805', 'קו קטעים צפוף — אזהרה לפני קו הפרדה רצוף', 'קו קטעים צפוף בצבע לבן — אזהרה לפני הופעת קו הפרדה רצוף כפול: עבור לנתיב הימני לפני תחילת קו ההפרדה הרצוף.', 'סיים עקיפה או מעבר נתיב לפני שהקו הופך לרצוף.', () => marking(`<line x1="60" y1="0" x2="60" y2="62" stroke="${W}" stroke-width="4" stroke-dasharray="6 5"/><line x1="55" y1="62" x2="55" y2="120" stroke="${W}" stroke-width="4"/><line x1="65" y1="62" x2="65" y2="120" stroke="${W}" stroke-width="4"/>`), ['markings', 'overtaking']),
  mark('806', 'קו קטעים ליד קו רצוף', 'קו קטעים ליד קו רצוף בצבע לבן: מותר לעבור את הקווים אם קו הקטעים הוא מצדו הימני של הקו הרצוף, והדרך פנויה.', 'חצייה מותרת רק מהצד שבו הקו המקווקו צמוד אליך.', () => marking(solidLine(55) + dashedLine(65)), ['markings', 'overtaking']),
  mark('807', 'קו שפה — קו רצוף צהוב', 'קו שפת הכביש, במקום שאין בו אבני שפה: נהג בצדו השמאלי של הקו ואל תעבור לצדו הימני אלא כדי למנוע תאונה, או לעיכוב כשאתה נוסע לאט, או לשמירת הוראות כל דין.', 'אל תיסע על השול מעבר לקו הצהוב.', () => marking(`<rect x="100" width="20" height="120" fill="#85888b"/>` + solidLine(97, 4, C.yellow))),
  mark('808', 'קו מלבנים לבן — נתיב ייעודי', 'קו מלבנים בצבע לבן: נתיב לפנייה בלעדית ימינה או שמאלה, נתיב האצה, השתזרות או נתיב המשנה את ייעודו. סע בהתאם לייעוד הנתיב.', 'אם אינך מתכוון לפנות — אל תיכנס לנתיב פנייה בלעדי.', () => marking(`<line x1="60" y1="0" x2="60" y2="120" stroke="${W}" stroke-width="9" stroke-dasharray="18 10"/>`), ['markings', 'lanes']),
  mark('809', 'קו הנחיה בצומת', 'קו קטעים בצבע לבן — פנייה בצומת: סע במקביל לקו הקטעים. פניית פרסה מותרת אלא אם נאסרה בתמרור.', 'בפנייה שמאלה עקוב אחר קו ההנחיה ואל תחתוך את הפינה.', () => marking(`<rect x="0" y="0" width="38" height="38" fill="${C.sidewalk}"/><rect x="82" y="82" width="38" height="38" fill="${C.sidewalk}"/><path d="M20 120 Q20 60 100 40" fill="none" stroke="${W}" stroke-width="4" stroke-dasharray="10 8"/>`), ['markings', 'turning']),
  mark('810', 'קו עצירה', 'קו עצירה — קו לבן לרוחב הנתיב: מקום עצירת הרכב, לפני הקו וסמוך לו, כאשר יש חובת עצירה (תמרור 302, אור אדום).', 'עצור כך שחזית הרכב לפני הקו — לא עליו ולא מעבר לו.', () => marking(`<rect x="0" y="50" width="120" height="10" fill="${W}"/>` + `<line x1="60" y1="60" x2="60" y2="120" stroke="${W}" stroke-width="4" stroke-dasharray="14 10"/>` + `<rect x="0" y="0" width="120" height="30" fill="${C.sidewalk}"/>`), ['markings', 'priority', 'signals']),
  mark('811', 'מעבר חצייה להולכי רגל', 'מעבר חצייה להולכי רגל (פסים לבנים). מעבר רחב חולק לשניים — חצה בחצי הימני.', 'לנהג: תן זכות קדימה להולכי רגל החוצים או המתכוונים לחצות; אסור לעצור או לחנות על המעבר ו-12 מ׳ לפניו.', () => marking(zebra(36, 48)), ['markings', 'pedestrians']),
  mark('813', 'חצי כיוון בנתיב', 'חצים בצבע לבן על פני הדרך: היכנס לצומת ועבור בו רק בכיוון החץ שבנתיב שממנו נכנסת לצומת.', 'בחר נתיב לפי החץ כבר 50 מ׳ לפני הצומת; מנתיב "ישר" אסור לפנות.', () => marking(`<line x1="40" y1="0" x2="40" y2="120" stroke="${W}" stroke-width="3" stroke-dasharray="10 8"/><line x1="80" y1="0" x2="80" y2="120" stroke="${W}" stroke-width="3" stroke-dasharray="10 8"/>` + place(bentArrow(W, 'left'), 20, 70, 0.34) + place(arrowShort(W), 60, 70, 0.4) + place(bentArrow(W, 'right'), 100, 70, 0.34)), ['markings', 'lanes', 'turning']),
  mark('814', 'נתיב נסיעה העומד להסתיים', 'חצים אלכסוניים בצבע לבן: הנתיב עומד להסתיים — עבור לנתיב הסמוך בכיוון החץ.', 'אותת, בדוק נקודה מתה והתמזג מוקדם — אל תחכה לסוף הנתיב.', () => marking(`<line x1="30" y1="0" x2="30" y2="120" stroke="${W}" stroke-width="3" stroke-dasharray="10 8"/>` + place(arrowShort(W, -45), 80, 30, 0.32) + place(arrowShort(W, -45), 80, 66, 0.32) + place(arrowShort(W, -45), 80, 102, 0.32)), ['markings', 'lanes']),
  mark('815', 'אי תנועה מסומן על הכביש', 'אי תנועה (בצורות שונות) מסומן על הכביש בצבע לבן: אסור לעבור, לעצור או לחנות עליו.', 'הישאר מחוץ לשטח המקווקו.', () => marking(hatched()), ['markings', 'lanes']),
  mark('816', 'אבני שפה שחור-לבן', 'אבני שפה צבועות שחור-לבן: להבלטה והדגשה של מדרכות, מפרדות ואיי תנועה בנויים.', 'סימון הדגשה בלבד — אינו אוסר חניה בפני עצמו.', () => kerb(C.black, C.white), ['markings', 'parking']),
  mark('817', 'אבני שפה כחול-לבן', 'אבני שפה צבועות כחול-לבן: החניה מותרת בתשלום על הכביש שליד אבני השפה או על המדרכה, לפי הוראות תמרור 439 שמתחת לתמרור 626 או 627.', 'חניה מוסדרת — שלם (אפליקציה/מדחן) ובדוק את השעות ואת הסדרי התושבים בשלט.', () => kerb(C.blue, C.white), ['markings', 'parking']),
  mark('818', 'אבני שפה אדום-לבן', 'אבני שפה צבועות אדום-לבן: אסורה כל עצירה או חניה של רכב בכביש שליד אבני השפה, אלא אם הדבר דרוש למילוי הוראות כל דין.', 'אל תעצור ואל תחנה לאורך אבן שפה אדומה-לבנה.', () => kerb(C.red, C.white), ['markings', 'parking']),
  mark('819', 'מקומות חניה מסומנים על המדרכה', 'מקומות חניה לכלי רכב מסומנים בצבע לבן על המדרכה: החניה תהיה רק בתחומי השטח המסומן (עם תמרור 627; רכב עד 2,200 ק״ג), בלי לחסום את המעבר להולכי רגל.', 'חנה בתוך המלבן המסומן בלבד, ברוורס או בכניסה קדמית לפי הסימון.', () => marking(`<rect x="0" y="0" width="120" height="74" fill="${C.sidewalk}"/><rect x="0" y="72" width="120" height="4" fill="${C.lightGrey}"/><g fill="none" stroke="${W}" stroke-width="3"><rect x="6" y="16" width="34" height="54"/><rect x="43" y="16" width="34" height="54"/><rect x="80" y="16" width="34" height="54"/></g>`), ['markings', 'parking']),
  mark('820', 'מקום אסור לחניה', 'מקום אסור לחניה מסומן בצבע לבן (מלבן עם אלכסונים): אסורה חניה בתוך השטח המסומן.', 'אל תחנה בתוך הסימון — לרוב מול שער, כניסת חירום או חניה פרטית.', () => marking(`<rect x="18" y="26" width="84" height="68" fill="none" stroke="${W}" stroke-width="4"/><path d="M18 26 L102 94 M102 26 L18 94" stroke="${W}" stroke-width="4"/>`), ['markings', 'parking']),
  mark('821', 'פס האטה', 'מקום פס האטה.', 'האט לפני הפס ועבור אותו באיטיות.', () => marking(`<rect x="0" y="44" width="120" height="32" fill="#85888b"/>` + [8, 36, 64, 92].map((x) => `<polygon points="${x},76 ${x + 10},44 ${x + 20},76" fill="${W}"/>`).join('')), ['markings', 'speed']),

  // ───────── אתר עבודה (901–935) ─────────
  { code: '901', name: 'אתר עבודה בדרך', category: 'work_zone', meaning: 'אתר עבודה בדרך; סע על פי הסימון בצבע כתום, אם סומן.', action: 'האט, עקוב אחר התמרורים הזמניים הכתומים ושים לב לעובדים ולכלי עבודה.', shape: 'triangle', topics: ['safety'], draw: () => warning(worker(B)) },
  { code: '902', name: 'קצה אתר העבודה', category: 'work_zone', meaning: 'קצה אתר העבודה וכל ההגבלות והאיסורים בתוכו.', action: 'חוזרים לתמרורים ולסימון הקבועים.', shape: 'square', topics: ['safety'], draw: () => square(`<path d="M0 -40 L44 38 L-44 38 Z" fill="${W}" stroke="${C.grey}" stroke-width="8" stroke-linejoin="round"/>${place(worker(C.grey), 0, 12, 0.34)}`, { bg: C.white, border: C.black, strike: true }) },
];

/** Codes the integration contract (ARCHITECTURE.md / lessons) relies on. */
export const REQUIRED_SIGN_CODES = ['301', '302', '303', '306', '402', '426', '428', '429', '430', '431', '432', '433', '501', '504', '613', '618', '623', '626', '627', '701', '702', '703', '704', '705', '706', '718', '719', '810', '811', '818', '817', '511', '121', '135', '144', '222'];
