/**
 * Inline Hebrew dialogue table — the fallback for data/content/dialogue.json.
 * Every key the coach module speaks exists here, so the simulator works without the
 * content file. Lines are short and spoken-style; {placeholders} are substituted by
 * `LineTable.line()`. Several variants per key keep the instructor from sounding robotic.
 *
 * Key conventions:
 *   greeting.<mode>                 instructor greetings
 *   nav.i.<phase>.<kind>            navigator, instructor style ("פנה ימינה לרחוב X")
 *   nav.e.<phase>.<kind>            navigator, examiner style (terse: "ימינה.")
 *   violation.<TYPE>                instructor reaction (fallback: VIOLATIONS[type].advice)
 *   intervention.* / danger.*       dual-brake lines and reasons
 *   explain.*                       the '?' key explanations
 *   examiner.*                      test conduct
 *   lesson.*                        lesson runner
 *   verdict.*                       scoring summaries
 *   parking.reason.*                kerb-stop legality reasons
 */
import type { Speaker } from '@/core/events';

export interface LineDef {
  who: Speaker;
  variants: string[];
}

const I = (...variants: string[]): LineDef => ({ who: 'instructor', variants });
const E = (...variants: string[]): LineDef => ({ who: 'examiner', variants });
const S = (...variants: string[]): LineDef => ({ who: 'system', variants });

