// Retakes the README screenshots against the running app: node scripts/readme-shots.mjs [url] [out-dir]
// Drives the real agent, so it takes a few minutes and the exact wording varies run to run.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = process.argv[3] ?? "../docs/readme";
const AGENT_TIMEOUT = 180_000;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

async function shoot(page, name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log(name);
}

/** Waits until no agent run is in flight and nothing is queued. */
async function idle(page) {
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('button[title="Stop"]') && !/Queued/i.test(document.body.innerText), null, {
    timeout: AGENT_TIMEOUT,
  });
}

// Single-user view: identify the Bay 4 patient, then open his chart.
{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await context.newPage();
  await page.goto(base + "/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await shoot(page, "home");
  await page.getByRole("button", { name: /Unconscious male/ }).click();
  await page.getByRole("button", { name: "Neither" }).waitFor({ timeout: AGENT_TIMEOUT });
  await idle(page);
  await shoot(page, "identify");
  await page.getByRole("button", { name: "Neither" }).click();
  await page.waitForSelector("text=Koelpin", { timeout: AGENT_TIMEOUT });
  await idle(page);
  await shoot(page, "chart");
  await context.close();
}

// Team view: the field report, the handoff, the ready list, and an order without the details.
{
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await context.newPage();
  const column = (role) => page.locator("section").filter({ has: page.locator(".label", { hasText: new RegExp(`^${role}$`, "i") }) });

  await page.goto(base + "/team");
  await page.evaluate(() => localStorage.removeItem("hl-team"));
  await page.reload();
  await page.waitForSelector("text=Field report");

  await column("paramedic").getByRole("button", { name: /Unit 12 inbound/ }).click();
  await column("paramedic").getByRole("button", { name: "Neither" }).waitFor({ timeout: AGENT_TIMEOUT });
  await page.waitForTimeout(1500);
  await column("paramedic").getByRole("button", { name: "Neither" }).click();
  await page.waitForSelector("text=Monitor alarm", { timeout: AGENT_TIMEOUT });
  await idle(page);
  await shoot(page, "team-handoff");

  await column("doctor").getByRole("button", { name: /What would I miss/ }).click();
  await idle(page);
  await shoot(page, "team");

  await column("nurse").locator("[data-ready-item]").first().click();
  await page.waitForTimeout(2500);
  const doctor = column("doctor").getByPlaceholder(/tell the nurse/);
  await doctor.fill("Pull off the gauze and hang blood");
  await doctor.press("Enter");
  await idle(page);
  await shoot(page, "team-blood");
  await context.close();
}

await browser.close();
