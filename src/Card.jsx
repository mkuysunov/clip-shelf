import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n.js';
import { DND_TYPE, KIND_COLOR, KIND_LABEL_KEY, defaultTitle, hostOf, kindOf } from './utils.js';

function Icon({ kind }) {
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
const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
    <path d="M4 20h4l10-10-4-4L4 16v4zM13 7l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

// Всплывающий список коллекций для сохранения сниппета
function SaveMenu({ collections, onPick, onClose }) {
  const { t } = useI18n();
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || e.target.closest('.save-trigger')) return;
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

export default function Card({
  item,
  index,
  isDev,
  collection, // задана, если карточка — сниппет коллекции
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
}) {
  const { t, timeAgo } = useI18n();
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const titleRef = useRef(null);
  const cancelRef = useRef(false);

  const isSnippet = !!collection;
  const kind = isSnippet ? 'snippet' : kindOf(item);
  const accent = isSnippet ? collection.color : KIND_COLOR[kind];
  const text = item.text ?? '';

  useEffect(() => {
    if (editing) titleRef.current?.select();
  }, [editing]);

  const startRename = () => {
    cancelRef.current = false;
    setTitle(item.title);
    setEditing(true);
  };
  const finishRename = () => {
    setEditing(false);
    if (cancelRef.current) return;
    const v = title.trim();
    if (v && v !== item.title) onRename(v);
  };
  const cancelRename = () => {
    cancelRef.current = true;
    setEditing(false);
  };

  // ---- drag ----
  const onDragStart = (e) => {
    // картинку тащим как файл, кроме случая, когда включена ручная перестановка
    if (item.type === 'image' && !reorderable) {
      e.preventDefault();
      onNativeDrag();
      return;
    }
    if (item.type !== 'image') {
      e.dataTransfer.setData('text/plain', text);
      e.dataTransfer.effectAllowed = 'copyMove';
    }
    e.dataTransfer.setData(DND_TYPE, item.id);
    onDragId(item.id);
  };
  const onDragOver = (e) => {
    if (!reorderable || !dragId || dragId === item.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  const onDrop = (e) => {
    if (!reorderable || !dragId) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    onDropBefore(item.id);
    onDragId(null);
  };

  const canSave = isDev && !isSnippet && item.type === 'text';

  return (
    <article
      className={`card ${selected ? 'selected' : ''} ${over ? 'drop-before' : ''} ${isDev ? 'mono' : ''}`}
      data-index={index}
      style={{ '--accent': accent }}
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
              <div className="card-title" title={item.title}>
                {item.title}
              </div>
            )
          ) : (
            <>
              <div className="card-title">{t(KIND_LABEL_KEY[kind])}</div>
              <div className="card-time">{timeAgo(item.createdAt)}</div>
            </>
          )}
        </div>
        {!isSnippet && (
          <div className="card-icon">
            <Icon kind={kind} />
          </div>
        )}
      </div>

      <div className={`card-body ${kind}`}>
        {kind === 'image' && <img src={item.thumb} alt="" draggable={false} />}
        {(kind === 'text' || kind === 'snippet') && (isDev ? <pre>{text.slice(0, 600)}</pre> : <p>{text.slice(0, 600)}</p>)}
        {kind === 'link' && (
          <div className="link-box">
            <div className="link-host">{hostOf(text.trim())}</div>
            <div className="link-url">{text.trim()}</div>
          </div>
        )}
      </div>

      <div className="card-foot">
        {kind === 'image' ? <span className="pill">{`${item.width} × ${item.height}`}</span> : <span>{t('chars', text.length)}</span>}
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
