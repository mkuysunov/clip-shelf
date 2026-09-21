import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n.js';
import { eventToAccelerator, formatAccelerator, hasStrongModifier } from './hotkey.js';

const api = window.clip;
const isMac = api?.platform === 'darwin';

// Поле «горячая клавиша»: клик -> запись сочетания -> проверка в main
export default function HotkeyField({ value, onSaved }) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState(null); // { ok, text }
  const btnRef = useRef(null);

  useEffect(() => {
    if (!recording) return;
    api.setRecording(true);
    btnRef.current?.focus();
    const stop = () => {
      setRecording(false);
      setPreview('');
      api.setRecording(false);
    };
    const onKey = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stop();
      const { mods, key, accel } = eventToAccelerator(e, isMac);
      if (!key) {
        setPreview(formatAccelerator([...mods, '…'].join('+'), isMac));
        return;
      }
      if (!hasStrongModifier(mods)) {
        setStatus({ ok: false, text: t('hotkeyNoKey') });
        return;
      }
      const res = await api.setHotkey(accel);
      setStatus(res.ok ? { ok: true, text: t('hotkeySaved') } : { ok: false, text: res.error });
      if (res.ok) onSaved?.(accel);
      stop();
    };
    const onKeyUp = () => setPreview('');
    const onBlur = () => stop();
    const btn = btnRef.current;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    btn?.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      btn?.removeEventListener('blur', onBlur);
      api.setRecording(false);
    };
  }, [recording, t, onSaved]);

  useEffect(() => {
    if (!status?.ok) return;
    const id = setTimeout(() => setStatus(null), 1800);
    return () => clearTimeout(id);
  }, [status]);

  return (
    <div className="hotkey-field">
      <button
        ref={btnRef}
        className={`hotkey-btn ${recording ? 'recording' : ''}`}
        onClick={() => {
          setStatus(null);
          setRecording(true);
        }}
      >
        <kbd>{recording ? preview || t('hotkeyRecording') : formatAccelerator(value, isMac)}</kbd>
        {!recording && <span className="hotkey-change">{t('hotkeyChange')}</span>}
      </button>
      <div className={`hotkey-status ${status ? (status.ok ? 'ok' : 'err') : ''}`}>
        {status ? status.text : t('hotkeyHint')}
      </div>
    </div>
  );
}
