import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = Number(process.env.QA_PORT || 3100);
const baseUrl = `http://127.0.0.1:${port}`;

function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    async function poll() {
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {}

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Server did not become ready at ${url}`));
        return;
      }

      setTimeout(poll, 500);
    }

    void poll();
  });
}

const server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
  stdio: "inherit",
  env: {
    ...process.env,
    APP_ENV: "test",
    APP_PORT: String(port),
    TTS_PROVIDER: process.env.TTS_PROVIDER || "browser"
  }
});

let browser;

try {
  await waitForServer(baseUrl);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.route("**/api/speech/synthesize/stream", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ provider: "browser", fallback: "browser" })
    });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /try sample/i }).click();
  await page.getByPlaceholder(/ask a question/i).fill("What is photosynthesis?");
  await page.getByRole("button", { name: /^send message$/i }).click();

  await page.getByText(/Tutor Conversation/i).waitFor({ state: "visible" });
  console.log("Frontend QA passed");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
