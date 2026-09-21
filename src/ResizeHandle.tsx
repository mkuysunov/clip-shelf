import { useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Position } from '../electron/types';
import { useI18n } from './i18n';

const api = window.clip;

// Ручка на краю панели, обращённом к экрану: потянуть — изменить высоту панели (у панели сбоку — ширину),
// двойной клик — вернуть размер по умолчанию. Само окно двигает main, сюда нужен только факт движения мыши.
export default function ResizeHandle({ position }: { position: Position }) {
  const { t } = useI18n();
  const grabRef = useRef<number | null>(null); // отступ курсора от края панели в момент захвата; null — не тянем

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId); // мышь уходит за пределы окна — события всё равно наши
    const grabs: Record<Position, number> = {
      bottom: e.clientY,
      top: window.innerHeight - e.clientY,
      left: window.innerWidth - e.clientX,
      right: e.clientX,
    };
    // увеличенная панель отрисована в масштабе, а main считает в экранных точках: у окна без рамки масштаб = outer / inner
    grabRef.current = grabs[position] * (window.outerWidth / window.innerWidth);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (grabRef.current === null) return;
    if (e.buttons & 1) api.resizePanel(grabRef.current);
    else grabRef.current = null; // кнопку отпустили, а pointerup до нас не дошёл — размер за мышью больше не ведём
  };
  const stop = () => {
    grabRef.current = null;
  };

  return (
    <div
      className="resize-handle"
      title={t('resizeHint')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => api.resetPanelSize()}
    />
  );
}
