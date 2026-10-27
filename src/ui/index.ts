/**
 * UI module — public surface.
 *
 *   const ui = new UISystem(document.getElementById('ui')!, bus, settings);
 *   systems.push(ui);                       // ui.update(ctx) each frame
 *   ui.showScreen('mainMenu', { onSelect });
 *   ui.setRoute(graph.routeViaJunctions(...));
 */
export { UISystem, HUD_REFRESH_HZ, PREFS_STORAGE_KEY, type UISystemOptions } from './uiSystem';
export * from './types';
export { Hud, snapshotOf, RPM_MAX, OVER_LIMIT_TOLERANCE, type HudSnapshot } from './hud';
export { LawMonitor, chipFor, iconForViolation, CHIP_TTL, MAX_VIOLATION_CHIPS, MAX_PRAISE_CHIPS, type ChipData } from './lawMonitor';
export { NavBanner, navDisplay, NAV_NOW_THRESHOLD_M, NAV_HIDE_AFTER_S, type NavDisplay } from './navBanner';
export { Minimap, routeToPolyline, type MinimapOptions, type RoutePath } from './minimap';
export { TileCache, tilesInView, tileIndex, tileKey, TILE_SIZE_M, type TileCoord } from './minimapTiles';
export { Subtitles, DEFAULT_LINGER_S } from './subtitles';
export { Toasts } from './toasts';
export { LoadingScreen } from './loading';
export { icon, iconHtml, navIcon, isIconName, ICON_PATHS, type IconName, type IconOptions } from './icons';
export { renderDiagram, isDiagramId, DIAGRAM_IDS, type DiagramId } from './diagrams';
export { signImage, signPlaceholder, signCategoryFromCode, signSrc } from './signImage';
export { renderMarkdown, markdownHtml } from './markdown';
export { formatDistance, formatNavDistance, formatClock, formatDuration, formatDateHe, formatHour } from './format';
export { summarise as summariseTheoryQuiz, questionCard, PASS_RATIO, DEFAULT_EXAM_SECONDS } from './screens/theoryQuiz';
export { filterSigns } from './screens/signLibrary';
export * as strings from './strings.he';