export const STRINGS_HE: Record<string, LineDef> = {
  // ---- greetings ----------------------------------------------------------------
  'greeting.lesson': I('שלום! אני המורה שלך להיום. נעבוד יחד שלב-שלב, ואני אסביר כל דבר בדרך. חגור חגורה ונתחיל.', 'ברוך הבא לשיעור. אני איתך ברכב, ואעזור לך בכל שלב. קודם כול — חגורת בטיחות.'),
  'greeting.free': I('נהיגה חופשית. אני יושב לידך, ואעיר רק כשצריך. חגור חגורה, שחרר בלם חניה, ושים D.', 'שלום. היום נוהגים חופשי בעיר. אני כאן אם יש שאלה — לחץ על סימן השאלה ואסביר מה קורה סביבנו.'),
  'greeting.training_ground': I('ברוך הבא למגרש האימונים. כאן אפשר לטעות בלי לחץ. חגור חגורה, שחרר בלם חניה, ובחר D.', 'מגרש האימונים — מקום טוב להתחיל. ניסע לאט, ונתרגל את היסודות.'),
  'greeting.seatbelt': I('לפני שזזים — חגורה.', 'חגור חגורה, בבקשה.'),

  // ---- navigator, instructor style -----------------------------------------------
  'nav.street': S(' לרחוב {street}'),
  'nav.street_named': S(' ל{street}'),
  'nav.then_right': S(' ומיד ימינה'),
  'nav.then_left': S(' ומיד שמאלה'),
  'nav.ordinal.1': S('ראשונה'),
  'nav.ordinal.2': S('שנייה'),
  'nav.ordinal.3': S('שלישית'),
  'nav.ordinal.4': S('רביעית'),
  'nav.ordinal.5': S('חמישית'),
  'nav.ordinal.6': S('שישית'),
  // HUD text of the current instruction (no distance; the UI shows the distance separately)
  'nav.hud.turn_right': S('פנה ימינה{streetPhrase}'),
  'nav.hud.turn_left': S('פנה שמאלה{streetPhrase}'),
  'nav.hud.slight_right': S('המשך קלות ימינה{streetPhrase}'),
  'nav.hud.slight_left': S('המשך קלות שמאלה{streetPhrase}'),
  'nav.hud.straight': S('המשך ישר'),
  'nav.hud.roundabout_exit': S('בכיכר — יציאה {ordinal}{streetPhrase}'),
  'nav.hud.uturn': S('פניית פרסה'),
  'nav.hud.arrive': S('היעד לפניך'),
  'nav.hud.pull_over': S('עצור בצד'),
  'nav.hud.none': S('המשך בנסיעה'),
  'nav.hud.in_distance': S('בעוד {distance} מטר: {text}'),
  'nav.i.far.turn_right': I('בעוד {distance} מטר פנה ימינה{streetPhrase}.', 'עוד {distance} מטר — פנייה ימינה{streetPhrase}. התחל לאותת והיערך בנתיב הימני.'),
  'nav.i.far.turn_left': I('בעוד {distance} מטר פנה שמאלה{streetPhrase}.', 'עוד {distance} מטר — פנייה שמאלה{streetPhrase}. אותת שמאלה והיערך בנתיב השמאלי.'),
  'nav.i.far.slight_right': I('בעוד {distance} מטר המשך קלות ימינה{streetPhrase}.'),
  'nav.i.far.slight_left': I('בעוד {distance} מטר המשך קלות שמאלה{streetPhrase}.'),
  'nav.i.far.straight': I('המשך ישר בצומת.', 'בצומת הבא ממשיכים ישר.'),
  'nav.i.far.roundabout_exit': I('בעוד {distance} מטר כיכר. צא ביציאה ה{ordinal}{streetPhrase}.', 'עוד {distance} מטר מגיעים לכיכר — היציאה ה{ordinal}{streetPhrase}.'),
  'nav.i.far.uturn': I('בעוד {distance} מטר בצע פניית פרסה.'),
  'nav.i.far.arrive': I('היעד בעוד {distance} מטר.', 'עוד {distance} מטר ואנחנו ביעד.'),
  'nav.i.now.turn_right': I('עכשיו פנה ימינה{thenPhrase}.', 'כאן ימינה{thenPhrase}.'),
  'nav.i.now.turn_left': I('עכשיו פנה שמאלה{thenPhrase}.', 'כאן שמאלה{thenPhrase}.'),
  'nav.i.now.slight_right': I('המשך קלות ימינה.'),
  'nav.i.now.slight_left': I('המשך קלות שמאלה.'),
  'nav.i.now.straight': I('ישר.'),
  'nav.i.now.roundabout_exit': I('בכיכר — יציאה {ordinal}.', 'כיכר. היציאה ה{ordinal}.'),
  'nav.i.now.uturn': I('בצע פניית פרסה כשיתאפשר.'),
  'nav.i.now.arrive': I('הגעת ליעד. עצור בצד כשיתאפשר.', 'זהו, הגענו. עצור בצד במקום מותר.'),
  'nav.i.reroute': I('לא נורא, נמשיך מכאן.'),
  'nav.i.no_route': I('אין לי הוראה כרגע. המשך בנסיעה.'),
  'nav.i.repeat.straight': I('ממשיכים ישר.'),

  // ---- navigator, examiner style (terse) ---------------------------------------------
  'nav.e.far.turn_right': E('בעוד {distance} מטר ימינה{streetPhrase}.'),
  'nav.e.far.turn_left': E('בעוד {distance} מטר שמאלה{streetPhrase}.'),
  'nav.e.far.slight_right': E('בעוד {distance} מטר קלות ימינה{streetPhrase}.'),
  'nav.e.far.slight_left': E('בעוד {distance} מטר קלות שמאלה{streetPhrase}.'),
  'nav.e.far.straight': E('ישר בצומת.'),
  'nav.e.far.roundabout_exit': E('בכיכר, יציאה {ordinal}{streetPhrase}.'),
  'nav.e.far.uturn': E('בעוד {distance} מטר פניית פרסה.'),
  'nav.e.far.arrive': E('המשך ישר, ובסוף הרחוב עצור בצד ימין.'),
  'nav.e.now.turn_right': E('ימינה{thenPhrase}.'),
  'nav.e.now.turn_left': E('שמאלה{thenPhrase}.'),
  'nav.e.now.slight_right': E('קלות ימינה.'),
  'nav.e.now.slight_left': E('קלות שמאלה.'),
  'nav.e.now.straight': E('ישר.'),
  'nav.e.now.roundabout_exit': E('יציאה {ordinal}.'),
  'nav.e.now.uturn': E('פניית פרסה כשיתאפשר.'),
  'nav.e.now.arrive': E('עצור כאן בצד ימין.'),
  'nav.e.reroute': E('נמשיך מכאן.'),
  'nav.e.no_route': E('המשך ישר.'),
  'nav.e.repeat.straight': E('ישר.'),

  // ---- violation reactions (others fall back to VIOLATIONS[type].advice) -------------
  'violation.SPEEDING_MINOR': I('קצת מהר. המהירות המותרת כאן {limit} — האט מעט.', 'שים לב למהירות — אתה מעט מעל המותר.'),
  'violation.SPEEDING_MAJOR': I('מהר מדי! המותר כאן {limit} קמ"ש. הורד את הרגל מהגז.', 'אתה נוסע מהר מדי. המותר כאן {limit} — האט עכשיו.'),
  'violation.SPEEDING_CRITICAL': I('מהירות מסוכנת! בלום בעדינות והאט מיד.'),
  'violation.STOP_SIGN_NO_STOP': I('זה היה תמרור עצור — חייבים לעצור עצירה מלאה לפני הקו, גם כשהדרך פנויה.'),
  'violation.STOP_SIGN_ROLLING': I('האטת, אבל לא עצרת. בתמרור עצור הגלגלים צריכים להפסיק להסתובב.'),
  'violation.RED_LIGHT': I('עברת באדום! באור אדום עוצרים לפני קו העצירה.'),
  'violation.AMBER_RUN': I('צהוב פירושו עצור, אלא אם אי אפשר לעצור בבטחה. כאן יכולת לעצור.'),
  'violation.NO_INDICATOR_TURN': I('פנית בלי לאותת. מאותתים לפני כל פנייה — מספיק מוקדם.', 'שכחת את האיתות. לפני פנייה — איתות.'),
  'violation.NO_INDICATOR_LANE_CHANGE': I('מעבר נתיב בלי איתות. איתות, מראות, נקודה מתה — ואז עוברים.'),
  'violation.INDICATOR_LEFT_ON': I('האיתות עדיין דולק. בטל אותו.'),
  'violation.PEDESTRIAN_NOT_YIELDED': I('הולך רגל חיכה לחצות ולא עצרת. במעבר חצייה הולך הרגל קודם — תמיד.'),
  'violation.FAILED_TO_YIELD': I('לא נתת זכות קדימה. רכב אחר נאלץ לבלום בגללך.'),
  'violation.ROUNDABOUT_NO_YIELD': I('בכניסה לכיכר נותנים זכות קדימה לרכב שכבר בתוכה. הסתכל שמאלה לפני שנכנסים.'),
  'violation.TAILGATING': I('קרוב מדי לרכב שלפנינו. שמור לפחות שתי שניות.', 'מרחק! ספור שתי שניות מהרכב שלפניך.'),
  'violation.LANE_DEPARTURE': I('אתה סוטה מהנתיב. הבט רחוק קדימה — זה עוזר ליישר.'),
  'violation.HARSH_BRAKING': I('בלימה חדה. נסה לצפות מראש ולבלום בהדרגה.'),
  'violation.SEATBELT': I('רגע — חגורה! לא זזים בלי חגורת בטיחות.'),
  'violation.HANDBRAKE_ON': I('בלם החניה עדיין משוך. שחרר אותו.'),
  'violation.WRONG_GEAR': I('בדוק את ההילוך — לנסיעה קדימה D.'),
  'violation.NO_MIRROR_CHECK': I('לפני התמרון — מראות. הסתכל במראה הפנימית ובמראת הצד.'),
  'violation.NO_SHOULDER_CHECK': I('נקודה מתה! סובב את הראש ובדוק לפני שאתה עובר.'),
  'violation.CENTRE_LINE_CROSSED': I('אתה בצד הנגדי של הכביש! חזור מיד לימין.'),
  'violation.WRONG_WAY': I('זה רחוב חד-סטרי ואתה נגד הכיוון! שים לב לתמרורים.'),
  'violation.ILLEGAL_PARKING': I('כאן אסור לחנות. חפש מקום מותר — לא ליד אבן שפה אדומה-לבנה, ולא קרוב לצומת.'),
  'violation.ILLEGAL_STOP': I('אסור לעצור כאן.'),
  'violation.COLLISION': I('פגענו במשהו. עצור, קח נשימה, ונמשיך בזהירות.'),
  'violation.MISSED_INSTRUCTION': I('זו לא הייתה ההוראה. לא נורא — נמשיך מכאן.'),
  'violation.WRONG_TURN': I('פנית לכיוון אחר ממה שביקשתי. לא נורא, נמשיך מכאן.'),
  'violation.GOOD_STOP': I('יפה, עצירה מלאה לפני הקו.', 'עצירה טובה.'),
  'violation.GOOD_YIELD': I('מצוין, נתת זכות קדימה בזמן.', 'יפה — ראית אותו ונתת לו לעבור.'),
  'violation.GOOD_PARKING': I('חניה מדויקת. כל הכבוד.', 'יפה מאוד, צמוד למדרכה ומקביל.'),
  'violation.APPROACHING_STOP_SIGN': I('מתקרבים לתמרור עצור — תתחיל להאט.', 'תמרור עצור לפנינו. האט, ועצור לפני הקו.'),
  'violation.APPROACHING_CROSSING': I('מעבר חצייה לפנינו — הורד מהירות ובדוק את המדרכות.', 'מעבר חצייה. יש מישהו שרוצה לחצות?'),
  'violation.APPROACHING_SIGNALS': I('רמזור לפנינו. שים לב לאור.', 'מתקרבים לרמזור — הכן את הרגל על הבלם.'),
  'violation.APPROACHING_ROUNDABOUT': I('כיכר לפנינו. האט, הסתכל שמאלה, ותן זכות קדימה למי שבכיכר.'),
  'violation.SPEED_LIMIT_CHANGED': I('המהירות המותרת השתנתה — {limit} קמ"ש.'),
  'violation.focus': I('{advice} זה בדיוק מה שאנחנו מתרגלים היום.'),
  'praise.generic': I('יפה מאוד.', 'מצוין.', 'כל הכבוד, ככה בדיוק.'),

  // ---- interventions ---------------------------------------------------------------
  'intervention.brake': I('אני בולם!'),
  'intervention.explain.red_signal': I('היה אור אדום ולא התחלת לבלום. באור אדום עוצרים לפני קו העצירה.'),
  'intervention.explain.pedestrian': I('הולך רגל במעבר החצייה. חייבים לעצור ולתת לו לחצות.'),
  'intervention.explain.yield': I('רכב עם זכות קדימה הגיע לצומת. היה עליך להאט ולתת לו לעבור.'),
  'intervention.explain.collision': I('היינו מתנגשים ברכב שלפנינו. שמור מרחק והסתכל רחוק קדימה.'),
  'danger.reason.red_signal': S('אור אדום לפניך'),
  'danger.reason.pedestrian': S('הולך רגל במעבר חצייה'),
  'danger.reason.yield': S('רכב עם זכות קדימה בצומת'),
  'danger.reason.collision': S('סכנת התנגשות ברכב שלפניך'),

  // ---- explanations ('?' key) ---------------------------------------------------------
  'explain.speed': I('המהירות המותרת כאן {limit} קמ"ש.'),
  'explain.signals': I('לפניך צומת מרומזר. {stateText}'),
  'explain.signal_state.red': S('האור אדום — עוצרים לפני קו העצירה וממתינים.'),
  'explain.signal_state.red_amber': S('אדום-צהוב — מתכוננים לנסיעה, עדיין לא זזים.'),
  'explain.signal_state.green': S('האור ירוק — בודקים שהצומת פנוי וממשיכים.'),
  'explain.signal_state.flashing_green': S('ירוק מהבהב — הירוק עומד להסתיים. אם אפשר לעצור בבטחה, מתכוננים לעצור.'),
  'explain.signal_state.amber': S('צהוב — עוצרים, אלא אם אי אפשר לעצור בבטחה.'),
  'explain.signal_state.flashing_amber': S('צהוב מהבהב — הרמזור לא פעיל. ממשיכים בזהירות לפי התמרורים.'),
  'explain.signal_state.off': S('הרמזור כבוי — נוהגים לפי התמרורים וכללי זכות הקדימה.'),
  'explain.control.stop': I('לפניך תמרור עצור. עוצרים עצירה מלאה לפני הקו, ורק כשהדרך פנויה ממשיכים.'),
  'explain.control.give_way': I('לפניך תמרור תן זכות קדימה. מאטים, ונותנים לרכבים בדרך החוצה לעבור.'),
  'explain.control.right_hand_rule': I('צומת ללא תמרורים. זכות הקדימה לרכב שמגיע מימין.'),
  'explain.control.roundabout_entry': I('לפניך כיכר. נותנים זכות קדימה לרכב שכבר בתוך הכיכר, ונוסעים בה נגד כיוון השעון.'),
  'explain.control.priority': I('אתה בדרך עם זכות קדימה, אבל שים לב לרחובות הצדדיים ולהולכי רגל.'),
  'explain.control.none': I('הדרך ממשיכה ללא צומת מיוחד.'),
  'explain.crossing': I('מעבר חצייה בעוד {distance} מטר. הולך רגל שמחכה לחצות — עוצרים לו.'),
  'explain.oneway': I('זה רחוב חד-סטרי.'),
  'explain.zone30': I('אזור מיתון תנועה — מהירות מרבית 30.'),
  'explain.bus_lane': I('אתה בנתיב תחבורה ציבורית — עבור לנתיב הכללי.'),
  'explain.lane_turns': I('מהנתיב הזה מותר {turns}.'),
  'explain.turn.left': S('לפנות שמאלה'),
  'explain.turn.right': S('לפנות ימינה'),
  'explain.turn.straight': S('להמשיך ישר'),
  'explain.turn.uturn': S('לבצע פניית פרסה'),
  'explain.turn.join': S(' או '),
  'explain.kerb.red_white': I('אבן השפה כאן אדומה-לבנה — אסור לעצור ולחנות.'),
  'explain.kerb.red_yellow': I('תחנת אוטובוס — אסור לעצור כאן.'),
  'explain.kerb.blue_white': I('כחול-לבן — חניה בתשלום או לתושבים.'),
  'explain.inside_junction': I('אנחנו בתוך הצומת. ממשיכים ולא עוצרים בתוכו.'),
  'explain.nothing': I('אין משהו מיוחד כרגע. המשך בנסיעה רגילה.'),

  // ---- examiner ---------------------------------------------------------------------
  'examiner.greeting': E('שלום, אני הבוחן. ניסע לפי ההוראות שלי. כשתהיה מוכן, צא לדרך.'),
  'examiner.speeding': E('שים לב למהירות.'),
  'examiner.maneuver.pull_over': E('עצור בצד ליד המדרכה, במקום המותר.'),
  'examiner.maneuver.pull_over.done': E('המשך בנסיעה.'),
  'examiner.maneuver.pull_over.failed': E('המקום לא מתאים לעצירה. המשך בנסיעה.'),
  'examiner.maneuver.reverse': E('סע לאחור בקו ישר כ-15 מטר.'),
  'examiner.maneuver.reverse.done': E('טוב. המשך בנסיעה.'),
  'examiner.maneuver.reverse.failed': E('סטית מהקו. המשך בנסיעה.'),
  'examiner.maneuver.uturn': E('בצע פניית פרסה כשיתאפשר.'),
  'examiner.maneuver.uturn.done': E('המשך ישר.'),
  'examiner.maneuver.uturn.failed': E('נמשיך בלי הפרסה. המשך ישר.'),
  'examiner.maneuver.parallel_park': E('חנה בחניה מקבילה בין שני הרכבים.'),
  'examiner.maneuver.parallel_park.done': E('טוב. צא מהחניה והמשך בנסיעה.'),
  'examiner.maneuver.parallel_park.failed': E('נשאיר את זה. המשך בנסיעה.'),
  'examiner.maneuver.emergency_stop.prepare': E('כשאומר "עצור" — בלום בלימת חירום.'),
  'examiner.maneuver.emergency_stop.go': E('עצור!'),
  'examiner.maneuver.emergency_stop.done': E('טוב. המשך בנסיעה.'),
  'examiner.maneuver.emergency_stop.failed': E('הבלימה לא הייתה מספיק חזקה. המשך בנסיעה.'),
  'examiner.maneuver.missed': E('לא ביצעת את ההוראה. המשך בנסיעה.'),
  'examiner.intervention': E('אני בולם.'),
  'examiner.failed_continue': E('סע עד סוף הרחוב ועצור בצד.'),
  'examiner.finished': E('המבחן הסתיים.'),
  'examiner.finished.pull_over': E('המבחן הסתיים. עצור בצד ושים את הרכב בחניה.'),
  'examiner.timeout': E('הזמן נגמר. המבחן הסתיים.'),

  // ---- lesson runner ---------------------------------------------------------------
  'lesson.step_failed': I('{reason} ננסה שוב.'),
  'lesson.restart': I('נתחיל את השלב מחדש.'),
  'lesson.timeout': I('נגמר הזמן לשלב הזה. נסה שוב.'),
  'lesson.timeout.hint': S('נסה שוב'),
  'lesson.quiz.intro': I('שאלה קצרה לפני שממשיכים.'),
  'lesson.quiz.correct': I('נכון!', 'תשובה נכונה.', 'בדיוק.'),
  'lesson.quiz.wrong': I('לא בדיוק. התשובה הנכונה: {answer}'),
  'lesson.completed.passed': I('סיימנו את השיעור. עברת בהצלחה — ציון {score}.'),
  'lesson.completed.failed': I('סיימנו את השיעור. היו כמה טעויות — כדאי לתרגל שוב. ציון {score}.'),
  'lesson.aborted': I('הפסקנו את השיעור.'),
  'lesson.brake': I('אני בולם!'),

  // ---- verdict ---------------------------------------------------------------------
  'verdict.passed': S('עברת את המבחן.'),
  'verdict.failed': S('לא עברת את המבחן הפעם.'),
  'verdict.reason.critical': S('שגיאה חמורה: {label}'),
  'verdict.reason.points': S('צבירת {points} נקודות שגיאה (המותר עד {max})'),
  'verdict.reason.majors': S('{n} שגיאות חמורות (המותר עד {max})'),
  'verdict.strengths': S('נקודות חוזק: {list}.'),
  'verdict.weaknesses': S('יש לשפר: {list}.'),
  'verdict.clean': S('נהיגה נקייה כמעט לחלוטין — כל הכבוד.'),
  'verdict.list_join': S(', '),
  'verdict.category.speed': S('שמירה על מהירות'),
  'verdict.category.signals': S('התנהגות ברמזורים'),
  'verdict.category.priority': S('מתן זכות קדימה'),
  'verdict.category.signalling': S('איתות בזמן'),
  'verdict.category.lane': S('משמעת נתיבים'),
  'verdict.category.control': S('שליטה ברכב'),
  'verdict.category.observation': S('הסתכלות במראות'),
  'verdict.category.parking': S('עצירה וחניה'),
  'verdict.category.instructions': S('ביצוע הוראות'),

  // ---- parking legality reasons ---------------------------------------------------------
  'parking.reason.red_white': S('אבן שפה אדומה-לבנה'),
  'parking.reason.red_yellow': S('תחנת אוטובוס'),
  'parking.reason.disabled': S('חניית נכים'),
  'parking.reason.loading': S('אזור פריקה וטעינה'),
  'parking.reason.junction': S('קרוב מדי לצומת (פחות מ-12 מטר)'),
  'parking.reason.crossing': S('על מעבר חצייה או סמוך לו'),
  'parking.reason.sign': S('תמרור איסור עצירה / חניה'),
  'parking.reason.sidewalk': S('על המדרכה'),
  'parking.reason.not_kerb_lane': S('לא בנתיב הימני, ליד המדרכה'),
  'parking.reason.in_junction': S('בתוך צומת'),
  'parking.reason.unknown': S('מחוץ לכביש'),
};
