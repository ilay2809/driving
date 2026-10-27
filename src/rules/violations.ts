/**
 * Catalogue of driving violations / observations produced by the rules engine
 * ("the judge") and consumed by the instructor, the examiner, scoring and the UI.
 *
 * Severity:
 *   info     – observation, no penalty (e.g. "approaching a stop sign")
 *   minor    – small error; several of them fail a test
 *   major    – serious error; a few of them fail a test
 *   critical – immediate test failure (dangerous / illegal action)
 */
export type Severity = 'info' | 'minor' | 'major' | 'critical';

export const VIOLATION_TYPES = [
  // speed
  'SPEEDING_MINOR', // up to +10 km/h over the limit
  'SPEEDING_MAJOR', // +10..+20
  'SPEEDING_CRITICAL', // > +20
  'TOO_SLOW', // well below the limit without reason (עיכוב תנועה)
  'HESITATION', // stopped / crawling with free road ahead
  // signals
  'RED_LIGHT', // entered the junction on red
  'AMBER_RUN', // entered on amber when stopping was safely possible
  'RED_AMBER_START', // moved on red+amber (allowed to prepare, not to go)
  'GREEN_NOT_MOVING', // green light, free road, no movement for a while
  // signs & priority
  'STOP_SIGN_NO_STOP', // did not stop at a stop sign
  'STOP_SIGN_ROLLING', // slowed but no full stop (below ~2 km/h for 1 s)
  'STOP_LINE_OVERRUN', // stopped past the stop line / on the crossing
  'FAILED_TO_YIELD', // give way / right-hand rule / priority violation that forced another road user to react
  'ROUNDABOUT_NO_YIELD',
  'ROUNDABOUT_WRONG_LANE',
  'PEDESTRIAN_NOT_YIELDED', // pedestrian waiting/crossing at a crossing and the driver did not stop
  'PEDESTRIAN_NEAR_MISS',
  'LEFT_TURN_NO_YIELD', // turning left across oncoming traffic
  // signalling & lane discipline
  'NO_INDICATOR_TURN',
  'NO_INDICATOR_LANE_CHANGE',
  'INDICATOR_LATE', // signalled less than ~20 m / 2 s before the manoeuvre
  'INDICATOR_LEFT_ON', // indicator still on long after the manoeuvre
  'WRONG_LANE_FOR_TURN', // turned from a lane that does not allow that turn
  'WRONG_WAY', // against a one-way street
  'NO_ENTRY', // entered a road/lane where entry is prohibited (bus lane, no-entry sign)
  'BUS_LANE', // drove in a public transport lane
  'LANE_DEPARTURE', // drifted over a lane line without changing lane
  'SOLID_LINE_CROSSED',
  'CENTRE_LINE_CROSSED', // drove on the wrong side of the road
  'KERB_MOUNT', // climbed the sidewalk
  'KERB_STRIKE', // touched the kerb (parking / turning)
  'WIDE_TURN', // swung into the wrong lane while turning
  'CUT_CORNER',
  // distance / smoothness / control
  'TAILGATING', // < 2 s following distance
  'HARSH_BRAKING',
  'HARSH_ACCELERATION',
  'COLLISION',
  'NEAR_MISS',
  'HANDBRAKE_ON', // driving with the parking brake engaged
  'WRONG_GEAR', // e.g. moving in N, reversing in D
  'SEATBELT', // moved without a seatbelt
  'ENGINE_OFF_ROLL',
  // observation (mirrors)
  'NO_MIRROR_CHECK', // no mirror glance before a manoeuvre
  'NO_SHOULDER_CHECK', // no blind-spot check before a lane change / pulling out
  // stopping & parking
  'ILLEGAL_STOP', // stopped on a crossing / inside a junction / in front of a bus stop
  'ILLEGAL_PARKING', // red-white kerb, < 12 m from a junction, on a crossing, bus stop...
  'PARKING_TOO_FAR', // > 40 cm from the kerb
  'PARKING_ANGLE', // not parallel to the kerb
  'BLOCKING_JUNCTION', // stopped inside the junction (box) blocking cross traffic
  // instructions
  'MISSED_INSTRUCTION', // did not follow the examiner's / instructor's route instruction
  'WRONG_TURN',
  // examiner
  'EXAMINER_INTERVENTION', // the examiner used the dual brake / took the wheel
  // positive / informational
  'GOOD_STOP',
  'GOOD_YIELD',
  'GOOD_PARKING',
  'APPROACHING_STOP_SIGN',
  'APPROACHING_CROSSING',
  'APPROACHING_SIGNALS',
  'APPROACHING_ROUNDABOUT',
  'SPEED_LIMIT_CHANGED',
] as const;

