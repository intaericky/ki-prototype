export function cleanHtml(value: string) {
  return value
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function parseKaistMenuPage(source: string, code: string, short: string, fallbackName: string) {
  const h3 = source.match(/<div class="item" id="tab_item_1">[\s\S]*?<h3>\[\s*(.*?)\s*\].*?(\d{2}\/\d{2}\([가-힣]\))<\/h3>/);
  const table = source.match(/<div class="item" id="tab_item_1">[\s\S]*?<table class="table">([\s\S]*?)<\/table>/)?.[1] ?? "";
  const heads = [...table.matchAll(/<th scope="col">(조식|중식|석식)\s*(.*?)<\/th>/g)].map((match) => cleanHtml(match[2]));
  const cells = [...table.matchAll(/<td>\s*([\s\S]*?)\s*<\/td>/g)].map((match) =>
    cleanHtml(match[1]).split("\n").filter(Boolean),
  );

  if (!h3 || heads.length < 3 || cells.length < 3) throw new Error("KAIST menu markup changed");

  return {
    code,
    short,
    name: cleanHtml(h3[1]) || fallbackName,
    sourceDate: h3[2],
    meals: {
      breakfast: { time: heads[0], lines: cells[0] },
      lunch: { time: heads[1], lines: cells[1] },
      dinner: { time: heads[2], lines: cells[2] },
    },
  };
}
