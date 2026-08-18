/* app.js — 화면 전환과 전체 흐름 */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var scan = null;          // {photo, lines, splits, confidence}
  var overrides = {};       // 사진 편집 중 사용자가 바꾼 칸 이름/종류
  var selectedZoneId = null;
  var activeTab = 'zone';
  var query = '';

  /* ── 공통 ── */
  function show(name) {
    $$('.screen').forEach(function (s) { s.hidden = s.dataset.screen !== name; });
    window.scrollTo(0, 0);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function todayPlus(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dd;
  }

  /* ─────────────── 시작 화면 ─────────────── */
  $('#btn-start-photo').addEventListener('click', function () { openScan(); });
  $('#btn-start-blocks').addEventListener('click', function () { openBlocks(); });
  $('#btn-resume').addEventListener('click', function () { openMain(); });
  $$('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (Store.get()) openMain(); else show('welcome');
    });
  });

  /* ─────────────── 사진 스캔 (구역별) ─────────────── */
  /* scans[구역] = {file, rotate, lines, splits, photo, confidence, ctx} */
  var scans = {};
  var activeSection = 'fridge';
  var overrides = {};

  var SECTION_HELP = {
    fridge:  '문을 열고 <b>냉장칸</b> 내부 전체가 나오게 한 장',
    door:    '<b>냉장고문</b> 포켓이 위아래로 다 보이게 한 장',
    freezer: '<b>냉동칸</b> 서랍을 열고 한 장'
  };

  function sectionMeta(id) {
    return Vision.SECTIONS.filter(function (s) { return s.id === id; })[0];
  }
  function current() { return scans[activeSection] || null; }

  function openScan() {
    scans = {};
    overrides = {};
    activeSection = 'fridge';
    renderSectionTabs();
    showSectionPane();
    renderScanPreview();
    show('scan');
  }
  $('#btn-scan-to-blocks').addEventListener('click', function () { openBlocks(); });

  function renderSectionTabs() {
    var wrap = $('#section-tabs');
    wrap.innerHTML = '';
    Vision.SECTIONS.forEach(function (sec) {
      var done = !!scans[sec.id];
      var b = document.createElement('button');
      b.className = 'section-tab' + (sec.id === activeSection ? ' active' : '') + (done ? ' done' : '');
      b.innerHTML = '<span class="st-name">' + sec.label + '</span>' +
        '<span class="st-state">' + (done ? scans[sec.id].lines.length + 1 + '칸 인식됨' : '미촬영') + '</span>';
      b.addEventListener('click', function () {
        activeSection = sec.id;
        renderSectionTabs();
        showSectionPane();
      });
      wrap.appendChild(b);
    });
  }

  function showSectionPane() {
    var sc = current();
    var meta = sectionMeta(activeSection);
    $('#dz-title').textContent = meta.label + ' 사진을 올려주세요';
    $('#dz-desc').innerHTML = SECTION_HELP[activeSection] + '<br />(탭하면 촬영 또는 앨범 선택)';
    $('#scan-upload').hidden = !!sc;
    $('#scan-result').hidden = !sc;
    if (sc) {
      $('#photo-preview').src = sc.photo || '';
      var pct = Math.round(sc.confidence * 100);
      var word = pct >= 65 ? '또렷하게' : pct >= 35 ? '대략' : '희미하게';
      $('#conf-chip').innerHTML = meta.label + ' · 경계 <b>' + sc.lines.length + '개</b> ' + word +
        ' 인식 · 신뢰도 <b>' + pct + '%</b>';
      renderLines();
    }
    renderScanPreview();
  }

  var fileInput = $('#file-input');
  $('#dropzone').addEventListener('click', function (e) {
    if (e.target !== fileInput) { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handlePhoto(fileInput.files[0], 0);
    fileInput.value = '';
  });
  ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
    $('#dropzone').addEventListener(ev, function (e) {
      e.preventDefault();
      $('#dropzone').classList.toggle('drag', ev === 'dragover');
      if (ev === 'drop' && e.dataTransfer.files[0]) handlePhoto(e.dataTransfer.files[0], 0);
    });
  });

  function handlePhoto(file, rotate) {
    if (!/^image\//.test(file.type)) { toast('이미지 파일만 올릴 수 있어요.'); return; }
    var section = activeSection;
    $('#scan-upload').hidden = true;
    $('#scan-result').hidden = false;
    $('#conf-chip').textContent = '사진을 분석하는 중…';
    $('#photo-preview').removeAttribute('src');
    $('#lines-layer').innerHTML = '';

    Vision.analyze(file, rotate).then(function (res) {
      res.file = file;
      scans[section] = res;
      if (activeSection === section) showSectionPane();
      renderSectionTabs();
      renderScanPreview();
    }).catch(function (err) {
      console.error(err);
      toast(err.message || '사진 분석에 실패했어요.');
      delete scans[section];
      showSectionPane();
    });
  }

  $('#btn-rotate').addEventListener('click', function () {
    var sc = current();
    if (!sc || !sc.file) return;
    handlePhoto(sc.file, (sc.rotate + 90) % 360);
  });
  $('#btn-repick').addEventListener('click', function () {
    $('#scan-upload').hidden = false;
    $('#scan-result').hidden = true;
  });
  $('#btn-drop-section').addEventListener('click', function () {
    delete scans[activeSection];
    renderSectionTabs();
    showSectionPane();
  });

  $('#btn-add-line').addEventListener('click', function () {
    var sc = current();
    if (!sc) return;
    var ys = [0].concat(sc.lines.map(function (l) { return l.y; })).concat([1]);
    var bi = 0, bg = -1;
    for (var i = 0; i < ys.length - 1; i++) {
      if (ys[i + 1] - ys[i] > bg) { bg = ys[i + 1] - ys[i]; bi = i; }
    }
    sc.lines.push({ y: (ys[bi] + ys[bi + 1]) / 2, score: 0 });
    sc.lines.sort(function (a, b) { return a.y - b.y; });
    refreshSplits();
  });

  function refreshSplits() {
    var sc = current();
    if (!sc) return;
    sc.splits = Vision.findSplits(sc.lines, sc.ctx);
    renderLines();
    renderSectionTabs();
    renderScanPreview();
  }

  function renderLines() {
    var layer = $('#lines-layer');
    layer.innerHTML = '';
    var sc = current();
    if (!sc) return;

    sc.lines.forEach(function (line, idx) {
      var d = document.createElement('div');
      d.className = 'shelf-line';
      d.style.top = (line.y * 100) + '%';
      d.innerHTML = '<span class="grip">경계 ' + (idx + 1) + '</span><span class="kill">✕</span>';

      d.querySelector('.kill').addEventListener('click', function (e) {
        e.stopPropagation();
        sc.lines.splice(idx, 1);
        refreshSplits();
      });

      d.addEventListener('pointerdown', function (e) {
        if (e.target.classList.contains('kill')) return;
        e.preventDefault();
        d.setPointerCapture(e.pointerId);
        var box = $('#photo-editor').getBoundingClientRect();
        var lo = idx > 0 ? sc.lines[idx - 1].y + 0.04 : 0.03;
        var hi = idx < sc.lines.length - 1 ? sc.lines[idx + 1].y - 0.04 : 0.97;

        function move(ev) {
          var y = (ev.clientY - box.top) / box.height;
          y = Math.max(lo, Math.min(hi, y));
          sc.lines[idx].y = y;
          d.style.top = (y * 100) + '%';
        }
        function up() {
          d.removeEventListener('pointermove', move);
          d.removeEventListener('pointerup', up);
          d.removeEventListener('pointercancel', up);
          refreshSplits();
        }
        d.addEventListener('pointermove', move);
        d.addEventListener('pointerup', up);
        d.addEventListener('pointercancel', up);
      });

      layer.appendChild(d);
    });

    var ys = [0].concat(sc.lines.map(function (l) { return l.y; })).concat([1]);
    (sc.splits || []).forEach(function (sp, i) {
      (sp || []).forEach(function (x) {
        var v = document.createElement('div');
        v.className = 'split-line';
        v.style.left = (x * 100) + '%';
        v.style.top = (ys[i] * 100) + '%';
        v.style.height = ((ys[i + 1] - ys[i]) * 100) + '%';
        layer.appendChild(v);
      });
    });
  }

  function okey(z) {
    return (z.section || 'x') + '_' + Math.round(z.y * 40) + '_' + Math.round(z.x * 20);
  }

  function currentScanZones() {
    var zones = Vision.compose(scans);
    zones.forEach(function (z) {
      var o = overrides[okey(z)];
      if (o) { if (o.name) z.name = o.name; if (o.type) z.type = o.type; }
    });
    return zones;
  }

  function renderScanPreview() {
    var zones = currentScanZones();
    Render.draw($('#scan-preview'), zones, { photos: Vision.photosOf(scans) });
    var done = Vision.SECTIONS.filter(function (s) { return !!scans[s.id]; });
    $('#compose-note').textContent = done.length
      ? done.map(function (s) { return s.label; }).join(' + ') + ' → 총 ' + zones.length + '칸'
      : '아직 인식된 구역이 없습니다.';
    $('#btn-confirm-scan').disabled = !zones.length;
    renderZoneTypeList(zones.filter(function (z) { return z.section === activeSection; }));
  }

  function renderZoneTypeList(zones) {
    var wrap = $('#scan-zone-types');
    wrap.innerHTML = '';
    zones.forEach(function (z) {
      var row = document.createElement('div');
      row.className = 'zone-type-row';
      row.innerHTML = '<input maxlength="16" /><select></select>';
      var nm = row.querySelector('input');
      nm.value = z.name;
      nm.addEventListener('input', function () {
        var o = overrides[okey(z)] = overrides[okey(z)] || {};
        o.name = nm.value;
      });
      var sel = row.querySelector('select');
      Object.keys(Store.ZONE_TYPES).forEach(function (k) {
        var o = document.createElement('option');
        o.value = k;
        o.textContent = Store.ZONE_TYPES[k].emoji + ' ' + Store.ZONE_TYPES[k].label;
        sel.appendChild(o);
      });
      sel.value = z.type;
      sel.addEventListener('change', function () {
        var o = overrides[okey(z)] = overrides[okey(z)] || {};
        o.type = sel.value;
        renderScanPreview();
      });
      wrap.appendChild(row);
    });
  }

  $('#btn-confirm-scan').addEventListener('click', function () {
    var zones = currentScanZones();
    if (!zones.length) { toast('구역을 하나 이상 찍어주세요.'); return; }
    var model = { source: 'photo', photos: Vision.photosOf(scans), zones: zones };
    if (Store.get()) Store.replaceStructure(model); else Store.create(model);
    selectedZoneId = null;
    openMain();
    toast('냉장고 모델을 만들었어요. 칸을 눌러 재고를 채워보세요!');
  });

  /* ─────────────── 블럭 빌더 ─────────────── */
  var blocksReady = false;
  var blocksLoadedFrom = null;   // 어떤 모델(updatedAt)을 불러와 편집 중인지
  function openBlocks() {
    show('blocks');
    if (!blocksReady) {
      Blocks.init({ list: $('#block-list'), palette: $('#palette'), onChange: renderBlocksPreview });
      blocksReady = true;
    }
    var st = Store.get();
    // 저장된 냉장고가 있으면 그 구조를 블럭으로 되돌려 이어서 편집
    if (st && st.zones.length && blocksLoadedFrom !== st.updatedAt) {
      blocksLoadedFrom = st.updatedAt;
      Blocks.loadFromZones(st.zones);
      var doors = st.zones.filter(function (z) { return z.col === 'door'; }).length;
      $('#blocks-door').value = String([0, 2, 3, 4].indexOf(doors) >= 0 ? doors : 3);
    }
    renderBlocksPreview();
  }
  $('#btn-blocks-to-scan').addEventListener('click', function () { openScan(); });
  $('#blocks-door').addEventListener('change', renderBlocksPreview);

  function renderBlocksPreview() {
    Render.draw($('#blocks-preview'), Blocks.zones($('#blocks-door').value), {});
  }

  $('#btn-confirm-blocks').addEventListener('click', function () {
    var zones = Blocks.zones($('#blocks-door').value);
    if (!zones.length) { toast('블럭을 하나 이상 쌓아주세요.'); return; }
    var model = { source: 'blocks', photos: {}, zones: zones };
    if (Store.get()) Store.replaceStructure(model); else Store.create(model);
    selectedZoneId = null;
    openMain();
    toast('냉장고 모델을 만들었어요!');
  });

  /* ─────────────── 메인 앱 ─────────────── */
  function openMain() {
    var st = Store.get();
    if (!st) { show('welcome'); return; }
    show('main');
    $('#fridge-name').value = st.name;
    if (!selectedZoneId || !Store.zone(selectedZoneId)) selectedZoneId = st.zones[0].id;
    renderAll();
  }

  function renderAll() {
    var st = Store.get();
    if (!st) return;
    var s = Store.summary();
    $('#stat-pills').innerHTML =
      '<span class="pill">재고 <b>' + s.total + '</b></span>' +
      (s.warn ? '<span class="pill warn">임박 <b>' + s.warn + '</b></span>' : '') +
      (s.bad ? '<span class="pill bad">지남 <b>' + s.bad + '</b></span>' : '');

    Render.draw($('#fridge-stage'), st.zones, {
      photos: st.photos,
      items: st.items,
      selectedId: selectedZoneId,
      onSelect: function (id) {
        selectedZoneId = id;
        setTab('zone');
        renderAll();
        if (window.innerWidth <= 900) {
          $('.side-col').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
    renderZonePane();
    renderAlerts();
    renderAllList();
  }

  function itemRow(it, opts) {
    opts = opts || {};
    var st = Store.status(it);
    var cat = Store.category(it.category);
    var li = document.createElement('li');
    li.className = 'item' + (st === 'warn' ? ' warn' : st === 'bad' ? ' bad' : '');
    var zone = Store.zone(it.zoneId);
    var sub = [];
    if (it.qty) sub.push(it.qty + (it.unit || ''));
    sub.push(cat.label);
    if (opts.showZone && zone) sub.push(zone.name);
    if (it.memo) sub.push(it.memo);

    li.innerHTML =
      '<span class="emo">' + cat.emoji + '</span>' +
      '<span class="info">' +
        '<span class="nm"></span>' +
        '<span class="sub"></span>' +
      '</span>' +
      '<span class="acts">' +
        '<button class="edit" title="편집">✎</button>' +
        '<button class="del" title="삭제">✕</button>' +
      '</span>';
    var nm = li.querySelector('.nm');
    nm.textContent = it.name;
    var dd = Store.ddayLabel(it);
    if (dd) {
      var b = document.createElement('span');
      b.className = 'dday';
      b.textContent = dd;
      nm.appendChild(b);
    }
    li.querySelector('.sub').textContent = sub.join(' · ');
    li.querySelector('.del').addEventListener('click', function () {
      Store.removeItem(it.id);
      renderAll();
      toast('삭제했어요.');
    });
    li.querySelector('.edit').addEventListener('click', function () {
      selectedZoneId = it.zoneId;
      setTab('zone');
      renderAll();
      startEdit(it);
    });
    return li;
  }

  function matches(it) {
    if (!query) return true;
    var q = query.toLowerCase();
    var zone = Store.zone(it.zoneId);
    return (it.name + ' ' + (it.memo || '') + ' ' + Store.category(it.category).label +
      ' ' + (zone ? zone.name : '')).toLowerCase().indexOf(q) >= 0;
  }

  function renderZonePane() {
    var z = Store.zone(selectedZoneId);
    var head = $('#zone-head');
    head.innerHTML = '';
    if (!z) return;
    var t = Store.ZONE_TYPES[z.type] || Store.ZONE_TYPES.shelf;
    var h = document.createElement('h2');
    h.textContent = t.emoji + ' ' + z.name;
    var meta = document.createElement('span');
    var list = Store.itemsOf(z.id);
    meta.textContent = t.label + ' · ' + list.length + '개 보관 중';
    head.appendChild(h);
    head.appendChild(meta);

    var ul = $('#zone-items');
    ul.innerHTML = '';
    var shown = list.filter(matches).sort(function (a, b) {
      var da = Store.daysLeft(a), db = Store.daysLeft(b);
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
    if (!shown.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = list.length ? '검색 결과가 없어요.' : '이 칸은 비어 있어요. 위에서 식재료를 담아보세요.';
      ul.appendChild(li);
      return;
    }
    shown.forEach(function (it) { ul.appendChild(itemRow(it)); });
  }

  function renderAlerts() {
    var st = Store.get();
    var ul = $('#alert-items');
    ul.innerHTML = '';
    var list = st.items.filter(function (it) { return Store.daysLeft(it) !== null; })
      .filter(matches)
      .sort(function (a, b) { return Store.daysLeft(a) - Store.daysLeft(b); })
      .filter(function (it) { return Store.daysLeft(it) <= 7; });
    if (!list.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '일주일 안에 챙겨야 할 재료가 없어요 👏';
      ul.appendChild(li);
      return;
    }
    list.forEach(function (it) { ul.appendChild(itemRow(it, { showZone: true })); });
  }

  function renderAllList() {
    var st = Store.get();
    var ul = $('#all-items');
    ul.innerHTML = '';
    var list = st.items.filter(matches).sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (!list.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = query ? '검색 결과가 없어요.' : '아직 담긴 식재료가 없어요.';
      ul.appendChild(li);
      return;
    }
    list.forEach(function (it) { ul.appendChild(itemRow(it, { showZone: true })); });
  }

  /* 탭 */
  function setTab(name) {
    activeTab = name;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    $$('.tab-pane').forEach(function (p) { p.hidden = p.dataset.pane !== name; });
  }
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () { setTab(t.dataset.tab); });
  });

  /* 입력 폼 */
  var catSel = $('#item-cat');
  Store.CATEGORIES.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.emoji + ' ' + c.label;
    catSel.appendChild(o);
  });

  $$('.quick-dates .chip').forEach(function (b) {
    b.addEventListener('click', function () {
      $('#item-exp').value = todayPlus(Number(b.dataset.days));
    });
  });

  function startEdit(it) {
    $('#item-id').value = it.id;
    $('#item-name').value = it.name;
    $('#item-cat').value = it.category;
    $('#item-qty').value = it.qty;
    $('#item-unit').value = it.unit;
    $('#item-exp').value = it.expiresAt || '';
    $('#item-memo').value = it.memo || '';
    $('#submit-item').textContent = '수정 저장';
    $('#cancel-edit').hidden = false;
    $('#item-name').focus();
  }

  function clearForm() {
    $('#item-id').value = '';
    $('#add-form').reset();
    $('#item-qty').value = 1;
    $('#item-unit').value = '개';
    $('#submit-item').textContent = '칸에 담기';
    $('#cancel-edit').hidden = true;
    catTouched = false;
  }
  $('#cancel-edit').addEventListener('click', clearForm);

  $('#add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#item-name').value.trim();
    if (!name) return;
    if (!selectedZoneId) { toast('먼저 칸을 선택해 주세요.'); return; }
    var data = {
      zoneId: selectedZoneId,
      name: name,
      category: $('#item-cat').value,
      qty: $('#item-qty').value,
      unit: $('#item-unit').value,
      expiresAt: $('#item-exp').value || null,
      memo: $('#item-memo').value
    };
    var id = $('#item-id').value;
    if (id) { Store.updateItem(id, data); toast('수정했어요.'); }
    else { Store.addItem(data); toast(name + ' 담았어요.'); }
    clearForm();
    renderAll();
  });

  /* ─────────────── AI 품목 인식 ─────────────── */
  var aiResult = null;   // 현재 화면에 떠 있는 인식 결과

  function openModal(id) { $('#' + id).hidden = false; }
  function closeModal(id) { $('#' + id).hidden = true; }
  $$('[data-close-modal]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.closest('.modal');
      if (m) m.hidden = true;
    });
  });
  $$('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) m.hidden = true; });
  });

  function aiKeyHint() {
    $('#ai-key-hint').innerHTML = AI.hasKey()
      ? 'Claude 비전 모델이 품목을 읽어 후보 목록을 만듭니다'
      : 'API 키를 등록하면 실제 판독이 됩니다 (메뉴 → AI 인식 설정)';
  }

  function openScanItems() {
    var z = Store.zone(selectedZoneId);
    if (!z) { toast('먼저 칸을 선택해 주세요.'); return; }
    aiResult = null;
    $('#scan-target').textContent = z.name;
    $('#ai-pick').hidden = false;
    $('#ai-busy').hidden = true;
    $('#ai-result').hidden = true;
    $('#ai-foot').hidden = true;
    aiKeyHint();
    renderDemoButtons();
    openModal('modal-scan');
  }
  $('#btn-scan-items').addEventListener('click', openScanItems);
  $('#ai-back').addEventListener('click', function () {
    $('#ai-pick').hidden = false;
    $('#ai-result').hidden = true;
    $('#ai-foot').hidden = true;
  });

  function renderDemoButtons() {
    var wrap = $('#ai-demo-buttons');
    wrap.innerHTML = '';
    var z = Store.zone(selectedZoneId);
    var sec = z && z.section;
    (window.AIDemo || []).forEach(function (d) {
      var b = document.createElement('button');
      // 선택한 칸과 같은 구역의 샘플을 먼저 눈에 띄게
      b.className = 'chip' + (d.section === sec ? ' on' : '');
      b.textContent = d.title;
      b.addEventListener('click', function () { showAIResult(d); });
      wrap.appendChild(b);
    });
  }

  var aiFile = $('#ai-file');
  $('#ai-dropzone').addEventListener('click', function (e) {
    if (e.target !== aiFile) { e.preventDefault(); aiFile.click(); }
  });
  aiFile.addEventListener('change', function () {
    var f = aiFile.files && aiFile.files[0];
    if (!f) return;
    if (!AI.hasKey()) { toast('먼저 메뉴 → AI 인식 설정에서 API 키를 등록해 주세요.'); return; }
    $('#ai-pick').hidden = true;
    $('#ai-busy').hidden = false;
    $('#ai-busy-sub').textContent = AI.MODEL + ' 호출 중 · 보통 10~20초';
    AI.recognize(f).then(function (res) {
      $('#ai-busy').hidden = true;
      showAIResult(res);
    }).catch(function (err) {
      $('#ai-busy').hidden = true;
      $('#ai-pick').hidden = false;
      toast('인식 실패: ' + err.message);
    });
    aiFile.value = '';
  });

  function showAIResult(res) {
    aiResult = res;
    $('#ai-pick').hidden = true;
    $('#ai-busy').hidden = true;
    $('#ai-result').hidden = false;
    $('#ai-foot').hidden = false;
    $('#ai-summary').textContent = (res.title ? res.title + ' — ' : '') + (res.summary || '');
    $('#ai-unident').textContent = res.unidentified_count
      ? '가려지거나 불투명해서 특정하지 못한 물건 ' + res.unidentified_count + '개. ' + (res.unidentified_note || '')
      : '';
    $('#ai-unident').hidden = !res.unidentified_count;

    var ul = $('#ai-candidates');
    ul.innerHTML = '';
    (res.items || []).forEach(function (row, i) {
      var cat = Store.category(row.category);
      var conf = Math.round((row.confidence || 0) * 100);
      var cls = conf >= 70 ? '' : conf >= 45 ? ' mid' : ' low';
      var li = document.createElement('li');
      li.className = 'cand' + (conf < 45 ? ' off' : '');
      li.innerHTML =
        '<input type="checkbox" ' + (conf >= 45 ? 'checked' : '') + ' />' +
        '<span class="emo">' + cat.emoji + '</span>' +
        '<span><span class="nm"></span><span class="meta"></span></span>' +
        '<span class="conf' + cls + '">' + conf + '%</span>';
      li.querySelector('.nm').textContent = row.name + (row.qty > 1 ? '  ×' + row.qty : '');
      var days = row.shelf_life_days > 0 ? row.shelf_life_days : AI.suggestShelfLife(row.name, row.category);
      var meta = [cat.label, '소비기한 제안 D+' + days];
      if (row.label_text) meta.push('“' + row.label_text + '”');
      else if (row.note) meta.push(row.note);
      li.querySelector('.meta').textContent = meta.join(' · ');
      var cb = li.querySelector('input');
      cb.addEventListener('change', function () { li.classList.toggle('off', !cb.checked); });
      li.dataset.index = i;
      ul.appendChild(li);
    });
  }

  $('#ai-commit').addEventListener('click', function () {
    if (!aiResult || !selectedZoneId) return;
    var n = 0;
    $$('#ai-candidates .cand').forEach(function (li) {
      if (!li.querySelector('input').checked) return;
      var row = aiResult.items[Number(li.dataset.index)];
      Store.addItem(AI.toDraft(row, selectedZoneId));
      n++;
    });
    closeModal('modal-scan');
    renderAll();
    toast(n ? n + '개 품목을 담았어요. 소비기한은 제안값이니 확인해 주세요.' : '선택된 품목이 없습니다.');
  });

  /* AI 설정 */
  function openKeyModal() {
    $('#ai-model-name').textContent = AI.MODEL;
    $('#ai-key-input').value = AI.getKey();
    openModal('modal-key');
  }
  $('#ai-key-save').addEventListener('click', function () {
    AI.setKey($('#ai-key-input').value);
    closeModal('modal-key');
    aiKeyHint();
    toast(AI.hasKey() ? 'API 키를 저장했어요.' : '키를 비웠습니다.');
  });
  $('#ai-key-clear').addEventListener('click', function () {
    AI.setKey('');
    $('#ai-key-input').value = '';
    aiKeyHint();
    toast('키를 삭제했어요.');
  });

  /* 이름을 적으면 카테고리와 소비기한을 먼저 제안 (수동 입력도 빠르게) */
  var catTouched = false;
  $('#item-cat').addEventListener('change', function () { catTouched = true; });
  $('#item-name').addEventListener('blur', function () {
    var name = this.value.trim();
    if (!name || $('#item-id').value) return;
    if (!catTouched) {
      var guess = AI.suggestCategory(name);
      if (guess) $('#item-cat').value = guess;
    }
    if (!$('#item-exp').value) {
      var days = AI.suggestShelfLife(name, $('#item-cat').value);
      $('#item-exp').value = todayPlus(days);
      $('#item-exp').title = '추천 소비기한 (D+' + days + ') — 실제 표기로 고쳐주세요';
    }
  });

  /* 검색 · 이름 · 메뉴 */
  $('#search').addEventListener('input', function () {
    query = this.value.trim();
    if (query && activeTab === 'zone') setTab('all');
    renderAll();
  });
  $('#fridge-name').addEventListener('change', function () {
    Store.setName(this.value);
    this.value = Store.get().name;
  });

  var menuPop = $('#menu-pop');
  $('#btn-menu').addEventListener('click', function (e) {
    e.stopPropagation();
    menuPop.hidden = !menuPop.hidden;
  });
  document.addEventListener('click', function () { menuPop.hidden = true; });
  menuPop.addEventListener('click', function (e) { e.stopPropagation(); });

  $$('#menu-pop button').forEach(function (b) {
    b.addEventListener('click', function () {
      menuPop.hidden = true;
      var a = b.dataset.menu;
      if (a === 'aikey') {
        openKeyModal();
      } else if (a === 'rebuild') {
        show('welcome');
        $('#welcome-resume-wrap').hidden = false;
      } else if (a === 'export') {
        var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a2 = document.createElement('a');
        a2.href = url;
        a2.download = 'fridge-' + new Date().toISOString().slice(0, 10) + '.json';
        a2.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } else if (a === 'import') {
        $('#import-input').click();
      } else if (a === 'reset') {
        if (confirm('냉장고 구조와 재고를 모두 지웁니다. 계속할까요?')) {
          Store.reset();
          selectedZoneId = null;
          blocksLoadedFrom = null;
          Blocks.reset();
          $('#welcome-resume-wrap').hidden = true;
          show('welcome');
        }
      }
    });
  });

  $('#import-input').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        Store.importJSON(fr.result);
        selectedZoneId = null;
        blocksLoadedFrom = null;
        openMain();
        toast('불러왔어요.');
      } catch (err) {
        toast('불러오기 실패: ' + err.message);
      }
    };
    fr.readAsText(f);
    this.value = '';
  });

  /* 오프라인 지원 — HTTPS(또는 localhost)에서만 등록된다. file:// 로 열면 조용히 건너뛴다. */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('오프라인 캐시 등록 실패:', e.message);
      });
    });
  }

  /* 아이폰은 beforeinstallprompt 가 없어 설치 버튼이 뜨지 않는다.
   * 대신 공유 시트로 추가하는 방법을 안내한다. 이미 홈 화면 앱으로 실행 중이면 숨긴다. */
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (isIOS && !isStandalone) {
    var tip = $('#ios-tip');
    if (tip) tip.hidden = false;
  }

  /* 홈 화면에 추가 안내 (안드로이드/크롬) */
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    var b = $('#btn-install');
    if (b) b.hidden = false;
  });
  var installBtn = $('#btn-install');
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt.userChoice.then(function () {
        installPrompt = null;
        installBtn.hidden = true;
      });
    });
  }

  /* 부팅 */
  (function boot() {
    var st = Store.load();
    if (st) {
      $('#welcome-resume-wrap').hidden = false;
      openMain();
    } else {
      show('welcome');
    }
    clearForm();
  })();
})();
