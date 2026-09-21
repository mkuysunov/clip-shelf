import React, { useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card.jsx';
import Toolbar from './Toolbar.jsx';
import { I18nContext, makeT } from './i18n.js';
import { DND_TYPE, kindOf } from './utils.js';

const api = window.clip;
const isMac = api?.platform === 'darwin';
const HISTORY_TAB = 'history';

export default function App() {
  const [items, setItems] = useState([]);
  const [collections, setCollections] = useState([]);
  const [settings, setSettings] = useState({ lang: 'en', mode: 'default', sort: 'newest', position: 'bottom' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // обычный режим: all / text / link / image
  const [tab, setTab] = useState(HISTORY_TAB); // режим разработчика: history / id коллекции
  const [selectedId, setSelectedId] = useState(null); // выбор по id — не сбивается при появлении новых элементов
  const [dragId, setDragId] = useState(null);
  const movingRef = useRef(false); // перестановка ждёт ответа main — не принимаем следующую
  const [, tick] = useState(0);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const i18n = useMemo(() => makeT(settings.lang), [settings.lang]);
  const { t } = i18n;
  const isDev = settings.mode === 'dev';
  const position = settings.position || 'bottom';
  const vertical = position === 'left' || position === 'right'; // панель сбоку — лента идёт сверху вниз
  const activeCollection = isDev && tab !== HISTORY_TAB ? collections.find((c) => c.id === tab) : null;
  const showingHistory = !activeCollection;

  useEffect(() => {
    if (!api) return;
    api.getHistory().then(setItems);
    api.getCollections().then(setCollections);
    api.getSettings().then(setSettings);
    const offs = [
      api.onUpdate(setItems),
      api.onCollections(setCollections),
      api.onSettings(setSettings),
      api.onShown(() => {
        setQuery('');
        setSelectedId(null);
        tick((n) => n + 1);
        listRef.current?.scrollTo({ left: 0, top: 0 });
        searchRef.current?.blur();
      }),
    ];
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      offs.forEach((off) => off());
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  // если активную коллекцию удалили — вернуться в историю
  useEffect(() => {
    if (isDev && tab !== HISTORY_TAB && !collections.some((c) => c.id === tab)) setTab(HISTORY_TAB);
  }, [collections, tab, isDev]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (activeCollection) {
      return activeCollection.items.filter(
        (s) => !q || s.title.toLowerCase().includes(q) || s.text.toLowerCase().includes(q)
      );
    }
    const list = items.filter((it) => {
      if (!isDev && filter !== 'all' && kindOf(it) !== filter) return false;
      if (!q) return true;
      return it.type === 'text' && it.text.toLowerCase().includes(q);
    });
    if (settings.sort === 'newest') return [...list].sort((a, b) => b.createdAt - a.createdAt);
    if (settings.sort === 'oldest') return [...list].sort((a, b) => a.createdAt - b.createdAt);
    return list; // manual — порядок массива истории
  }, [items, activeCollection, query, filter, isDev, settings.sort]);

  // ручная перестановка возможна: в истории при ручной сортировке, в коллекции — всегда
  const reorderable = activeCollection ? true : settings.sort === 'manual';
  // полный список в порядке хранения — нужен, чтобы при фильтре ставить элемент рядом с видимым соседом
  const full = activeCollection ? activeCollection.items : items;

  // индекс выбранной карточки; если её нет в списке — первая
  const selected = Math.max(0, visible.findIndex((v) => v.id === selectedId));
  const setSelected = (i) => setSelectedId(visible[Math.min(Math.max(i, 0), visible.length - 1)]?.id ?? null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selected, visible]);

  const moveItem = async (id, beforeId) => {
    if (movingRef.current) return;
    movingRef.current = true;
    try {
      await (activeCollection ? api.moveSnippet(id, beforeId) : api.move(id, beforeId));
    } finally {
      movingRef.current = false;
    }
  };
  const removeItem = (id) => (activeCollection ? api.removeSnippet(id) : api.remove(id));

  // id элемента, идущего в полном списке сразу после target (null — target последний)
  const afterInFull = (target) => full[full.findIndex((x) => x.id === target.id) + 1]?.id ?? null;

  // сдвинуть выбранную карточку на шаг назад/вперёд по ленте
  const nudge = (dir) => {
    const i = selected;
    const j = i + dir;
    if (!reorderable || movingRef.current || j < 0 || j >= visible.length) return;
    const beforeId = dir < 0 ? visible[j].id : afterInFull(visible[j]);
    moveItem(visible[i].id, beforeId);
  };

  // Клавиатура
  useEffect(() => {
    const onKey = (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const control = target.tagName === 'SELECT' || target.tagName === 'BUTTON';
      const inSearch = target === searchRef.current;
      const cur = visible[selected];

      if (e.key === 'Escape') {
        if ((typing && !inSearch) || target.tagName === 'SELECT') return target.blur();
        if (control) target.blur();
        if (query) setQuery('');
        else api.hide();
        return;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        api.showSettings();
        return;
      }
      if ((typing && !inSearch) || control) return; // редактируем название / работаем с селектом — не перехватываем

      // лента горизонтальная — ← →, вертикальная (панель сбоку) — ↑ ↓
      const [prevKey, nextKey] = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      if (e.key === nextKey || e.key === prevKey) {
        if (inSearch && !e.altKey && !vertical) return; // курсор в поле поиска
        e.preventDefault();
        const dir = e.key === nextKey ? 1 : -1;
        if (e.altKey) nudge(dir);
        else setSelected(selected + dir);
        return;
      }
      if (e.key === 'Enter' && cur) {
        e.preventDefault();
        api.paste(cur.id);
        return;
      }
      if (mod && e.key.toLowerCase() === 'c' && cur && !window.getSelection()?.toString()) {
        e.preventDefault();
        api.copy(cur.id);
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const it = visible[Number(e.key) - 1];
        if (it) api.paste(it.id);
        return;
      }
      if (!inSearch && (e.key === 'Backspace' || e.key === 'Delete') && cur) {
        e.preventDefault();
        removeItem(cur.id);
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!inSearch && !mod && !e.altKey && e.key.length === 1) searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // горизонтальную ленту крутим и обычным колесом; вертикальная прокручивается сама
  const onWheel = (e) => {
    if (!vertical && Math.abs(e.deltaY) > Math.abs(e.deltaX)) listRef.current.scrollLeft += e.deltaY;
  };

  // Drop в пустое место ленты — в конец
  const onListDragOver = (e) => {
    if (reorderable && dragId) e.preventDefault();
  };
  const onListDrop = (e) => {
    const id = e.dataTransfer.getData(DND_TYPE);
    if (!reorderable || !id) return;
    e.preventDefault();
    const last = visible[visible.length - 1];
    moveItem(id, last && last.id !== id ? afterInFull(last) : null);
    setDragId(null);
  };

  const emptyText = () => {
    if (activeCollection) return activeCollection.items.length ? t('notFound') : t('emptyCollection');
    return items.length ? t('notFound') : t('empty');
  };

  return (
    <I18nContext.Provider value={i18n}>
      <div className={`panel pos-${position} ${vertical ? 'vertical' : ''} ${isDev ? 'dev' : ''}`}>
        <Toolbar
          searchRef={searchRef}
          query={query}
          onQuery={(v) => {
            setQuery(v);
            setSelectedId(null);
          }}
          isDev={isDev}
          filter={filter}
          onFilter={(f) => {
            setFilter(f);
            setSelectedId(null);
          }}
          tab={tab}
          onTab={(id) => {
            setTab(id);
            setSelectedId(null);
            setQuery('');
          }}
          collections={collections}
          showingHistory={showingHistory}
          count={visible.length}
          onClear={() => items.length && api.clear()}
        />

        <main className="list" ref={listRef} onWheel={onWheel} onDragOver={onListDragOver} onDrop={onListDrop}>
          {visible.length === 0 ? (
            <div className="empty">{emptyText()}</div>
          ) : (
            visible.map((item, i) => (
              <Card
                key={item.id}
                item={item}
                index={i}
                isDev={isDev}
                collection={activeCollection}
                collections={collections}
                selected={i === selected}
                hotkey={i < 9 ? `${isMac ? '⌘' : 'Ctrl+'}${i + 1}` : null}
                reorderable={reorderable}
                dragId={dragId}
                onDragId={setDragId}
                onDropBefore={(beforeId) => dragId && dragId !== beforeId && moveItem(dragId, beforeId)}
                onSelect={() => setSelectedId(item.id)}
                onPaste={() => api.paste(item.id)}
                onCopy={() => api.copy(item.id)}
                onRemove={() => removeItem(item.id)}
                onNativeDrag={() => api.startDrag(item.id)}
                onRename={(title) => api.updateSnippet(item.id, { title })}
                onSaveTo={(collectionId, snippet) => api.addSnippet(collectionId, snippet)}
              />
            ))
          )}
        </main>
      </div>
    </I18nContext.Provider>
  );
}
