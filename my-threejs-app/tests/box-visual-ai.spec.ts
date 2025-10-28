import { test, expect } from '@playwright/test';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// --- Configuration ---
const APP_URL = 'http://localhost:5173';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SCREENSHOT_DIR = 'test-results/ai-screenshots';
const DEBUG_SCREENSHOT_DIR = 'tests/debug';
const RELEVANT_CODE_FILE = 'src/App.tsx';
const CONFIDENCE_THRESHOLD = 0.85;
const VIEWPORT = { width: 1920, height: 1080 } // was 1280x720

// --- Timeout Configuration ---
test.describe.configure({ timeout: 60000 }) // raise suite timeout

// --- Helper: Ensure screenshot directory exists ---
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(DEBUG_SCREENSHOT_DIR, { recursive: true });

// --- Gemini AI Analysis Function ---
async function analyzeVisualTest(beforeImgBuffer: Buffer, afterImgBuffer: Buffer, testContext: string, gitDiff: string): Promise<{ status: 'PASS' | 'FAIL', certainty: number, reasoning: string, tokens?: { prompt: number, candidates: number, total: number } }> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable not set.');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

  // This function now takes a Buffer directly
  const bufferToGenerativePart = (buffer: Buffer) => {
    return {
      inlineData: {
        data: buffer.toString("base64"),
        mimeType: "image/png"
      },
    };
  };

  const movementAwareNote = /moves?|shift(s)?|translate(s)?/i.test(testContext)
    ? `If the test context describes movement, you MUST consider object position changes; measure horizontal pixel shift.`
    : `Assume object position remains stable; focus on visual appearance changes.`;

  const prompt = `
You are a hyper-focused AI Quality Assurance Analyst. You will be sent two pictures, one "before" and the other "after". Your task is to determine if a specific visual change occurred between a "Before" and "After" screenshot, based on a "Test Context".
The tests that you received are a series of automated visual testing that compare the visual appearance of the application to verify that no regressions or unexpected changes have occurred.

You are currently looking at a threeJS application, rendering a 3D scene as well as a orbit camera and UI elements.
${movementAwareNote}

The test context describes the goal of the current test. Your job is to analyze the two images and determine if the expected change described in the test context has occurred.

Analysis Instructions:
1. Identify the Subject from Test Context.
2. Focus ONLY on this subject; ignore noise.
3. If movement: estimate X,Y pixel center before vs after; report them.
4. Decide PASS if change matches description; else FAIL.

To help with your analysis, a git diff is also provided showing code changes made since. These changes are not guaranteed to be related to the test, but may provide useful context.

Respond ONLY with JSON:
{ "status": "PASS"|"FAIL", "certainty": 0.0-1.0, "reasoning": "…" }

---

## EXAMPLE 1: (PASS)



[IMAGE 1: "before.png" shows a blue car in the center]

[IMAGE 2: "after.png" shows the same blue car on the right]



Test Context: "User presses the 'Nudge Right' button. The selected 4D entity should move to the right."



PR Git Diff:

\`\`\`diff

--- a/src/components/Labeling/Canvas/NudgeTool.js

+++ b/src/components/Labeling/Canvas/NudgeTool.js

@@ -42,1 +42,1 @@

- const newX = selectedEntity.position.x; // BUG: Not adding the nudge

+ const newX = selectedEntity.position.x + NUDGE_AMOUNT;

AI OUTPUT:

{ "status": "PASS", "certainty": 0.98, "reasoning": "The 'PR Git Diff' shows a fix to 'NudgeTool.js' that correctly adds 'NUDGE_AMOUNT' to the X position. The 'Test Context' confirms this is a 'Nudge Right' test. The 'After' image clearly shows the car moved right, which visually confirms the code fix in the diff. This is a PASS." }

EXAMPLE 2: (FAIL)

[IMAGE 1: "before.png" shows a blue car in the center]

[IMAGE 2: "after.png" shows the blue car turning red, but still in the center]

Test Context: "User presses the 'Nudge Right' button. The selected 4D entity should move to the right."

PR Git Diff:

\`\`\`diff
--- a/src/components/Labeling/4D/AttributePanel.js
+++ b/src/components/Labeling/4D/AttributePanel.js
@@ -110,1 +110,1 @@
- const newColor = 0x0000FF; // blue
+ const newColor = 0xFF0000; // red

AI OUTPUT:

{ "status": "FAIL", "certainty": 1.0, "reasoning": "The test expected the car to move right. The 'After' image shows the car did not move. The 'PR Git Diff' shows a change to 'AttributePanel.js' related to color, not position. Therefore, the visual change (color) does not match the 'Test Context' (movement). This is a FAIL." }

YOUR TASK

Test Context: "${testContext}"
Git Diff:
\`\`\`diff
${gitDiff || 'No git diff provided or file is unchanged.'}
\`\`\`
JSON ONLY:
`;

  // const prompt = `describe both image in detail. then compare and contrast the two images. say what changed between the two images. do not make up anything that is not in the images. be factual and concise.
  // pay special attention to the position of the blue wireframe box in each image and note any changes in its position. it could change very slightly so be precise.`

  // console.log('----- Gemini Prompt (BEGIN) -----\n' + prompt + '\n----- Gemini Prompt (END) -----');

  try {
    const imageParts = [
      bufferToGenerativePart(beforeImgBuffer),
      bufferToGenerativePart(afterImgBuffer),
    ];

    // console.log(`Sending prompt to Gemini with ${imageParts.length} images...`);

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const response = result.response;
    const responseText = response.text();
    const parsed = JSON.parse(responseText);

    // Validate fields
    if (!parsed.status || typeof parsed.certainty !== 'number' || !parsed.reasoning) {
      throw new Error('AI response missing required fields (status, certainty, reasoning).');
    }
    if (parsed.status !== 'PASS' && parsed.status !== 'FAIL') {
      throw new Error('AI status is invalid (must be PASS or FAIL).');
    }

    // Token usage extraction
    const usage: any = (response as any).usageMetadata || {};
    const tokens = {
      prompt: usage.promptTokenCount ?? 0,
      candidates: usage.candidatesTokenCount ?? 0,
      total: usage.totalTokenCount ?? (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0)
    };

    return { ...parsed, tokens };

  } catch (error: any) {
    return {
      status: 'FAIL',
      certainty: 0.0,
      reasoning: `Error during AI analysis: ${error.message}`,
      tokens: { prompt: 0, candidates: 0, total: 0 }
    };
  }
}

