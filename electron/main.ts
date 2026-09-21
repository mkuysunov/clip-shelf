import {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  nativeImage,
  ipcMain,
  screen,
  Tray,
  Menu,
  dialog,
  systemPreferences,
  powerMonitor,
} from 'electron';
import type { MessageBoxOptions, NativeImage, Rectangle } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import type {
  Collection,
  HistoryItem,
  HotkeyResult,
  Lang,
  Mode,
  Position,
  Settings,
  SnippetDraft,
  SnippetPatch,
  Sort,
} from './types';

// ---------- Настройки ----------
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+V';
const MAX_ITEMS = 300; // сколько элементов хранить
const POLL_MS = 500; // как часто проверять буфер
const PANEL_HEIGHT = 360; // высота панели при расположении снизу / сверху
const PANEL_WIDTH = 360; // ширина панели при расположении слева / справа
const THUMB_WIDTH = 480; // ширина превью картинок
const SUPPORTED_LANGS: Lang[] = ['en', 'ru'];

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = `http://localhost:${process.env.DEV_PORT || 5173}`; // порт Vite, см. vite.config.ts
const isMac = process.platform === 'darwin';

const dataDir = app.getPath('userData');
const imagesDir = path.join(dataDir, 'images');
const historyFile = path.join(dataDir, 'history.json');
const collectionsFile = path.join(dataDir, 'collections.json');
const settingsFile = path.join(dataDir, 'settings.json');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let history: HistoryItem[] = []; // порядок массива = ручной порядок
let collections: Collection[] = []; // коллекции сниппетов для режима разработчика
let settings = {} as Settings; // { lang, mode, sort, position, hotkey, onboarded } — заполняется в loadAll()
let onboardingWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let hotkeyRegistered: string | null = null; // текущий зарегистрированный accelerator
let lastSignature: string | null = null;
let paused = false;

// ---------- Локализация трея ----------
const TRAY_I18N = {
  en: {
    open: 'Show history',
    pause: 'Pause recording',
    resume: 'Resume recording',
    clear: 'Clear history',
    login: 'Launch at login',
    quit: 'Quit',
    confirmDelete: 'Delete',
    cancel: 'Cancel',
    intro: 'Show welcome screen',
    settings: 'Settings…',
    hkNoKey: 'Press a key together with ⌘, ⌃ or ⌥',
    hkTaken: 'This shortcut is already used by another app or the system',
  },
  ru: {
    open: 'Открыть историю',
    pause: 'Пауза записи',
    resume: 'Возобновить запись',
    clear: 'Очистить историю',
    login: 'Запускать при входе',
    quit: 'Выйти',
    confirmDelete: 'Удалить',
    cancel: 'Отмена',
    intro: 'Показать приветствие',
    settings: 'Настройки…',
    hkNoKey: 'Нажмите клавишу вместе с ⌘, ⌃ или ⌥',
    hkTaken: 'Это сочетание уже занято другим приложением или системой',
  },
};
const tr = (key: keyof typeof TRAY_I18N.en) => (TRAY_I18N[settings.lang] || TRAY_I18N.en)[key];

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

// Язык по умолчанию: язык системы, если он поддерживается, иначе английский
function detectLang(): Lang {
  const sys = (app.getLocale() || 'en').slice(0, 2).toLowerCase();
  return isOneOf(SUPPORTED_LANGS, sys) ? sys : 'en';
}

// ---------- Хранилище ----------
function readJSON(file: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Пишем во временный файл и переименовываем — при падении не останется битого JSON
function writeAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const pending = new Map<string, { timer: NodeJS.Timeout; data: unknown }>(); // file -> { timer, data }
function writeJSON(file: string, data: unknown) {
  const prev = pending.get(file);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pending.delete(file);
    try {
      writeAtomic(file, data);
    } catch (err) {
      console.error('write failed', file, err);
    }
  }, 300);
  pending.set(file, { timer, data });
}

// Сбросить отложенные записи синхронно (перед выходом)
function flushWrites() {
  for (const [file, { timer, data }] of pending) {
    clearTimeout(timer);
    try {
      writeAtomic(file, data);
    } catch (err) {
      console.error('flush failed', file, err);
    }
  }
  pending.clear();
}

