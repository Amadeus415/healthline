// Records the team demo against the running app: node scripts/record-demo.mjs [url] [out-dir]
// Drives the real agent, so timings follow Snowflake. Captions explain each step for viewers.
import { chromium } from "playwright";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:3000/team";
const outDir = process.argv[3] ?? "demo-video";
const size = { width: 1600, height: 900 };
const AGENT_TIMEOUT = 180_000;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size }, colorScheme: "light" });
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:9999;max-width:880px;padding:12px 20px;border-radius:14px;" +
        "background:rgba(21,21,21,.88);color:#faf9f6;font:400 18px/1.4 var(--font-inter-tight),system-ui;text-align:center;" +
        "box-shadow:0 18px 40px -18px rgba(0,0,0,.5);transition:opacity .4s;pointer-events:none";
      document.body.appendChild(el);
    }
    el.style.opacity = t ? "1" : "0";
    if (t) el.textContent = t;
  }, text);
}

/** Waits until no agent run is in flight and nothing is queued. */
async function idle() {
  await pause(1500);
  await page.waitForFunction(() => !document.querySelector('button[title="Stop"]') && !/Queued/i.test(document.body.innerText), null, {
    timeout: AGENT_TIMEOUT,
  });
}

const column = (role) => page.locator("section").filter({ has: page.locator(".label", { hasText: new RegExp(`^${role}$`, "i") }) });

await page.goto(url);
await page.evaluate(() => localStorage.removeItem("hl-team"));
await page.reload();
await page.waitForSelector("text=Field report");

await caption("One Cortex Agent, three people on one case: paramedic, ER doctor and nurse.");
await pause(3500);

await caption("The paramedic sends a field report. The live ambulance monitor starts streaming.");
await column("paramedic").getByRole("button", { name: /Unit 12 inbound/ }).click();
await pause(3000);
await caption("The agent searches 1.4M synthetic patients and narrows them to a few likely people.");
await column("paramedic").getByRole("button", { name: "Neither" }).waitFor({ timeout: AGENT_TIMEOUT });
await pause(2000);

await caption("One bedside check. The paramedic taps “Neither”.");
await pause(1500);
await column("paramedic").getByRole("button", { name: "Neither" }).click();
await caption("Identity narrows to one person. The doctor is alerted before the ambulance arrives.");
await page.waitForSelector("text=Monitor alarm", { timeout: AGENT_TIMEOUT });
await caption("Nobody asked: the monitor sees BP falling and alarms the team on its own.");
await idle();
await caption("The doctor gets a critical alert. The nurse gets a ready list. Catches fill the top strip.");
await pause(5000);

await caption("The doctor asks what a busy team would miss, and asks for the bay to be prepared.");
await column("doctor").getByRole("button", { name: /What would I miss/ }).click();
await idle();
await pause(5000);

await caption("The nurse ticks items off. The doctor sees each one, and so does the agent.");
await column("nurse").locator("[data-ready-item]").first().click();
await pause(3500);

await caption("The nurse asks their own question, with the latest vitals attached automatically.");
await column("nurse").getByRole("button", { name: /What should I prepare/ }).click();
await idle();
await pause(5000);

await caption("The doctor opens the chart pulled together from every care site.");
await column("doctor").getByRole("button", { name: "Patient chart" }).click();
await pause(6000);
await column("doctor").getByRole("button", { name: "Patient chart" }).click();

await caption("Safety, time, cost and research: what slips past human eyes, caught by one agent on Snowflake.");
await pause(5000);
await caption("");
await pause(800);

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
const target = join(outDir, "healthline-team-demo.webm");
renameSync(raw, target);
console.log(target);