// --- Helper: Wait for Canvas Ready ---
async function waitForCanvasReady(page) {
  await page.waitForSelector('canvas', { state: 'visible', timeout: 10000 })
  await page.waitForFunction(
    () => !!(window as any).__firstFrameDrawn,
    null,
    { timeout: 10000 }
  )
  // Small settle to avoid layout resize race
  await page.waitForTimeout(50)
}

// --- Playwright Test Suite ---
test.describe('Three.js Box Movement & Rotation - AI Visual Analysis', () => {
  test.describe.configure({ retries: 3 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await waitForCanvasReady(page)
    await page.waitForFunction(() =>
      !!(window as any).scene?.getObjectByName('MainBox'), { timeout: 5000 }
    )
    await page.evaluate(() => {
      const obj = (window as any).scene?.getObjectByName('MainBox')
      if (obj) obj.rotation.set(0, 0, 0)
    })
  });

  test('movement: box moves right (D)', async ({ page }) => {
    await page.keyboard.press('f');

    const beforePos = await page.evaluate(() => {
      const o = (window as any).scene?.getObjectByName('MainBox');
      return o ? { x: o.position.x, y: o.position.y, z: o.position.z } : null;
    });
    expect(beforePos).not.toBeNull();

    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible({ timeout: 5000 })
    const beforeScreenshotBuffer = await canvas.screenshot({ timeout: 10000 })

    const presses = 4;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('d');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(60);
    }

    const afterPos = await page.evaluate(() => {
      const o = (window as any).scene?.getObjectByName('MainBox');
      return o ? { x: o.position.x, y: o.position.y, z: o.position.z } : null;
    });
    expect(afterPos).not.toBeNull();
    expect(afterPos!.x).toBeGreaterThan(beforePos!.x);

    const afterScreenshotBuffer = await page.locator('canvas').screenshot();

    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();

    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Several 'd' key presses.
Expectation: Box translates horizontally toward screen-right (world +X).
Warnings: Ignore panel UI, particles, tiny jitter, any perceived rotation artifact.
Pass: Box final position is visually farther right than initial; pure lateral shift.
Notes: Test should still pass if rotation is observed; focus on position change.
`.replace(/\s+/g, ' ').trim();

    const result = await analyzeVisualTest(beforeScreenshotBuffer, afterScreenshotBuffer, testContext, gitDiff);
    await test.info().attach('movement-d-token-usage', {
      body: Buffer.from(JSON.stringify(result.tokens, null, 2)),
      contentType: 'application/json'
    });

    await test.info().attach('movement-d-before', { body: beforeScreenshotBuffer, contentType: 'image/png' });
    await test.info().attach('movement-d-after', { body: afterScreenshotBuffer, contentType: 'image/png' });
    await test.info().attach('movement-d-ai', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });

    expect(result.status, `AI failed. Reason: ${result.reasoning}`).toBe('PASS');
    expect(result.certainty, `Low confidence. Reason: ${result.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  test('movement: box moves forward (W)', async ({ page }) => {
    await page.keyboard.press('f');

    const beforePos = await page.evaluate(() => {
      const o = (window as any).scene?.getObjectByName('MainBox');
      return o ? { x: o.position.x, y: o.position.y, z: o.position.z } : null;
    });
    expect(beforePos).not.toBeNull();

    const beforeScreenshotBuffer = await page.locator('canvas').screenshot();

    const presses = 4;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('w');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(60);
    }

    const afterPos = await page.evaluate(() => {
      const o = (window as any).scene?.getObjectByName('MainBox');
      return o ? { x: o.position.x, y: o.position.y, z: o.position.z } : null;
    });
    expect(afterPos).not.toBeNull();
    expect(afterPos!.z).toBeLessThan(beforePos!.z);

    const afterScreenshotBuffer = await page.locator('canvas').screenshot();

    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();

    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Several 'w' key presses.
Expectation: Box moves forward deeper into scene (world -Z), no significant sideways drift.
Warnings: Ignore panel, particles, slight perspective skew.
Pass: Box ends visually farther forward; forward translation evident.
Notes: Test should still pass if rotation is observed; focus on position change.
`.replace(/\s+/g, ' ').trim();

    const result = await analyzeVisualTest(beforeScreenshotBuffer, afterScreenshotBuffer, testContext, gitDiff);
    await test.info().attach('movement-w-token-usage', {
      body: Buffer.from(JSON.stringify(result.tokens, null, 2)),
      contentType: 'application/json'
    });

    await test.info().attach('movement-w-before', { body: beforeScreenshotBuffer, contentType: 'image/png' });
    await test.info().attach('movement-w-after', { body: afterScreenshotBuffer, contentType: 'image/png' });
    await test.info().attach('movement-w-ai', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });

    expect(result.status, `AI failed. Reason: ${result.reasoning}`).toBe('PASS');
    expect(result.certainty, `Low confidence. Reason: ${result.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  test('rotation: box rotates right (E)', async ({ page }) => {
    await page.keyboard.press('f');

    const getYaw = async () => await page.evaluate(() =>
      (window as any).scene?.getObjectByName('MainBox')?.rotation.y
    );

    const beforeYaw = await getYaw();
    expect(beforeYaw).not.toBeUndefined();

    const beforeScreenshotBuffer = await page.locator('canvas').screenshot();

    const presses = 6;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('e');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(70);
    }

    const afterYaw = await getYaw();
    expect(afterYaw).not.toBeUndefined();
    expect(afterYaw as number).toBeLessThan(beforeYaw as number);

    const afterScreenshotBuffer = await page.locator('canvas').screenshot();

    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();

    const testContext = `
Subject: Blue wireframe box (MainBox).
Action: Several 'e' key presses.
Expectation: Box rotates right (clockwise yaw decrease); position roughly stable.
Warnings: Ignore minor positional jitter, particles, UI panel.
Pass: Final orientation clearly turned right compared to initial (edges angle changed clockwise).
`.replace(/\s+/g, ' ').trim();

    const result = await analyzeVisualTest(beforeScreenshotBuffer, afterScreenshotBuffer, testContext, gitDiff);
    await test.info().attach('rotation-e-token-usage', {
      body: Buffer.from(JSON.stringify(result.tokens, null, 2)),
      contentType: 'application/json'
    });

    await test.info().attach('rotation-e-before', { body: beforeScreenshotBuffer, contentType: 'image/png' });
    await test.info().attach('rotation-e-after', { body: afterScreenshotBuffer, contentType: 'image/png' });
    await test.info().attach('rotation-e-ai', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });

    expect(result.status, `AI failed. Reason: ${result.reasoning}`).toBe('PASS');
    expect(result.certainty, `Low confidence. Reason: ${result.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

});

