"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ProjectId = "enso" | "daisy" | "coral" | "food";
type Theme = "dark" | "light";
type EnsoEpisode = { phase: "El Niño" | "La Niña"; start: number; end: number };
type EnsoStatus = { date: string; value: number; phase: "El Niño" | "La Niña" | "Neutral"; episodes: EnsoEpisode[] };
type CoralStatus = { anomaly: number; dhw: number; coverage: number; alert: string; influence: number; recovery: string; active: boolean };
type FoodLegendItem = { id: string; label: string; kg: number; color: string };
type FoodStatus = { totalKg: number; budgetUse: number; legend: FoodLegendItem[]; menu: string[]; optionTitle: string };
type Project = {
  id: ProjectId;
  number: string;
  ko: string;
  en: string;
  maker: string;
  source: string;
  description: string;
  dataset: string;
  interaction: string;
  reference: { x: number; y: number; scale: number };
};

const PROJECTS: Project[] = [
  {
    id: "enso", number: "01", ko: "엘니뇨 남방진동", en: "ENSO", maker: "황인태", source: "/projects/enso/index.html?embed=1",
    description: "〈ENSO〉는 NOAA 해수면 온도 자료를 구형 디스플레이 위에 펼쳐, 적도 태평양의 온도 변화가 행성 규모의 진동으로 이어지는 과정을 보여준다. 1982년부터 2025년까지의 SST와 Niño 3.4 지수를 따라 엘니뇨와 라니냐가 형성되고 사라지는 시간을 관찰한다.",
    dataset: "NOAA NCEI OISST v2.1 · 1982–2025 전 월 528개 전 지구 프레임 · 2° SST · Niño 3.4",
    interaction: "타임라인 이동 · 1초당 약 1년 재생 · 높이 조절 · 구 드래그",
    reference: { x: 640, y: 360, scale: 1 },
  },
  {
    id: "daisy", number: "02", ko: "데이지 월드", en: "Daisy World", maker: "정진", source: "/projects/daisy/daisy-world.mp4",
    description: "〈데이지월드〉는 가이아 가설의 ‘데이지월드 모델’을 바탕으로, 생명체와 환경이 상호작용하며 행성의 온도를 스스로 조절하는 메커니즘을 시각화한 작업이다. 생명 활동이 지구의 항상성을 지키는 과정과 온실가스 증가로 균형이 무너지는 임계점을 보여준다.",
    dataset: "Daisyworld model simulation · video prototype",
    interaction: "영상 재생·정지 · 타임라인 이동",
    reference: { x: 640, y: 360, scale: 1 },
  },
  {
    id: "coral", number: "03", ko: "산호 백화", en: "Coral Bleaching", maker: "서민혁", source: "/projects/coral/index.html?embed=1",
    description: "해양 표면 온도에 따른 산호의 백화 현상을 시각화한 인터랙티브 데이터 작업이다. 인간의 터치가 구의 온도 상승에 기여하여 산호빛 구가 하얗게 물드는 장면을 보여준다. 적극적으로 백화를 가속할 수도, 개입하지 않고 관망할 수도 있다.",
    dataset: "NOAA 지역별 산호 백화 자료 · DHW 위험도 · 산호 회복 속도",
    interaction: "터치 패드를 누르는 동안 가열·백화 · 손을 떼면 회복 · 구 드래그",
    reference: { x: 640, y: 350, scale: 1.28 },
  },
  {
    id: "food", number: "04", ko: "한 끼의 무게", en: "The Weight of a Meal", maker: "황인태", source: "/food?embed=1",
    description: "〈한 끼의 무게〉는 KAIST 교내 식당 메뉴를 탄소 데이터로 번역한다. 메뉴의 주요 식재료군과 대표 제공량별 배출계수를 바탕으로 예상 배출량을 계산하고, 서로 다른 색과 부피의 토큰으로 구 안에 쌓는다. 바깥 구는 한 사람의 하루 탄소예산 5.5 kg CO₂e를 나타낸다.",
    dataset: "KAIST 공식 식단 · 18개 식재료군별 탄소배출계수 · 5.5 kg CO₂e 하루 예산",
    interaction: "날짜·식당·끼니 선택 · 물리 토큰 낙하 · 구 드래그/확대",
    reference: { x: 640, y: 350, scale: 1.09 },
  },
];

function koreaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function ExhibitionShell() {
  const stageRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [theme, setTheme] = useState<Theme>("dark");
  const [stageSize, setStageSize] = useState({ width: 1280, height: 720 });
  const [artworkReady, setArtworkReady] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [ensoTime, setEnsoTime] = useState(1000);
  const [ensoHeight, setEnsoHeight] = useState(0);
  const [ensoPlaying, setEnsoPlaying] = useState(false);
  const [ensoStatus, setEnsoStatus] = useState<EnsoStatus>({ date: "2025-12-01", value: 0, phase: "Neutral", episodes: [] });
  const [coralTouch, setCoralTouch] = useState(false);
  const [coralStatus, setCoralStatus] = useState<CoralStatus>({ anomaly: 0, dhw: 0, coverage: 0, alert: "No stress", influence: 0, recovery: "stable", active: false });
  const [foodDate, setFoodDate] = useState(koreaDate);
  const [foodMeal, setFoodMeal] = useState("lunch");
  const [foodCafeteria, setFoodCafeteria] = useState("fclt");
  const [foodStatus, setFoodStatus] = useState<FoodStatus>({ totalKg: 0, budgetUse: 0, legend: [], menu: [], optionTitle: "" });
  const active = PROJECTS[activeIndex];
  const frameStateRef = useRef({
    activeId: active.id,
    theme,
    ensoHeight,
    foodDate,
    foodMeal,
    foodCafeteria,
  });

  useEffect(() => {
    frameStateRef.current = {
      activeId: active.id,
      theme,
      ensoHeight,
      foodDate,
      foodMeal,
      foodCafeteria,
    };
  }, [active.id, theme, ensoHeight, foodDate, foodMeal, foodCafeteria]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("ki-prototype-theme");
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("ki-prototype-theme", theme);
    frameRef.current?.contentWindow?.postMessage({ type: "KI_THEME", theme }, window.location.origin);
  }, [theme, active.id]);

  const selectProject = useCallback((index: number) => {
    setEnsoPlaying(false);
    setArtworkReady(false);
    setActiveIndex((index + PROJECTS.length) % PROJECTS.length);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "ArrowRight") selectProject(activeIndex + 1);
      if (event.key === "ArrowLeft") selectProject(activeIndex - 1);
      const number = Number(event.key);
      if (number >= 1 && number <= 4) selectProject(number - 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeIndex, selectProject]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => setVideoProgress(video.duration ? video.currentTime / video.duration * 100 : 0);
    const play = () => setVideoPlaying(true);
    const pause = () => setVideoPlaying(false);
    video.addEventListener("timeupdate", update);
    video.addEventListener("play", play);
    video.addEventListener("pause", pause);
    return () => { video.removeEventListener("timeupdate", update); video.removeEventListener("play", play); video.removeEventListener("pause", pause); };
  }, [active.id]);

  useEffect(() => {
    if (!ensoPlaying || active.id !== "enso") return;
    const timer = window.setInterval(() => {
      const slider = frameRef.current?.contentDocument?.getElementById("timeSlider") as HTMLInputElement | null;
      if (slider && Number(slider.max) > 0) setEnsoTime(Number(slider.value) / Number(slider.max) * 1000);
    }, 250);
    return () => window.clearInterval(timer);
  }, [ensoPlaying, active.id]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data) return;
      if (event.data.type === "ENSO_STATUS") {
        setEnsoStatus((current) => ({
          date: event.data.date,
          value: Number(event.data.value) || 0,
          phase: event.data.phase,
          episodes: Array.isArray(event.data.episodes) ? event.data.episodes : current.episodes,
        }));
      }
      if (event.data.type === "CORAL_STATUS") setCoralStatus(event.data);
      if (event.data.type === "FOOD_STATUS") setFoodStatus(event.data);
      if (event.data.type === "ARTWORK_READY") {
        setArtworkReady(true);
        const frame = frameRef.current?.contentWindow;
        if (!frame) return;
        const current = frameStateRef.current;
        frame.postMessage({ type: "KI_THEME", theme: current.theme }, window.location.origin);
        if (current.activeId === "enso") frame.postMessage({ type: "ENSO_CONTROL", height: current.ensoHeight }, window.location.origin);
        if (current.activeId === "coral") frame.postMessage({ type: "CORAL_EMBED" }, window.location.origin);
        if (current.activeId === "food") {
          frame.postMessage({
            type: "FOOD_CONTROL",
            date: current.foodDate,
            meal: current.foodMeal,
            cafeteria: current.foodCafeteria,
          }, window.location.origin);
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  const frameControl = (id: string, value?: string, eventName = "input") => {
    const element = frameRef.current?.contentDocument?.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null;
    if (!element) return;
    if (value === undefined) {
      element.click();
    } else if ("value" in element) {
      element.value = value;
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
  };

  const postFrame = (message: unknown) => frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  const fit = stageSize.height / 720;
  const visualScale = fit * active.reference.scale;
  const frameStyle = {
    width: 1280,
    height: 720,
    left: stageSize.width / 2 - active.reference.x * visualScale,
    top: stageSize.height / 2 - active.reference.y * visualScale,
    transform: `scale(${visualScale})`,
  };

  const renderControls = () => {
    if (active.id === "enso") {
      const phaseClass = ensoStatus.phase === "El Niño" ? "warm" : ensoStatus.phase === "La Niña" ? "cool" : "neutral";
      const dateLabel = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ensoStatus.date}T00:00:00Z`));
      return (
      <div className="original-controls enso-controls">
        <label><span>ENSO TIMELINE <output>{ensoTime === 1000 ? "LATEST" : `${Math.round(1982 + ensoTime / 1000 * 43)}`}</output></span><input type="range" min="0" max="1000" value={ensoTime} onInput={(event) => { const normalized = Number(event.currentTarget.value); setEnsoTime(normalized); const slider = frameRef.current?.contentDocument?.getElementById("timeSlider") as HTMLInputElement | null; if (slider) frameControl("timeSlider", String(Math.round(normalized / 1000 * Number(slider.max)))); }} /></label>
        <div className="enso-episodes" aria-label="ENSO episode timeline">{ensoStatus.episodes.map((episode, index) => <i key={`${episode.phase}-${index}`} className={episode.phase === "El Niño" ? "warm" : "cool"} style={{ left: `${episode.start * 100}%`, width: `${Math.max(.35, (episode.end - episode.start) * 100)}%` }} />)}</div>
        <div className={`enso-state ${phaseClass}`}><span><b>{dateLabel}</b><em>3-MONTH NIÑO 3.4</em></span><strong>{ensoStatus.phase}</strong><output>{ensoStatus.value >= 0 ? "+" : ""}{ensoStatus.value.toFixed(2)}°C</output></div>
        <div className="enso-thresholds"><span className="warm"><b>EL NIÑO</b><i>+0.5°C</i></span><span><b>NEUTRAL</b><i>±0.5°C</i></span><span className="cool"><b>LA NIÑA</b><i>−0.5°C</i></span></div>
        <label><span>RELIEF HEIGHT <output>{Math.round(ensoHeight * 100)}% R</output></span><input type="range" min="0" max="0.5" step="0.01" value={ensoHeight} onInput={(event) => { setEnsoHeight(Number(event.currentTarget.value)); frameControl("heightScaleSlider", event.currentTarget.value); }} /></label>
        <button className="panel-primary" onClick={() => { frameControl("playButton"); setEnsoPlaying((value) => !value); }}>{ensoPlaying ? "PAUSE" : "PLAY"}</button>
      </div>
      );
    }
    if (active.id === "daisy") return (
      <div className="original-controls">
        <label><span>VIDEO POSITION <output>{Math.round(videoProgress)}%</output></span><input type="range" min="0" max="100" value={videoProgress} onChange={(event) => { const video = videoRef.current; if (video?.duration) video.currentTime = video.duration * Number(event.target.value) / 100; }} /></label>
        <button className="panel-primary" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) video.play(); else video.pause(); }}>{videoPlaying ? "PAUSE VIDEO" : "PLAY VIDEO"}</button>
      </div>
    );
    if (active.id === "coral") return (
      <div className="original-controls coral-controls">
        <div className="coral-metrics">
          <span><b>BLEACHED</b><strong>{Math.round(coralStatus.coverage * 100)}%</strong></span>
          <span><b>SST ANOMALY</b><strong>+{coralStatus.anomaly.toFixed(1)}°C</strong></span>
          <span><b>HEAT STRESS</b><strong>{coralStatus.alert} · {coralStatus.dhw.toFixed(1)} DHW</strong></span>
          <span><b>INFLUENCE / STATE</b><strong>{coralStatus.influence.toFixed(1)}s · {coralStatus.recovery}</strong></span>
        </div>
        <button className={`panel-touch ${coralTouch ? "active" : ""}`} onPointerDown={() => { setCoralTouch(true); postFrame({ type: "CORAL_TOUCH", active: true }); }} onPointerUp={() => { setCoralTouch(false); postFrame({ type: "CORAL_TOUCH", active: false }); }} onPointerCancel={() => { setCoralTouch(false); postFrame({ type: "CORAL_TOUCH", active: false }); }} onPointerLeave={() => { setCoralTouch(false); postFrame({ type: "CORAL_TOUCH", active: false }); }}><b>{coralTouch ? "HEATING" : "TOUCH + HOLD"}</b><span>RELEASE TO STOP</span></button>
        <button className="panel-primary" onClick={() => frameControl("toggle")}>PAUSE / RESUME ROTATION</button>
      </div>
    );
    return (
      <div className="original-controls food-controls">
        <div className="food-fields"><input className="panel-date" type="date" value={foodDate} max={koreaDate()} onChange={(event) => { setFoodDate(event.target.value); postFrame({ type: "FOOD_CONTROL", date: event.target.value }); }} />
        <select value={foodCafeteria} onChange={(event) => { setFoodCafeteria(event.target.value); postFrame({ type: "FOOD_CONTROL", cafeteria: event.target.value }); }}><option value="fclt">카이마루 / N11</option><option value="west">서맛골 / W2</option><option value="east1">동맛골 / E5</option><option value="east2">동맛골 교직원 / E5</option><option value="emp">교수회관 / N6</option></select></div>
        <div className="panel-segments three">{[["breakfast","조식"],["lunch","중식"],["dinner","석식"]].map(([id,label]) => <button key={id} className={foodMeal === id ? "active" : ""} onClick={() => { setFoodMeal(id); postFrame({ type: "FOOD_CONTROL", meal: id }); }}>{label}</button>)}</div>
        <div className="food-summary"><span>MEAL <b>{foodStatus.totalKg.toFixed(2)} kg CO₂e</b></span><span>DAILY BUDGET <b>{Math.round(foodStatus.budgetUse)}%</b></span></div>
        <div className="food-details">
          <div className="food-menu" aria-label="현재 식단"><b>MENU{foodStatus.optionTitle && foodStatus.optionTitle !== "기본" ? ` · ${foodStatus.optionTitle}` : ""}</b><p>{foodStatus.menu.length ? foodStatus.menu.join(" · ") : "식단을 불러오는 중"}</p></div>
          <div className="food-legend" aria-label="식재료군 색상 범례">{foodStatus.legend.length ? foodStatus.legend.map((item) => <span key={item.id}><i style={{ background: item.color }} /><b>{item.label}</b><em>{item.kg.toFixed(2)}</em></span>) : <small>분류 대기 중</small>}</div>
        </div>
        <button className="panel-primary" onClick={() => postFrame({ type: "FOOD_CONTROL", reset: true })}>다시 떨어뜨리기</button>
      </div>
    );
  };

  return (
    <main className="prototype-shell" data-theme={theme}>
      <section ref={stageRef} className="original-stage" aria-label={`${active.en} original artwork`}>
        {active.id === "daisy" ? <video ref={videoRef} className={`original-video ${artworkReady ? "ready" : ""}`} src={active.source} autoPlay muted loop playsInline onCanPlay={() => setArtworkReady(true)} /> : <iframe ref={frameRef} key={active.id} className={`original-frame ${artworkReady ? "ready" : ""}`} style={frameStyle} src={active.source} title={`${active.en} original prototype`} onLoad={() => { postFrame({ type: "KI_THEME", theme }); if (active.id === "enso") postFrame({ type: "ENSO_CONTROL", height: ensoHeight }); if (active.id === "coral") postFrame({ type: "CORAL_EMBED" }); if (active.id === "food") postFrame({ type: "FOOD_CONTROL", date: foodDate, meal: foodMeal, cafeteria: foodCafeteria }); }} />}
        <div className={`artwork-loading ${artworkReady ? "hidden" : ""}`} aria-hidden="true"><i className="artwork-placeholder" /></div>
      </section>

      <aside className="interface-column">
        <section className="tablet-interface" aria-label="Landscape tablet controller">
          <nav className="panel-tabs" aria-label="Projects">{PROJECTS.map((project, index) => <button key={project.id} className={index === activeIndex ? "active" : ""} onClick={() => selectProject(index)} aria-label={project.en}><span>{project.number}</span></button>)}</nav>
          {renderControls()}
        </section>

        <section className="description-view">
          <header className="research-heading">
            <div><span>KI PROTOTYPE</span><h2>행성지능 인터페이스를 위한<br />기후 빅데이터 구면 시각화 프로토타입 개발</h2></div>
            <button className="theme-toggle" type="button" role="switch" aria-checked={theme === "light"} aria-label={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>
              <span>DARK</span><i aria-hidden="true" /><span>LIGHT</span>
            </button>
          </header>
          <div className="work-heading"><h1>{active.ko}</h1><p>{active.en} · {active.maker}</p></div>
          <p className="work-description">{active.description}</p>
          <dl><div><dt>DATA</dt><dd>{active.dataset}</dd></div><div><dt>INTERACTION</dt><dd>{active.interaction}</dd></div></dl>
        </section>
      </aside>
    </main>
  );
}
