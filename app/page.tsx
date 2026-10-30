const PAGES = [
  {
    group: "Sampling Sphere",
    note: "How NASA Earth data is gathered: 20 satellites carving the sphere with their swaths.",
    links: [
      { href: "/sphere-display", title: "Sphere display", text: "Full-screen equirectangular frame for the LED sphere. Drag to rotate, F for full screen." },
      { href: "/sphere-tablet", title: "Tablet", text: "Full-screen world map forged by the swaths, with the satellite picker." },
      { href: "/sphere-studio", title: "Studio", text: "Every control: surface, light, material, export for Unreal, and live control of the other two pages." },
      { href: "/sphere-orbits", title: "Orbits", text: "Every active satellite in the public catalogue, as its exact orbit. ?display for the sphere." },
      { href: "/sphere-eye", title: "Satellite eye", text: "Every Earth-observation satellite in real time, lighting only what it sees this instant. ?display for the sphere, ?tablet for the map." },
    ],
  },
  {
    group: "Visual tests",
    note: "Data-free scenes for trying ideas on the sphere. Each has its own display mode (press F or add ?display).",
    links: [
      { href: "/sphere-test-ripples", title: "Ripples", text: "White sphere; click anywhere to send large waves across it." },
      { href: "/sphere-test-shell", title: "Open shell", text: "Thick shell with an anamorphic front window that opens; small balls fall in and fill it." },
      { href: "/sphere-test-liquid", title: "Liquid", text: "Same open shell; water pours in from the top, rests, and drains through a whirlpool at the bottom." },
    ],
  },
  {
    group: "Earlier presentation",
    note: "Climate data artworks for the spherical display: ENSO, Daisyworld, Coral Bleaching, KAIST cafeteria.",
    links: [{ href: "/exhibition", title: "Exhibition", text: "The previous presentation, unchanged." }],
  },
];

export default function Home() {
  return (
    <main style={{ minHeight: "100svh", padding: "48px max(20px, 6vw)", display: "grid", alignContent: "start", gap: 40, maxWidth: 960 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase" }}>KI Prototype</h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, opacity: 0.6 }}>Interactive climate data studies for a spherical display.</p>
      </header>
      {PAGES.map((g) => (
        <section key={g.group} style={{ display: "grid", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 400 }}>{g.group}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.6 }}>{g.note}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {g.links.map((l) => (
              <a key={l.href} href={l.href} style={{ display: "grid", gap: 6, padding: 16, border: "1px solid var(--line)", textDecoration: "none" }}>
                <span style={{ fontSize: 15 }}>{l.title} <span style={{ opacity: 0.5, fontSize: 12 }}>{l.href}</span></span>
                <span style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.65 }}>{l.text}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