const MODES: Mode[] = ['default', 'dev'];
const SORTS: Sort[] = ['newest', 'oldest', 'manual'];
const POSITIONS: Position[] = ['bottom', 'top', 'left', 'right'];
const asArray = (v: unknown) => (Array.isArray(v) ? v : []); // содержимое JSON с диска не типизировано

// Accelerator: хотя бы один «сильный» модификатор + одна клавиша
const ACCEL_RE = /^((CommandOrControl|Command|Control|Alt|Shift)\+)+[A-Za-z0-9]$|^((CommandOrControl|Command|Control|Alt|Shift)\+)+(F([1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Backspace|Delete|Escape|Up|Down|Left|Right|Home|End|PageUp|PageDown|[`\-=\[\];',.\/\\])$/;
function validHotkey(a: unknown): a is string {
  if (typeof a !== 'string' || !ACCEL_RE.test(a)) return false;
  return /(CommandOrControl|Command|Control|Alt)\+/.test(a); // одного Shift недостаточно
}

function normalizeSettings(raw: unknown): Settings {
  const s: Partial<Record<keyof Settings, unknown>> = raw && typeof raw === 'object' ? raw : {};
  return {
    lang: isOneOf(SUPPORTED_LANGS, s.lang) ? s.lang : detectLang(),
    mode: isOneOf(MODES, s.mode) ? s.mode : 'default',
    sort: isOneOf(SORTS, s.sort) ? s.sort : 'newest',
    position: isOneOf(POSITIONS, s.position) ? s.position : 'bottom',
    hotkey: validHotkey(s.hotkey) ? s.hotkey : DEFAULT_HOTKEY,
    onboarded: s.onboarded === true,
  };
}

// ---------- Горячая клавиша ----------
function unregisterHotkey() {
  if (hotkeyRegistered) globalShortcut.unregister(hotkeyRegistered);
  hotkeyRegistered = null;
}

// Пытается зарегистрировать; возвращает { ok, error }
function registerHotkey(accel: unknown): HotkeyResult {
  if (!validHotkey(accel)) return { ok: false, error: tr('hkNoKey') };
  unregisterHotkey();
  let ok = false;
  try {
    ok = globalShortcut.register(accel, togglePanel);
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, error: tr('hkTaken') };
  hotkeyRegistered = accel;
  return { ok: true };
}

// Показать сочетание по-человечески: ⌘⇧V на mac, Ctrl+Shift+V в остальных
function formatHotkey(accel: string) {
  const parts = accel.split('+');
  const key = parts.pop()!;
  if (isMac) {
    const map: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
    return parts.map((p) => map[p] || p).join('') + key;
  }
  const map: Record<string, string> = { CommandOrControl: 'Ctrl', Command: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  return [...parts.map((p) => map[p] || p), key].join('+');
}

function loadAll() {
  fs.mkdirSync(imagesDir, { recursive: true });
  history = asArray(readJSON(historyFile, [])).filter(
    (i) => i && typeof i === 'object' && i.id && (i.type !== 'image' || fs.existsSync(imagePath(i.id)))
  );
  collections = asArray(readJSON(collectionsFile, []))
    .filter((c) => c && typeof c === 'object' && c.id)
    .map((c) => ({ ...c, name: String(c.name ?? ''), items: asArray(c.items) }));
  settings = normalizeSettings(readJSON(settingsFile, {}));
}

const saveHistory = () => writeJSON(historyFile, history);
const saveCollections = () => writeJSON(collectionsFile, collections);
const saveSettings = () => writeJSON(settingsFile, settings);

const imagePath = (id: string) => path.join(imagesDir, `${id}.png`);

function send(channel: string, data?: unknown, windows: (BrowserWindow | null)[] = [win]) {
  for (const w of windows) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  }
}
const broadcastHistory = () => send('history:update', history);
const broadcastCollections = () => send('collections:update', collections);
// настройки нужны всем окнам: в приветствии переключается язык, в окне настроек — всё остальное
const broadcastSettings = () => send('settings:update', settings, [win, onboardingWin, settingsWin]);
const broadcastLogin = () => send('login:update', app.getLoginItemSettings().openAtLogin, [settingsWin]);

function removeImageFile(item: HistoryItem) {
  if (item.type === 'image') fs.unlink(imagePath(item.id), () => {});
}

function pushItem(item: HistoryItem) {
  const existing = history.find((i) => i.sig === item.sig);
  if (existing) {
    existing.createdAt = Date.now();
    // при ручной сортировке порядок не трогаем, иначе поднимаем наверх
    if (settings.sort !== 'manual') {
      history = [existing, ...history.filter((i) => i !== existing)];
    }
  } else {
    history.unshift(item);
    while (history.length > MAX_ITEMS) removeImageFile(history.pop()!);
  }
  saveHistory();
  broadcastHistory();
}

// ---------- Отслеживание буфера ----------
const hash = (buf: crypto.BinaryLike) => crypto.createHash('md5').update(buf).digest('hex');

function imageSignature(img: NativeImage) {
  const bmp = img.toBitmap();
  const step = Math.max(1, Math.floor(bmp.length / 4096));
  const sample = Buffer.alloc(Math.ceil(bmp.length / step));
  for (let i = 0, j = 0; i < bmp.length; i += step, j++) sample[j] = bmp[i];
  const { width, height } = img.getSize();
  return `img:${width}x${height}:${hash(sample)}`;
}

type ClipboardContent = { type: 'text'; text: string; sig: string } | { type: 'image'; img: NativeImage; sig: string };

function readCurrent(): ClipboardContent | null {
  const formats = clipboard.availableFormats();
  if (formats.includes('text/uri-list')) return null; // файлы из Finder пропускаем

  if (formats.includes('text/plain')) {
    const text = clipboard.readText();
    if (text && text.trim()) return { type: 'text', text, sig: `txt:${hash(text)}` };
  }
  if (formats.some((f) => f.startsWith('image/'))) {
    const img = clipboard.readImage();
    if (!img.isEmpty()) return { type: 'image', img, sig: imageSignature(img) };
  }
  return null;
}

function poll() {
  if (paused) return;
  let cur;
  try {
    cur = readCurrent();
  } catch {
    return;
  }
  if (!cur || cur.sig === lastSignature) return;
  lastSignature = cur.sig;

  const id = crypto.randomUUID();
  const base = { id, sig: cur.sig, createdAt: Date.now() };

  if (cur.type === 'text') {
    pushItem({ ...base, type: 'text', text: cur.text });
    return;
  }
  // такая картинка уже есть в истории — файл и превью заново не создаём, pushItem просто поднимет её наверх
  const known = history.find((i) => i.sig === cur.sig);
  if (known) {
    pushItem(known);
    return;
  }
  const { width, height } = cur.img.getSize();
  fs.writeFileSync(imagePath(id), cur.img.toPNG());
  const thumbImg = width > THUMB_WIDTH ? cur.img.resize({ width: THUMB_WIDTH, quality: 'good' }) : cur.img;
  const thumb = `data:image/jpeg;base64,${thumbImg.toJPEG(80).toString('base64')}`;
  pushItem({ ...base, type: 'image', width, height, thumb });
}

// ---------- Окно-панель ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    ...(isMac
      ? ({ type: 'panel', vibrancy: 'hud', visualEffectState: 'active', transparent: true } as const)
      : { backgroundColor: '#f3ece4' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('blur', onWindowBlur);
  win.on('focus', () => clearTimeout(blurTimer));
}

const panelVisible = () => !!win && !win.isDestroyed() && win.isVisible();

// Фокус ушёл из панели или из окна настроек. Без окна настроек панель прячется сразу. С ним — ждём,
// куда фокус придёт: переход между панелью и настройками панель не закрывает, уход в другое приложение — закрывает.
let blurTimer: NodeJS.Timeout | undefined;
function onWindowBlur() {
  clearTimeout(blurTimer);
  if (!settingsWin || settingsWin.isDestroyed()) return dismissPanel();
  blurTimer = setTimeout(() => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && (focused === win || focused === settingsWin)) return;
    dismissPanel();
  }, 200);
}

// Панель закрывается при любом системном действии: потеря фокуса, смена Space, блокировка экрана и т.п.
function dismissPanel() {
  if (!win || win.isDestroyed() || dialogOpen || win.webContents.isDevToolsOpened()) return;
  hidePanel(false);
}

function watchSystemEvents() {
  // панель видна на всех Spaces и остаётся key-окном, поэтому при свайпе между ними blur не приходит
  if (isMac) systemPreferences.subscribeWorkspaceNotification('NSWorkspaceActiveSpaceDidChangeNotification', dismissPanel);
  powerMonitor.on('lock-screen', dismissPanel);
  powerMonitor.on('suspend', dismissPanel);
  screen.on('display-added', dismissPanel);
  screen.on('display-removed', dismissPanel);
  screen.on('display-metrics-changed', dismissPanel);
}

// ---------- Обычные окна (приветствие, настройки): тот же интерфейс, страница выбирается по hash ----------
function createPageWindow(hash: string, width: number, height: number) {
  const w = new BrowserWindow({
    width,
    height,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'ClipShelf',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f7f1ea',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.center();
  if (isDev) w.loadURL(`${DEV_URL}/#${hash}`);
  else w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
  w.once('ready-to-show', () => {
    w.show();
    if (isMac) app.focus({ steal: true });
  });
  return w;
}

// ---------- Настройки ----------
function showSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = createPageWindow('settings', 560, 700);
  syncSettingsLevel();
  settingsWin.on('blur', onWindowBlur);
  settingsWin.on('focus', () => clearTimeout(blurTimer));
  settingsWin.on('closed', () => {
    settingsWin = null;
    // панель осталась открытой — возвращаем ей фокус, иначе она не узнает, что пора закрыться
    if (panelVisible()) win?.focus();
  });
}

// Панель держится поверх всех окон; пока она открыта, окно настроек поднимаем ещё выше, иначе она его перекроет
function syncSettingsLevel() {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  if (panelVisible()) settingsWin.setAlwaysOnTop(true, 'pop-up-menu', 1);
  else settingsWin.setAlwaysOnTop(false);
}

// ---------- Онбординг (первый запуск) ----------
function showOnboarding() {
  if (onboardingWin && !onboardingWin.isDestroyed()) return onboardingWin.focus();
  onboardingWin = createPageWindow('onboarding', 560, 676);
  onboardingWin.on('closed', () => {
    onboardingWin = null;
    // закрыли крестиком — тоже считаем, что приветствие показано
    if (!settings.onboarded) {
      settings.onboarded = true;
      saveSettings();
      broadcastSettings();
    }
  });
}

// Границы панели у выбранного края экрана (на маленьких экранах — не больше рабочей области)
function panelBounds({ x, y, width, height }: Rectangle): Rectangle {
  const w = Math.min(PANEL_WIDTH, width);
  const h = Math.min(PANEL_HEIGHT, height);
  switch (settings.position) {
    case 'top':
      return { x, y, width, height: h };
    case 'left':
      return { x, y, width: w, height };
    case 'right':
      return { x: x + width - w, y, width: w, height };
    default:
      return { x, y: y + height - h, width, height: h };
  }
}

function showPanel() {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  win.setBounds(panelBounds(workArea));
  send('panel:shown');
  win.show();
  win.focus();
  syncSettingsLevel();
}

function hidePanel(returnFocus = true) {
  if (!win || !win.isVisible()) return;
  win.hide();
  syncSettingsLevel();
  if (returnFocus && isMac) app.hide();
}

function togglePanel() {
  if (!win) return;
  if (win.isVisible()) hidePanel();
  else showPanel();
}

// ---------- Вставка ----------
function simulatePaste() {
  if (isMac) {
    if (!systemPreferences.isTrustedAccessibilityClient(true)) return;
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
  } else if (process.platform === 'win32') {
    execFile('powershell', [
      '-NoProfile',
      '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
    ]);
  }
}

function useText(text: string) {
  clipboard.writeText(text);
  lastSignature = `txt:${hash(text)}`;
}

function useHistoryItem(item: HistoryItem) {
  if (item.type === 'text') useText(item.text);
  else {
    clipboard.writeImage(nativeImage.createFromPath(imagePath(item.id)));
    // после round-trip через pasteboard битмап может отличаться — читаем подпись заново
    lastSignature = readCurrent()?.sig ?? item.sig;
  }
  pushItem({ ...item });
}

function findSnippet(id: string) {
  for (const c of collections) {
    const s = c.items.find((i) => i.id === id);
    if (s) return { collection: c, snippet: s };
  }
  return null;
}

// ---------- IPC: история ----------
ipcMain.handle('history:get', () => history);

ipcMain.handle('item:use', (_e, id: string, paste: boolean) => {
  const item = history.find((i) => i.id === id);
  if (item) useHistoryItem(item);
  else {
    const found = findSnippet(id);
    if (!found) return;
    useText(found.snippet.text);
  }
  hidePanel(true);
  if (paste) setTimeout(simulatePaste, 180);
});

ipcMain.handle('item:remove', (_e, id: string) => {
  const item = history.find((i) => i.id === id);
  if (!item) return;
  removeImageFile(item);
  history = history.filter((i) => i.id !== id);
  saveHistory();
  broadcastHistory();
});

// Ручная сортировка: переставить элемент перед beforeId (null = в конец)
ipcMain.handle('item:move', (_e, id: string, beforeId: string | null) => {
  const from = history.findIndex((i) => i.id === id);
  if (from < 0 || id === beforeId) return;
  const [item] = history.splice(from, 1);
  const to = beforeId ? history.findIndex((i) => i.id === beforeId) : history.length;
  history.splice(to < 0 ? history.length : to, 0, item);
  saveHistory();
  broadcastHistory();
});

ipcMain.handle('history:clear', () => clearHistory());
ipcMain.handle('panel:hide', () => hidePanel(true));

ipcMain.on('item:drag', (e, id: string) => {
  const item = history.find((i) => i.id === id);
  if (!item || item.type !== 'image') return;
  const file = imagePath(item.id);
  if (!fs.existsSync(file)) return;
  try {
    e.sender.startDrag({ file, icon: nativeImage.createFromPath(file).resize({ width: 96 }) });
  } catch (err) {
    console.error('drag failed', err);
  }
});

// --- IPC: подтверждение (нативный диалог; пока он открыт, панель не прячется по blur)
let dialogOpen = false;
ipcMain.handle('dialog:confirm', async (_e, message: string) => {
  dialogOpen = true;
  try {
    const t = TRAY_I18N[settings.lang] || TRAY_I18N.en;
    const options: MessageBoxOptions = {
      type: 'question',
      buttons: [t.confirmDelete, t.cancel],
      defaultId: 1,
      cancelId: 1,
      message: String(message),
    };
    const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
    return response === 0;
  } finally {
    dialogOpen = false;
    win?.focus();
  }
});

// ---------- IPC: настройки ----------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  const { hotkey, ...rest } = patch || {}; // hotkey меняется только через hotkey:set
  const prevPosition = settings.position;
  settings = normalizeSettings({ ...settings, ...rest });
  saveSettings();
  broadcastSettings();
  // позицию сменили из открытой панели — сразу переезжаем к новому краю того же экрана
  if (settings.position !== prevPosition && win?.isVisible()) {
    win.setBounds(panelBounds(screen.getDisplayMatching(win.getBounds()).workArea));
  }
  if (tray) tray.setContextMenu(buildTrayMenu());
});

