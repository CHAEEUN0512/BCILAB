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
  var ctx = null;       // 마지막 분석 컨텍스트 {gray,w,h,roi}

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

  function toGray(img) {
    var scale = Math.min(1, MAX_W / img.naturalWidth);
    var w = Math.max(40, Math.round(img.naturalWidth * scale));
    var h = Math.max(40, Math.round(img.naturalHeight * scale));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var c2 = cv.getContext('2d', { willReadFrequently: true });
    c2.drawImage(img, 0, 0, w, h);
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
    var mx = Math.round(w * 0.01), my = Math.round(h * 0.01);
    return {
      x0: Math.min(xr[0] + mx, w - 10), x1: Math.max(xr[1] - mx, 10),
      y0: Math.min(yr[0] + my, h - 10), y1: Math.max(yr[1] - my, 10)
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
  function findSplits(lines) {
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
  function cropPhoto(img, roi, aw, ah) {
    var sx = img.naturalWidth / aw, sy = img.naturalHeight / ah;
    var sw = (roi.x1 - roi.x0) * sx, sh = (roi.y1 - roi.y0) * sy;
    var scale = Math.min(1, CROP_W / sw);
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sw * scale));
    cv.height = Math.max(1, Math.round(sh * scale));
    cv.getContext('2d').drawImage(img, roi.x0 * sx, roi.y0 * sy, sw, sh, 0, 0, cv.width, cv.height);
    try { return cv.toDataURL('image/jpeg', 0.72); } catch (e) { return null; }
  }

  /* ── 진입점 ── */
  function analyze(file) {
    return readFile(file).then(loadImage).then(function (img) {
      var gd = toGray(img);
      var roi = findRoi(gd.gray, gd.w, gd.h);
      ctx = { gray: gd.gray, w: gd.w, h: gd.h, roi: roi };
      var sh = findShelves(gd.gray, gd.w, roi);
      var splits = findSplits(sh.lines);
      return {
        roi: { x0: roi.x0 / gd.w, x1: roi.x1 / gd.w, y0: roi.y0 / gd.h, y1: roi.y1 / gd.h },
        photo: cropPhoto(img, roi, gd.w, gd.h),
        lines: sh.lines,
        splits: splits,
        confidence: sh.confidence
      };
    });
  }

  /* ── 5) zone 목록으로 변환 ── */
  function buildZones(lines, splits, doorCount) {
    var sorted = lines.slice().sort(function (a, b) { return a.y - b.y; });
    var ys = [0].concat(sorted.map(function (l) { return l.y; })).concat([1]);
    var bands = ys.length - 1;
    var zones = [];
    var shelfNo = 0;
    var SIDE3 = ['좌', '중', '우'], SIDE2 = ['좌', '우'];

    for (var i = 0; i < bands; i++) {
      var y = ys[i], h = ys[i + 1] - ys[i];
      if (h <= 0.001) continue;
      var isBottom = (i === bands - 1);
      var type = (isBottom && bands >= 3) ? 'crisper' : 'shelf';
      var base;
      if (type === 'crisper') base = '야채칸';
      else { shelfNo++; base = '선반 ' + shelfNo; }

      var sp = (splits && splits[i]) || [];
      var xs = [0].concat(sp).concat([1]);
      var parts = xs.length - 1;
      for (var j = 0; j < parts; j++) {
        var side = parts === 3 ? ' ' + SIDE3[j] : parts === 2 ? ' ' + SIDE2[j] : '';
        zones.push({
          id: Store.uid('z'),
          name: base + side,
          type: type,
          col: 'body',
          x: xs[j], y: y, w: xs[j + 1] - xs[j], h: h
        });
      }
    }

    var dc = Number(doorCount) || 0;
    for (var d = 0; d < dc; d++) {
      zones.push({
        id: Store.uid('z'),
        name: '도어 ' + (d + 1),
        type: 'door',
        col: 'door',
        x: 0, y: d / dc, w: 1, h: 1 / dc
      });
    }
    return zones;
  }

  return {
    analyze: analyze,
    findSplits: findSplits,
    buildZones: buildZones,
    hasContext: function () { return !!ctx; }
  };
})();
