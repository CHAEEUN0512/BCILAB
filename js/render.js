/* render.js — 냉장고 모델을 SVG 도면으로 그린다 */
window.Render = (function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var W = 340, H = 470, PAD = 14;

  function el(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }

  function clip(str, n) {
    str = String(str == null ? '' : str);
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }

  function layout(zones) {
    var hasDoor = zones.some(function (z) { return z.col === 'door'; });
    var innerW = W - PAD * 2, innerH = H - PAD * 2;
    if (!hasDoor) {
      return { body: { x: PAD, y: PAD, w: innerW, h: innerH }, door: null };
    }
    var gap = 10;
    var doorW = Math.round(innerW * 0.24);
    return {
      body: { x: PAD, y: PAD, w: innerW - doorW - gap, h: innerH },
      door: { x: PAD + innerW - doorW, y: PAD, w: doorW, h: innerH }
    };
  }

  function sectionKey(z) {
    return z.section || (z.col === 'door' ? 'door' : 'fridge');
  }

  function boxAttr(b, extra) {
    var a = { x: b.x, y: b.y, width: b.w, height: b.h };
    for (var k in (extra || {})) a[k] = extra[k];
    return a;
  }

  function rectOf(zone, lay) {
    var box = zone.col === 'door' ? lay.door : lay.body;
    if (!box) box = lay.body;
    if (zone.col === 'door') {
      return { x: box.x, y: box.y + zone.y * box.h, w: box.w, h: zone.h * box.h };
    }
    return {
      x: box.x + zone.x * box.w,
      y: box.y + zone.y * box.h,
      w: zone.w * box.w,
      h: zone.h * box.h
    };
  }

  /**
   * container 안에 냉장고를 그린다.
   * opts: { selectedId, items:[], onSelect(zoneId), showItems:bool, photo:dataURL }
   */
  function draw(container, zones, opts) {
    opts = opts || {};
    container.innerHTML = '';
    if (!zones || !zones.length) {
      container.innerHTML = '<p class="empty">아직 칸이 없습니다.</p>';
      return;
    }
    var lay = layout(zones);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '냉장고 도면' });

    // 구역(냉장칸/냉장고문/냉동칸)별 바운딩 박스 — 사진 배경과 외곽선에 함께 쓴다
    var boxes = {};
    zones.forEach(function (z) {
      var r = rectOf(z, lay);
      var key = sectionKey(z);
      var b = boxes[key];
      if (!b) boxes[key] = { x: r.x, y: r.y, x1: r.x + r.w, y1: r.y + r.h };
      else {
        b.x = Math.min(b.x, r.x); b.y = Math.min(b.y, r.y);
        b.x1 = Math.max(b.x1, r.x + r.w); b.y1 = Math.max(b.y1, r.y + r.h);
      }
    });
    Object.keys(boxes).forEach(function (k) {
      var b = boxes[k];
      boxes[k] = { x: b.x, y: b.y, w: b.x1 - b.x, h: b.y1 - b.y };
    });

    var photos = opts.photos || (opts.photo ? { fridge: opts.photo } : null);
    if (photos) {
      var defs = el('defs');
      svg.appendChild(defs);
      Object.keys(photos).forEach(function (key) {
        var box = boxes[key];
        if (!box || !photos[key]) return;
        var cid = 'clip_' + key + '_' + Math.random().toString(36).slice(2, 7);
        var cp = el('clipPath', { id: cid });
        cp.appendChild(el('rect', boxAttr(box, { rx: 8 })));
        defs.appendChild(cp);
        var img = el('image', {
          x: box.x, y: box.y, width: box.w, height: box.h,
          preserveAspectRatio: 'none', opacity: 0.45, 'clip-path': 'url(#' + cid + ')'
        });
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', photos[key]);
        img.setAttribute('href', photos[key]);
        svg.appendChild(img);
      });
    }

    // 구역별 외곽선 — 냉장칸과 냉동칸이 한 덩어리로 보이지 않게 나눠 그린다
    Object.keys(boxes).forEach(function (k) {
      var b = boxes[k];
      svg.appendChild(el('rect', boxAttr(
        { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 },
        { class: 'fridge-shell', rx: 10 }
      )));
    });

    var itemsByZone = {};
    (opts.items || []).forEach(function (it) {
      (itemsByZone[it.zoneId] = itemsByZone[it.zoneId] || []).push(it);
    });

    zones.forEach(function (z) {
      var r = rectOf(z, lay);
      var g = el('g', { class: 'zone' + (opts.selectedId === z.id ? ' sel' : ''), 'data-zone': z.id });
      g.appendChild(el('rect', { class: 'zbg', x: r.x + 1.5, y: r.y + 1.5, width: Math.max(4, r.w - 3), height: Math.max(4, r.h - 3), rx: 4 }));

      var type = Store.ZONE_TYPES[z.type] || Store.ZONE_TYPES.shelf;
      var maxChars = Math.max(4, Math.floor(r.w / 4.6));
      var t = el('text', { x: r.x + 7, y: r.y + 13.5 });
      t.textContent = type.emoji + ' ' + clip(z.name, maxChars);
      g.appendChild(t);

      var list = itemsByZone[z.id] || [];
      if (list.length) {
        var worst = list.reduce(function (acc, it) {
          var s = Store.status(it);
          if (s === 'bad') return 'bad';
          if (s === 'warn' && acc !== 'bad') return 'warn';
          return acc;
        }, 'ok');
        var color = worst === 'bad' ? '#f87171' : worst === 'warn' ? '#fbbf24' : '#4ade80';
        g.appendChild(el('circle', { cx: r.x + r.w - 8, cy: r.y + 9, r: 3.2, fill: color }));
        var c = el('text', { class: 'zcount', x: r.x + r.w - 15, y: r.y + 11.5, 'text-anchor': 'end' });
        c.textContent = list.length;
        g.appendChild(c);
      }

      if (opts.showItems !== false && r.h > 30) {
        var lines = Math.min(list.length, Math.floor((r.h - 19) / 9.2));
        for (var i = 0; i < lines; i++) {
          var it = list[i];
          var cat = Store.category(it.category);
          var ti = el('text', { class: 'zitem', x: r.x + 8, y: r.y + 24 + i * 9.2 });
          ti.textContent = cat.emoji + ' ' + clip(it.name, maxChars - 1);
          g.appendChild(ti);
        }
        if (list.length > lines && lines > 0) {
          var more = el('text', { class: 'zitem', x: r.x + r.w - 7, y: r.y + r.h - 5, 'text-anchor': 'end' });
          more.textContent = '+' + (list.length - lines);
          g.appendChild(more);
        }
      }

      if (opts.onSelect) {
        g.addEventListener('click', function () { opts.onSelect(z.id); });
      } else {
        g.style.cursor = 'default';
      }
      svg.appendChild(g);
    });

    container.appendChild(svg);
  }

  return { draw: draw, layout: layout, rectOf: rectOf, boxAttr: boxAttr };
})();
