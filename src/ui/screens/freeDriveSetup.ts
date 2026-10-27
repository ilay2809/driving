import { button, el, setText, toggleClass } from '../dom';
import { formatHour } from '../format';
import { icon } from '../icons';
import { COMMON, FREE } from '../strings.he';
import type { FreeDriveConfig, FreeDriveSetupProps, ScreenHandle, ScreenHost } from '../types';
import { field, footer, panel, segmented, select, slider, toggle } from './common';

function levelLabel(v: number): string {
  const idx = Math.min(FREE.levels.length - 1, Math.round(v * (FREE.levels.length - 1)));
  return FREE.levels[idx] ?? '';
}

export function freeDriveSetupScreen(_host: ScreenHost, props: FreeDriveSetupProps): ScreenHandle {
  const cfg: FreeDriveConfig = {
    spawnId: props.defaults?.spawnId ?? props.spawnPoints[0]?.id ?? '',
    traffic: props.defaults?.traffic ?? 0.4,
    pedestrians: props.defaults?.pedestrians ?? 0.4,
    hour: props.defaults?.hour ?? 10,
    weather: props.defaults?.weather ?? 'clear',
    coach: props.defaults?.coach ?? true,
    lawMonitor: props.defaults?.lawMonitor ?? true,
  };
  const { el: root, body } = panel({ title: FREE.title, icon: 'car', subtitle: FREE.subtitle, size: 'md', onClose: props.onBack, closeLabel: COMMON.back });
  const form = el('div', { class: 'form' });

  const spawnSel = select(
    props.spawnPoints.map((s) => ({ value: s.id, label: s.name })),
    cfg.spawnId,
    (v) => (cfg.spawnId = v),
    FREE.spawn,
  );
  form.appendChild(field(FREE.spawn, spawnSel));

  const trafficVal = el('span', { class: 'field-value', text: levelLabel(cfg.traffic) });
  form.appendChild(field(FREE.traffic, slider(0, 1, 0.05, cfg.traffic, (v) => ((cfg.traffic = v), setText(trafficVal, levelLabel(v))), FREE.traffic), { value: trafficVal }));
  const pedVal = el('span', { class: 'field-value', text: levelLabel(cfg.pedestrians) });
  form.appendChild(field(FREE.pedestrians, slider(0, 1, 0.05, cfg.pedestrians, (v) => ((cfg.pedestrians = v), setText(pedVal, levelLabel(v))), FREE.pedestrians), { value: pedVal }));

  const hourIcons = { moon: icon('moon', { size: 18 }), sun: icon('sun', { size: 18 }) };
  const hourVal = el('span', { class: 'field-value num', text: formatHour(cfg.hour) });
  const hourControl = el('div', { class: 'control', style: { width: '100%' } }, el('span', { class: 'hour-icons' }, hourIcons.moon), slider(0, 24, 0.5, cfg.hour, (v) => {
    cfg.hour = v;
    setText(hourVal, formatHour(v));
    updateHourIcons();
  }, FREE.hour), el('span', { class: 'hour-icons' }, hourIcons.sun));
  const updateHourIcons = () => {
    const day = cfg.hour >= 6.5 && cfg.hour < 18.5;
    toggleClass(hourIcons.sun, 'active', day);
    toggleClass(hourIcons.moon, 'active', !day);
  };
  updateHourIcons();
  form.appendChild(field(FREE.hour, hourControl, { value: hourVal }));

  form.appendChild(
    field(
      FREE.weather,
      segmented(
        [
          { value: 'clear', label: FREE.weatherOptions.clear!, icon: 'sun' },
          { value: 'rain', label: FREE.weatherOptions.rain!, icon: 'rain' },
          { value: 'fog', label: FREE.weatherOptions.fog!, icon: 'fog' },
        ],
        cfg.weather,
        (v) => (cfg.weather = v as FreeDriveConfig['weather']),
        FREE.weather,
      ),
    ),
  );
  form.appendChild(field(FREE.coach, toggle(cfg.coach, (v) => (cfg.coach = v)), { hint: FREE.coachHint }));
  form.appendChild(field(FREE.lawMonitor, toggle(cfg.lawMonitor, (v) => (cfg.lawMonitor = v)), { hint: FREE.lawMonitorHint }));
  body.appendChild(form);

  const start = button(FREE.start, () => props.onStart({ ...cfg }), { variant: 'primary', icon: 'play', class: 'btn-lg' });
  body.appendChild(footer(button(COMMON.back, props.onBack, { variant: 'ghost', icon: 'chevronRight', kbd: 'Esc' }), start));
  return { el: root, kind: 'full', initialFocus: start, onKey: (e) => (e.key === 'Escape' ? (props.onBack(), true) : false) };
}
