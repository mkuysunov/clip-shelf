import { execFile } from 'child_process';

// Распознавание текста и QR / штрихкодов на картинке через Apple Vision — тот же движок, что у Live Text в macOS.
// Vision вызывается из JXA (osascript -l JavaScript): отдельный Swift-бинарник пришлось бы собирать под обе архитектуры
// и отдельно склеивать в universal-сборке, а osascript есть в любой macOS и работает не медленнее (~0,5 с на картинку).
//
// argv: путь к картинке и языки через запятую ('ru,en' — префиксы, как в системных настройках).
// Скрипт только достаёт данные; как склеить фрагменты в строки, решает joinLines ниже.
const SCRIPT = `
ObjC.import('Vision');
ObjC.import('AppKit');
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const rep = $.NSImageRep.imageRepWithContentsOfURL(url);
  if (!rep.js) throw new Error('cannot read image');
  const text = $.VNRecognizeTextRequest.alloc.init;
  text.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate;
  text.usesLanguageCorrection = true;
  // С macOS 13 Vision сам определяет язык картинки — это точнее любого списка: первый язык списка выбирает
  // модель, и с китайским впереди кириллица читается латинским мусором. На macOS 12 автоопределения нет —
  // даём языки системы; на macOS 11 нет и списка поддерживаемых, остаётся английский по умолчанию.
  if (text.respondsToSelector('setAutomaticallyDetectsLanguage:')) {
    text.automaticallyDetectsLanguage = true;
  } else if (text.respondsToSelector('supportedRecognitionLanguagesAndReturnError:')) {
    const supported = ObjC.deepUnwrap(text.supportedRecognitionLanguagesAndReturnError($())) || [];
    const langs = [];
    for (const p of argv[1].split(',').concat('en')) {
      for (const l of supported) if ((l === p || l.startsWith(p + '-')) && !langs.includes(l)) langs.push(l);
    }
    if (langs.length) text.recognitionLanguages = $(langs);
  }
  const codes = $.VNDetectBarcodesRequest.alloc.init;
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $());
  if (!handler.performRequestsError($([text, codes]), $())) throw new Error('Vision request failed');

  const boxes = [];
  const found = text.results;
  for (let i = 0; i < found.count; i++) {
    const o = found.objectAtIndex(i);
    const b = o.boundingBox;
    boxes.push({ text: o.topCandidates(1).objectAtIndex(0).string.js, x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height });
  }
  const payloads = [];
  const bc = codes.results;
  for (let i = 0; i < bc.count; i++) {
    const s = bc.objectAtIndex(i).payloadStringValue;
    if (s.js) payloads.push(s.js);
  }
  return JSON.stringify({ width: Number(rep.pixelsWide), height: Number(rep.pixelsHigh), boxes, codes: payloads });
}
`;

// Фрагмент текста; координаты Vision нормированы к 0…1 и отсчитываются от нижнего левого угла
interface Box {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface RawResult {
  width: number;
  height: number;
  boxes: Box[];
  codes: string[];
}

// Vision отдаёт фрагменты в порядке чтения, но иногда режет строку на части и ставит хвост в самый конец.
// Фрагмент, который стоит на той же высоте вплотную справа от уже собранной строки, дописываем к ней;
// соседнюю колонку (зазор шире полутора высот строки) оставляем отдельной строкой, иначе колонки перемешаются.
function joinLines({ width, height, boxes }: RawResult) {
  const lines: Box[] = [];
  for (const raw of boxes) {
    const b = { text: raw.text, x: raw.x * width, y: (1 - raw.y - raw.h) * height, w: raw.w * width, h: raw.h * height };
    const line = lines.find((l) => {
      const overlap = Math.min(l.y + l.h, b.y + b.h) - Math.max(l.y, b.y);
      const gap = b.x - (l.x + l.w);
      return overlap > Math.min(l.h, b.h) / 2 && gap > -b.h / 2 && gap < b.h * 1.5;
    });
    if (!line) {
      lines.push(b);
      continue;
    }
    const bottom = Math.max(line.y + line.h, b.y + b.h);
    line.text += ` ${b.text}`;
    line.w = b.x + b.w - line.x;
    line.y = Math.min(line.y, b.y);
    line.h = bottom - line.y;
  }
  return lines.map((l) => l.text).join('\n');
}

// Текст с картинки; содержимое QR / штрихкодов, которого нет в самом тексте, дописывается отдельными строками.
// Пустая строка — ничего не нашлось.
export function recognize(file: string, langs: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-l', 'JavaScript', '-e', SCRIPT, file, langs.join(',')];
    execFile('osascript', args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      try {
        const res: RawResult = JSON.parse(stdout);
        const text = joinLines(res);
        const codes = res.codes.filter((c) => !text.includes(c));
        resolve([text, ...codes].filter(Boolean).join('\n'));
      } catch (e) {
        reject(e);
      }
    });
  });
}
