import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testMatch: "browser.dev.spec.js",
  use: { ...base.use, baseURL: "http://127.0.0.1:5180" },
  webServer: {
    command: "node tests/dev-server.mjs",
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
  },
});