// смена сочетания: регистрируем новое, при ошибке возвращаем старое
ipcMain.handle('hotkey:set', (_e, accel: string) => {
  const prev = settings.hotkey;
  const res = registerHotkey(accel);
  if (!res.ok) {
    registerHotkey(prev);
    return res;
  }
  settings.hotkey = accel;
  saveSettings();
  broadcastSettings();
  if (tray) tray.setContextMenu(buildTrayMenu());
  return res;
});

// пока пользователь записывает сочетание, глобальный хоткей отключён — иначе панель дёрнется
ipcMain.handle('hotkey:recording', (_e, on: boolean) => {
  if (on) unregisterHotkey();
  else if (!hotkeyRegistered) registerHotkey(settings.hotkey);
});

ipcMain.handle('hotkey:format', (_e, accel: string) => formatHotkey(accel));

// окно настроек открывается из панели (кнопка / ⌘,) поверх неё — панель остаётся открытой
ipcMain.handle('settings:show', () => {
  showSettings();
});

// автозапуск хранит система, а не settings.json — отдельные каналы
ipcMain.handle('login:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('login:set', (_e, on: boolean) => {
  app.setLoginItemSettings({ openAtLogin: on === true });
  if (tray) tray.setContextMenu(buildTrayMenu());
  broadcastLogin();
});

