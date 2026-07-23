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
