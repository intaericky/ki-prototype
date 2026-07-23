"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DAILY_BUDGET_KG, estimateMenu } from "../lib/carbon";
import { TOKEN_COLORS } from "../lib/token-colors";
import TokenGlobe, { type GlobeToken } from "./TokenGlobe";

type MealKey = "breakfast" | "lunch" | "dinner";
type Meal = { time: string; lines: string[] };
type Cafeteria = {
  code: string;
  short: string;
  name: string;
  sourceUrl: string;
  status: "live" | "unavailable";
  meals: Record<MealKey, Meal>;
};
type MenuResponse = { date: string; fetchedAt: string; cafeterias: Cafeteria[] };
type Option = { title: string; lines: string[] };

const MEALS: { id: MealKey; label: string }[] = [
  { id: "breakfast", label: "조식" },
  { id: "lunch", label: "중식" },
  { id: "dinner", label: "석식" },
];

function koreaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function splitOptions(lines: string[]): Option[] {
  if (!lines.length) return [];
  const section = /(?:^|\s)(?:A|B|C)?코너|일품|\d층\s*자율배식|프리미엄|특식|Premium/i;
  const groups: Option[] = [];
  let current: Option = { title: "기본", lines: [] };
  for (const line of lines) {
    if (section.test(line) && current.lines.length) {
      groups.push(current);
      current = { title: line.replace(/\s+/g, " "), lines: [] };
    } else if (section.test(line)) current.title = line.replace(/\s+/g, " ");
    else current.lines.push(line);
  }
  if (current.lines.length) groups.push(current);
  return groups;
}