export type ViolationType = (typeof VIOLATION_TYPES)[number];

export interface ViolationInfo {
  severity: Severity;
  /** Short Hebrew label for the HUD / result sheet. */
  label: string;
  /** What the driver should have done (Hebrew). Used by the instructor. */
  advice: string;
  /** Legal reference (תקנות התעבורה) or rule name, for the theory link. */
  ref?: string;
  /** Minimum seconds between two reports of the same type. */
  cooldown: number;
}

export const VIOLATIONS: Record<ViolationType, ViolationInfo> = {
  SPEEDING_MINOR: { severity: 'minor', label: 'חריגה קלה מהמהירות המותרת', advice: 'שים לב למהירות המותרת בדרך זו והאט מעט.', ref: 'תקנה 54', cooldown: 15 },
  SPEEDING_MAJOR: { severity: 'major', label: 'חריגה מהמהירות המותרת', advice: 'אתה נוסע מהר מדי. המהירות המרבית כאן נמוכה יותר — האט.', ref: 'תקנה 54', cooldown: 10 },
  SPEEDING_CRITICAL: { severity: 'critical', label: 'מהירות מופרזת', advice: 'מהירות מסוכנת בהרבה מהמותר. בלום בעדינות והאט מיד.', ref: 'תקנה 54', cooldown: 10 },
  TOO_SLOW: { severity: 'minor', label: 'נסיעה איטית מדי', advice: 'הדרך פנויה — אפשר לנסוע במהירות הנסיעה הרגילה. נסיעה איטית מדי מעכבת תנועה.', ref: 'תקנה 51', cooldown: 20 },
  HESITATION: { severity: 'minor', label: 'היסוס / עצירה ללא צורך', advice: 'כשיש לך זכות קדימה והדרך פנויה — המשך בנסיעה בביטחון.', cooldown: 20 },
  RED_LIGHT: { severity: 'critical', label: 'נסיעה באור אדום', advice: 'באור אדום עוצרים לפני קו העצירה וממתינים לאור ירוק.', ref: 'תמרור 701', cooldown: 5 },
  AMBER_RUN: { severity: 'major', label: 'כניסה לצומת באור צהוב', advice: 'אור צהוב פירושו עצור — אלא אם אי אפשר לעצור בבטחה. ירוק מהבהב מזהיר שהצהוב מגיע.', ref: 'תמרור 705', cooldown: 5 },
  RED_AMBER_START: { severity: 'minor', label: 'תזוזה באדום-צהוב', advice: 'אדום-צהוב פירושו להתכונן לנסיעה — לא לנסוע. ממתינים לירוק.', ref: 'תמרור 702', cooldown: 10 },
  GREEN_NOT_MOVING: { severity: 'minor', label: 'אי-תזוזה באור ירוק', advice: 'האור ירוק והדרך פנויה — בדוק שהצומת פנוי וצא לדרך.', cooldown: 15 },
  STOP_SIGN_NO_STOP: { severity: 'critical', label: 'אי-עצירה בתמרור עצור', advice: 'בתמרור עצור חייבים לעצור עצירה מוחלטת לפני קו העצירה, גם כשהדרך נראית פנויה.', ref: 'תמרור 302', cooldown: 5 },
  STOP_SIGN_ROLLING: { severity: 'major', label: 'עצירה לא מלאה בתמרור עצור', advice: 'האטת אבל לא עצרת לגמרי. הגלגלים חייבים להפסיק להסתובב.', ref: 'תמרור 302', cooldown: 5 },
  STOP_LINE_OVERRUN: { severity: 'minor', label: 'עצירה מעבר לקו העצירה', advice: 'יש לעצור לפני קו העצירה (או לפני מעבר החצייה), לא עליו.', ref: 'תמרור 801', cooldown: 5 },
  FAILED_TO_YIELD: { severity: 'critical', label: 'אי-מתן זכות קדימה', advice: 'היה עליך לתת זכות קדימה. רכב אחר נאלץ לבלום או לסטות בגללך.', ref: 'תקנה 64', cooldown: 5 },
  ROUNDABOUT_NO_YIELD: { severity: 'critical', label: 'אי-מתן זכות קדימה בכיכר', advice: 'בכניסה לכיכר נותנים זכות קדימה לרכב שכבר נמצא בכיכר.', ref: 'תמרור 303', cooldown: 5 },
  ROUNDABOUT_WRONG_LANE: { severity: 'minor', label: 'נתיב שגוי בכיכר', advice: 'ליציאה ראשונה/ימינה — הנתיב הימני. ליציאות הרחוקות ושמאלה — הנתיב השמאלי.', cooldown: 10 },
  PEDESTRIAN_NOT_YIELDED: { severity: 'critical', label: 'אי-מתן זכות קדימה להולך רגל', advice: 'הולך רגל שמתכוון לחצות במעבר חצייה — עוצרים ומאפשרים לו לחצות.', ref: 'תקנה 67', cooldown: 5 },
  PEDESTRIAN_NEAR_MISS: { severity: 'critical', label: 'סיכון הולך רגל', advice: 'עברת קרוב מדי להולך רגל. האט ליד מעברי חצייה ותן זכות קדימה.', ref: 'תקנה 67', cooldown: 5 },
  LEFT_TURN_NO_YIELD: { severity: 'critical', label: 'פנייה שמאלה ללא מתן זכות קדימה', advice: 'בפנייה שמאלה נותנים זכות קדימה לרכב שבא ממול וממשיך ישר או פונה ימינה.', ref: 'תקנה 64(ג)', cooldown: 5 },
  NO_INDICATOR_TURN: { severity: 'minor', label: 'פנייה ללא איתות', advice: 'לפני כל פנייה מאותתים — בזמן ומספיק מראש.', ref: 'תקנה 38', cooldown: 5 },
  NO_INDICATOR_LANE_CHANGE: { severity: 'minor', label: 'החלפת נתיב ללא איתות', advice: 'לפני מעבר נתיב מאותתים, בודקים מראות ונקודה מתה, ורק אז עוברים.', ref: 'תקנה 38', cooldown: 5 },
  INDICATOR_LATE: { severity: 'minor', label: 'איתות מאוחר', advice: 'האיתות צריך להינתן מספיק מוקדם כדי שאחרים יבינו את כוונתך.', cooldown: 5 },
  INDICATOR_LEFT_ON: { severity: 'minor', label: 'איתות שנשאר דולק', advice: 'סיימת את התמרון — בטל את האיתות כדי לא להטעות נהגים אחרים.', cooldown: 15 },
  WRONG_LANE_FOR_TURN: { severity: 'major', label: 'פנייה מנתיב לא מתאים', advice: 'פונים רק מהנתיב שמסומן לכיוון הפנייה. היערך לנתיב הנכון מראש.', ref: 'תקנה 36', cooldown: 5 },
  WRONG_WAY: { severity: 'critical', label: 'נסיעה נגד כיוון התנועה', advice: 'זהו רחוב חד-סטרי. שים לב לתמרור "אין כניסה" ולחיצי הכיוון.', ref: 'תמרור 402', cooldown: 5 },
  NO_ENTRY: { severity: 'critical', label: 'כניסה אסורה', advice: 'תמרור "אין כניסה" אוסר להיכנס לדרך זו.', ref: 'תמרור 402', cooldown: 5 },
  BUS_LANE: { severity: 'major', label: 'נסיעה בנתיב תחבורה ציבורית', advice: 'הנתיב הצהוב מיועד לאוטובוסים ומוניות בלבד. עבור לנתיב הכללי.', ref: 'תמרור 501', cooldown: 10 },
  LANE_DEPARTURE: { severity: 'minor', label: 'סטייה מהנתיב', advice: 'החזק את הרכב במרכז הנתיב. הבט רחוק קדימה — זה עוזר ליישר.', cooldown: 8 },
  SOLID_LINE_CROSSED: { severity: 'major', label: 'חציית קו הפרדה רצוף', advice: 'קו רצוף אסור לחצות. החלף נתיב רק במקום שבו הקו מקווקו.', ref: 'תמרור 803', cooldown: 8 },
  CENTRE_LINE_CROSSED: { severity: 'critical', label: 'נסיעה בצד הנגדי של הכביש', advice: 'נוסעים בצד הימני של הכביש. סטייה לנתיב הנגדי מסוכנת מאוד.', ref: 'תקנה 35', cooldown: 5 },
  KERB_MOUNT: { severity: 'major', label: 'עלייה על המדרכה', advice: 'הרכב עלה על המדרכה. בפניות ובחניה שמור מרחק מאבן השפה.', cooldown: 5 },
  KERB_STRIKE: { severity: 'minor', label: 'נגיעה באבן השפה', advice: 'הרכב נגע באבן השפה. תקן את הזווית ושמור מרחק קטן מהמדרכה.', cooldown: 5 },
  WIDE_TURN: { severity: 'minor', label: 'פנייה רחבה', advice: 'בפנייה ימינה הישאר צמוד לימין; בפנייה שמאלה אל תחתוך לנתיב הנגדי.', cooldown: 8 },
  CUT_CORNER: { severity: 'major', label: 'חיתוך פינה', advice: 'בפנייה שמאלה עוברים את מרכז הצומת ולא חותכים דרך הנתיב הנגדי.', cooldown: 8 },
  TAILGATING: { severity: 'minor', label: 'מרחק עקיבה קצר', advice: 'שמור לפחות 2 שניות מהרכב שלפניך (3 בגשם).', ref: 'תקנה 49', cooldown: 10 },
  HARSH_BRAKING: { severity: 'minor', label: 'בלימה חדה', advice: 'נסה לצפות מראש ולבלום בהדרגה.', cooldown: 10 },
  HARSH_ACCELERATION: { severity: 'minor', label: 'האצה חדה', advice: 'האץ בעדינות ובהדרגה.', cooldown: 10 },
  COLLISION: { severity: 'critical', label: 'תאונה', advice: 'הרכב פגע במשהו. עצור, הירגע, ונתחיל שוב.', cooldown: 3 },
  NEAR_MISS: { severity: 'major', label: 'כמעט תאונה', advice: 'היית קרוב מאוד לפגיעה. שמור מרחק והאט כשהמצב לא ברור.', cooldown: 5 },
  HANDBRAKE_ON: { severity: 'minor', label: 'נסיעה עם בלם חניה', advice: 'שחרר את בלם החניה לפני היציאה לדרך.', cooldown: 20 },
  WRONG_GEAR: { severity: 'minor', label: 'הילוך לא מתאים', advice: 'לנסיעה קדימה בוחרים D, לנסיעה לאחור R, ובחניה P.', cooldown: 10 },
  SEATBELT: { severity: 'critical', label: 'נסיעה ללא חגורת בטיחות', advice: 'חוגרים חגורה לפני שמתחילים לנסוע — תמיד.', ref: 'תקנה 83ב', cooldown: 30 },
  ENGINE_OFF_ROLL: { severity: 'minor', label: 'גלישה ללא מנוע', advice: 'אל תיסע כשהמנוע כבוי או בהילוך סרק.', cooldown: 20 },
  NO_MIRROR_CHECK: { severity: 'minor', label: 'ללא בדיקת מראות', advice: 'לפני כל תמרון מסתכלים במראות — מראה פנימית וצד.', cooldown: 10 },
  NO_SHOULDER_CHECK: { severity: 'minor', label: 'ללא בדיקת נקודה מתה', advice: 'לפני החלפת נתיב ויציאה מחניה מפנים את הראש לבדיקת השטח המת.', cooldown: 10 },
  ILLEGAL_STOP: { severity: 'major', label: 'עצירה במקום אסור', advice: 'אין לעצור על מעבר חצייה, בתוך צומת או בתחנת אוטובוס.', ref: 'תקנה 72', cooldown: 10 },
  ILLEGAL_PARKING: { severity: 'major', label: 'חניה במקום אסור', advice: 'אסור לחנות ליד אבן שפה אדומה-לבנה, במרחק קטן מ-12 מ\' מצומת, או ליד מעבר חצייה.', ref: 'תקנה 72', cooldown: 10 },
  PARKING_TOO_FAR: { severity: 'minor', label: 'חניה רחוקה מהמדרכה', advice: 'בסיום החניה הרכב צריך להיות עד 40 ס"מ מאבן השפה.', cooldown: 10 },
  PARKING_ANGLE: { severity: 'minor', label: 'חניה לא מקבילה', advice: 'יישר את הרכב במקביל למדרכה.', cooldown: 10 },
  BLOCKING_JUNCTION: { severity: 'major', label: 'חסימת צומת', advice: 'נכנסים לצומת רק אם אפשר לצאת ממנו — לא עוצרים בתוכו.', ref: 'תקנה 65', cooldown: 10 },
  MISSED_INSTRUCTION: { severity: 'minor', label: 'אי-ביצוע הוראה', advice: 'לא ביצעת את ההוראה שניתנה. אם לא שמעת — אפשר לבקש לחזור עליה.', cooldown: 5 },
  WRONG_TURN: { severity: 'minor', label: 'פנייה שגויה', advice: 'פנית לכיוון אחר מההוראה. נמשיך מכאן.', cooldown: 5 },
  EXAMINER_INTERVENTION: { severity: 'critical', label: 'התערבות הבוחן', advice: 'הבוחן נאלץ לבלום. במבחן אמיתי זהו כישלון מיידי.', cooldown: 3 },
  GOOD_STOP: { severity: 'info', label: 'עצירה טובה', advice: 'יפה — עצירה מלאה לפני הקו.', cooldown: 10 },
  GOOD_YIELD: { severity: 'info', label: 'מתן זכות קדימה', advice: 'מצוין, נתת זכות קדימה בזמן.', cooldown: 10 },
  GOOD_PARKING: { severity: 'info', label: 'חניה טובה', advice: 'חניה מדויקת. כל הכבוד.', cooldown: 10 },
  APPROACHING_STOP_SIGN: { severity: 'info', label: 'תמרור עצור לפניך', advice: 'מתקרבים לתמרור עצור — האט והתכונן לעצירה מלאה.', cooldown: 20 },
  APPROACHING_CROSSING: { severity: 'info', label: 'מעבר חצייה לפניך', advice: 'מעבר חצייה — האט ובדוק אם יש הולכי רגל שמתכוונים לחצות.', cooldown: 20 },
  APPROACHING_SIGNALS: { severity: 'info', label: 'רמזור לפניך', advice: 'רמזור — שים לב למצב האור והתכונן.', cooldown: 20 },
  APPROACHING_ROUNDABOUT: { severity: 'info', label: 'כיכר לפניך', advice: 'כיכר — האט, הסתכל שמאלה, ותן זכות קדימה לרכבים בתוך הכיכר.', cooldown: 20 },
  SPEED_LIMIT_CHANGED: { severity: 'info', label: 'שינוי במהירות המותרת', advice: 'המהירות המותרת השתנתה.', cooldown: 5 },
};

export interface Violation {
  type: ViolationType;
  severity: Severity;
  /** Simulation time (seconds) when it happened. */
  time: number;
  /** World position [x, z]. */
  pos: [number, number];
  /** Optional details for the message (e.g. speed, limit, street name). */
  details?: Record<string, string | number | boolean>;
  /** Free-text addition (Hebrew), e.g. the street / junction name. */
  context?: string;
}

/** Points used by the examiner's rubric and lesson scoring. */
export const SEVERITY_POINTS: Record<Severity, number> = { info: 0, minor: 1, major: 4, critical: 100 };

/** Default test rubric: fail on any critical, or when the points exceed the threshold. */
export const TEST_RUBRIC = { failPoints: 12, maxMajor: 2 } as const;
