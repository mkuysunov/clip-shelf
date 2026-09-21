import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Position, Settings as AppSettings, SettingsPatch } from '../electron/types';
import { I18nContext, LANGS, makeT } from './i18n';
import type { DictKey } from './i18n';
import HotkeyField from './HotkeyField';

const api = window.clip;
const POSITIONS: { id: Position; labelKey: DictKey }[] = [
  { id: 'bottom', labelKey: 'posBottom' },
  { id: 'top', labelKey: 'posTop' },
  { id: 'left', labelKey: 'posLeft' },
  { id: 'right', labelKey: 'posRight' },
];

interface SegmentProps<T extends string> {
  options: { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
}

// Переключатель из нескольких вариантов
function Segment<T extends string>({ options, value, onPick }: SegmentProps<T>) {
  return (
    <div className="segment">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'active' : ''} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface RowProps {
  title: string;
  hint?: string;
  stack?: boolean;
  children: ReactNode;
}

// Строка настройки: название и пояснение слева, элемент управления справа (stack — под названием)
function Row({ title, hint, stack, children }: RowProps) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-text">
        <div className="set-title">{title}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null); // null, пока не пришли из main — чтобы не мигать чужим языком
  const [login, setLogin] = useState(false);
  const i18n = useMemo(() => makeT(settings?.lang ?? 'en'), [settings?.lang]);
  const { t } = i18n;

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.getLoginItem().then(setLogin);
    const offs = [api.onSettings(setSettings), api.onLoginItem(setLogin)];
    // HotkeyField во время записи сам перехватывает Escape (capture), сюда он тогда не доходит
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && window.close();
    window.addEventListener('keydown', onKey);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (settings) document.documentElement.lang = settings.lang;
  }, [settings?.lang]);

  if (!settings) return null;
  const set = (patch: SettingsPatch) => api.setSettings(patch);

  return (
    <I18nContext.Provider value={i18n}>
      <div className="settings">
        <h1>{t('settings')}</h1>

        <div className="set-label">{t('secPanel')}</div>
        <div className="set-group">
          <Row title={t('positionTitle')} hint={t('positionHint')} stack>
            <div className="pos-grid">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  className={`pos-tile ${settings.position === p.id ? 'active' : ''}`}
                  onClick={() => set({ position: p.id })}
                >
                  {/* мини-экран с полоской там, где окажется панель */}
                  <span className={`pos-screen ${p.id}`} />
                  {t(p.labelKey)}
                </button>
              ))}
            </div>
          </Row>
          <Row title={t('modeTitle')} hint={t('modeHint')}>
            <Segment
              value={settings.mode}
              onPick={(mode) => set({ mode })}
              options={[
                { id: 'default', label: t('modeDefault') },
                { id: 'dev', label: t('modeDev') },
              ]}
            />
          </Row>
          <Row title={t('sortTitle')} hint={t('sortHint')} stack>
            <Segment
              value={settings.sort}
              onPick={(sort) => set({ sort })}
              options={[
                { id: 'newest', label: t('sortNewest') },
                { id: 'oldest', label: t('sortOldest') },
                { id: 'manual', label: t('sortManual') },
              ]}
            />
          </Row>
        </div>

        <div className="set-label">{t('secGeneral')}</div>
        <div className="set-group">
          <Row title={t('language')}>
            <Segment value={settings.lang} onPick={(lang) => set({ lang })} options={LANGS.map((l) => ({ id: l.id, label: l.label }))} />
          </Row>
          <Row title={t('loginTitle')} hint={t('loginHint')}>
            <button
              className={`switch ${login ? 'on' : ''}`}
              role="switch"
              aria-checked={login}
              aria-label={t('loginTitle')}
              onClick={() => api.setLoginItem(!login)}
            />
          </Row>
          <Row title={t('hotkey')} stack>
            <HotkeyField value={settings.hotkey} />
          </Row>
        </div>

        <button className="set-link" onClick={() => api.showOnboarding()}>
          {t('showIntro')}
        </button>
      </div>
    </I18nContext.Provider>
  );
}
