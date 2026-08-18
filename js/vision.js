/* vision.js — 브라우저 안에서 냉장고 사진의 칸 구조를 읽어낸다.
 *
 * 파이프라인
 *   1) 사진 축소 → 그레이스케일
 *   2) 밝기 + 엣지 밀도로 냉장고 내부(ROI) 자동 추정
 *   3) ROI 안에서 "가로로 길게 이어지는 밝기 단차" = 선반 라인 검출
 *   4) 선반 사이 구간마다 세로 칸막이(좌우 분할) 검출
 *   5) 검출 결과를 정규화 좌표의 zone 목록으로 변환
 * 서버 호출 없음 — 모든 계산은 canvas 픽셀 위에서 이루어진다.
 */
window.Vision = (function () {
  var MAX_W = 520;      // 분석 해상도
  var CROP_W = 760;     // 저장할 잘라낸 사진 폭

  /* ── 유틸 ── */
  function smooth(arr, r) {
    var out = new Float32Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      var s = 0, c = 0;
      for (var k = -r; k <= r; k++) {
        var j = i + k;
        if (j >= 0 && j < arr.length) { s += arr[j]; c++; }
      }
      out[i] = s / c;
    }
    return out;
  }

  function normalize(arr) {
    var mn = Infinity, mx = -Infinity, i;
    for (i = 0; i < arr.length; i++) { if (arr[i] < mn) mn = arr[i]; if (arr[i] > mx) mx = arr[i]; }
    var out = new Float32Array(arr.length), d = mx - mn || 1;
    for (i = 0; i < arr.length; i++) out[i] = (arr[i] - mn) / d;
    return out;
  }

  /* 임계값 이상인 가장 긴 구간.
   * 선반 앞면처럼 어두운 가로 띠가 내부를 가로지르면 구간이 잘게 끊기므로
   * 짧은 끊김(gapRatio 이하)은 같은 구간으로 이어 붙인다. */
  function longestRun(score, ratio, gapRatio) {
    var n = score.length, i;
    var mn = Infinity, mx = -Infinity;
    for (i = 0; i < n; i++) { if (score[i] < mn) mn = score[i]; if (score[i] > mx) mx = score[i]; }
    var thr = mn + (mx - mn) * ratio;

    var runs = [], cs = -1;
    for (i = 0; i < n; i++) {
      if (score[i] >= thr) { if (cs < 0) cs = i; }
      else { if (cs >= 0) runs.push([cs, i]); cs = -1; }
    }
    if (cs >= 0) runs.push([cs, n]);
    if (!runs.length) return [0, n];

    var maxGap = Math.max(3, Math.round(n * (gapRatio == null ? 0.06 : gapRatio)));
    var merged = [runs[0].slice()];
    for (i = 1; i < runs.length; i++) {
      var last = merged[merged.length - 1];
      if (runs[i][0] - last[1] <= maxGap) last[1] = runs[i][1];
      else merged.push(runs[i].slice());
    }
    var best = merged[0];
    merged.forEach(function (r) { if (r[1] - r[0] > best[1] - best[0]) best = r; });
    if (best[1] - best[0] < n * 0.3) return [0, n];   // 신뢰 못 하면 전체
    return best;
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('이미지를 읽지 못했습니다.')); };
      img.src = src;
    });
  }

  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('파일을 읽지 못했습니다.')); };
      fr.readAsDataURL(file);
    });
  }

  /* 회전(0/90/180/270도)을 반영해 캔버스에 그린다. 휴대폰으로 냉장고를 찍으면
   * 눕혀 찍히는 경우가 많아, 분석 전에 세워주는 편이 선반 인식에 유리하다. */
  function drawRotated(ctx2d, img, rotate, w, h) {
    ctx2d.save();
    if (rotate === 90)       { ctx2d.translate(w, 0); ctx2d.rotate(Math.PI / 2); ctx2d.drawImage(img, 0, 0, h, w); }
    else if (rotate === 180) { ctx2d.translate(w, h); ctx2d.rotate(Math.PI);     ctx2d.drawImage(img, 0, 0, w, h); }
    else if (rotate === 270) { ctx2d.translate(0, h); ctx2d.rotate(-Math.PI / 2); ctx2d.drawImage(img, 0, 0, h, w); }
    else                     { ctx2d.drawImage(img, 0, 0, w, h); }
    ctx2d.restore();
  }

  function rotatedSize(img, rotate) {
    var swap = (rotate === 90 || rotate === 270);
    return {
      w: swap ? img.naturalHeight : img.naturalWidth,
      h: swap ? img.naturalWidth : img.naturalHeight
    };
  }

  function toGray(img, rotate) {
    var src = rotatedSize(img, rotate);
    var scale = Math.min(1, MAX_W / src.w);
    var w = Math.max(40, Math.round(src.w * scale));
    var h = Math.max(40, Math.round(src.h * scale));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var c2 = cv.getContext('2d', { willReadFrequently: true });
    drawRotated(c2, img, rotate, w, h);
    var d = c2.getImageData(0, 0, w, h).data;
    var g = new Float32Array(w * h);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }
    return { gray: g, w: w, h: h };
  }

  /* ── 2) 내부 영역(ROI) 추정 ── */
  function findRoi(g, w, h) {
    var rowB = new Float32Array(h), rowE = new Float32Array(h);
    var colB = new Float32Array(w), colE = new Float32Array(w);
    var x, y, v;
    for (y = 0; y < h; y++) {
      var sb = 0, se = 0;
      for (x = 0; x < w; x++) {
        v = g[y * w + x];
        sb += v;
        if (x > 0) se += Math.abs(v - g[y * w + x - 1]);
      }
      rowB[y] = sb / w; rowE[y] = se / w;
    }
    for (x = 0; x < w; x++) {
      var cb = 0, ce = 0;
      for (y = 0; y < h; y++) {
        v = g[y * w + x];
        cb += v;
        if (y > 0) ce += Math.abs(v - g[(y - 1) * w + x]);
      }
      colB[x] = cb / h; colE[x] = ce / h;
    }
    function mix(b, e) {
      var nb = normalize(smooth(b, 3)), ne = normalize(smooth(e, 3));
      var out = new Float32Array(b.length);
      for (var i = 0; i < b.length; i++) out[i] = 0.6 * nb[i] + 0.4 * ne[i];
      return out;
    }
    var yr = longestRun(mix(rowB, rowE), 0.42);
    var xr = longestRun(mix(colB, colE), 0.42);
    // 안쪽으로 깎으면 실사진에서 내용물이 잘려나간다 → 살짝 바깥으로 넓힌다.
    // 경계에 딸려오는 냉장고 테두리는 봉우리 탐색에서 가장자리 6%를 제외해 걸러진다.
    var mx = Math.round(w * 0.015), my = Math.round(h * 0.015);
    return {
      x0: Math.max(0, xr[0] - mx), x1: Math.min(w, xr[1] + mx),
      y0: Math.max(0, yr[0] - my), y1: Math.min(h, yr[1] + my)
    };
  }

  /* ── 3) 선반(가로) 라인 ── */
  function findShelves(g, w, roi) {
    var x0 = roi.x0, x1 = roi.x1, y0 = roi.y0, y1 = roi.y1;
    var RH = y1 - y0, RW = x1 - x0;
    var k = Math.max(2, Math.round(RH * 0.012));      // 위·아래 비교 간격
    var support = new Float32Array(RH);
    for (var y = y0 + k; y < y1 - k; y++) {
      var hit = 0;
      for (var x = x0; x < x1; x++) {
        if (Math.abs(g[(y + k) * w + x] - g[(y - k) * w + x]) > 14) hit++;
      }
      support[y - y0] = hit / RW;                     // 가로로 얼마나 길게 이어지는가 (0~1)
    }
    support = smooth(support, Math.max(1, Math.round(RH * 0.006)));

    var maxS = 0, i;
    for (i = 0; i < RH; i++) if (support[i] > maxS) maxS = support[i];
    var thr = Math.max(0.17, maxS * 0.42);
    var minSep = Math.max(5, Math.round(RH * 0.075));
    var cands = [];
    for (i = 1; i < RH - 1; i++) {
      if (i < RH * 0.06 || i > RH * 0.94) continue;
      if (support[i] >= support[i - 1] && support[i] >= support[i + 1] && support[i] >= thr) {
        cands.push({ i: i, s: support[i] });
      }
    }
    cands.sort(function (a, b) { return b.s - a.s; });
    var picked = [];
    cands.forEach(function (c) {
      if (picked.length >= 6) return;
      for (var j = 0; j < picked.length; j++) if (Math.abs(picked[j].i - c.i) < minSep) return;
      picked.push(c);
    });
    picked.sort(function (a, b) { return a.i - b.i; });

    var lines = picked.map(function (p) { return { y: p.i / RH, score: p.s }; });
    var conf;
    if (!lines.length) {
      // 아무것도 못 잡으면 4칸으로 균등 분할한 기본 모델을 제안
      lines = [0.25, 0.5, 0.75].map(function (y) { return { y: y, score: 0 }; });
      conf = 0.15;
    } else {
      var avg = lines.reduce(function (a, l) { return a + l.score; }, 0) / lines.length;
      conf = Math.min(1, (Math.min(avg, 0.55) / 0.55) * 0.7 + (Math.min(lines.length, 4) / 4) * 0.3);
    }
    return { lines: lines, confidence: conf };
  }

  /* ── 4) 구간별 세로 칸막이 ── */
  function findSplits(lines, ctx) {
    if (!ctx) return [];
    var g = ctx.gray, w = ctx.w, roi = ctx.roi;
    var x0 = roi.x0, x1 = roi.x1, y0 = roi.y0, y1 = roi.y1;
    var RH = y1 - y0, RW = x1 - x0;
    var ys = [0].concat(lines.map(function (l) { return l.y; })).concat([1]);
    var out = [];

    for (var b = 0; b < ys.length - 1; b++) {
      var by0 = y0 + Math.round(ys[b] * RH) + 2;
      var by1 = y0 + Math.round(ys[b + 1] * RH) - 2;
      var bh = by1 - by0;
      if (bh < Math.max(8, RH * 0.06)) { out.push([]); continue; }

      var k = Math.max(2, Math.round(RW * 0.012));
      var sup = new Float32Array(RW);
      for (var x = x0 + k; x < x1 - k; x++) {
        var hit = 0;
        for (var y = by0; y < by1; y++) {
          if (Math.abs(g[y * w + x + k] - g[y * w + x - k]) > 16) hit++;
        }
        sup[x - x0] = hit / bh;
      }
      sup = smooth(sup, Math.max(1, Math.round(RW * 0.008)));

      var best = null;
      for (var i = Math.round(RW * 0.25); i < Math.round(RW * 0.75); i++) {
        if (sup[i] >= sup[i - 1] && sup[i] >= sup[i + 1] && (!best || sup[i] > best.s)) {
          best = { i: i, s: sup[i] };
        }
      }
      // 구간 대부분을 세로로 관통할 때만 칸막이로 인정
      out.push(best && best.s > 0.55 ? [best.i / RW] : []);
    }
    return out;
  }

  /* ROI를 잘라 저장용 사진 만들기 */
  function cropPhoto(img, roi, aw, ah, rotate) {
    // 회전을 먼저 적용한 전체 이미지를 만든 뒤 ROI만 잘라낸다
    var src = rotatedSize(img, rotate);
    var full = document.createElement('canvas');
    full.width = src.w; full.height = src.h;
    drawRotated(full.getContext('2d'), img, rotate, src.w, src.h);

    var sx = src.w / aw, sy = src.h / ah;
    var sw = (roi.x1 - roi.x0) * sx, sh = (roi.y1 - roi.y0) * sy;
    var scale = Math.min(1, CROP_W / sw);
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sw * scale));
    cv.height = Math.max(1, Math.round(sh * scale));
    cv.getContext('2d').drawImage(full, roi.x0 * sx, roi.y0 * sy, sw, sh, 0, 0, cv.width, cv.height);
    try { return cv.toDataURL('image/jpeg', 0.72); } catch (e) { return null; }
  }

  /* ── 진입점 ── */
  /* opts: { rotate: 0|90|180|270, fullFrame: bool }
   * fullFrame 이면 내부 영역 추정을 건너뛰고 사진 전체를 그대로 쓴다.
   * (자동 추정이 사진을 잘라내는 경우의 탈출구) */
  function analyze(file, opts) {
    opts = (typeof opts === 'number') ? { rotate: opts } : (opts || {});
    var rotate = ((Number(opts.rotate) || 0) % 360 + 360) % 360;
    return readFile(file).then(loadImage).then(function (img) {
      var gd = toGray(img, rotate);
      var roi = opts.fullFrame
        ? { x0: 0, x1: gd.w, y0: 0, y1: gd.h }
        : findRoi(gd.gray, gd.w, gd.h);
      var ctx = { gray: gd.gray, w: gd.w, h: gd.h, roi: roi };
      var sh = findShelves(gd.gray, gd.w, roi);
      return {
        ctx: ctx,
        rotate: rotate,
        fullFrame: !!opts.fullFrame,
        roi: { x0: roi.x0 / gd.w, x1: roi.x1 / gd.w, y0: roi.y0 / gd.h, y1: roi.y1 / gd.h },
        photo: cropPhoto(img, roi, gd.w, gd.h, rotate),
        lines: sh.lines,
        splits: findSplits(sh.lines, ctx),
        confidence: sh.confidence
      };
    });
  }

  /* ── 5) 구역별 인식 결과를 하나의 냉장고 zone 목록으로 합치기 ──
   * 냉장고 한 대는 보통 사진 한 장에 다 담기지 않는다.
   * 냉장칸 / 냉장고문 / 냉동칸을 각각 찍어 아래처럼 한 모델로 조립한다.
   *
   *   ┌───────────┬────┐
   *   │  냉장칸    │ 문 │   ← 문 포켓은 냉장칸 높이까지만.
   *   ├───────────┼────┘      냉동칸은 서랍이라 문이 없다.
   *   │  냉동칸    │
   *   └───────────┘
   */
  var SECTIONS = [
    { id: 'fridge',  label: '냉장칸',   col: 'body' },
    { id: 'door',    label: '냉장고문', col: 'door' },
    { id: 'freezer', label: '냉동칸',   col: 'body' }
  ];

  var SIDE3 = ['좌', '중', '우'], SIDE2 = ['좌', '우'];

  /* 한 구역의 라인/칸막이 → zone 목록. y는 [top, top+height] 범위로 매핑된다. */
  function sectionZones(section, scan, top, height) {
    var lines = (scan.lines || []).slice().sort(function (a, b) { return a.y - b.y; });
    var ys = [0].concat(lines.map(function (l) { return l.y; })).concat([1]);
    var bands = ys.length - 1;
    var zones = [];
    var no = 0;

    for (var i = 0; i < bands; i++) {
      var y = ys[i], h = ys[i + 1] - ys[i];
      if (h <= 0.001) continue;

      var type, base;
      if (section === 'door') {
        no++; type = 'door'; base = '도어 ' + no;
      } else if (section === 'freezer') {
        no++; type = 'freezer'; base = '냉동칸 ' + no;
      } else {
        var isBottom = (i === bands - 1);
        if (isBottom && bands >= 3) { type = 'crisper'; base = '야채칸'; }
        else { no++; type = 'shelf'; base = '선반 ' + no; }
      }

      // 도어 포켓은 좌우로 나뉘지 않는다
      var sp = (section === 'door') ? [] : ((scan.splits && scan.splits[i]) || []);
      var xs = [0].concat(sp).concat([1]);
      var parts = xs.length - 1;
      for (var j = 0; j < parts; j++) {
        var side = parts === 3 ? ' ' + SIDE3[j] : parts === 2 ? ' ' + SIDE2[j] : '';
        zones.push({
          id: Store.uid('z'),
          name: base + side,
          type: type,
          section: section,
          col: section === 'door' ? 'door' : 'body',
          x: xs[j], y: top + y * height, w: xs[j + 1] - xs[j], h: h * height
        });
      }
    }
    return zones;
  }

  /* scans: { fridge: {lines,splits}|null, door: …, freezer: … } */
  function compose(scans) {
    scans = scans || {};
    var hasFridge = !!(scans.fridge && scans.fridge.lines);
    var hasFreezer = !!(scans.freezer && scans.freezer.lines);
    var hasDoor = !!(scans.door && scans.door.lines);

    var zones = [];
    var doorTop = 0, doorHeight = 1;   // 문이 붙는 범위 = 냉장칸 범위
    if (hasFridge && hasFreezer) {
      zones = zones.concat(sectionZones('fridge', scans.fridge, 0, 0.62));
      zones = zones.concat(sectionZones('freezer', scans.freezer, 0.62, 0.38));
      doorHeight = 0.62;
    } else if (hasFridge) {
      zones = zones.concat(sectionZones('fridge', scans.fridge, 0, 1));
    } else if (hasFreezer) {
      zones = zones.concat(sectionZones('freezer', scans.freezer, 0, 1));
    }
    if (hasDoor) zones = zones.concat(sectionZones('door', scans.door, doorTop, doorHeight));
    return zones;
  }

  /* 구역별 사진 { fridge: dataURL, … } */
  function photosOf(scans) {
    var out = {};
    SECTIONS.forEach(function (s) {
      if (scans[s.id] && scans[s.id].photo) out[s.id] = scans[s.id].photo;
    });
    return out;
  }

  return {
    SECTIONS: SECTIONS,
    analyze: analyze,
    findSplits: findSplits,
    compose: compose,
    photosOf: photosOf
  };
})();
