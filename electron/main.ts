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
  desktopCapturer,
  Notification,
  shell,
} from 'electron';
import type { MenuItemConstructorOptions, MessageBoxOptions, NativeImage, Rectangle } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { recognize } from './ocr';
import type {
  Collection,
  HistoryItem,
  HotkeyAction,
  HotkeyResult,
  Lang,
  MenuEntry,
  Mode,
  Position,
  Settings,
  SnippetDraft,
  SnippetPatch,
  Sort,
} from './types';

// ---------- Настройки ----------
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+V';
const DEFAULT_CAPTURE_HOTKEY = 'CommandOrControl+Shift+2'; // как у TextSniper; ⌘⇧3/4/5 заняты системными скриншотами
const MAX_ITEMS = 300; // сколько элементов хранить
const POLL_MS = 500; // как часто проверять буфер
// Размер панели поперёк края экрана: base — по умолчанию; край можно тянуть мышью от min до доли экрана maxShare —
// панель должна оставаться компактной. Больше base она становится не вместительнее, а крупнее (см. applyPanelBounds).
const PANEL_HEIGHT = { base: 360, min: 260, maxShare: 0.4 }; // панель снизу / сверху
const PANEL_WIDTH = { base: 360, min: 300, maxShare: 0.3 }; // панель слева / справа
const MIN_PANEL_GROWTH = 1.25; // на небольшом экране доля maxShare меньше base — увеличить панель можно хотя бы во столько раз
type PanelLimits = typeof PANEL_HEIGHT;
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
let settings = {} as Settings; // { lang, mode, sort, position, panelHeight, panelWidth, hotkey, captureHotkey, onboarded } — заполняется в loadAll()
let onboardingWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
const hotkeysRegistered: Partial<Record<HotkeyAction, string>> = {}; // текущие зарегистрированные accelerator
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
    hkDuplicate: 'This shortcut is already used in ClipShelf',
    capture: 'Capture text from screen',
    ocrCopied: 'Text copied',
    ocrEmpty: 'No text found',
    ocrFailed: 'Could not recognize text',
    screenTitle: 'Allow screen recording',
    screenDetail:
      'To read text from the screen, ClipShelf needs the Screen Recording permission. Turn on ClipShelf in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen ClipShelf.',
    openSettings: 'Open System Settings',
    screenDev: 'Development mode: macOS checks the permission of the app ClipShelf was started from — the terminal or VS Code. Turn on that app and restart it.',
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
    hkDuplicate: 'Это сочетание уже используется в ClipShelf',
    capture: 'Распознать текст с экрана',
    ocrCopied: 'Текст скопирован',
    ocrEmpty: 'Текст не найден',
    ocrFailed: 'Не удалось распознать текст',
    screenTitle: 'Разрешите запись экрана',
    screenDetail:
      'Чтобы читать текст с экрана, ClipShelf нужно разрешение «Запись экрана». Включите ClipShelf в Системных настройках → Конфиденциальность и безопасность → Запись экрана и системного звука, затем перезапустите ClipShelf.',
    openSettings: 'Открыть Системные настройки',
    screenDev: 'Режим разработки: macOS проверяет разрешение у приложения, из которого запущен ClipShelf, — терминала или VS Code. Включите его и перезапустите.',
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

// верхнюю границу размера панели задаёт экран, на котором она открыта — см. fitPanelSize()
const panelSize = (v: unknown, { base, min }: PanelLimits) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.round(v)) : base;

function normalizeSettings(raw: unknown): Settings {
  const s: Partial<Record<keyof Settings, unknown>> = raw && typeof raw === 'object' ? raw : {};
  return {
    lang: isOneOf(SUPPORTED_LANGS, s.lang) ? s.lang : detectLang(),
    mode: isOneOf(MODES, s.mode) ? s.mode : 'default',
    sort: isOneOf(SORTS, s.sort) ? s.sort : 'newest',
    position: isOneOf(POSITIONS, s.position) ? s.position : 'bottom',
    panelHeight: panelSize(s.panelHeight, PANEL_HEIGHT),
    panelWidth: panelSize(s.panelWidth, PANEL_WIDTH),
    hotkey: validHotkey(s.hotkey) ? s.hotkey : DEFAULT_HOTKEY,
    captureHotkey: validHotkey(s.captureHotkey) ? s.captureHotkey : DEFAULT_CAPTURE_HOTKEY,
    onboarded: s.onboarded === true,
  };
}

// ---------- Горячие клавиши ----------
// Глобальных сочетаний два: панель и распознавание текста с экрана (только macOS — там есть screencapture и Vision)
const HOTKEY_ACTIONS: HotkeyAction[] = isMac ? ['panel', 'capture'] : ['panel'];
const HOTKEY_SETTING = { panel: 'hotkey', capture: 'captureHotkey' } as const;
const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = { panel: DEFAULT_HOTKEY, capture: DEFAULT_CAPTURE_HOTKEY };
const HOTKEY_HANDLERS: Record<HotkeyAction, () => void> = { panel: togglePanel, capture: captureText };

