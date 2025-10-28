import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';

const APP_URL = 'http://localhost:5173';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RELEVANT_CODE_FILE = 'src/App.tsx';
const FRAMES_DIR = 'test-results/ai-frames';
const CONFIDENCE_THRESHOLD = 0.80;
const VIEWPORT = { width: 1280, height: 720 };

fs.mkdirSync(FRAMES_DIR, { recursive: true });

async function analyzeFrameSequenceTest(frameBuffers: Buffer[], testContext: string, gitDiff: string): Promise<{ status: 'PASS' | 'FAIL', certainty: number, reasoning: string, tokens?: { prompt: number, candidates: number, total: number } }> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const parts = frameBuffers.map(buf => ({
    inlineData: { data: buf.toString('base64'), mimeType: 'image/png' }
  }));

  const prompt = `
You are a visual QA analyst. You receive an ordered sequence of PNG frames from a Three.js scene.
Decide PASS or FAIL strictly by the Test Context (Subject / Action / Expectation / Warnings / Pass / Notes).

Rules:
1. First frame = initial state; last frame = final state; intermediates show progression.
2. Focus ONLY on the Subject.
3. Ignore apparent rotation caused by camera perspective if Notes say to ignore.
4. Ignore minor lighting flicker, particles, drawer UI elements.
5. PASS only if progression matches Expectation and Pass condition.

Return ONLY JSON:
{ "status":"PASS"|"FAIL", "certainty":0.0-1.0, "reasoning":"short factual justification" }

Test Context: ${testContext}
Git Diff:
\`\`\`diff
${gitDiff || 'No git diff.'}
\`\`\`
JSON ONLY:
`.trim();

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [...parts, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    });
    const txt = result.response.text();
    const parsed = JSON.parse(txt);
    const usage: any = (result.response as any).usageMetadata || {};
    const tokens = {
      prompt: usage.promptTokenCount ?? 0,
      candidates: usage.candidatesTokenCount ?? 0,
      total: usage.totalTokenCount ?? (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0)
    };
    return { ...parsed, tokens };
  } catch (e: any) {
    return { status: 'FAIL', certainty: 0.0, reasoning: 'Error: ' + e.message, tokens: { prompt: 0, candidates: 0, total: 0 } };
  }
}

async function captureFrame(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  return await page.locator('canvas').screenshot();
}