export default function MenuInstrument() {
  const [embedded, setEmbedded] = useState(false);
  const [date, setDate] = useState(koreaDate);
  const [meal, setMeal] = useState<MealKey>("lunch");
  const [data, setData] = useState<MenuResponse | null>(null);
  const [cafeteriaCode, setCafeteriaCode] = useState("fclt");
  const [optionIndex, setOptionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => setEmbedded(new URLSearchParams(window.location.search).has("embed")), []);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/menu?date=${date}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`menu ${response.status}`);
      const nextData = await response.json();
      if (requestId === requestRef.current) setData(nextData);
    } catch {
      if (requestId === requestRef.current) {
        setData(null);
        setError(true);
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const cafeteria = data?.cafeterias.find((item) => item.code === cafeteriaCode) ?? data?.cafeterias[0] ?? null;
  const options = useMemo(() => cafeteria ? splitOptions(cafeteria.meals[meal].lines) : [], [cafeteria, meal]);
  const selectedOption = options[Math.min(optionIndex, Math.max(0, options.length - 1))] ?? null;
  const estimate = useMemo(() => selectedOption ? estimateMenu(selectedOption.lines) : null, [selectedOption]);

  useEffect(() => { setOptionIndex(0); }, [cafeteriaCode, meal, date]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "FOOD_CONTROL") return;
      const command = event.data as { date?: string; meal?: MealKey; cafeteria?: string; reset?: boolean };
      if (command.date && /^\d{4}-\d{2}-\d{2}$/.test(command.date)) setDate(command.date);
      if (command.meal && MEALS.some((item) => item.id === command.meal)) setMeal(command.meal);
      if (command.cafeteria) setCafeteriaCode(command.cafeteria);
      if (command.reset) setResetKey((value) => value + 1);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const tokens = useMemo<GlobeToken[]>(() => {
    if (!estimate) return [];
    return estimate.dishes.flatMap((dish, dishIndex) => dish.hits.map((hit, hitIndex) => ({
      id: `${dishIndex}-${hitIndex}-${hit.id}`,
      categoryId: hit.id,
      label: hit.ko,
      kg: hit.contribution,
      color: TOKEN_COLORS[hit.id] ?? "#777777",
    })));
  }, [estimate]);

  const legend = useMemo(() => {
    const totals = new Map<string, { id: string; label: string; kg: number; color: string }>();
    for (const token of tokens) {
      const current = totals.get(token.categoryId);
      if (current) current.kg += token.kg;
      else totals.set(token.categoryId, { id: token.categoryId, label: token.label, kg: token.kg, color: token.color });
    }
    return [...totals.values()].sort((a, b) => b.kg - a.kg);
  }, [tokens]);

  const dateLabel = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(`${date}T12:00:00+09:00`));
  const budgetUse = estimate ? estimate.kg / DAILY_BUDGET_KG * 100 : 0;

  useEffect(() => {
    if (!embedded || window.parent === window) return;
    window.parent.postMessage({
      type: "FOOD_STATUS",
      totalKg: estimate?.kg ?? 0,
      budgetUse,
      legend,
    }, window.location.origin);
  }, [embedded, estimate, budgetUse, legend]);

  return (
    <main className={`edo-three${embedded ? " embedded" : ""}`}>
      <header className="three-header">
        <h1>EDO / KAIST</h1>
        <div className="control date-control">
          <button aria-label="이전 날짜" onClick={() => setDate(shiftDate(date, -1))}>←</button>
          <label><span>{dateLabel}</span><input type="date" value={date} max={koreaDate()} onChange={(event) => setDate(event.target.value)} /></label>
          <button aria-label="다음 날짜" disabled={date >= koreaDate()} onClick={() => setDate(shiftDate(date, 1))}>→</button>
        </div>
        <div className="control meal-control">
          {MEALS.map((item) => <button key={item.id} className={meal === item.id ? "active" : ""} onClick={() => setMeal(item.id)}>{item.label}</button>)}
        </div>
        <label className="select-control">
          <span className="sr-only">식당</span>
          <select value={cafeteriaCode} onChange={(event) => setCafeteriaCode(event.target.value)}>
            {(data?.cafeterias ?? []).map((item) => <option key={item.code} value={item.code}>{item.name} / {item.short}</option>)}
          </select>
        </label>
      </header>

      <section className="three-stage">
        {tokens.length ? <TokenGlobe tokens={tokens} resetKey={resetKey} budgetKg={DAILY_BUDGET_KG} /> : (
          <div className="three-empty" aria-live="polite">
            {loading ? "메뉴 불러오는 중" : error ? <><span>식단 연결 실패</span><button onClick={load}>다시 시도</button></> : "공식 메뉴 미게시"}
          </div>
        )}

        <div className="stage-meta">
          <span>{cafeteria?.name ?? "—"} · {cafeteria?.meals[meal].time || "—"}</span>
          <strong>{estimate ? `${Math.round(budgetUse)}%` : "—"}</strong>
          <small>{estimate ? `${estimate.kg.toFixed(2)} / ${DAILY_BUDGET_KG.toFixed(1)} kg CO₂e · 메뉴명 기반 추정` : "1일 탄소예산 5.5 kg CO₂e"}</small>
        </div>

        {options.length > 1 && (
          <div className="option-control" aria-label="메뉴 선택">
            {options.map((option, index) => <button key={`${option.title}-${index}`} className={index === optionIndex ? "active" : ""} onClick={() => setOptionIndex(index)}>{index + 1}</button>)}
          </div>
        )}

        {selectedOption && (
          <div className="stage-menu" aria-label="선택한 메뉴">
            <b>MENU</b>
            <span>{selectedOption.lines.join(" · ")}</span>
          </div>
        )}

        {tokens.length > 0 && (
          <div className="globe-actions">
            <span>DRAG 회전 · WHEEL/PINCH 확대</span>
            <button className="drop-again" onClick={() => setResetKey((value) => value + 1)}>다시 떨어뜨리기 ↘</button>
          </div>
        )}
      </section>

      <footer className="three-footer">
        <div className="legend">
          {legend.map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.label} <b>{item.kg.toFixed(2)}</b></span>)}
        </div>
        <div className="encoding">전체 구 = 1일 5.5 kg · 부피 ∝ CO₂e · 높이 ≠ 비율 · <a href={cafeteria?.sourceUrl} target="_blank" rel="noreferrer">식단 원본 ↗</a></div>
      </footer>
    </main>
  );
}
