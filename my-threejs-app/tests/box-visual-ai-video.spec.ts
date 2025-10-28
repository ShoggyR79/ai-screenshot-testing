import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';

const APP_URL = 'http://localhost:5173';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RELEVANT_CODE_FILE = 'src/App.tsx';
const VIDEO_DIR = 'test-results/ai-video';
const CONFIDENCE_THRESHOLD = 0.80;
const VIEWPORT = { width: 1280, height: 720 };

fs.mkdirSync(VIDEO_DIR, { recursive: true });

async function analyzeVideoTest(videoBuffer: Buffer, testContext: string, gitDiff: string): Promise<{ status: 'PASS' | 'FAIL', certainty: number, reasoning: string, tokens?: { prompt: number, candidates: number, total: number } }> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const movementAwareNote = /moves?|shift(s)?|translate(s)?/i.test(testContext)
    ? `If the test context describes movement, you MUST consider object position changes; measure horizontal pixel shift.`
    : `Assume object position remains stable; focus on visual appearance changes.`;

  const prompt = `
You are a visual QA analyst provided with a single WebM video that shows an action over time in a Three.js app.
Decide PASS or FAIL based only on whether the observed visual change matches the Test Context.
Your goal is to validate if the visual behavior meets the specified expectations. Do not try to consider/error outside this scope of test context.

You are currently looking at a threeJS application, rendering a 3D scene as well as a orbit camera and UI elements.
The camera is viewing the scene in a orthographic projection.
${movementAwareNote}

Instructions:
1. Identify the subject (blue wireframe box "MainBox" or side panel).
2. Infer start vs end from the video.
3. PASS if the final visual state matches the expected change; else FAIL.
4. Be concise, factual. Do not invent details. Ignore minor lighting, noise points, UI unrelated to subject.

Return ONLY JSON:
{ "status":"PASS"|"FAIL", "certainty":0.0-1.0, "reasoning":"short factual justification" }

Test Context: ${testContext}
Git Diff:
\`\`\`diff
${gitDiff || 'No git diff.'}
\`\`\`
JSON ONLY:
`.trim();

  const part = {
    inlineData: {
      data: videoBuffer.toString('base64'),
      mimeType: 'video/webm'
    },
    videoMetadata: {
      fps: 24,
    }

  };

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [part, { text: prompt }] }],
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

async function startRecording(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) throw new Error('Canvas not found for recording');
    const stream = canvas.captureStream(30);
    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const supportedMime = mimeCandidates.find(t => MediaRecorder.isTypeSupported(t));
    if (!supportedMime) throw new Error('No supported MediaRecorder MIME type');
    const recorder = new MediaRecorder(stream, { mimeType: supportedMime });
    const chunks: BlobPart[] = [];
    (window as any).__canvasRecordingDone = new Promise<string>((resolve, reject) => {
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = e => reject(e.error);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      };
    });
    (window as any).__canvasRecorderStop = () => recorder.stop();
    recorder.start();
  });
}

async function stopRecordingAndGet(page) {
  const dataUrl = await page.evaluate(async () => {
    (window as any).__canvasRecorderStop();
    return await (window as any).__canvasRecordingDone;
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// --- Suite ---
test.describe('Three.js Box Video Visual AI', () => {
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

  test('video movement: right (D)', async ({ page }) => {
    await page.keyboard.press('f');
    await startRecording(page);
    const presses = 5;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('d');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(70);
    }
    const videoBuffer = await stopRecordingAndGet(page);
    fs.writeFileSync(path.join(VIDEO_DIR, 'move-right.webm'), videoBuffer);
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();
    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Several 'd' key presses in sequence.
Expectation: Box shifts horizontally to screen-right.
Warnings: Ignore perceived rotation from perspective, particles, panel.
Pass: Box ends clearly farther right than it started.
Notes: Test should still pass if rotation is observed; focus on position change.
`.replace(/\s+/g, ' ').trim();
    const ai = await analyzeVideoTest(videoBuffer, testContext, gitDiff);
    await test.info().attach('video-move-right', { body: videoBuffer, contentType: 'video/webm' });
    await test.info().attach('video-move-right-ai', { body: Buffer.from(JSON.stringify(ai, null, 2)), contentType: 'application/json' });
    await test.info().attach('video-move-right-token-usage', {
      body: Buffer.from(JSON.stringify(ai.tokens, null, 2)),
      contentType: 'application/json'
    });
    expect(ai.status, `AI failed. Reason: ${ai.reasoning}`).toBe('PASS');
    expect(ai.certainty, `Low certainty. Reason: ${ai.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  test('video movement: forward (W)', async ({ page }) => {
    await page.keyboard.press('f');
    await startRecording(page);
    const presses = 6;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('w');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(70);
    }
    const videoBuffer = await stopRecordingAndGet(page);
    fs.writeFileSync(path.join(VIDEO_DIR, 'move-forward.webm'), videoBuffer);
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();
    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Several 'w' key presses.
Expectation: Box moves forward deeper into scene (toward world -Z visually).
Warnings: Ignore minor jitter, particles, UI.
Pass: Box noticeably advances forward from its starting point.
Notes: Test should still pass if rotation is observed; focus on position change.
`.replace(/\s+/g, ' ').trim();
    const ai = await analyzeVideoTest(videoBuffer, testContext, gitDiff);
    await test.info().attach('video-move-forward', { body: videoBuffer, contentType: 'video/webm' });
    await test.info().attach('video-move-forward-ai', { body: Buffer.from(JSON.stringify(ai, null, 2)), contentType: 'application/json' });
    await test.info().attach('video-move-forward-token-usage', {
      body: Buffer.from(JSON.stringify(ai.tokens, null, 2)),
      contentType: 'application/json'
    });
    expect(ai.status, `AI failed. Reason: ${ai.reasoning}`).toBe('PASS');
    expect(ai.certainty, `Low certainty. Reason: ${ai.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  test('video rotation: right (E)', async ({ page }) => {
    await page.keyboard.press('f');
    await startRecording(page);
    const presses = 8;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('e');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(70);
    }
    const videoBuffer = await stopRecordingAndGet(page);
    fs.writeFileSync(path.join(VIDEO_DIR, 'rotate-right.webm'), videoBuffer);
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();
    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Series of 'e' key presses.
Expectation: Box rotates clockwise (yaw decreases) around vertical axis, position mostly stable.
Warnings: Ignore slight translation jitter, particles, panel.
Pass: Final orientation is clearly rotated right relative to start.
`.replace(/\s+/g, ' ').trim();
    const ai = await analyzeVideoTest(videoBuffer, testContext, gitDiff);
    await test.info().attach('video-rotate-right', { body: videoBuffer, contentType: 'video/webm' });
    await test.info().attach('video-rotate-right-ai', { body: Buffer.from(JSON.stringify(ai, null, 2)), contentType: 'application/json' });
    await test.info().attach('video-rotate-right-token-usage', {
      body: Buffer.from(JSON.stringify(ai.tokens, null, 2)),
      contentType: 'application/json'
    });
    expect(ai.status, `AI failed. Reason: ${ai.reasoning}`).toBe('PASS');
    expect(ai.certainty, `Low certainty. Reason: ${ai.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

});