test.describe('Three.js Box Frame Sequence Visual AI', () => {
  test.describe.configure({ retries: 3 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(APP_URL);
    await page.waitForSelector('canvas');
    await page.waitForFunction(() =>
      !!(window as any).scene?.getObjectByName('MainBox'), { timeout: 5000 }
    );
    await page.evaluate(() => {
      const o = (window as any).scene?.getObjectByName('MainBox');
      if (o) o.rotation.set(0, 0, 0);
    });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  });

  test('frames movement: right (D)', async ({ page }) => {
    await page.keyboard.press('f');
    const presses = 5;
    const frames: Buffer[] = [];
    frames.push(await captureFrame(page));
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('d');
      await page.waitForTimeout(60);
      frames.push(await captureFrame(page));
    }
    frames.push(await captureFrame(page));
    const seqDir = path.join(FRAMES_DIR, 'seq-move-right');
    fs.mkdirSync(seqDir, { recursive: true });
    frames.forEach((f, i) => fs.writeFileSync(path.join(seqDir, `frame-${i}.png`), f));
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();
    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Ordered frames after multiple 'd' presses.
Expectation: Progressive horizontal shift to screen-right.
Warnings: Ignore perspective-induced apparent angle, particles, UI.
Pass: Clear rightward progression from first to last frame.
Notes: Test should still pass if rotation is observed; focus on position change.
`.replace(/\s+/g, ' ').trim();
    const ai = await analyzeFrameSequenceTest(frames, testContext, gitDiff);
    await test.info().attach('seq-right-token-usage', {
      body: Buffer.from(JSON.stringify(ai.tokens, null, 2)),
      contentType: 'application/json'
    });
    frames.forEach((buf, i) => test.info().attach(`seq-right-${i}`, { body: buf, contentType: 'image/png' }));
    await test.info().attach('seq-right-ai', { body: Buffer.from(JSON.stringify(ai, null, 2)), contentType: 'application/json' });
    expect(ai.status, `AI failed. Reason: ${ai.reasoning}`).toBe('PASS');
    expect(ai.certainty, `Low certainty. Reason: ${ai.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  test('frames movement: forward (W)', async ({ page }) => {
    await page.keyboard.press('f');
    const presses = 5;
    const frames: Buffer[] = [];
    frames.push(await captureFrame(page));
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('w');
      await page.waitForTimeout(60);
      frames.push(await captureFrame(page));
    }
    frames.push(await captureFrame(page));
    const seqDir = path.join(FRAMES_DIR, 'seq-move-forward');
    fs.mkdirSync(seqDir, { recursive: true });
    frames.forEach((f, i) => fs.writeFileSync(path.join(seqDir, `frame-${i}.png`), f));
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();
    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Ordered frames after multiple 'w' presses.
Expectation: Progressive forward (deeper) movement into scene.
Warnings: Ignore slight perspective changes, particles, panel.
Pass: Box visibly advances forward from first to last frame.
Notes: Test should still pass if rotation is observed; focus on position change.
`.replace(/\s+/g, ' ').trim();
    const ai = await analyzeFrameSequenceTest(frames, testContext, gitDiff);
    await test.info().attach('seq-forward-token-usage', {
      body: Buffer.from(JSON.stringify(ai.tokens, null, 2)),
      contentType: 'application/json'
    });
    frames.forEach((buf, i) => test.info().attach(`seq-forward-${i}`, { body: buf, contentType: 'image/png' }));
    await test.info().attach('seq-forward-ai', { body: Buffer.from(JSON.stringify(ai, null, 2)), contentType: 'application/json' });
    expect(ai.status, `AI failed. Reason: ${ai.reasoning}`).toBe('PASS');
    expect(ai.certainty, `Low certainty. Reason: ${ai.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  test('frames rotation: right (E)', async ({ page }) => {
    await page.keyboard.press('f');
    const presses = 7;
    const frames: Buffer[] = [];
    frames.push(await captureFrame(page));
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('e');
      await page.waitForTimeout(70);
      frames.push(await captureFrame(page));
    }
    frames.push(await captureFrame(page));
    const seqDir = path.join(FRAMES_DIR, 'seq-rotate-right');
    fs.mkdirSync(seqDir, { recursive: true });
    frames.forEach((f, i) => fs.writeFileSync(path.join(seqDir, `frame-${i}.png`), f));
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();
    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Ordered frames after repeated 'e' presses.
Expectation: Gradual right (clockwise) rotation about vertical axis; position mostly stable.
Warnings: Ignore minor positional jitter, particles, UI panel.
Pass: Frames depict a rotation of the box to the right as presses are made.
Notes: Evaluate rotation only; disregard translation artifacts.
`.replace(/\s+/g, ' ').trim();
    const ai = await analyzeFrameSequenceTest(frames, testContext, gitDiff);
    await test.info().attach('seq-rotate-right-token-usage', {
      body: Buffer.from(JSON.stringify(ai.tokens, null, 2)),
      contentType: 'application/json'
    });
    frames.forEach((buf, i) => test.info().attach(`seq-rotate-right-${i}`, { body: buf, contentType: 'image/png' }));
    await test.info().attach('seq-rotate-right-ai', { body: Buffer.from(JSON.stringify(ai, null, 2)), contentType: 'application/json' });
    expect(ai.status, `AI failed. Reason: ${ai.reasoning}`).toBe('PASS');
    expect(ai.certainty, `Low certainty. Reason: ${ai.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

});