function unregisterHotkey(action: HotkeyAction) {
  const accel = hotkeysRegistered[action];
  if (accel) globalShortcut.unregister(accel);
  delete hotkeysRegistered[action];
}

// Пытается зарегистрировать; возвращает { ok, error }
function registerHotkey(action: HotkeyAction, accel: unknown): HotkeyResult {
  if (!validHotkey(accel)) return { ok: false, error: tr('hkNoKey') };
  unregisterHotkey(action);
  // сочетание другого действия: система его не отвергнет, но сработало бы только одно из двух
  if (HOTKEY_ACTIONS.some((a) => a !== action && settings[HOTKEY_SETTING[a]] === accel)) {
    return { ok: false, error: tr('hkDuplicate') };
  }
  let ok = false;
  try {
    ok = globalShortcut.register(accel, HOTKEY_HANDLERS[action]);
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, error: tr('hkTaken') };
  hotkeysRegistered[action] = accel;
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
    existing.remote = item.remote; // как и время, пометка «с другого устройства» относится к последнему копированию
    // при ручной сортировке порядок не трогаем, иначе поднимаем наверх
    if (settings.sort !== 'manual') {
      history = [existing, ...history.filter((i) => i !== existing)];
    }
  } else {
    history.unshift(item);
    // закреплённые не вытесняются и в лимит не входят
    const extra = history.filter((i) => !i.pinned).slice(MAX_ITEMS);
    if (extra.length) {
      extra.forEach(removeImageFile);
      history = history.filter((i) => !extra.includes(i));
    }
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

type ClipboardContent = ({ type: 'text'; text: string } | { type: 'image'; img: NativeImage }) & { sig: string; remote: boolean };

// Universal Clipboard: скопированное на iPhone / iPad / другом Mac macOS сама кладёт в обычный pasteboard
// и помечает этим типом. Отдельно забирать ничего не нужно — опрос видит такие копии как любые другие.
const REMOTE_CLIPBOARD_TYPE = 'com.apple.is-remote-clipboard';
const isRemoteClipboard = () => isMac && clipboard.has(REMOTE_CLIPBOARD_TYPE);

function readCurrent(): ClipboardContent | null {
  const formats = clipboard.availableFormats();
  if (formats.includes('text/uri-list')) return null; // файлы из Finder пропускаем

  if (formats.includes('text/plain')) {
    const text = clipboard.readText();
    if (text && text.trim()) return { type: 'text', text, sig: `txt:${hash(text)}`, remote: isRemoteClipboard() };
  }
  if (formats.some((f) => f.startsWith('image/'))) {
    const img = clipboard.readImage();
    if (!img.isEmpty()) return { type: 'image', img, sig: imageSignature(img), remote: isRemoteClipboard() };
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
  const base = { id, sig: cur.sig, createdAt: Date.now(), remote: cur.remote || undefined };

  if (cur.type === 'text') {
    pushItem({ ...base, type: 'text', text: cur.text });
    return;
  }
  // такая картинка уже есть в истории — файл и превью заново не создаём, pushItem просто поднимет её наверх
  const known = history.find((i) => i.sig === cur.sig);
  if (known) {
    pushItem({ ...known, remote: base.remote });
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
    height: PANEL_HEIGHT.base,
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
  settingsWin = createPageWindow('settings', 560, 812);
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
  onboardingWin = createPageWindow('onboarding', 560, 710);
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

// Размер панели поперёк её края: от min до доли maxShare рабочей области. На экране ноутбука эта доля меньше размера
// по умолчанию (40 % от 873 px — это 349), поэтому потолок не опускается ниже base × MIN_PANEL_GROWTH: увеличение
// панели укрупняет интерфейс (см. applyPanelBounds) и должно оставаться доступным людям со слабым зрением на любом экране.
function fitPanelSize(size: number, { base, min, maxShare }: PanelLimits, area: number) {
  const max = Math.max(Math.floor(area * maxShare), Math.round(base * MIN_PANEL_GROWTH));
  return Math.min(area, Math.max(min, Math.min(size, max)));
}

// Границы панели у выбранного края экрана
function panelBounds({ x, y, width, height }: Rectangle): Rectangle {
  const w = fitPanelSize(settings.panelWidth, PANEL_WIDTH, width);
  const h = fitPanelSize(settings.panelHeight, PANEL_HEIGHT, height);
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

// Ставит панель к краю экрана и подбирает масштаб интерфейса. Панель больше размера по умолчанию — это та же компактная
// раскладка, только крупнее (текст, карточки, кнопки), а не больше мелких строк; меньше — масштаб 1, карточки просто ниже.
// Масштаб применяет preload через webFrame: webContents.setZoomFactor действует на весь origin и увеличил бы и окно настроек.
function applyPanelBounds(workArea: Rectangle) {
  if (!win) return;
  const bounds = panelBounds(workArea);
  const vertical = settings.position === 'left' || settings.position === 'right';
  send('panel:zoom', Math.max(1, vertical ? bounds.width / PANEL_WIDTH.base : bounds.height / PANEL_HEIGHT.base));
  win.setBounds(bounds);
}

function showPanel() {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  applyPanelBounds(workArea);
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

// ---------- Распознавание текста (OCR) ----------
function notify(title: string, body = '') {
  if (!Notification.isSupported()) return;
  new Notification({ title, body: body.length > 140 ? `${body.slice(0, 140)}…` : body, silent: true }).show();
}

// языки системы и интерфейса — подсказка для Vision на macOS 12, где он не умеет определять язык сам
const ocrLangs = () => [...new Set([...app.getPreferredSystemLanguages(), settings.lang].map((l) => l.split('-')[0]))];

// Распознаёт картинку и кладёт текст в буфер обмена, а значит и в историю. Возвращает текст;
// null — ничего не нашлось или распознать не вышло (об этом уже сказано уведомлением: панели в этот момент может не быть).
async function copyRecognized(file: string) {
  let text: string;
  try {
    text = await recognize(file, ocrLangs());
  } catch (err) {
    console.error('ocr failed', err);
    notify(tr('ocrFailed'));
    return null;
  }
  if (!text) {
    notify(tr('ocrEmpty'));
    return null;
  }
  clipboard.writeText(text);
  poll(); // сразу в историю, не дожидаясь следующего опроса
  return text;
}

// Без разрешения «Запись экрана» screencapture снимает только обои и строку меню — текста там не будет.
// Выдать разрешение может только сам пользователь, и действует оно после перезапуска приложения (macOS предложит его сама).
async function ensureScreenAccess() {
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return true;
  app.focus({ steal: true }); // у приложения без Dock диалог без окна-родителя иначе окажется под чужими окнами
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: tr('screenTitle'),
    // npm run dev: разрешение спрашивают у «ответственного» процесса — терминала / VS Code, а не у ClipShelf.app в списке
    detail: isDev ? `${tr('screenDetail')}\n\n${tr('screenDev')}` : tr('screenDetail'),
    buttons: [tr('openSettings'), tr('cancel')],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) {
    // своих окон нет — возвращаем фокус приложению, из которого начинали
    if (!BrowserWindow.getAllWindows().some((w) => w.isVisible())) app.hide();
    return false;
  }
  // обращение к экрану заносит ClipShelf в список «Запись экрана» (в первый раз — ещё и с системным запросом),
  // иначе приложение пришлось бы искать и добавлять туда вручную
  await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  return false;
}

// Как у TextSniper: выделить область экрана — её текст и QR-коды оказываются в буфере обмена.
// Выделение рисует системный screencapture (тот же, что у ⌘⇧4, пробел переключает на окно целиком), читает Vision.
let capturing = false;
async function captureText() {
  if (!isMac || capturing) return;
  capturing = true;
  const file = path.join(app.getPath('temp'), `clipshelf-capture-${crypto.randomUUID()}.png`);
  try {
    hidePanel(false); // панель поверх всех окон закрывала бы то, что хотят выделить
    if (!(await ensureScreenAccess())) return;
    await new Promise<void>((resolve) => execFile('screencapture', ['-i', '-x', '-o', file], () => resolve()));
    if (!fs.existsSync(file)) return; // выделение отменили (Esc)
    const text = await copyRecognized(file);
    if (text) notify(tr('ocrCopied'), text);
  } finally {
    capturing = false;
    fs.rm(file, { force: true }, () => {});
  }
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

// Закрепить / открепить. Порядок в массиве не меняется: закреплённые ставит в начало ленты интерфейс
ipcMain.handle('item:pin', (_e, id: string, pinned: boolean) => {
  const item = history.find((i) => i.id === id);
  if (!item) return;
  item.pinned = pinned === true || undefined;
  saveHistory();
  broadcastHistory();
});

// Распознать текст на картинке из истории. Текст становится новой карточкой — её id уходит в интерфейс, чтобы её выбрать
ipcMain.handle('item:recognize', async (_e, id: string) => {
  const item = history.find((i) => i.id === id);
  if (!isMac || item?.type !== 'image') return null;
  const text = await copyRecognized(imagePath(item.id));
  return (text && history.find((i) => i.sig === `txt:${hash(text)}`)?.id) || null;
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

// --- IPC: контекстное меню карточки. Нативное, а не HTML: невысокая панель обрезала бы его по своему краю.
// Возвращает id выбранного пункта, null — меню закрыли без выбора.
ipcMain.handle('menu:popup', (e, entries: MenuEntry[]) => {
  return new Promise<string | null>((resolve) => {
    const template = entries.map((m): MenuItemConstructorOptions =>
      m === 'separator' ? { type: 'separator' } : { label: String(m.label), click: () => resolve(m.id) }
    );
    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(e.sender) ?? undefined,
      // закрытие меню может прийти раньше click выбранного пункта — даём click отработать первым
      callback: () => setImmediate(() => resolve(null)),
    });
  });
});

// ---------- IPC: размер панели ----------
// size — новый размер поперёк края экрана, null — вернуть размер по умолчанию
function setPanelSize(size: number | null) {
  if (!win || !win.isVisible()) return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  if (settings.position === 'left' || settings.position === 'right') {
    settings.panelWidth = fitPanelSize(size ?? PANEL_WIDTH.base, PANEL_WIDTH, workArea.width);
  } else {
    settings.panelHeight = fitPanelSize(size ?? PANEL_HEIGHT.base, PANEL_HEIGHT, workArea.height);
  }
  applyPanelBounds(workArea);
  saveSettings();
}

// Край панели тянут мышью. Курсор читаем здесь, а не берём из события рендерера: окно в этот момент само
// двигается, экранные координаты в рендерере запаздывают, и панель дрожала бы.
ipcMain.on('panel:resize', (_e, grab: number) => {
  if (!win || !win.isVisible()) return;
  const { x, y, width, height } = screen.getDisplayMatching(win.getBounds()).workArea;
  const cursor = screen.getCursorScreenPoint();
  const sizes: Record<Position, number> = {
    bottom: y + height - cursor.y,
    top: cursor.y - y,
    left: cursor.x - x,
    right: x + width - cursor.x,
  };
  setPanelSize(sizes[settings.position] + (Number.isFinite(grab) ? grab : 0));
});
ipcMain.on('panel:resize-reset', () => setPanelSize(null));

// ---------- IPC: настройки ----------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  const { hotkey, captureHotkey, ...rest } = patch || {}; // сочетания меняются только через hotkey:set
  const prevPosition = settings.position;
  settings = normalizeSettings({ ...settings, ...rest });
  saveSettings();
  broadcastSettings();
  // позицию сменили из открытой панели — сразу переезжаем к новому краю того же экрана
  if (settings.position !== prevPosition && win?.isVisible()) {
    applyPanelBounds(screen.getDisplayMatching(win.getBounds()).workArea);
  }
  if (tray) tray.setContextMenu(buildTrayMenu());
});

// смена сочетания: регистрируем новое, при ошибке возвращаем старое
ipcMain.handle('hotkey:set', (_e, accel: string, action: HotkeyAction = 'panel') => {
  if (!isOneOf(HOTKEY_ACTIONS, action)) return { ok: false, error: tr('hkNoKey') };
  const key = HOTKEY_SETTING[action];
  const prev = settings[key];
  const res = registerHotkey(action, accel);
  if (!res.ok) {
    registerHotkey(action, prev);
    return res;
  }
  settings[key] = accel;
  saveSettings();
  broadcastSettings();
  if (tray) tray.setContextMenu(buildTrayMenu());
  return res;
});

// пока пользователь записывает сочетание, глобальные хоткеи отключены — иначе панель дёрнется или начнётся захват экрана
ipcMain.handle('hotkey:recording', (_e, on: boolean) => {
  for (const action of HOTKEY_ACTIONS) {
    if (on) unregisterHotkey(action);
    else if (!hotkeysRegistered[action]) registerHotkey(action, settings[HOTKEY_SETTING[action]]);
  }
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

// закреплённые очистка не трогает
function clearHistory() {
  history.filter((i) => !i.pinned).forEach(removeImageFile);
  history = history.filter((i) => i.pinned);
  saveHistory();
  broadcastHistory();
}

// ---------- Трей ----------
function buildTrayMenu() {
  const t = TRAY_I18N[settings.lang] || TRAY_I18N.en;
  const login = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: `${t.open}  (${formatHotkey(settings.hotkey)})`, click: showPanel },
    ...(isMac ? [{ label: `${t.capture}  (${formatHotkey(settings.captureHotkey)})`, click: captureText }] : []),
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

    for (const action of HOTKEY_ACTIONS) {
      const key = HOTKEY_SETTING[action];
      const res = registerHotkey(action, settings[key]);
      if (res.ok) continue;
      console.warn(`Could not register ${settings[key]}: ${res.error}`);
      // пользовательское сочетание перестало работать — откатываемся на стандартное
      if (settings[key] !== DEFAULT_HOTKEYS[action] && registerHotkey(action, DEFAULT_HOTKEYS[action]).ok) {
        settings[key] = DEFAULT_HOTKEYS[action];
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
