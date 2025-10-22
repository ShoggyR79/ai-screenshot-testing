import { test, expect } from '@playwright/test'

/**
 * NOTE:
 * 1. First run: npx playwright test --update-snapshots
 * 2. The app must be running (npm run dev) OR configure webServer in playwright.config.ts.
 */
const APP_URL = 'http://localhost:5173';

const VIEWPORT = { width: 1280, height: 720 }

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto(APP_URL)               // adjust if you set a baseURL
  await page.locator('canvas').waitFor()
  // Let orbit damping settle one frame
  await page.waitForTimeout(100)
})

test('initial scene', async ({ page }) => {
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveScreenshot('initial.png')
})


// WASD movement tests
test('box moved with keyboard (one step W)', async ({ page }) => {
  await page.keyboard.press('KeyW')
  await page.waitForTimeout(50)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveScreenshot('box-moved-key-W.png')
})

test('box moved with keyboard (one step S)', async ({ page }) => {
  await page.keyboard.press('KeyS')
  await page.waitForTimeout(50)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveScreenshot('box-moved-key-S.png')
})

test('box moved with keyboard (one step A)', async ({ page }) => {
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(50)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveScreenshot('box-moved-key-A.png')
})

test('box moved with keyboard (one step D)', async ({ page }) => {
  await page.keyboard.press('KeyD')
  await page.waitForTimeout(50)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveScreenshot('box-moved-key-D.png')
})


test('center hotkey (C) recenters without changing orientation', async ({ page }) => {
  // Move box far away first (deterministic)
  await page.evaluate(() => {
    const box: any = (window as any).testingBox
    if (box) box.position.set(25, 0.505, 12)
  })
  await page.waitForTimeout(50)
  // Capture before centering
  await expect(page.locator('canvas')).toHaveScreenshot('pre-center.png')
  // Center camera
  await page.keyboard.press('KeyC')
  await page.waitForTimeout(100)
  await expect(page.locator('canvas')).toHaveScreenshot('post-center.png')
})

test('multiple moves accumulate', async ({ page }) => {
  for (const key of ['KeyW', 'KeyW', 'KeyA', 'KeyD', 'KeyD']) {
    await page.keyboard.press(key)
  }
  await page.waitForTimeout(60)
  await expect(page.locator('canvas')).toHaveScreenshot('accumulated-moves.png')
})