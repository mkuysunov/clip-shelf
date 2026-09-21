import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import type { Collection, SnippetDraft } from '../electron/types';
import { useI18n } from './i18n';
import { DND_TYPE, KIND_COLOR, KIND_LABEL_KEY, defaultTitle, hostOf, kindOf } from './utils';
import type { CardItem, Kind } from './utils';

function Icon({ kind }: { kind: Kind | 'snippet' }) {
  if (kind === 'image')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="9" cy="10" r="1.8" fill="currentColor" />
        <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  if (kind === 'link')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (kind === 'snippet')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path d="M5 6h14M5 10h14M5 14h10M5 18h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
    <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const DeviceIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
    <rect x="7" y="3" width="10" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M11 17.5h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
    <path d="M4 20h4l10-10-4-4L4 16v4zM13 7l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

interface SaveMenuProps {
  collections: Collection[];
  onPick: (collectionId: string) => void;
  onClose: () => void;
}

// Всплывающий список коллекций для сохранения сниппета
function SaveMenu({ collections, onPick, onClose }: SaveMenuProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: Event) => {
      const target = e.target as Element;
      if (ref.current?.contains(target) || target.closest('.save-trigger')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('wheel', onDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('wheel', onDown);
    };
  }, [onClose]);
  return (
    <div className="save-menu" ref={ref}>
      {collections.length === 0 && <div className="save-menu-empty">{t('noCollections')}</div>}
      {collections.map((c) => (
        <button key={c.id} onClick={() => onPick(c.id)}>
          <span className="dot" style={{ background: c.color }} />
          {c.name}
        </button>
      ))}
    </div>
  );
}

// Панель можно сделать ниже обычной, и карточки сжимаются вместе с ней (выше обычной — растёт масштаб, а не карточки),
// поэтому число строк текста считаем по факту: сколько целых строк помещается в тело карточки.
// Один наблюдатель на все карточки; сначала все замеры, потом запись — без лишних layout.
const clampObserver = new ResizeObserver((entries) => {
  const jobs = entries.map(({ target, contentRect }) => {
    const el = target.querySelector<HTMLElement>('p, pre, .link-url');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const room = contentRect.height - el.offsetTop - parseFloat(cs.paddingTop);
    return { el, lines: Math.max(1, Math.floor(room / parseFloat(cs.lineHeight))) };
  });
  for (const job of jobs) if (job) job.el.style.webkitLineClamp = String(job.lines);
});

interface Props {
  item: CardItem;
  index: number;
  isDev: boolean;
  collection?: Collection | null; // задана, если карточка — сниппет коллекции
  collections: Collection[];
  selected: boolean;
  hotkey: string | null;
  reorderable: boolean;
  dragId: string | null;
  onDragId: (id: string | null) => void;
  onDropBefore: (beforeId: string) => void;
  onSelect: () => void;
  onPaste: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onNativeDrag: () => void;
  onRename: (title: string) => void;
  onSaveTo: (collectionId: string, snippet: SnippetDraft) => void;
}

