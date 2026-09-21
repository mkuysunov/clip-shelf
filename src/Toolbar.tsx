import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Collection } from '../electron/types';
import { useI18n } from './i18n';
import { COLLECTION_COLORS } from './utils';
import type { Filter } from './utils';

const api = window.clip;
const isMac = api?.platform === 'darwin';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface KindFiltersProps {
  filter: Filter;
  onFilter: (filter: Filter) => void;
}

// Вкладки обычного режима: фильтры по типу
function KindFilters({ filter, onFilter }: KindFiltersProps) {
  const { t } = useI18n();
  const filters: { id: Filter; label: string; dot?: string }[] = [
    { id: 'all', label: t('all') },
    { id: 'text', label: t('text'), dot: 'var(--c-text)' },
    { id: 'link', label: t('links'), dot: 'var(--c-link)' },
    { id: 'image', label: t('images'), dot: 'var(--c-image)' },
  ];
  return (
    <nav className="filters">
      {filters.map((f) => (
        <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => onFilter(f.id)}>
          {f.dot && <span className="dot" style={{ background: f.dot }} />}
          {f.label}
        </button>
      ))}
    </nav>
  );
}

interface CollectionTabsProps {
  tab: string;
  onTab: (id: string) => void;
  collections: Collection[];
}

// Вкладки режима разработчика: история + коллекции сниппетов + «+»
function CollectionTabs({ tab, onTab, collections }: CollectionTabsProps) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const submit = async () => {
    const n = name.trim();
    setAdding(false);
    setName('');
    if (!n || cancelRef.current) return;
    const color = COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length];
    const id = await api.addCollection(n, color);
    onTab(id);
  };

  const remove = async (c: Collection) => {
    if (await api.confirm(t('confirmDeleteCollection', c.name, c.items.length))) api.removeCollection(c.id);
  };

  return (
    <nav className="filters">
      <button className={tab === 'history' ? 'active' : ''} onClick={() => onTab('history')}>
        <span className="dot" style={{ background: 'var(--muted)' }} />
        {t('clipboardHistory')}
      </button>
      {collections.map((c) => (
        <button key={c.id} className={`tab ${tab === c.id ? 'active' : ''}`} onClick={() => onTab(c.id)}>
          <span className="dot" style={{ background: c.color }} />
          {c.name}
          {tab === c.id && (
            <span
              className="tab-close"
              title={t('deleteCollection')}
              onClick={(e) => {
                e.stopPropagation();
                remove(c);
              }}
            >
              ×
            </span>
          )}
        </button>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          className="tab-input"
          value={name}
          placeholder={t('collectionName')}
          onChange={(e) => setName(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') {
              cancelRef.current = true;
              setName('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button
          className="tab-add"
          title={t('newCollection')}
          onClick={() => {
            cancelRef.current = false;
            setAdding(true);
          }}
        >
          +
        </button>
      )}
    </nav>
  );
}

// Кнопка настроек: открывает отдельное окно
function SettingsButton() {
  const { t } = useI18n();
  return (
    <button className="ghost settings-btn" title={`${t('settings')} (${isMac ? '⌘' : 'Ctrl+'},)`} onClick={() => api.showSettings()}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );
}

interface Props extends KindFiltersProps, CollectionTabsProps {
  searchRef: RefObject<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
  isDev: boolean;
  showingHistory: boolean;
  count: number;
  onClear: () => void;
}

export default function Toolbar({
  searchRef,
  query,
  onQuery,
  isDev,
  filter,
  onFilter,
  tab,
  onTab,
  collections,
  showingHistory,
  count,
  onClear,
}: Props) {
  const { t } = useI18n();

  return (
    <header className="toolbar">
      <div className="search">
        <SearchIcon />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('search')}
          spellCheck={false}
        />
      </div>

      {isDev ? (
        <CollectionTabs tab={tab} onTab={onTab} collections={collections} />
      ) : (
        <KindFilters filter={filter} onFilter={onFilter} />
      )}

      <div className="toolbar-right">
        <span className="count">{count}</span>
        {showingHistory && (
          <button className="ghost" title={t('clearHistory')} onClick={onClear}>
            {t('clear')}
          </button>
        )}
        <SettingsButton />
      </div>
    </header>
  );
}
