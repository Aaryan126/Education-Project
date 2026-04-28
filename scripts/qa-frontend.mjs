import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const port = Number(process.env.QA_PORT || 3100);
const suppliedBaseUrl = process.env.QA_BASE_URL;
const defaultBaseUrl = `http://127.0.0.1:${port}`;
let baseUrl = suppliedBaseUrl || defaultBaseUrl;

async function canReachServer(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    async function poll() {
      if (await canReachServer(url)) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Server did not become ready at ${url}`));
        return;
      }

      setTimeout(poll, 500);
    }

    void poll();
  });
}

async function startServerIfNeeded() {
  if (suppliedBaseUrl || (await canReachServer(baseUrl))) {
    return null;
  }

  const hasProductionBuild = existsSync(".next/BUILD_ID") || existsSync(".next/BUILD_ID.tmp");
  const script = hasProductionBuild && process.env.QA_USE_DEV !== "1" ? "start" : "dev";
  const server = spawn("npm", ["run", script, "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    stdio: "inherit",
    env: {
      ...process.env,
      APP_ENV: "test",
      APP_PORT: String(port),
      TTS_PROVIDER: process.env.TTS_PROVIDER || "browser"
    }
  });

  await waitForServer(baseUrl);
  return server;
}

let browser;
let server;

try {
  server = await startServerIfNeeded();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ persisted: false, sessionId: null, reason: "QA mock" })
      });
      return;
    }

    await route.continue();
  });

  await page.route("**/api/tutor/respond", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: "Photosynthesis is how plants make food using light, water, and carbon dioxide.",
        followUpQuestion: "Which one of those ingredients comes from the air?",
        understandingLevel: "medium",
        directAnswerGiven: false,
        confidence: 0.9,
        provider: "qa-mock"
      })
    });
  });

  await page.route("**/api/speech/synthesize", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        audioBase64: null,
        format: null,
        provider: "browser",
        voice: "qa-mock",
        fallback: "browser",
        timings: []
      })
    });
  });

  await page.route("**/api/speech/synthesize/stream", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ provider: "browser", fallback: "browser" })
    });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /math problem/i }).click();
  await page.getByText(/Tutor Conversation/i).waitFor({ state: "visible" });
  await page.getByPlaceholder(/ask a question/i).fill("What is photosynthesis?");
  await page.getByRole("button", { name: /^send message$/i }).click();

  await page.locator(".message.assistant").getByText(/Which one of those ingredients comes from the air/i).waitFor({
    state: "visible"
  });
  console.log("Frontend QA passed");
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}
