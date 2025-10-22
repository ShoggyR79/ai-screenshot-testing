import { test, expect, Page } from '@playwright/test';

const APP_URL = 'http://localhost:5173';

// Helper function to get the box's position from Three.js inside the browser
async function getBoxPosition(page: Page): Promise<{ x: number, y: number, z: number }> {
  // Use page.evaluate to run code within the browser context
  const position = await page.evaluate(() => {
    // Access the Three.js scene and box (assuming they are globally accessible or attached to window for testing)
    // IMPORTANT: For this to work, React app needs to expose the 'rectangle' object.
    const box = (window as any).testingBox;
    if (box && box.position) {
      return { x: box.position.x, y: box.position.y, z: box.position.z };
    }
    return null; // Box not found
  });

  if (!position) {
    throw new Error('Could not find the Three.js box object exposed on the window for testing.');
  }
  return position;
}

// --- Test Suite ---
test.describe('Three.js Box Movement', () => {

  test.beforeEach(async ({ page }) => {
    // Go to the app before each test
    await page.goto(APP_URL);
    // Wait for the canvas to be potentially ready (adjust selector if needed)
    await page.waitForSelector('canvas');
    // Add a small delay to ensure Three.js initializes fully
    await page.waitForTimeout(1000);
  });

  test('should move the box right when "d" is pressed', async ({ page }) => {
    // 1. Get initial position
    const initialPosition = await getBoxPosition(page);
    console.log('Initial Position:', initialPosition);

    // 2. Simulate pressing the "d" key
    await page.keyboard.press('d');

    // Add a small delay to allow Three.js to process the input and update
    await page.waitForTimeout(100);

    // 3. Get the new position
    const newPosition = await getBoxPosition(page);
    console.log('New Position:', newPosition);

    // 4. Assert the change
    // We expect only the x position to increase by the step value (0.5 in your App.tsx)
    expect(newPosition.x).toBeCloseTo(initialPosition.x + 0.5); // Use toBeCloseTo for floating point numbers
    expect(newPosition.y).toBeCloseTo(initialPosition.y);
    expect(newPosition.z).toBeCloseTo(initialPosition.z);
  });

  // --- Add more tests here for W, A, S, and C keys ---
  test('should move the box forward when "w" is pressed', async ({ page }) => {
    const initialPosition = await getBoxPosition(page);
    await page.keyboard.press('w');
    await page.waitForTimeout(100);
    const newPosition = await getBoxPosition(page);
    expect(newPosition.x).toBeCloseTo(initialPosition.x);
    expect(newPosition.y).toBeCloseTo(initialPosition.y);
    expect(newPosition.z).toBeCloseTo(initialPosition.z - 0.5); // Z decreases going "forward"
  });

   test('should move the box left when "a" is pressed', async ({ page }) => {
    const initialPosition = await getBoxPosition(page);
    await page.keyboard.press('a');
    await page.waitForTimeout(100);
    const newPosition = await getBoxPosition(page);
    expect(newPosition.x).toBeCloseTo(initialPosition.x - 0.5);
    expect(newPosition.y).toBeCloseTo(initialPosition.y);
    expect(newPosition.z).toBeCloseTo(initialPosition.z);
  });

   test('should move the box backward when "s" is pressed', async ({ page }) => {
    const initialPosition = await getBoxPosition(page);
    await page.keyboard.press('s');
    await page.waitForTimeout(100);
    const newPosition = await getBoxPosition(page);
    expect(newPosition.x).toBeCloseTo(initialPosition.x);
    expect(newPosition.y).toBeCloseTo(initialPosition.y);
    expect(newPosition.z).toBeCloseTo(initialPosition.z + 0.5); // Z increases going "backward"
  });

});