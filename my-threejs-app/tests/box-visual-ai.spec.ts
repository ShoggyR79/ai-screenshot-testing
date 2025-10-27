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


// --- Helper: Ensure screenshot directory exists ---
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(DEBUG_SCREENSHOT_DIR, { recursive: true });

// --- Gemini AI Analysis Function ---
async function analyzeVisualTest(beforeImgBuffer: Buffer, afterImgBuffer: Buffer, testContext: string, gitDiff: string): Promise<{ status: 'PASS' | 'FAIL', certainty: number, reasoning: string }> {
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
You are a hyper-focused AI Quality Assurance Analyst. Your task is to determine if a specific visual change occurred between a "Before" and "After" screenshot, based on a "Test Context".

You are currently looking at a threeJS application, rendering a 3D scene as well as a orbit camera and UI elements.
${movementAwareNote}

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
    console.log("Raw Gemini Response:", responseText);

    const parsed = JSON.parse(responseText);

    if (!parsed.status || typeof parsed.certainty !== 'number' || !parsed.reasoning) {
      throw new Error('AI response missing required fields (status, certainty, reasoning).');
    }
    if (parsed.status !== 'PASS' && parsed.status !== 'FAIL') {
      throw new Error('AI status is invalid (must be PASS or FAIL).');
    }

    return parsed as { status: 'PASS' | 'FAIL', certainty: number, reasoning: string };

  } catch (error: any) {
    console.error("Error calling Gemini API or parsing response:", error);
    return {
      status: 'FAIL',
      certainty: 0.0,
      reasoning: `Error during AI analysis: ${error.message}`
    };
  }
}

// --- Playwright Test Suite ---
test.describe('Three.js Box Movement - AI Visual Analysis', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(APP_URL);
    await page.waitForSelector('canvas');
    await page.locator('canvas').waitFor();

    // Wait until MainBox is present
    await page.waitForFunction(() =>
      !!(window as any).scene?.getObjectByName('MainBox')
      , { timeout: 5000 });

    // One extra frame for render stability
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  });

  test('should close panel when ] is pressed', async ({ page }) => {
    const testContext = "The subject is the dark side panel on the right. The test verifies if this panel disappears when the ']' key is pressed. Ignore all other visual elements.";

    // 1. Capture "Before" state
    const beforeScreenshotBuffer = await page.locator('body').screenshot();
    // console.log(`Captured 'before' screenshot.`);

    // 2. Perform Action
    await page.locator('canvas').focus();
    await page.keyboard.press(']');

    // 3. Wait for the panel's closing animation to finish
    await page.waitForTimeout(500);

    // 4. Capture "After" state
    const afterScreenshotBuffer = await page.locator('body').screenshot();
    // console.log(`Captured 'after' screenshot.`);

    // (Optional) Save for debugging
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'ai-box-before-close-panel.png'), beforeScreenshotBuffer);
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'ai-box-after-close-panel.png'), afterScreenshotBuffer);

    // 5. Get Git Diff
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();

    // 6. Analyze with AI
    const result = await analyzeVisualTest(beforeScreenshotBuffer, afterScreenshotBuffer, testContext, gitDiff);
    // console.log('AI Analysis Result:', result);

    // 7. Assert
    expect(result.status, `AI failed the test. Reasoning: ${result.reasoning}`).toBe('PASS');
    expect(result.certainty, `AI confidence was too low. Reasoning: ${result.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });
  
  test('should visually confirm box movement right when "d" is pressed (AI Analysis)', async ({ page }) => {

    await page.keyboard.press('f');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForTimeout(100);

    // 1. Capture "Before" state
    const beforeScreenshotBuffer = await page.locator('canvas').screenshot();
    await test.info().attach('before-box-canvas', {
      body: beforeScreenshotBuffer,
      contentType: 'image/png'
    });

    // 2. Perform Action
    await page.locator('canvas').click();
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForTimeout(100);

    const presses = 4;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('d');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForTimeout(100);

    // 3. Stabilize
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));


    // 4. Capture "After" state
    const afterScreenshotBuffer = await page.locator('canvas').screenshot();
    await test.info().attach('after-box-canvas', {
      body: afterScreenshotBuffer,
      contentType: 'image/png'
    });


    // Debug saves
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'ai-box-before-d.png'), beforeScreenshotBuffer);
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'ai-box-after-d.png'), afterScreenshotBuffer);

    // 5. Git Diff
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();

    // 6. Enhanced testContext with numeric anchors
    let testContext =
      `Subject: main blue wireframe box. Expect horizontal movement to the RIGHT when 'd' is pressed.
       pay special attention to the position of the blue wireframe box in each image and note any changes in its position. 
       Note that the camera does not move, so movement perceived to be camera is in fact the main subject.`;

    // 7. AI analysis
    const result = await analyzeVisualTest(beforeScreenshotBuffer, afterScreenshotBuffer, testContext, gitDiff);

    // 8. AI assertion
    expect(result.status, `AI failed. Reason: ${result.reasoning}`).toBe('PASS');
    expect(result.certainty, `Low confidence. Reason: ${result.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  test('should visually confirm box movement forward when "w" is pressed (AI Analysis)', async ({ page }) => {

    await page.keyboard.press('f');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForTimeout(100);

    // 1. Capture "Before" state
    const beforeScreenshotBuffer = await page.locator('canvas').screenshot();
    await test.info().attach('before-box-canvas', {
      body: beforeScreenshotBuffer,
      contentType: 'image/png'
    });

    // 2. Perform Action
    await page.locator('canvas').click();
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForTimeout(100);

    const presses = 4;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('w');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    await page.waitForTimeout(100);

    // 3. Stabilize
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    // 4. Capture "After" state
    const afterScreenshotBuffer = await page.locator('canvas').screenshot();
    await test.info().attach('after-box-canvas', {
      body: afterScreenshotBuffer,
      contentType: 'image/png'
    });


    // Debug saves
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'ai-box-before-w.png'), beforeScreenshotBuffer);
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'ai-box-after-w.png'), afterScreenshotBuffer);

    // 5. Git Diff
    const gitDiff = execSync(`git diff -- ${RELEVANT_CODE_FILE}`).toString();

    // 6. Enhanced testContext with numeric anchors
    let testContext =
      `Subject: main blue wireframe box. Expect movement FORWARD when 'w' is pressed.
       pay special attention to the position of the blue wireframe box in each image and note any changes in its position. 
       Note that the camera does not move, so movement perceived to be camera is in fact the main subject.`;

    // 7. AI analysis
    const result = await analyzeVisualTest(beforeScreenshotBuffer, afterScreenshotBuffer, testContext, gitDiff);

    // 8. AI assertion
    expect(result.status, `AI failed. Reason: ${result.reasoning}`).toBe('PASS');
    expect(result.certainty, `Low confidence. Reason: ${result.reasoning}`).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

});