// ---------- IPC: онбординг ----------
ipcMain.handle('onboarding:done', () => {
  settings.onboarded = true;
  saveSettings();
  broadcastSettings();
  if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close();
  setTimeout(showPanel, 200);
});
ipcMain.handle('onboarding:show', () => {
  hidePanel(false);
  showOnboarding();
});

// ---------- IPC: коллекции (режим разработчика) ----------
ipcMain.handle('collections:get', () => collections);

ipcMain.handle('collection:add', (_e, name: string, color: string) => {
  const c: Collection = { id: crypto.randomUUID(), name: String(name).slice(0, 60), color: String(color), items: [] };
  collections.push(c);
  saveCollections();
  broadcastCollections();
  return c.id;
});

ipcMain.handle('collection:remove', (_e, id: string) => {
  collections = collections.filter((c) => c.id !== id);
  saveCollections();
  broadcastCollections();
});

ipcMain.handle('snippet:add', (_e, collectionId: string, { title, text }: Partial<SnippetDraft> = {}) => {
  const c = collections.find((x) => x.id === collectionId);
  if (!c || typeof text !== 'string' || !text) return;
  c.items.unshift({ id: crypto.randomUUID(), title: String(title || ''), text, createdAt: Date.now() });
  saveCollections();
  broadcastCollections();
});

