/* store.js — 냉장고 모델과 재고 데이터 (localStorage 영속화) */
window.Store = (function () {
  var KEY = 'fridge-keeper-v1';
  var state = null;

  var ZONE_TYPES = {
    shelf:   { label: '선반',      emoji: '🗄️' },
    drawer:  { label: '서랍',      emoji: '🧰' },
    crisper: { label: '야채칸',    emoji: '🥬' },
    freezer: { label: '냉동칸',    emoji: '🧊' },
    icebox:  { label: '제빙/특선', emoji: '❄️' },
    door:    { label: '도어 포켓', emoji: '🚪' }
  };

  var CATEGORIES = [
    { id: 'veg',    label: '채소',   emoji: '🥬' },
    { id: 'fruit',  label: '과일',   emoji: '🍎' },
    { id: 'meat',   label: '육류',   emoji: '🥩' },
    { id: 'sea',    label: '수산',   emoji: '🐟' },
    { id: 'dairy',  label: '유제품', emoji: '🥛' },
    { id: 'drink',  label: '음료',   emoji: '🥤' },
    { id: 'side',   label: '반찬',   emoji: '🍲' },
    { id: 'frozen', label: '냉동',   emoji: '🧊' },
    { id: 'sauce',  label: '소스',   emoji: '🧂' },
    { id: 'etc',    label: '기타',   emoji: '📦' }
  ];

  function uid(p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function blank() {
    return {
      version: 1,
      name: '우리집 냉장고',
      source: null,      // 'photo' | 'blocks'
      photos: {},        // 구역별 사진 {fridge,door,freezer} — ROI로 잘라낸 dataURL
      zones: [],         // {id,name,type,section,col:'body'|'door',x,y,w,h}  좌표는 0~1 정규화
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : null;
    } catch (e) { state = null; }
    if (state && (!state.zones || !state.zones.length)) state = null;
    if (state && !state.items) state.items = [];
    // 구버전(단일 사진) 모델 마이그레이션
    if (state && !state.photos) {
      state.photos = state.photo ? { fridge: state.photo } : {};
      delete state.photo;
    }
    return state;
  }

  function save() {
    if (!state) return;
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // 사진 때문에 용량 초과인 경우 사진을 버리고 데이터라도 지킨다
      if (state.photos && Object.keys(state.photos).length) {
        state.photos = {};
        try {
          localStorage.setItem(KEY, JSON.stringify(state));
          console.warn('저장 공간이 부족해 사진을 제외하고 저장했습니다.');
          return;
        } catch (e2) {/* fallthrough */}
      }
      console.warn('저장 실패:', e);
    }
  }

  function get() { return state; }

  function create(model) {
    state = blank();
    state.source = model.source || null;
    state.photos = model.photos || {};
    state.zones = model.zones || [];
    if (model.name) state.name = model.name;
    save();
    return state;
  }

  /* 구조만 갈아끼우고 재고는 최대한 살린다 (같은 이름의 칸으로 이어붙임) */
  function replaceStructure(model) {
    if (!state) return create(model);
    var oldZones = state.zones.slice();
    var oldItems = state.items.slice();
    state.source = model.source || state.source;
    state.photos = model.photos || {};
    state.zones = model.zones || [];

    var byName = {};
    state.zones.forEach(function (z) { if (!byName[z.name]) byName[z.name] = z.id; });
    var fallback = state.zones.length ? state.zones[0].id : null;

    state.items = oldItems.map(function (it) {
      var old = oldZones.filter(function (z) { return z.id === it.zoneId; })[0];
      var target = (old && byName[old.name]) || fallback;
      return Object.assign({}, it, { zoneId: target });
    });
    save();
    return state;
  }

  function reset() {
    state = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function setName(name) {
    if (!state) return;
    state.name = (name || '').trim() || '우리집 냉장고';
    save();
  }

  function zone(id) {
    if (!state) return null;
    return state.zones.filter(function (z) { return z.id === id; })[0] || null;
  }

  function itemsOf(zoneId) {
    if (!state) return [];
    return state.items.filter(function (it) { return it.zoneId === zoneId; });
  }

  function addItem(data) {
    if (!state) return null;
    var it = {
      id: uid('it'),
      zoneId: data.zoneId,
      name: (data.name || '').trim(),
      category: data.category || 'etc',
      qty: data.qty === '' || data.qty == null ? 1 : Number(data.qty),
      unit: (data.unit || '개').trim(),
      expiresAt: data.expiresAt || null,
      memo: (data.memo || '').trim(),
      createdAt: Date.now()
    };
    state.items.push(it);
    save();
    return it;
  }

  function updateItem(id, patch) {
    if (!state) return;
    state.items = state.items.map(function (it) {
      return it.id === id ? Object.assign({}, it, patch) : it;
    });
    save();
  }

  function removeItem(id) {
    if (!state) return;
    state.items = state.items.filter(function (it) { return it.id !== id; });
    save();
  }

  /* ── 유통기한 ── */
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

  function daysLeft(item) {
    if (!item.expiresAt) return null;
    var t = new Date(item.expiresAt + 'T00:00:00').getTime();
    if (isNaN(t)) return null;
    return Math.round((t - startOfToday()) / 86400000);
  }

  function status(item) {
    var d = daysLeft(item);
    if (d === null) return 'none';
    if (d < 0) return 'bad';
    if (d <= 3) return 'warn';
    return 'ok';
  }

  function ddayLabel(item) {
    var d = daysLeft(item);
    if (d === null) return '';
    if (d === 0) return '오늘까지';
    if (d < 0) return Math.abs(d) + '일 지남';
    return 'D-' + d;
  }

  function summary() {
    var s = { total: 0, warn: 0, bad: 0 };
    if (!state) return s;
    state.items.forEach(function (it) {
      s.total++;
      var st = status(it);
      if (st === 'warn') s.warn++;
      if (st === 'bad') s.bad++;
    });
    return s;
  }

  function category(id) {
    return CATEGORIES.filter(function (c) { return c.id === id; })[0] || CATEGORIES[CATEGORIES.length - 1];
  }

  function exportJSON() { return JSON.stringify(state, null, 2); }

  function importJSON(text) {
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.zones) || !data.zones.length) throw new Error('칸 정보가 없는 파일입니다.');
    if (!Array.isArray(data.items)) data.items = [];
    state = data;
    save();
    return state;
  }

  return {
    ZONE_TYPES: ZONE_TYPES, CATEGORIES: CATEGORIES,
    uid: uid, load: load, save: save, get: get,
    create: create, replaceStructure: replaceStructure, reset: reset, setName: setName,
    zone: zone, itemsOf: itemsOf,
    addItem: addItem, updateItem: updateItem, removeItem: removeItem,
    daysLeft: daysLeft, status: status, ddayLabel: ddayLabel,
    summary: summary, category: category,
    exportJSON: exportJSON, importJSON: importJSON
  };
})();
