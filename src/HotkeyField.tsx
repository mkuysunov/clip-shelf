import { useEffect, useRef, useState } from 'react';
import type { HotkeyAction } from '../electron/types';
import { useI18n } from './i18n';
import { eventToAccelerator, formatAccelerator, hasStrongModifier } from './hotkey';

const api = window.clip;
const isMac = api?.platform === 'darwin';

interface Props {
  value: string;
  action?: HotkeyAction; // какое глобальное сочетание меняем; по умолчанию — открытие панели
  onSaved?: (accel: string) => void;
}

// Поле «горячая клавиша»: клик -> запись сочетания -> проверка в main
export default function HotkeyField({ value, action, onSaved }: Props) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    api.setRecording(true);
    btnRef.current?.focus();
    const stop = () => {
      setRecording(false);
      setPreview('');
      api.setRecording(false);
    };
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stop();
      const { mods, accel } = eventToAccelerator(e, isMac);
      // accel === null — нажаты только модификаторы
      if (!accel) {
        setPreview(formatAccelerator([...mods, '…'].join('+'), isMac));
        return;
      }
      if (!hasStrongModifier(mods)) {
        setStatus({ ok: false, text: t('hotkeyNoKey') });
        return;
      }
      const res = await api.setHotkey(accel, action);
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
  }, [recording, t, action, onSaved]);

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
