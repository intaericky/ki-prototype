# KI Prototype

Interactive spherical-display prototypes for the research project
“행성지능 인터페이스를 위한 기후 빅데이터 구면 시각화 프로토타입 개발”.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production

This repository is a standard Next.js application intended for Git-connected
Vercel deployments.

- Framework preset: Next.js
- Root directory: `.`
- Build and install commands: use Vercel defaults
- Output directory: leave empty
- Node.js: 22.x

The `main` branch is the production branch. Other branches can be used for
Vercel Preview Deployments.

## Data and media

ENSO data assets and the Daisy World video are served from `public/projects`.
The KAIST cafeteria route fetches current menu data at request time from the
official KAIST website.

## Pages

| Path | What it is |
|---|---|
| `/` | Index of all pages |
| `/exhibition` | The earlier presentation (ENSO, Daisyworld, Coral Bleaching, KAIST cafeteria) |
| `/sphere-display` | Sampling Sphere: full-screen equirectangular frame for the LED sphere |
| `/sphere-tablet` | Sampling Sphere: full-screen world map for the tablet |
| `/sphere-studio` | Sampling Sphere: all controls, light and material settings, export, live control |

## Sampling Sphere

Static pages in `public/sphere-*`, built from `sampling-sphere/studio-src.html` and
`sampling-sphere/data.js` (20 satellite TLEs and one day of MODIS granule footprints):

```bash
python3 sampling-sphere/build.py
```

**Display page.** Stretches the frame to fill the whole screen (any size, e.g. 1920×1080).
Drag to rotate the sculpture, double-click to reset, press F for full screen. Move the
mouse to show the controls; they hide again after a few seconds.

**Live control (studio → display and tablet).**
1. In `/sphere-studio`, open **Live control**. It shows a room code and two links.
2. Open the display link on the sphere computer and the tablet link on the tablet
   (or open `/sphere-display` / `/sphere-tablet` and type the room code into the box at the bottom right).
3. Press **Start live control**. Every change in the studio (surface, frame, satellite, speed,
   carving, light, material) appears on the other pages within a moment. A satellite picked
   on the tablet also reaches the display. The display and tablet keep the last settings
   if they reload.

It goes through a free public MQTT relay (`wss://broker.emqx.io:8084/mqtt`); only setting
values travel. The room code is not a password, so make a new one for each show. Another
relay can be used with `?broker=wss://...`.

**URL settings** for the display and tablet: `?room=CODE&style=afterglow|ribbons|pixels|cut|build|erosion&ink=dark&frame=earth|sun|satellite&sat=TERRA&trail=6&depth=320&levels=even|orbit&speed=600&loop=1&quality=low`. Afterglow (light that fades with the age of each observation) is the default surface; `ink=dark` draws it dark on light.
All pages share a clock (`loop` = days per loop), so separate devices show the same moment.
