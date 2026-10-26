import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { mockAreaSources } from "./fixtures/area-sources.js";
import { solarmanWorkbook } from "./fixtures/solarman-workbook.js";

// The server starts with an isolated fresh cache; the second case reuses its warmed dependencies.
for (const cache of ["cold", "warm"]) {
  test(`first area and PDF actions work with ${cache} Vite dependencies`, async ({
    page,
  }) => {
    const errors = [],
      failedModules = [],
      navigations = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        /\/(src|node_modules)\//.test(response.url())
      )
        failedModules.push(`${response.status()} ${response.url()}`);
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await mockAreaSources(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/Solar Atlas/);
    await expect(page.getByTestId("shadedKwh")).toContainText("18,013", {
      timeout: 30000,
    });
    await expect(page.locator(".results")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const initialNavigations = navigations.length;

    await page.getByRole("tab", { name: "Validate", exact: true }).click();
    await page
      .getByLabel("Upload production files", { exact: true })
      .setInputFiles({
        name: "synthetic-solarman.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(
          solarmanWorkbook(
            Array.from({ length: 13 }, (_, i) => [
              new Date(Date.UTC(2026, 5, 1, 12, i * 5)),
              "UTC+02:00",
              1000,
              0,
              0,
            ]),
          ),
        ),
      });
    await expect(page.getByTestId("production-import-summary")).toContainText(
      "13 power samples",
    );
    await page.getByRole("tab", { name: "Scenario", exact: true }).click();

    const [pdf] = await Promise.all([
      page.waitForEvent("download"),
      page
        .getByRole("button", { name: "Export scenario", exact: true })
        .click(),
    ]);
    expect(
      fs
        .readFileSync(await pdf.path())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    await page.getByLabel("Area latitude", { exact: true }).fill("58.37");
    await page.getByLabel("Area longitude", { exact: true }).fill("26.72");
    await page
      .getByRole("button", { name: "Load Estonia area", exact: true })
      .click();
    await expect(page.locator(".empty-site")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("map")).toHaveAttribute(
      "data-map-ready",
      "true",
    );
    await expect(page.getByTestId("shadedKwh")).toContainText("—");
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(failedModules).toEqual([]);
    expect(navigations).toHaveLength(initialNavigations);
  });
}
