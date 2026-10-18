/** Shared helpers for Volunteer Hub end-to-end checks (test-only). */
import { chromium, type Browser, type Page } from "@playwright/test";
import pg from "pg";

export const APP = process.env.APP_URL ?? "http://localhost:3200";
export const FAKE = process.env.FAKE_URL ?? "http://127.0.0.1:54399";

export async function startChecks(title: string) {
  const db = new pg.Client({ connectionString: process.env.DB_URL });
  await db.connect();
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
  const results: { check: string; ok: boolean; note?: string }[] = [];
  const check = (name: string, ok: boolean, note?: string) => {
    results.push({ check: name, ok, note });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`);
  };
  const browser: Browser = await chromium.launch();
  const serverErrors: string[] = [];
  async function newPage(): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.on("response", (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    return page;
  }
  async function signIn(page: Page, email: string) {
    await page.goto(`${APP}/login`);
    await page.getByRole("button", { name: "Email me a sign-in code" }).waitFor();
    await page.fill("#email", email);
    await page.getByRole("button", { name: "Email me a sign-in code" }).click();
    await page.fill("#code", "000000");
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }), page.getByRole("button", { name: "Sign in" }).click()]);
  }
  const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  async function finish() {
    check("no server errors while browsing", serverErrors.length === 0, serverErrors.join(", "));
    await browser.close();
    await db.end();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${title}: ${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) process.exit(1);
  }
  return { db, q, check, newPage, signIn, noHorizontalScroll, finish };
}
