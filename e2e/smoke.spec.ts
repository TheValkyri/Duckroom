import { test, expect } from "@playwright/test";

test.describe("Duckroom Core Smoke Tests", () => {
  test("1. App shell & homepage render properly", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Duckroom/i);

    // Verify main brand logo/text is visible
    const brandText = page.getByText("Duckroom").first();
    await expect(brandText).toBeVisible();

    // Verify main content container exists without error
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
    await expect(page.getByText("Không thể tải trang")).not.toBeVisible();
  });

  test("2. Library route navigation & content container render", async ({ page }) => {
    await page.goto("/");

    // Navigate to /library via link or direct navigation
    await page.goto("/library");
    await expect(page).toHaveURL(/\/library/);

    // Verify page content loads without unhandled crash
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
    await expect(page.getByText("Không thể tải trang")).not.toBeVisible();
  });

  test("3. Player bar component is mounted in DOM", async ({ page }) => {
    await page.goto("/");

    // Player bar or player container should be rendered in the DOM
    const playerContainer = page
      .locator("nav, div")
      .filter({ hasText: /Duckroom/ })
      .first();
    await expect(playerContainer).toBeVisible();

    // Audio element should exist for the audio engine (primary and crossfade)
    const audioElement = page.locator("audio").first();
    await expect(audioElement).toBeAttached();
  });

  test("4. Command palette search dialog responds to shortcut or trigger", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("html[data-hydrated='true']");

    // Open search palette via search button
    const searchTrigger = page.locator('button[aria-label="Tìm nhanh trong Duckroom"]').first();
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();

    const dialog = page.getByRole("dialog", { name: "Bảng lệnh Duckroom" });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const searchInput = page.getByLabel("Tìm trong Duckroom");
    await expect(searchInput).toBeVisible();
    await searchInput.focus();

    // Press Escape to dismiss
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("5. Mobile viewport responsiveness (nav dock visibility)", async ({ page }) => {
    // Emulate mobile screen
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // Mobile bottom navigation dock must be visible
    const mobileBottomNav = page.locator('nav[aria-label="Điều hướng chính"]');
    await expect(mobileBottomNav).toBeVisible();

    // Desktop-only aside sidebar should be hidden
    const desktopAside = page.locator("aside");
    await expect(desktopAside).toBeHidden();
  });
});
