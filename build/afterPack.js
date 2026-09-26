const path = require('path');
const { execFileSync } = require('child_process');

// Без сертификата Developer ID electron-builder пропускает подпись, и в бандле
// остаётся linker-подпись Electron, которая после упаковки уже невалидна.
// На Apple Silicon такое приложение, скачанное из интернета, не открывается
// с ошибкой «is damaged». Ad-hoc подпись делает бандл валидным.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // При universal-сборке хук вызывается ещё и для промежуточных бандлов
  // (`mac-universal-x64-temp`, `mac-universal-arm64-temp`). Их подписывать
  // нельзя: _CodeSignature/CodeResources будут различаться, и @electron/universal
  // откажется их склеивать. Подписываем только итоговый universal-бандл.
  if (/-(x64|arm64)-temp$/.test(context.appOutDir)) return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });

  // У ad-hoc подписи требование к коду по умолчанию — cdhash, а он меняется с каждой
  // сборкой. macOS хранит разрешения («Запись экрана», «Универсальный доступ») вместе
  // с этим требованием, так что после пересборки или обновления переключатель
  // в Настройках остаётся включённым, но к новой версии уже не относится.
  // Требование по bundle id одинаково у всех сборок. Переподписываем только сам бандл:
  // у вложенных хелперов свои идентификаторы, им это требование не подходит.
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign',
      '-',
      '--requirements',
      `=designated => identifier "${context.packager.appInfo.id}"`,
      appPath,
    ],
    { stdio: 'inherit' }
  );
};
