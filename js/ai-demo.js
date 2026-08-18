/* ai-demo.js — API 키 없이도 인식 흐름을 볼 수 있는 샘플 결과.
 * 실제 사용자 냉장고 사진 3장을 Claude(비전 모델)로 판독한 결과를 그대로 담았다.
 * confidence: 1.0에 가까울수록 확실. 0.5 이하는 "이런 종류로 보인다" 수준.
 */
window.AIDemo = [
  {
    id: 'A',
    section: 'fridge',
    title: '샘플 · 냉장칸',
    summary: '정리용 트레이로 구획된 냉장칸. 음료팩·소스병·반찬통이 앞뒤로 겹쳐 있어 뒷줄은 일부만 보입니다.',
    unidentified_count: 9,
    unidentified_note: '흰색·투명 반찬통 5개와 종이봉투 2개는 내용물이 보이지 않아 품목을 특정할 수 없습니다.',
    items: [
      { name: '아몬드 음료 (저당 35kcal)', category: 'drink', qty: 4, unit: '팩', confidence: 0.88, shelf_life_days: 90, label_text: '1:2 · 35kcal · ZERO SUGAR', note: '멸균팩, 세워서 트레이에 정렬' },
      { name: '오트밀크 (OATSIDE)', category: 'drink', qty: 1, unit: '팩', confidence: 0.72, shelf_life_days: 60, label_text: 'OATSIDE', note: '' },
      { name: '오트밀 (대용량 밀폐용기)', category: 'etc', qty: 1, unit: '통', confidence: 0.74, shelf_life_days: 180, label_text: '', note: '검은 뚜껑 원형 용기, 곡물류로 보임' },
      { name: '계란', category: 'dairy', qty: 1, unit: '판', confidence: 0.8, shelf_life_days: 21, label_text: '', note: '계란 트레이 + 낱개 1구 별도 보관' },
      { name: '잼/스프레드 유리병', category: 'sauce', qty: 3, unit: '병', confidence: 0.62, shelf_life_days: 180, label_text: '', note: '내용물 갈색·검정, 라벨 각도상 판독 불가' },
      { name: '김치통 (대형 밀폐용기)', category: 'side', qty: 1, unit: '통', confidence: 0.55, shelf_life_days: 30, label_text: '', note: '갈색 대형 용기 — 김치/장아찌류 추정' },
      { name: '참기름 또는 식용유', category: 'sauce', qty: 1, unit: '병', confidence: 0.6, shelf_life_days: 180, label_text: '', note: '노란 뚜껑, 갈색 액체' },
      { name: '간장/소스 병', category: 'sauce', qty: 2, unit: '병', confidence: 0.66, shelf_life_days: 180, label_text: '', note: '검은 뚜껑' },
      { name: '반찬통 (내용물 불명)', category: 'side', qty: 5, unit: '통', confidence: 0.35, shelf_life_days: 5, label_text: '', note: '불투명/반투명 용기라 시각 판독 불가 — 직접 입력 필요' },
      { name: '배추 또는 양배추', category: 'veg', qty: 1, unit: '통', confidence: 0.58, shelf_life_days: 14, label_text: '', note: '오른쪽 야채칸, 종이에 싸여 있음' },
      { name: '수입 조미료 (이탈리아산)', category: 'sauce', qty: 1, unit: '봉', confidence: 0.5, shelf_life_days: 180, label_text: 'CONDIMENTO', note: '노란 포장 봉지' },
      { name: '우유팩', category: 'dairy', qty: 1, unit: '팩', confidence: 0.5, shelf_life_days: 7, label_text: '', note: '베이지색 종이팩, 브랜드 미확인' }
    ]
  },
  {
    id: 'B',
    section: 'door',
    title: '샘플 · 냉장고문',
    summary: '냉장고문 4단 포켓. 병·봉지가 한 줄로 서 있어 인식이 가장 잘 되는 구역입니다.',
    unidentified_count: 4,
    unidentified_note: '왼쪽 포켓의 종이/비닐 봉지 4개는 포장만 보이고 내용물 표기가 가려져 있습니다.',
    items: [
      { name: '태화루 생막걸리', category: 'drink', qty: 1, unit: '병', confidence: 0.93, shelf_life_days: 10, label_text: '태화루 생막걸리', note: '생주 — 개봉 후 빨리 소비' },
      { name: '마요네즈 (대용량)', category: 'sauce', qty: 1, unit: '병', confidence: 0.85, shelf_life_days: 90, label_text: '', note: '' },
      { name: '발효곤약 냉모밀 모밀고명', category: 'side', qty: 1, unit: '팩', confidence: 0.9, shelf_life_days: 14, label_text: '바로먹는 발효곤약 냉모밀 · 모밀고명 · 내용량 23g', note: '' },
      { name: '스리라차 소스', category: 'sauce', qty: 1, unit: '병', confidence: 0.78, shelf_life_days: 180, label_text: 'SRIRACHA', note: '' },
      { name: '참기름', category: 'sauce', qty: 1, unit: '병', confidence: 0.7, shelf_life_days: 180, label_text: '', note: '노란 뚜껑' },
      { name: '고기 양념장', category: 'sauce', qty: 1, unit: '병', confidence: 0.62, shelf_life_days: 60, label_text: '고기전용', note: '' },
      { name: '다진마늘 또는 절임 (유리병)', category: 'sauce', qty: 1, unit: '병', confidence: 0.55, shelf_life_days: 60, label_text: '', note: '갈색 내용물, 라벨 일부만 노출' },
      { name: '가공유 (매일 더리치)', category: 'dairy', qty: 1, unit: '병', confidence: 0.72, shelf_life_days: 7, label_text: 'THE RICH', note: '손글씨 메모 스티커가 붙어 있음 — 개봉일 표기로 추정' },
      { name: '모짜렐라 치즈', category: 'dairy', qty: 1, unit: '봉', confidence: 0.86, shelf_life_days: 14, label_text: 'MOZZARELLA CHEESE', note: '' },
      { name: '피자 치즈 (피자마루)', category: 'dairy', qty: 1, unit: '봉', confidence: 0.8, shelf_life_days: 14, label_text: 'Pizza maru · 목장 치즈', note: '' },
      { name: '프로틴 스낵', category: 'etc', qty: 1, unit: '봉', confidence: 0.68, shelf_life_days: 120, label_text: 'PROTEIN BITES', note: '' },
      { name: '호일 포장 식품', category: 'etc', qty: 1, unit: '개', confidence: 0.3, shelf_life_days: 3, label_text: '', note: '내용물 완전 불명 — 직접 입력 필요' }
    ]
  },
  {
    id: 'C',
    section: 'freezer',
    title: '샘플 · 냉동칸',
    summary: '냉동칸 서랍 3칸. 성에와 반투명 봉지 때문에 인식 난이도가 가장 높은 구역입니다.',
    unidentified_count: 14,
    unidentified_note: '소분 냉동 봉지 다수가 서로 겹쳐 있고 성에가 껴 있어 품목 특정이 어렵습니다. 냉동칸은 사진보다 직접 입력이 확실합니다.',
    items: [
      { name: '쿠키 (WHAT’S THE BETTER?)', category: 'frozen', qty: 2, unit: '봉', confidence: 0.88, shelf_life_days: 180, label_text: "WHAT'S THE BETTER?", note: '' },
      { name: '냉동 만두 또는 떡', category: 'frozen', qty: 3, unit: '봉', confidence: 0.5, shelf_life_days: 180, label_text: '', note: '봉지 형태로 추정, 라벨 판독 불가' },
      { name: '냉동 육류 소분팩', category: 'meat', qty: 2, unit: '팩', confidence: 0.55, shelf_life_days: 90, label_text: '', note: '붉은 색감으로 육류 추정' },
      { name: '냉동 보관용기 (파란 뚜껑)', category: 'frozen', qty: 1, unit: '통', confidence: 0.45, shelf_life_days: 90, label_text: '', note: '내용물 불명 — 밥/국 소분 추정' },
      { name: '빵가루 또는 치즈가루', category: 'etc', qty: 1, unit: '팩', confidence: 0.42, shelf_life_days: 180, label_text: '', note: '노란 가루가 담긴 트레이' },
      { name: '냉동 채소/나물', category: 'veg', qty: 1, unit: '봉', confidence: 0.4, shelf_life_days: 180, label_text: '', note: '초록색 덩어리로 보임' },
      { name: '소분 냉동식품 (내용물 불명)', category: 'frozen', qty: 8, unit: '봉', confidence: 0.25, shelf_life_days: 90, label_text: '', note: '흰 비닐/지퍼백 다수 — 라벨링 권장' }
    ]
  }
];
