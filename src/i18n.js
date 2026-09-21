import { createContext, useContext } from 'react';

export const LANGS = [
  { id: 'en', label: 'EN' },
  { id: 'ru', label: 'RU' },
];

const dict = {
  en: {
    search: 'Search…',
    all: 'All',
    text: 'Text',
    links: 'Links',
    images: 'Images',
    kindText: 'Text',
    kindLink: 'Link',
    kindImage: 'Image',
    clear: 'Clear',
    clearHistory: 'Clear history',
    empty: 'History is empty — copy some text or an image',
    emptyCollection: 'No snippets yet — hover a clipboard card and press "+"',
    notFound: 'Nothing found',
    chars: (n) => `${n.toLocaleString('en')} ${n === 1 ? 'character' : 'characters'}`,
    justNow: 'just now',
    modeDefault: 'Default',
    modeDev: 'Developer',
    modeTitle: 'Panel mode',
    modeHint: 'Developer: dark theme, monospace font and snippet collections.',
    language: 'Language',
    sortTitle: 'Sort order',
    sortNewest: 'Newest first',
    sortOldest: 'Oldest first',
    sortManual: 'Manual order',
    sortHint: 'Manual order lets you drag cards to rearrange them.',
    secPanel: 'Panel',
    secGeneral: 'General',
    loginTitle: 'Launch at login',
    loginHint: 'Start ClipShelf automatically when you log in.',
    positionTitle: 'Panel position',
    positionHint: 'The screen edge the panel slides out from.',
    posBottom: 'Bottom',
    posTop: 'Top',
    posLeft: 'Left',
    posRight: 'Right',
    clipboardHistory: 'Clipboard History',
    newCollection: 'New collection',
    collectionName: 'Collection name',
    deleteCollection: 'Delete collection',
    confirmDeleteCollection: (name, n) => `Delete "${name}" with ${n} snippet(s)?`,
    addToCollection: 'Save to collection',
    noCollections: 'Create a collection first (+ in the tab bar)',
    rename: 'Rename',
    copy: 'Copy',
    delete: 'Delete',
    untitled: 'Untitled',
    settings: 'Settings',
    hotkey: 'Open panel shortcut',
    hotkeyChange: 'Change',
    hotkeyRecording: 'Press keys…',
    hotkeyHint: 'Use ⌘, ⌃ or ⌥ plus a key. Esc to cancel.',
    hotkeySaved: 'Saved',
    hotkeyNoKey: 'Press a key together with ⌘, ⌃ or ⌥',
    showIntro: 'Show welcome screen',
    obTitle: 'Welcome to ClipShelf',
    obSubtitle: 'Everything you copy, one shortcut away.',
    obPoint1: 'Text, links and images you copy are saved automatically.',
    obPoint2: 'Press the shortcut to open the panel, ← → to pick, Enter to paste.',
    obPoint3: 'Double-click a card to paste it straight into the active app.',
    obPoint4: 'Developer mode keeps your favourite snippets in collections.',
    obHotkey: 'Your shortcut to open the panel',
    obHotkeyNote: 'You can change it later in Settings — the gear button in the panel.',
    obAccess: 'To paste directly into apps, allow ClipShelf in System Settings → Privacy & Security → Accessibility.',
    obStart: 'Get started',
  },
  ru: {
    search: 'Поиск…',
    all: 'Все',
    text: 'Текст',
    links: 'Ссылки',
    images: 'Изображения',
    kindText: 'Текст',
    kindLink: 'Ссылка',
    kindImage: 'Изображение',
    clear: 'Очистить',
    clearHistory: 'Очистить историю',
    empty: 'История пуста — скопируйте текст или картинку',
    emptyCollection: 'Пока пусто — наведите на карточку истории и нажмите «+»',
    notFound: 'Ничего не найдено',
    chars: (n) => {
      const f = new Intl.PluralRules('ru').select(n);
      const forms = { one: 'символ', few: 'символа', many: 'символов', other: 'символа' };
      return `${n.toLocaleString('ru')} ${forms[f]}`;
    },
    justNow: 'только что',
    modeDefault: 'Обычный',
    modeDev: 'Разработчик',
    modeTitle: 'Режим панели',
    modeHint: 'Разработчик: тёмная тема, моноширинный шрифт и коллекции сниппетов.',
    language: 'Язык',
    sortTitle: 'Порядок',
    sortNewest: 'Сначала новые',
    sortOldest: 'Сначала старые',
    sortManual: 'Вручную',
    sortHint: 'В ручном режиме карточки можно перетаскивать.',
    secPanel: 'Панель',
    secGeneral: 'Основные',
    loginTitle: 'Запускать при входе',
    loginHint: 'ClipShelf будет стартовать автоматически при входе в систему.',
    positionTitle: 'Расположение панели',
    positionHint: 'Край экрана, у которого появляется панель.',
    posBottom: 'Снизу',
    posTop: 'Сверху',
    posLeft: 'Слева',
    posRight: 'Справа',
    clipboardHistory: 'История буфера',
    newCollection: 'Новая коллекция',
    collectionName: 'Название коллекции',
    deleteCollection: 'Удалить коллекцию',
    confirmDeleteCollection: (name, n) => `Удалить «${name}» и ${n} сниппет(ов)?`,
    addToCollection: 'Сохранить в коллекцию',
    noCollections: 'Сначала создайте коллекцию («+» на панели вкладок)',
    rename: 'Переименовать',
    copy: 'Копировать',
    delete: 'Удалить',
    untitled: 'Без названия',
    settings: 'Настройки',
    hotkey: 'Сочетание для открытия панели',
    hotkeyChange: 'Изменить',
    hotkeyRecording: 'Нажмите клавиши…',
    hotkeyHint: '⌘, ⌃ или ⌥ плюс клавиша. Esc — отмена.',
    hotkeySaved: 'Сохранено',
    hotkeyNoKey: 'Нажмите клавишу вместе с ⌘, ⌃ или ⌥',
    showIntro: 'Показать приветствие',
    obTitle: 'Добро пожаловать в ClipShelf',
    obSubtitle: 'Всё, что вы копируете, в одном сочетании клавиш.',
    obPoint1: 'Скопированные текст, ссылки и картинки сохраняются автоматически.',
    obPoint2: 'Нажмите сочетание — откроется панель; ← → выбор, Enter — вставить.',
    obPoint3: 'Двойной клик по карточке сразу вставляет её в активное приложение.',
    obPoint4: 'Режим разработчика хранит любимые сниппеты в коллекциях.',
    obHotkey: 'Ваше сочетание для открытия панели',
    obHotkeyNote: 'Его можно поменять позже в настройках — кнопка с шестерёнкой на панели.',
    obAccess: 'Чтобы вставлять сразу в приложения, разрешите ClipShelf в Системных настройках → Конфиденциальность и безопасность → Универсальный доступ.',
    obStart: 'Начать',
  },
};

export function makeT(lang) {
  const d = dict[lang] || dict.en;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  return {
    t: (key, ...args) => {
      const v = d[key] ?? dict.en[key] ?? key;
      return typeof v === 'function' ? v(...args) : v;
    },
    timeAgo(ts) {
      const sec = Math.round((ts - Date.now()) / 1000);
      const abs = Math.abs(sec);
      if (abs < 45) return d.justNow;
      if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
      if (abs < 86400 * 7) return rtf.format(Math.round(sec / 86400), 'day');
      if (abs < 86400 * 30) return rtf.format(Math.round(sec / (86400 * 7)), 'week');
      return rtf.format(Math.round(sec / (86400 * 30)), 'month');
    },
  };
}

export const I18nContext = createContext(makeT('en'));
export const useI18n = () => useContext(I18nContext);
