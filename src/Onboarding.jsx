import React, { useEffect, useMemo, useState } from 'react';
import logo from './logo.png';
import { I18nContext, LANGS, makeT } from './i18n.js';
import { formatAccelerator } from './hotkey.js';

const api = window.clip;
const isMac = api?.platform === 'darwin';

export default function Onboarding() {
  const [settings, setSettings] = useState({ lang: 'en', hotkey: 'CommandOrControl+Shift+V' });
  const i18n = useMemo(() => makeT(settings.lang), [settings.lang]);
  const { t } = i18n;

  useEffect(() => {
    api.getSettings().then(setSettings);
    return api.onSettings(setSettings);
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  return (
    <I18nContext.Provider value={i18n}>
      <div className="onboarding">
        <div className="ob-lang">
          {LANGS.map((l) => (
            <button
              key={l.id}
              className={settings.lang === l.id ? 'active' : ''}
              onClick={() => api.setSettings({ lang: l.id })}
            >
              {l.label}
            </button>
          ))}
        </div>

        <img className="ob-logo" src={logo} alt="" width="96" height="96" />
        <h1>{t('obTitle')}</h1>
        <p className="ob-sub">{t('obSubtitle')}</p>

        <ul className="ob-points">
          <li>{t('obPoint1')}</li>
          <li>{t('obPoint2')}</li>
          <li>{t('obPoint3')}</li>
          <li>{t('obPoint4')}</li>
        </ul>

        <div className="ob-hotkey">
          <div className="ob-hotkey-label">{t('obHotkey')}</div>
          <kbd>{formatAccelerator(settings.hotkey, isMac)}</kbd>
          <div className="ob-hotkey-note">{t('obHotkeyNote')}</div>
        </div>

        <p className="ob-access">{t('obAccess')}</p>

        <button className="ob-start" onClick={() => api.finishOnboarding()} autoFocus>
          {t('obStart')}
        </button>
      </div>
    </I18nContext.Provider>
  );
}
