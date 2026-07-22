"use client";

import { useCallback, useEffect, useState } from "react";

const projects = [
  {
    id: "enso",
    number: "01",
    title: "ENSO",
    subtitle: "Sea Surface Temperature",
    kind: "frame" as const,
    source: "/projects/enso/index.html",
  },
  {
    id: "daisy",
    number: "02",
    title: "Daisy World",
    subtitle: "Climate System",
    kind: "video" as const,
    source: "/projects/daisy/daisy-world.mp4",
  },
  {
    id: "coral",
    number: "03",
    title: "Coral Bleaching",
    subtitle: "Ocean Heat Stress",
    kind: "frame" as const,
    source: "/projects/coral/index.html",
  },
  {
    id: "food",
    number: "04",
    title: "KAIST Food",
    subtitle: "Dietary Carbon",
    kind: "frame" as const,
    source: "/food",
  },
];

export default function ExhibitionShell() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = projects[activeIndex];

  const selectProject = useCallback((index: number) => {
    setActiveIndex((index + projects.length) % projects.length);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "ArrowRight") selectProject(activeIndex + 1);
      if (event.key === "ArrowLeft") selectProject(activeIndex - 1);
      const number = Number(event.key);
      if (number >= 1 && number <= projects.length) selectProject(number - 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, selectProject]);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };

  return (
    <main className="exhibition-shell">
      <header className="exhibition-header">
        <div className="exhibition-mark" aria-label="Spherical Studies, work in progress">
          <strong>SPHERE / STUDIES</strong>
          <span>WIP · 2026</span>
        </div>

        <nav className="project-nav" aria-label="Projects">
          {projects.map((project, index) => (
            <button
              key={project.id}
              type="button"
              className={index === activeIndex ? "active" : ""}
              aria-current={index === activeIndex ? "page" : undefined}
              onClick={() => selectProject(index)}
            >
              <span>{project.number}</span>
              <strong>{project.title}</strong>
            </button>
          ))}
        </nav>

        <button className="fullscreen-button" type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
          <i aria-hidden="true" />
          <span>Fullscreen</span>
        </button>
      </header>

      <section className="artwork-stage" aria-label={`${active.title}: ${active.subtitle}`}>
        {active.kind === "video" ? (
          <div className="video-stage" key={active.id}>
            <video src={active.source} controls autoPlay muted loop playsInline aria-label="Daisy World video" />
          </div>
        ) : (
          <iframe key={active.id} className="artwork-frame" src={active.source} title={`${active.title} interactive artwork`} />
        )}
      </section>
    </main>
  );
}