export default function Card({
  item,
  index,
  isDev,
  collection,
  collections,
  selected,
  hotkey,
  reorderable,
  dragId,
  onDragId,
  onDropBefore,
  onSelect,
  onPaste,
  onCopy,
  onRemove,
  onNativeDrag,
  onRename,
  onSaveTo,
}: Props) {
  const { t, timeAgo } = useI18n();
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);

  const entry = 'type' in item ? item : null; // элемент истории; у сниппета коллекции поля type нет
  const image = entry?.type === 'image' ? entry : null;
  const kind = entry ? kindOf(entry) : 'snippet';
  const isSnippet = kind === 'snippet';
  const accent = isSnippet ? collection?.color : KIND_COLOR[kind];
  const text = 'text' in item ? item.text : '';
  const snippetTitle = 'title' in item ? item.title : '';

  useEffect(() => {
    if (editing) titleRef.current?.select();
  }, [editing]);

  // смена режима заменяет <p> на <pre> — наблюдение начинаем заново, чтобы новый элемент получил своё число строк
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    clampObserver.observe(body);
    return () => clampObserver.unobserve(body);
  }, [isDev]);

  const startRename = () => {
    cancelRef.current = false;
    setTitle(snippetTitle);
    setEditing(true);
  };
  const finishRename = () => {
    setEditing(false);
    if (cancelRef.current) return;
    const v = title.trim();
    if (v && v !== snippetTitle) onRename(v);
  };
  const cancelRename = () => {
    cancelRef.current = true;
    setEditing(false);
  };

  // ---- drag ----
  const onDragStart = (e: DragEvent) => {
    // картинку тащим как файл, кроме случая, когда включена ручная перестановка
    if (image && !reorderable) {
      e.preventDefault();
      onNativeDrag();
      return;
    }
    if (!image) {
      e.dataTransfer.setData('text/plain', text);
      e.dataTransfer.effectAllowed = 'copyMove';
    }
    e.dataTransfer.setData(DND_TYPE, item.id);
    onDragId(item.id);
  };
  const onDragOver = (e: DragEvent) => {
    if (!reorderable || !dragId || dragId === item.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    if (!reorderable || !dragId) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    onDropBefore(item.id);
    onDragId(null);
  };

  const canSave = isDev && entry?.type === 'text';

  return (
    <article
      className={`card ${selected ? 'selected' : ''} ${over ? 'drop-before' : ''} ${isDev ? 'mono' : ''}`}
      data-index={index}
      style={{ '--accent': accent } as CSSProperties}
      onClick={onSelect}
      onDoubleClick={onPaste}
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={() => onDragId(null)}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="card-head">
        <div className="card-head-text">
          {isSnippet ? (
            editing ? (
              <input
                ref={titleRef}
                className="title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename();
                  if (e.key === 'Escape') cancelRename();
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="card-title" title={snippetTitle}>
                {snippetTitle}
              </div>
            )
          ) : (
            <>
              <div className="card-title">{t(KIND_LABEL_KEY[kind])}</div>
              <div className="card-time">
                {timeAgo(item.createdAt)}
                {entry?.remote && (
                  <span className="card-remote" title={t('fromOtherDevice')}>
                    <DeviceIcon />
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        {!isSnippet && (
          <div className="card-icon">
            <Icon kind={kind} />
          </div>
        )}
      </div>

      <div className={`card-body ${kind}`} ref={bodyRef}>
        {image && <img src={image.thumb} alt="" draggable={false} />}
        {(kind === 'text' || kind === 'snippet') && (isDev ? <pre>{text.slice(0, 600)}</pre> : <p>{text.slice(0, 600)}</p>)}
        {kind === 'link' && (
          <div className="link-box">
            <div className="link-host">{hostOf(text.trim())}</div>
            <div className="link-url">{text.trim()}</div>
          </div>
        )}
      </div>

      <div className="card-foot">
        {image ? <span className="pill">{`${image.width} × ${image.height}`}</span> : <span>{t('chars', text.length)}</span>}
      </div>

      {hotkey && <span className="hotkey">{hotkey}</span>}

      <div className="card-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {canSave && (
          <button className="save-trigger" title={t('addToCollection')} onClick={() => setMenu((m) => !m)}>
            +
          </button>
        )}
        {isSnippet && (
          <button title={t('rename')} onClick={startRename}>
            <PencilIcon />
          </button>
        )}
        <button title={t('copy')} onClick={onCopy}>
          <CopyIcon />
        </button>
        <button title={t('delete')} onClick={onRemove}>
          <CloseIcon />
        </button>
      </div>

      {menu && (
        <SaveMenu
          collections={collections}
          onClose={() => setMenu(false)}
          onPick={(cid) => {
            onSaveTo(cid, { title: defaultTitle(text, t('untitled')), text });
            setMenu(false);
          }}
        />
      )}
    </article>
  );
}
