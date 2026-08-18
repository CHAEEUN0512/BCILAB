/* ai.js — 사진 속 식재료를 AI로 인식해 재고 후보를 만든다.
 *
 * 이 앱은 빌드 도구가 없는 정적 사이트라 공식 SDK(@anthropic-ai/sdk) 대신
 * Messages API를 fetch로 직접 호출한다. 브라우저에서 직접 호출하려면
 * anthropic-dangerous-direct-browser-access 헤더가 필요하고,
 * API 키가 브라우저에 노출된다는 점을 사용자가 알고 켜야 한다(설정에서 opt-in).
 */
window.AI = (function () {
  var KEY_STORE = 'fridge-keeper-apikey';
  var ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var MODEL = 'claude-opus-5';
  var MAX_EDGE = 1120;   // 전송 전 축소 (인식률은 유지하면서 토큰·전송량 절감)

  var CATEGORY_IDS = Store.CATEGORIES.map(function (c) { return c.id; });

  /* 품목별 기본 소비기한(일). AI가 값을 못 주거나 수동 입력일 때 제안용. */
  var SHELF_LIFE_BY_CATEGORY = {
    veg: 7, fruit: 7, meat: 3, sea: 2, dairy: 7,
    drink: 14, side: 4, frozen: 90, sauce: 180, etc: 14
  };
  var SHELF_LIFE_BY_KEYWORD = [
    [/우유|milk|라떼/i, 7], [/계란|달걀/i, 21], [/두부/i, 5], [/생선|회|연어|고등어/i, 2],
    [/삼겹|목살|소고기|돼지|닭|육류/i, 3], [/막걸리|생주/i, 10], [/치즈/i, 14],
    [/김치|장아찌/i, 30], [/간장|고추장|된장|소스|마요|케첩|참기름/i, 180],
    [/냉동|만두|아이스/i, 90], [/요거트|요구르트/i, 10], [/나물|반찬/i, 4]
  ];

  /* 이름만 보고 카테고리 추정 (수동 입력 보조) */
  var CATEGORY_BY_KEYWORD = [
    [/우유|치즈|요거트|요구르트|버터|생크림|계란|달걀|라떼/i, 'dairy'],
    [/사과|배|딸기|포도|바나나|귤|오렌지|수박|참외|블루베리/i, 'fruit'],
    [/삼겹|목살|소고기|돼지|닭|육류|고기|베이컨|햄|소시지/i, 'meat'],
    [/생선|회|연어|고등어|새우|오징어|조개|명란|어묵/i, 'sea'],
    [/콜라|사이다|주스|음료|막걸리|맥주|와인|커피|탄산|물/i, 'drink'],
    [/김치|나물|반찬|장아찌|무침|조림|국|찌개/i, 'side'],
    [/냉동|만두|아이스크림|떡갈비|피자/i, 'frozen'],
    [/간장|고추장|된장|소스|마요|케첩|참기름|식초|드레싱|잼|시럽/i, 'sauce'],
    [/대파|양파|마늘|배추|양배추|상추|시금치|당근|감자|고추|버섯|오이|호박|채소/i, 'veg']
  ];

  function suggestCategory(name) {
    for (var i = 0; i < CATEGORY_BY_KEYWORD.length; i++) {
      if (CATEGORY_BY_KEYWORD[i][0].test(name || '')) return CATEGORY_BY_KEYWORD[i][1];
    }
    return null;
  }

  function suggestShelfLife(name, category) {
    for (var i = 0; i < SHELF_LIFE_BY_KEYWORD.length; i++) {
      if (SHELF_LIFE_BY_KEYWORD[i][0].test(name || '')) return SHELF_LIFE_BY_KEYWORD[i][1];
    }
    return SHELF_LIFE_BY_CATEGORY[category] || 7;
  }

  /* ── API 키 (사용자가 직접 저장, 이 브라우저 밖으로 나가지 않음) ── */
  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) {
    try {
      if (k) localStorage.setItem(KEY_STORE, k.trim());
      else localStorage.removeItem(KEY_STORE);
    } catch (e) {}
  }
  function hasKey() { return !!getKey(); }

  /* ── 이미지 축소 + base64 ── */
  function prepareImage(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          var cv = document.createElement('canvas');
          cv.width = Math.round(img.naturalWidth * scale);
          cv.height = Math.round(img.naturalHeight * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          var url = cv.toDataURL('image/jpeg', 0.8);
          res({ base64: url.split(',')[1], mediaType: 'image/jpeg', preview: url });
        };
        img.onerror = function () { rej(new Error('이미지를 읽지 못했습니다.')); };
        img.src = fr.result;
      };
      fr.onerror = function () { rej(new Error('파일을 읽지 못했습니다.')); };
      fr.readAsDataURL(file);
    });
  }

  var SCHEMA = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '한국어 품목명. 브랜드를 읽을 수 있으면 포함' },
            category: { type: 'string', enum: CATEGORY_IDS },
            qty: { type: 'number' },
            unit: { type: 'string', description: '개, 팩, 병, 봉, 통 등' },
            confidence: { type: 'number', description: '0~1' },
            shelf_life_days: { type: 'integer', description: '통상 소비기한(일). 모르면 0' },
            label_text: { type: 'string', description: '포장에서 실제로 읽은 글자. 없으면 빈 문자열' },
            note: { type: 'string' }
          },
          required: ['name', 'category', 'qty', 'unit', 'confidence', 'shelf_life_days', 'label_text', 'note'],
          additionalProperties: false
        }
      },
      unidentified_count: { type: 'integer', description: '가려지거나 불투명해서 특정하지 못한 물건 수' },
      unidentified_note: { type: 'string' },
      summary: { type: 'string' }
    },
    required: ['items', 'unidentified_count', 'unidentified_note', 'summary'],
    additionalProperties: false
  };

  var SYSTEM = [
    '너는 냉장고 내부 사진에서 식재료 재고를 뽑아내는 도우미다.',
    '규칙:',
    '1. 사진에 실제로 보이는 것만 적는다. 냉장고에 흔히 있을 법한 물건을 상상해서 추가하지 않는다.',
    '2. 불투명한 용기·봉지처럼 내용물을 알 수 없으면 "반찬통(내용물 불명)"처럼 적고 confidence를 0.4 이하로 낮춘다.',
    '3. 포장에서 글자를 읽었으면 label_text에 읽은 그대로 넣는다. 흐릿하면 빈 문자열로 둔다.',
    '4. 같은 물건이 여러 개면 하나의 항목으로 합치고 qty로 센다.',
    '5. 뒷줄에 가려 안 보이는 물건은 세지 말고, 대신 unidentified_count와 unidentified_note로 설명한다.',
    '6. shelf_life_days는 미개봉/냉장 보관 기준의 통상 소비기한이고, 모르면 0으로 둔다.'
  ].join('\n');

  var USER_TEXT = '이 냉장고 사진에 보이는 식재료를 재고 목록으로 만들어줘. 확실하지 않은 것은 confidence를 낮추고, 가려서 못 본 부분은 따로 알려줘.';

  /* ── 실제 인식 호출 ── */
  function recognize(file) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('API 키가 없습니다. 설정에서 먼저 등록해 주세요.'));

    return prepareImage(file).then(function (img) {
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 8000,
          system: SYSTEM,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
              { type: 'text', text: USER_TEXT }
            ]
          }]
        })
      }).then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) {
            var msg = (body && body.error && body.error.message) || ('HTTP ' + r.status);
            throw new Error(msg);
          }
          return body;
        });
      }).then(function (body) {
        if (body.stop_reason === 'refusal') throw new Error('모델이 이 이미지 처리를 거절했습니다.');
        var textBlock = (body.content || []).filter(function (b) { return b.type === 'text'; })[0];
        if (!textBlock) throw new Error('응답에서 결과를 찾지 못했습니다.');
        var data = JSON.parse(textBlock.text);   // output_config.format 이 JSON 유효성을 보장
        data.preview = img.preview;
        data.usage = body.usage;
        return data;
      });
    });
  }

  /* 인식 결과 한 줄 → 재고 항목 초안 */
  function toDraft(row, zoneId) {
    var days = row.shelf_life_days > 0 ? row.shelf_life_days : suggestShelfLife(row.name, row.category);
    var d = new Date();
    d.setDate(d.getDate() + days);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return {
      zoneId: zoneId,
      name: row.name,
      category: CATEGORY_IDS.indexOf(row.category) >= 0 ? row.category : 'etc',
      qty: row.qty || 1,
      unit: row.unit || '개',
      expiresAt: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      memo: row.label_text || row.note || ''
    };
  }

  return {
    MODEL: MODEL,
    getKey: getKey, setKey: setKey, hasKey: hasKey,
    recognize: recognize, toDraft: toDraft,
    suggestShelfLife: suggestShelfLife, suggestCategory: suggestCategory
  };
})();
