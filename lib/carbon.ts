export type CarbonCategory = {
  id: string;
  label: string;
  ko: string;
  kg: number;
  portion: string;
};

export type CarbonHit = CarbonCategory & {
  multiplier: number;
  contribution: number;
  matchedBy: string;
};

export type DishEstimate = {
  line: string;
  hits: CarbonHit[];
  kg: number;
};

export type MenuEstimate = {
  kg: number;
  low: number;
  high: number;
  coverage: number;
  dishes: DishEstimate[];
  totals: CarbonHit[];
};

// Edo's poster uses this COP21-derived reference circle as one personal daily budget.
export const DAILY_BUDGET_KG = 5.5;

// Values reproduce Edo's 18 token categories: kg CO2e per typical portion.
export const CATEGORIES: CarbonCategory[] = [
  { id: "red-meat", label: "Red meat", ko: "소고기·양고기", kg: 4.6, portion: "100 g" },
  { id: "fish", label: "Fish", ko: "생선·해산물", kg: 1.5, portion: "110 g" },
  { id: "pork", label: "Pork", ko: "돼지고기", kg: 1.1, portion: "90 g" },
  { id: "poultry", label: "Poultry", ko: "닭·오리", kg: 0.61, portion: "90 g" },
  { id: "yogurt", label: "Yogurt", ko: "요거트", kg: 0.388, portion: "145 g" },
  { id: "protein-starter", label: "Protein starter", ko: "혼합 단백질", kg: 0.305, portion: "1 serving" },
  { id: "starch", label: "Rice / noodles / potato", ko: "밥·면·감자", kg: 0.271, portion: "225 g" },
  { id: "pastry", label: "Cake / pastry", ko: "케이크·과자", kg: 0.216, portion: "1 piece" },
  { id: "cheese", label: "Cheese", ko: "치즈", kg: 0.188, portion: "30 g" },
  { id: "egg", label: "Egg", ko: "달걀", kg: 0.176, portion: "1–1.5 eggs" },
  { id: "vegetable", label: "Vegetables", ko: "채소", kg: 0.165, portion: "150 g" },
  { id: "grain", label: "Quinoa / couscous", ko: "기타 곡물", kg: 0.139, portion: "225 g" },
  { id: "coffee", label: "Coffee", ko: "커피", kg: 0.132, portion: "1 cup" },
  { id: "fruit", label: "Fruit", ko: "과일", kg: 0.127, portion: "1 serving" },
  { id: "dairy", label: "Dairy supplement", ko: "유제품", kg: 0.11, portion: "1 serving" },
  { id: "plant-protein", label: "Plant protein", ko: "콩·두부", kg: 0.099, portion: "1 serving" },
  { id: "salad", label: "Salad", ko: "샐러드", kg: 0.054, portion: "1 bowl" },
  { id: "bread", label: "Bread", ko: "빵", kg: 0.033, portion: "1 piece" },
];

const byId = Object.fromEntries(CATEGORIES.map((category) => [category.id, category]));

type Rule = { id: string; pattern: RegExp; multiplier?: number };

const RULES: Rule[] = [
  { id: "red-meat", pattern: /소고기|쇠고기|우양지|불고기|육전|비프|양고기|스테이크|장조림/ },
  { id: "pork", pattern: /돼지|돈육|제육|돈까스|돈카츠|멘치|햄|소시지|비엔나|족발|보쌈|부대/ },
  { id: "poultry", pattern: /닭|치킨|계육|오리|가금/ },
  { id: "fish", pattern: /생선|갈치|고등어|참치|연어|가자미|어묵|오징어|새우|해물|조개|홍합|멸치|쭈꾸미|낙지/ },
  { id: "cheese", pattern: /치즈/ },
  { id: "yogurt", pattern: /요거트|요구르트/ },
  { id: "egg", pattern: /계란|달걀|메추리알/ },
  { id: "plant-protein", pattern: /두부|콩자반|콩비지|렌틸|병아리콩|콩고기/ },
  { id: "salad", pattern: /샐러드/, multiplier: 1 },
  { id: "bread", pattern: /식빵|모닝빵|바게트|베이글|토스트|빵/, multiplier: 1 },
  { id: "pastry", pattern: /케이크|쿠키|과자|파이|도넛|페이스트리/ },
  { id: "coffee", pattern: /커피|아메리카노/ },
  { id: "fruit", pattern: /과일|사과|배(?!추)|바나나|오렌지|귤|포도|딸기|수박|복숭아/ },
  { id: "dairy", pattern: /우유|크림|버터|요거트|요구르트/, multiplier: 1 },
  { id: "starch", pattern: /밥|국수|면|우동|쫄면|냉면|파스타|떡|감자|고구마|잡곡|누룽지|만두|수제비/ },
  { id: "grain", pattern: /퀴노아|쿠스쿠스|보리|옥수수/ },
  { id: "vegetable", pattern: /나물|야채|채소|브로콜리|오이|버섯|무침|유채|콩나물|시금치|김치|해초|깻잎|배추|무채|치커리|깍두기|부추|양배추|숙주|가지|호박|마늘쫑/, multiplier: 0.45 },
];

const IGNORE = /가격|원\)|kcal|칼로리|코너|자율배식|학생 대상|캠페인|제공됩니다|운영|추가밥|공기밥|쌀밥\/보리밥/;

function contextualMultiplier(line: string, rule: Rule) {
  let value = rule.multiplier ?? 1;
  if (/국|찌개|탕/.test(line) && ["red-meat", "pork", "poultry", "fish"].includes(rule.id)) value *= 0.45;
  if (/볶음밥|비빔밥|덮밥|국수|면|우동|파스타/.test(line) && ["red-meat", "pork", "poultry", "fish"].includes(rule.id)) value *= 0.65;
  if (/김치|깍두기/.test(line) && rule.id === "vegetable") value *= 0.35;
  if (/드레싱|소스/.test(line) && rule.id === "dairy") value *= 0.35;
  return value;
}

export function estimateMenu(lines: string[]): MenuEstimate {
  let eligible = 0;
  let covered = 0;

  const dishes = lines
    .map((raw) => raw.trim())
    .filter(Boolean)
    .filter((line) => !IGNORE.test(line))
    .map((line) => {
      eligible += 1;
      const hits: CarbonHit[] = [];
      const seen = new Set<string>();

      for (const rule of RULES) {
        if (!seen.has(rule.id) && rule.pattern.test(line)) {
          seen.add(rule.id);
          const category = byId[rule.id];
          const multiplier = contextualMultiplier(line, rule);
          hits.push({
            ...category,
            multiplier,
            contribution: category.kg * multiplier,
            matchedBy: line,
          });
        }
      }

      if (hits.length) covered += 1;
      return { line, hits, kg: hits.reduce((sum, hit) => sum + hit.contribution, 0) };
    });

  const kg = dishes.reduce((sum, dish) => sum + dish.kg, 0);
  const grouped = new Map<string, CarbonHit>();
  for (const dish of dishes) {
    for (const hit of dish.hits) {
      const current = grouped.get(hit.id);
      if (current) {
        current.multiplier += hit.multiplier;
        current.contribution += hit.contribution;
        current.matchedBy += ` · ${hit.matchedBy}`;
      } else grouped.set(hit.id, { ...hit });
    }
  }

  return {
    kg,
    low: kg * 0.65,
    high: kg * 1.35,
    coverage: eligible ? covered / eligible : 0,
    dishes,
    totals: [...grouped.values()].sort((a, b) => b.contribution - a.contribution),
  };
}
