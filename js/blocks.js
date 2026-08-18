/* blocks.js — 사진 없이 블럭을 위아래로 쌓아 냉장고 모델을 만드는 빌더 */
window.Blocks = (function () {
  var TYPES = [
    { type: 'shelf',   label: '선반칸',   units: 3 },
    { type: 'drawer',  label: '서랍',     units: 2 },
    { type: 'crisper', label: '야채칸',   units: 2 },
    { type: 'freezer', label: '냉동칸',   units: 3 },
    { type: 'icebox',  label: '제빙/특선', units: 1.5 }
  ];

  var blocks = [];
  var listEl = null, paletteEl = null, onChange = null;

  function def(type) {
    return TYPES.filter(function (t) { return t.type === type; })[0] || TYPES[0];
  }

  function make(type) {
    var d = def(type);
    var same = blocks.filter(function (b) { return b.type === type; }).length;
    return {
      id: Store.uid('b'),
      type: type,
      name: d.label + (same ? ' ' + (same + 1) : ''),
      units: d.units,
      split: 1
    };
  }

  function seed() {
    blocks = [make('shelf'), make('shelf'), make('crisper')];
  }

  function add(type) {
    blocks.push(make(type));
    changed();
  }

  function move(id, dir) {
    var i = blocks.findIndex(function (b) { return b.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    var tmp = blocks[i]; blocks[i] = blocks[j]; blocks[j] = tmp;
    changed();
  }

  function remove(id) {
    blocks = blocks.filter(function (b) { return b.id !== id; });
    changed();
  }

  function patch(id, key, value) {
    blocks = blocks.map(function (b) {
      return b.id === id ? Object.assign({}, b, (function () { var o = {}; o[key] = value; return o; })()) : b;
    });
    // 이름 입력·높이 슬라이더는 드래그/입력 중 다시 그리면 포커스가 끊기므로 목록 재렌더를 건너뛴다
    changed(key === 'name' || key === 'units');
  }

  function changed(skipRender) {
    if (!skipRender) render();
    if (onChange) onChange();
  }

  /* 블럭 스택 → 정규화 zone 목록 */
  function zones(doorCount) {
    var total = blocks.reduce(function (a, b) { return a + Number(b.units); }, 0) || 1;
    var out = [], cum = 0;
    var SIDE3 = ['좌', '중', '우'], SIDE2 = ['좌', '우'];

    blocks.forEach(function (b) {
      var h = Number(b.units) / total;
      var n = Math.max(1, Math.min(3, Number(b.split) || 1));
      for (var j = 0; j < n; j++) {
        var side = n === 3 ? ' ' + SIDE3[j] : n === 2 ? ' ' + SIDE2[j] : '';
        out.push({
          id: Store.uid('z'),
          name: b.name + side,
          type: b.type,
          col: 'body',
          x: j / n, y: cum, w: 1 / n, h: h
        });
      }
      cum += h;
    });

    // 문 포켓은 냉동칸이 시작되기 전(=냉장칸 구간)까지만 붙인다
    var doorSpan = 1, acc = 0;
    for (var k = 0; k < blocks.length; k++) {
      if (blocks[k].type === 'freezer') { doorSpan = acc; break; }
      acc += Number(blocks[k].units) / total;
    }
    if (doorSpan < 0.2) doorSpan = 1;   // 맨 위가 냉동칸이면 그냥 전체에 붙인다

    var dc = Number(doorCount) || 0;
    for (var d = 0; d < dc; d++) {
      out.push({
        id: Store.uid('z'), name: '도어 ' + (d + 1), type: 'door', col: 'door',
        x: 0, y: doorSpan * d / dc, w: 1, h: doorSpan / dc
      });
    }
    return out;
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!blocks.length) {
      var li = document.createElement('li');
      li.className = 'empty-note';
      li.textContent = '위의 블럭을 눌러 냉장고를 쌓아 올려보세요.';
      listEl.appendChild(li);
      return;
    }
    blocks.forEach(function (b, idx) {
      var t = Store.ZONE_TYPES[b.type] || Store.ZONE_TYPES.shelf;
      var li = document.createElement('li');
      li.className = 'block-row';
      li.innerHTML =
        '<span class="bi">' + t.emoji + '</span>' +
        '<span class="bmeta">' +
          '<input class="bname" value="" maxlength="16" />' +
          '<span class="block-ctrls">' +
            '<label>높이 <input type="range" min="1" max="6" step="0.5" class="bunits" /><span class="uval"></span></label>' +
            '<label>좌우 <select class="bsplit">' +
              '<option value="1">1칸</option><option value="2">2칸</option><option value="3">3칸</option>' +
            '</select></label>' +
            '<label>종류 <select class="btype"></select></label>' +
          '</span>' +
        '</span>' +
        '<span class="block-move">' +
          '<button class="up" title="위로">▲</button>' +
          '<button class="down" title="아래로">▼</button>' +
          '<button class="del" title="삭제">✕</button>' +
        '</span>';

      var nameEl = li.querySelector('.bname');
      nameEl.value = b.name;
      nameEl.addEventListener('input', function () { patch(b.id, 'name', nameEl.value); });

      var unitsEl = li.querySelector('.bunits');
      var uval = li.querySelector('.uval');
      unitsEl.value = b.units;
      uval.textContent = Number(b.units).toFixed(1);
      unitsEl.addEventListener('input', function () {
        uval.textContent = Number(unitsEl.value).toFixed(1);
        patch(b.id, 'units', Number(unitsEl.value));
      });

      var splitEl = li.querySelector('.bsplit');
      splitEl.value = String(b.split);
      splitEl.addEventListener('change', function () { patch(b.id, 'split', Number(splitEl.value)); });

      var typeEl = li.querySelector('.btype');
      TYPES.forEach(function (tt) {
        var o = document.createElement('option');
        o.value = tt.type; o.textContent = tt.label;
        typeEl.appendChild(o);
      });
      typeEl.value = b.type;
      typeEl.addEventListener('change', function () { patch(b.id, 'type', typeEl.value); });

      li.querySelector('.up').addEventListener('click', function () { move(b.id, -1); });
      li.querySelector('.down').addEventListener('click', function () { move(b.id, 1); });
      li.querySelector('.del').addEventListener('click', function () { remove(b.id); });
      if (idx === 0) li.querySelector('.up').disabled = true;
      if (idx === blocks.length - 1) li.querySelector('.down').disabled = true;

      listEl.appendChild(li);
    });
  }

  function renderPalette() {
    if (!paletteEl) return;
    paletteEl.innerHTML = '';
    TYPES.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.textContent = '+ ' + (Store.ZONE_TYPES[t.type] || {}).emoji + ' ' + t.label;
      b.addEventListener('click', function () { add(t.type); });
      paletteEl.appendChild(b);
    });
  }

  function init(opts) {
    listEl = opts.list;
    paletteEl = opts.palette;
    onChange = opts.onChange;
    if (!blocks.length) seed();
    renderPalette();
    render();
    if (onChange) onChange();
  }

  /* 기존 zone 목록을 블럭으로 되돌려 편집 이어가기 */
  function loadFromZones(zoneList) {
    var body = (zoneList || []).filter(function (z) { return z.col !== 'door'; });
    if (!body.length) { seed(); return; }
    var rows = {};
    body.forEach(function (z) {
      var key = z.y.toFixed(3);
      (rows[key] = rows[key] || []).push(z);
    });
    blocks = Object.keys(rows).sort(function (a, b) { return Number(a) - Number(b); }).map(function (key) {
      var group = rows[key];
      var z = group[0];
      return {
        id: Store.uid('b'),
        type: z.type === 'door' ? 'shelf' : z.type,
        name: z.name.replace(/\s*(좌|중|우)$/, ''),
        units: Math.max(1, Math.round(z.h * 12 * 2) / 2),
        split: Math.min(3, group.length)
      };
    });
    render();
    if (onChange) onChange();
  }

  function reset() {
    seed();
    render();
    if (onChange) onChange();
  }

  return { init: init, zones: zones, add: add, reset: reset, loadFromZones: loadFromZones, TYPES: TYPES };
})();
