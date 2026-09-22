// Общие типы main ↔ preload ↔ renderer. Здесь только типы: preload работает в sandbox
// и не может подключать локальные модули, поэтому импортировать отсюда можно лишь `import type`.

export type Lang = 'en' | 'ru';
export type Mode = 'default' | 'dev';
export type Sort = 'newest' | 'oldest' | 'manual';
export type Position = 'bottom' | 'top' | 'left' | 'right';

export interface Settings {
  lang: Lang;
  mode: Mode;
  sort: Sort;
  position: Position;
  panelHeight: number; // высота панели снизу / сверху — меняется перетаскиванием её края
  panelWidth: number; // ширина панели слева / справа
  hotkey: string;
  onboarded: boolean;
}
export type SettingsPatch = Partial<Omit<Settings, 'hotkey'>>; // hotkey меняется только через setHotkey

interface ItemBase {
  id: string;
  sig: string;
  createdAt: number;
  remote?: boolean; // скопировано на другом устройстве Apple — пришло через Universal Clipboard
  pinned?: boolean; // закреплён: в ленте идёт первым, не вытесняется лимитом и не стирается очисткой истории
}
export interface TextItem extends ItemBase {
  type: 'text';
  text: string;
}
export interface ImageItem extends ItemBase {
  type: 'image';
  width: number;
  height: number;
  thumb: string; // data:URL превью; оригинал лежит в images/<id>.png
}
export type HistoryItem = TextItem | ImageItem;

export interface Snippet {
  id: string;
  title: string;
  text: string;
  createdAt: number;
}
export interface Collection {
  id: string;
  name: string;
  color: string;
  items: Snippet[];
}
export type SnippetDraft = Pick<Snippet, 'title' | 'text'>;
export type SnippetPatch = Partial<SnippetDraft>;

export type HotkeyResult = { ok: true } | { ok: false; error: string };

// пункт контекстного меню карточки; id выбранного пункта возвращает showMenu
export type MenuEntry = { id: string; label: string } | 'separator';

type Unsubscribe = () => void;

// Мост window.clip (см. preload.ts)
export interface ClipApi {
  // история
  getHistory(): Promise<HistoryItem[]>;
  paste(id: string): Promise<void>;
  copy(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  move(id: string, beforeId: string | null): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  clear(): Promise<void>;
  startDrag(id: string): void;
  onUpdate(cb: (items: HistoryItem[]) => void): Unsubscribe;

  // настройки
  getSettings(): Promise<Settings>;
  setSettings(patch: SettingsPatch): Promise<void>;
  onSettings(cb: (settings: Settings) => void): Unsubscribe;
  showSettings(): Promise<void>;

  // автозапуск при входе в систему
  getLoginItem(): Promise<boolean>;
  setLoginItem(on: boolean): Promise<void>;
  onLoginItem(cb: (on: boolean) => void): Unsubscribe;

  // коллекции сниппетов (режим разработчика)
  getCollections(): Promise<Collection[]>;
  addCollection(name: string, color: string): Promise<string>;
  removeCollection(id: string): Promise<void>;
  addSnippet(collectionId: string, snippet: SnippetDraft): Promise<void>;
  updateSnippet(id: string, patch: SnippetPatch): Promise<void>;
  removeSnippet(id: string): Promise<void>;
  moveSnippet(id: string, beforeId: string | null): Promise<void>;
  onCollections(cb: (collections: Collection[]) => void): Unsubscribe;

  // горячая клавиша
  setHotkey(accel: string): Promise<HotkeyResult>;
  setRecording(on: boolean): Promise<void>;
  formatHotkey(accel: string): Promise<string>;

  // онбординг
  finishOnboarding(): Promise<void>;
  showOnboarding(): Promise<void>;

  // панель
  confirm(message: string): Promise<boolean>;
  showMenu(entries: MenuEntry[]): Promise<string | null>; // нативное контекстное меню; null — закрыли без выбора
  hide(): Promise<void>;
  onShown(cb: () => void): Unsubscribe;
  resizePanel(grab: number): void; // край панели тянут мышью; grab — отступ курсора от этого края внутрь панели
  resetPanelSize(): void;
  platform: string;
}
