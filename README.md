# ai-screenshot-testing
# AI Screenshot Testing Playground

Purpose: explore AI-powered visual regression (e.g. Gemini) as a smarter alternative to raw pixel diffing.

## Why
Traditional `toHaveScreenshot` (pixel comparison) is brittle:
- Minor AA, noise, font rendering, or data changes fail tests.
- Hard to express intent (e.g. "3D object still visible", "layout intact").

This repo injects controlled randomness to demonstrate flakiness:
- Three.js scene with a hollow wireframe box.
- Randomized point cloud jittering every frame.
- MUI side drawer with regenerated random info.
- Discrete WASD box moves (5 units), hotkeys: W A S D, C (center without reorient), R (refresh info), ] (toggle drawer).

<img width="1437" height="1208" alt="image" src="https://github.com/user-attachments/assets/04787b0b-3f60-4cb0-8254-08e89879e9ea" />

## Idea
Replace / augment pixel diff with AI vision:
1. Capture screenshot.
2. Send to Gemini (or other multimodal model).
3. Ask semantic assertions:
   - "Is the blue wireframe box visible?"
   - "Is the drawer open and listing ~8 items?"
   - "Does the scene render a green ground plane?"
4. Fail only on meaningful changes.

## Current Visual Tests
Playwright tests use `toHaveScreenshot`. They are expected to fail or churn due to:
- Random point jitter.
- Random drawer contents.
- Sub‑pixel camera nudges.

Run (app separately):
```bash
npm install
npm run dev
npx playwright test --update-snapshots   # first time
npx playwright test
```

## Possible AI Test Flow (pseudo)
```ts
// capture
const buffer = await page.screenshot()
// send to AI model (Gemini API or similar) with prompt:
// "Answer JSON: { boxVisible: boolean, drawerOpen: boolean, itemCount: number }"
```
Then assert semantic JSON instead of pixel delta.

## Toggle Stability
To make screenshots stable later:
- Remove/join point cloud & camera jitter.
- Freeze random list (seeded generator).
- Disable drawer resizing.

## Folder Notes
- `src/App.tsx` sets up scene + randomness.
- `tests/scene.spec.ts` shows conventional brittle approach.
- Future: add `ai-tests/` invoking model for semantic checks.

## Roadmap
- Add AI assertion harness.
- Snapshot metadata (prompt + model response).
- Degradation scoring (semantic diff vs pixel diff).

## Disclaimer
Randomness is intentional to highlight limitations of naive pixel diffing.
