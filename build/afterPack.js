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
};
