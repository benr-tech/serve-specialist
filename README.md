# Serve Specialist

*Formerly Line Judge.* Upload a phone video of one tennis serve → get a motion breakdown with a checklist score and things to work on, a foot-fault verdict, and the timing of each serve phase. Runs entirely in your browser; the video never leaves your device.

**Live:** https://benr-tech.github.io/serve-specialist/

The court is found automatically, each serve phase is timed, the whole motion gets a 0–100 score with a breakdown by area, and a foot-fault check runs when the phone was held still. Works from behind, the side, the front or a diagonal.

```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run build   # → dist/  (a static site: upload it anywhere)
```

## Hosting
It's a static site: the browser does all the work, there's no server, and videos never leave the viewer's device. `.github/workflows/deploy.yml` runs the tests, builds, and publishes to GitHub Pages on every push to `main`. The `dist` folder also works on any static host (`netlify.toml` included).

The pose model (`public/models`, ~30 MB, MediaPipe Pose Landmarker heavy, Apache 2.0) and the WASM runtime are served by the site itself, so nothing is fetched from anywhere else.

| Doc | What it is |
|---|---|
| [DECISIONS.md](DECISIONS.md) | Every major decision and why |
| [DATA.md](DATA.md) | How to film serves |
| [experiments/](experiments/README.md) | Every measured number, with script + dataset version |

Developer benchmark (dev server only, not in the public build): `npm run dev`, then open `/bench.html`.