ipcMain.handle('snippet:update', (_e, id: string, patch: SnippetPatch = {}) => {
  const found = findSnippet(id);
  if (!found) return;
  if (typeof patch.title === 'string') found.snippet.title = patch.title.slice(0, 120);
  if (typeof patch.text === 'string') found.snippet.text = patch.text;
  saveCollections();
  broadcastCollections();
});

ipcMain.handle('snippet:remove', (_e, id: string) => {
  const found = findSnippet(id);
  if (!found) return;
  found.collection.items = found.collection.items.filter((s) => s.id !== id);
  saveCollections();
  broadcastCollections();
});

ipcMain.handle('snippet:move', (_e, id: string, beforeId: string | null) => {
  const found = findSnippet(id);
  if (!found || id === beforeId) return;
  const items = found.collection.items;
  const [s] = items.splice(items.indexOf(found.snippet), 1);
  const to = beforeId ? items.findIndex((i) => i.id === beforeId) : items.length;
  items.splice(to < 0 ? items.length : to, 0, s);
  saveCollections();
  broadcastCollections();
});

function clearHistory() {
  history.forEach(removeImageFile);
  history = [];
  saveHistory();
  broadcastHistory();
}

// ---------- Трей ----------
function buildTrayMenu() {
  const t = TRAY_I18N[settings.lang] || TRAY_I18N.en;
  const login = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: `${t.open}  (${formatHotkey(settings.hotkey)})`, click: showPanel },
    { label: t.settings, click: showSettings },
    { label: t.intro, click: showOnboarding },
    { type: 'separator' },
    {
      label: paused ? t.resume : t.pause,
      click: () => {
        paused = !paused;
        if (!paused) lastSignature = readCurrent()?.sig ?? null;
        tray?.setContextMenu(buildTrayMenu());
      },
    },
    { label: t.clear, click: clearHistory },
    {
      label: t.login,
      type: 'checkbox',
      checked: login,
      click: (mi) => {
        app.setLoginItemSettings({ openAtLogin: mi.checked });
        broadcastLogin();
      },
    },
    { type: 'separator' },
    { label: t.quit, role: 'quit' },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('ClipShelf');
  tray.setContextMenu(buildTrayMenu());
}

// ---------- Старт ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showPanel);

  app.whenReady().then(() => {
    if (isMac && app.dock) app.dock.hide();
    loadAll();
    createWindow();
    createTray();
    watchSystemEvents();

    const res = registerHotkey(settings.hotkey);
    if (!res.ok) {
      console.warn(`Could not register ${settings.hotkey}: ${res.error}`);
      // пользовательское сочетание перестало работать — откатываемся на стандартное
      if (settings.hotkey !== DEFAULT_HOTKEY && registerHotkey(DEFAULT_HOTKEY).ok) {
        settings.hotkey = DEFAULT_HOTKEY;
        saveSettings();
      }
    }

    if (!settings.onboarded) showOnboarding();

    poll();
    setInterval(poll, POLL_MS);
  });

  app.on('before-quit', flushWrites);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // сам факт подписки отменяет выход по умолчанию, когда закрыты все окна
  app.on('window-all-closed', () => {});
}
