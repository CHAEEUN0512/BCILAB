#!/usr/bin/env node
/* tools/bundle.js — 앱 전체를 HTML 한 파일로 묶는다.
 *
 *   node tools/bundle.js                 → dist/fridge-keeper.html (그냥 열면 되는 단일 파일)
 *   node tools/bundle.js --artifact      → dist/fridge-artifact.html
 *        (호스트가 <html><head><body>를 감싸주는 환경용 — 문서 골격 없이 본문만)
 *
 * 배포 없이 폰에서 링크 하나로 테스트할 때 쓴다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const artifactMode = process.argv.includes('--artifact');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/styles.css');

// <body> 안쪽만 꺼낸다
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script src="[^"]+"><\/script>\s*/g, '');

// 스크립트는 index.html에 적힌 순서 그대로
const scripts = (html.match(/<script src="([^"]+)"><\/script>/g) || [])
  .map((tag) => tag.match(/src="([^"]+)"/)[1]);

let bundledBody = body;

if (artifactMode) {
  // 서비스워커·홈화면 설치는 이 빌드에서 의미가 없다 → 안내로 대체
  bundledBody = bundledBody.replace(
    /<p class="hero-note">[\s\S]*?<\/p>/,
    '<p class="hero-note tiny">테스트 빌드입니다 — 파일 한 개로 묶여 있어 오프라인 캐시와 홈 화면 설치는 빠져 있습니다.</p>'
  );
}

const parts = [];
parts.push('<title>Fridge Keeper</title>');
parts.push('<style>\n' + css + '\n</style>');
parts.push(bundledBody.trim());

scripts.forEach((src) => {
  let code = read(src);
  if (artifactMode && src.endsWith('app.js')) {
    // 없는 sw.js를 등록하려다 콘솔에 경고만 남기므로 아예 뺀다
    code = code.replace(
      /\/\* 오프라인 지원[\s\S]*?\n  }\n\n/,
      '/* (번들 빌드에서는 서비스워커를 등록하지 않는다) */\n\n'
    );
  }
  if (code.includes('</script')) throw new Error('스크립트 안에 </script 문자열이 있어 인라인할 수 없습니다: ' + src);
  parts.push('<script>\n' + code + '\n</script>');
});

let out = parts.join('\n\n');
if (!artifactMode) {
  out = '<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n' +
    '<meta name="theme-color" content="#0f1520" />\n' + out.replace(bundledBody.trim(), '</head>\n<body>\n' + bundledBody.trim()) +
    '\n</body>\n</html>';
}

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, artifactMode ? 'fridge-artifact.html' : 'fridge-keeper.html');
fs.writeFileSync(file, out);
console.log('생성:', path.relative(ROOT, file), '(' + Math.round(out.length / 1024) + ' KB, 스크립트 ' + scripts.length + '개)');
