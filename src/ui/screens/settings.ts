import { DEFAULT_SETTINGS, type Settings } from '@/core/sim';
import { button, el, setText } from '../dom';
import { SETTINGS } from '../strings.he';
import { DEFAULT_UI_PREFS, type ScreenHandle, type ScreenHost, type SettingsProps } from '../types';
import { field, footer, panel, section, segmented, select, slider, toggle } from './common';

export function settingsScreen(host: ScreenHost, props: SettingsProps): ScreenHandle {
  const s: Settings = { ...props.settings };
  const prefs = host.prefs;
  const { el: root, body } = panel({ title: SETTINGS.title, icon: 'settings', size: 'md', onClose: props.onClose });
  const content = el('div', { style: { display: 'contents' } });
  body.appendChild(content);

  const emit = () => props.onChange({ ...s }, { ...prefs });

  function render(): void {
    content.innerHTML = '';
    // audio
    const volVal = el('span', { class: 'field-value num', text: `${Math.round(s.volume * 100)}%` });
    const voiceOptions = [{ value: '', label: SETTINGS.voiceDefault }, ...props.voices.map((v) => ({ value: v, label: v }))];
    content.appendChild(
      section(
        SETTINGS.audio,
        'volume',
        el(
          'div',
          { class: 'form' },
          field(SETTINGS.volume, slider(0, 1, 0.05, s.volume, (v) => ((s.volume = v), setText(volVal, `${Math.round(v * 100)}%`), emit()), SETTINGS.volume), { value: volVal }),
          field(SETTINGS.tts, toggle(s.tts, (v) => ((s.tts = v), emit()))),
          field(SETTINGS.voice, select(voiceOptions, prefs.ttsVoice ?? '', (v) => ((prefs.ttsVoice = v || null), emit()), SETTINGS.voice)),
          field(SETTINGS.subtitles, toggle(s.subtitles, (v) => ((s.subtitles = v), emit()))),
        ),
      ),
    );
    // driving
    const assistVal = el('span', { class: 'field-value num', text: `${Math.round(s.steeringAssist * 100)}` });
    content.appendChild(
      section(
        SETTINGS.driving,
        'wheel',
        el(
          'div',
          { class: 'form' },
          field(SETTINGS.steeringAssist, slider(0, 1, 0.05, s.steeringAssist, (v) => ((s.steeringAssist = v), setText(assistVal, String(Math.round(v * 100))), emit()), SETTINGS.steeringAssist), { value: assistVal, hint: SETTINGS.steeringHint }),
          field(SETTINGS.mirrors, toggle(s.mirrors, (v) => ((s.mirrors = v), emit())), { hint: SETTINGS.mirrorsHint }),
        ),
      ),
    );
    // display
    content.appendChild(
      section(
        SETTINGS.display,
        'eye',
        el(
          'div',
          { class: 'form' },
          field(
            SETTINGS.quality,
            segmented(
              (['low', 'medium', 'high'] as const).map((q) => ({ value: q, label: SETTINGS.qualityOptions[q] ?? q })),
              s.quality,
              (v) => ((s.quality = v as Settings['quality']), emit()),
              SETTINGS.quality,
            ),
          ),
          field(SETTINGS.lawMonitor, toggle(s.showLawMonitor, (v) => ((s.showLawMonitor = v), emit()))),
          field(SETTINGS.minimapHeadingUp, toggle(prefs.minimapHeadingUp, (v) => ((prefs.minimapHeadingUp = v), emit()))),
          field(SETTINGS.hintPrompt, toggle(prefs.hintPrompt, (v) => ((prefs.hintPrompt = v), emit()))),
        ),
      ),
    );
    // controls
    content.appendChild(
      section(
        SETTINGS.controls,
        'gamepad',
        el(
          'div',
          { class: 'form' },
          field(
            SETTINGS.scheme,
            segmented(
              [
                { value: 'keyboard', label: SETTINGS.schemeOptions.keyboard!, icon: 'keyboard' },
                { value: 'gamepad', label: SETTINGS.schemeOptions.gamepad!, icon: 'gamepad' },
                { value: 'wheel', label: SETTINGS.schemeOptions.wheel!, icon: 'wheel' },
              ],
              s.controls,
              (v) => ((s.controls = v as Settings['controls']), emit()),
              SETTINGS.scheme,
            ),
            { hint: SETTINGS.autoDetect },
          ),
          field(SETTINGS.gamepad, el('span', { class: 'muted', text: props.gamepadStatus })),
        ),
      ),
    );
    content.appendChild(
      footer(
        button(SETTINGS.reset, () => {
          Object.assign(s, DEFAULT_SETTINGS);
          Object.assign(prefs, DEFAULT_UI_PREFS);
          emit();
          render();
        }, { variant: 'ghost', icon: 'replay' }),
        button(SETTINGS.close, props.onClose, { variant: 'primary', icon: 'check', kbd: 'Esc' }),
      ),
    );
  }
  render();
  return { el: root, kind: 'full', onKey: (e) => (e.key === 'Escape' ? (props.onClose(), true) : false) };
}
