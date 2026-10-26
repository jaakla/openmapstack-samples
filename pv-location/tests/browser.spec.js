import { test, expect } from "@playwright/test";
import fs from "node:fs";
const project = JSON.parse(
  fs.readFileSync(
    new URL("../public/data/project.json", import.meta.url),
    "utf8",
  ),
);
const pretty = (v) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(v);
const settled = async (page) => {
  await expect(page.locator(".results")).toHaveAttribute("aria-busy", "false", {
    timeout: 20000,
  });
};
test("canonical replay, live scenarios, geometry, export/import and honest CSV comparison", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await settled(page);
  await expect(page).toHaveTitle(/Solar Atlas/);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.locator(".map-error")).toHaveCount(0);
  await expect(page.getByTestId("shadedKwh")).toContainText(
    pretty(project.results["2025"].summary.shadedKwh),
  );
  const initial = await page.getByTestId("shadedKwh").textContent();
  await page.getByLabel("Panel tilt", { exact: true }).fill("15");
  await settled(page);
  await expect(page.getByTestId("shadedKwh")).not.toHaveText(initial);
  await expect(page.locator("html")).toHaveAttribute(
    "data-oms-state",
    "exploratory",
  );
  await page.locator("[data-oms-reset]").first().click();
  await settled(page);
  await expect(page.getByTestId("shadedKwh")).toHaveText(initial);
  await expect(page.locator("html")).toHaveAttribute(
    "data-oms-state",
    "canonical",
  );
  await page.getByLabel("Market year", { exact: true }).selectOption("2024");
  await settled(page);
  await expect(page.getByTestId("shadedKwh")).toContainText(
    pretty(project.results["2024"].summary.shadedKwh),
  );
  await page.getByRole("tab", { name: "Validate", exact: true }).click();
  await expect(
    page.getByText("Owner calibration: pending real production data."),
  ).toBeVisible();
  // Synthetic values verify the import workflow only; they are never field-validation evidence.
  await page.locator(".upload-zone input").setInputFiles({
    name: "test-only.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "time,energy_kwh\n2024-06-21T10:00:00Z,1\n2024-06-21T10:15:00Z,1\n",
    ),
  });
  await expect(page.getByText("2 intervals", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Each modeled hour is divided equally/),
  ).toBeVisible();
  await page.locator(".upload-zone input").setInputFiles({
    name: "ambiguous.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("time,energy_kwh\n2024-10-27T03:00:00,1\n"),
  });
  await expect(
    page.getByText(/timestamp needs Z or a UTC offset/),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Scenario", exact: true }).click();
  await page.locator("[data-oms-reset]").first().click();
  await settled(page);
  await page.getByRole("button", { name: "Draw site", exact: true }).click();
  const box = await page.getByTestId("map").boundingBox();
  for (const [x, y] of [
    [0.42, 0.4],
    [0.46, 0.4],
    [0.46, 0.47],
    [0.42, 0.47],
  ])
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await page.getByRole("button", { name: "Finish polygon" }).click();
  await settled(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-oms-state",
    "exploratory",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page
        .getByRole("button", { name: "More scenario export options" })
        .click();
      await page.getByRole("menuitem", { name: "Scenario GeoJSON" }).click();
    })(),
  ]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(exported.features[0].properties.scenarioType).toBe("hypothetical");
  expect(exported.features[0].geometry.type).toBe("Polygon");
  await page.locator(".import-link input").setInputFiles({
    name: "canonical.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(
      JSON.stringify({
        type: "Feature",
        geometry: project.canonical.polygon,
        properties: project.canonical.system,
      }),
    ),
  });
  await settled(page);
  await expect(page.getByTestId("shadedKwh")).toHaveText(initial);
  // Clearing a date must retain the previous valid sun state and not crash rendering.
  await page.getByLabel("Shadow date", { exact: true }).fill("");
  await expect(page.getByTestId("map")).toBeVisible();
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await expect(page.getByTestId("provenance")).toBeVisible();
  await expect(
    page.getByText(/Government municipality counts are context/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
for (const width of [390, 320])
  test(`mobile ${width}px keeps map visible and controls accessible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await settled(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByTestId("map")).toBeVisible();
    expect(
      (await page.getByTestId("map").boundingBox()).width,
    ).toBeGreaterThanOrEqual(width / 2);
    await page
      .getByRole("tab", { name: "Scenario", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

test("consumption estimates, private Enefit import and PDF report export", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await settled(page);
  await expect(page.getByTestId("consumptionKwh")).toContainText("5,110");
  const initial = await page.getByTestId("pv-value").textContent();
  await page.getByLabel("Day consumption", { exact: true }).fill("20");
  await settled(page);
  await expect(page.getByTestId("consumptionKwh")).toContainText("8,760");
  await expect(page.getByTestId("pv-value")).not.toHaveText(initial);
  await expect(page.locator("html")).toHaveAttribute(
    "data-oms-state",
    "exploratory",
  );
  await page.locator("[data-oms-reset]").first().click();
  await settled(page);
  await expect(page.getByLabel("Day consumption", { exact: true })).toHaveValue(
    "10",
  );
  const enefit =
    "Väljastaja:;Enefit AS\nKlient:;PRIVATE-TEST-CUSTOMER\nMõõtepunkti EIC:;;PRIVATE-TEST-EIC;;PRIVATE-TEST-EIC\nAndmete tüüp:;;Tarbimine;;Tootmine;;\n\nAlgus;Lõpp;Kogus (kWh);Börsihind (EUR / MWh);Kogus (kWh);Börsihind (EUR / MWh);\n21.06.2023 12:00;21.06.2023 13:00;2,788;91,99;0,5;91,99;\n";
  await page
    .getByLabel("Upload Enefit historical CSV", { exact: true })
    .setInputFiles({
      name: "enefit-test.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(enefit),
    });
  await expect(
    page.getByLabel("Consumption profile", { exact: true }),
  ).toHaveValue("csv-calendar");
  await settled(page);
  await expect(page.getByText(/Partial demand coverage:/)).toBeVisible();
  await expect(page.getByTestId("consumptionKwh")).toContainText("—");
  await expect(
    page.getByText(/Enefit “Tarbimine” measures grid imports/),
  ).toBeVisible();
  await page
    .getByLabel("Fill missing intervals with the day/night estimate")
    .check();
  await settled(page);
  await expect(page.getByTestId("consumptionKwh")).not.toContainText("—");
  await expect(page.getByText(/hours estimated/)).toBeVisible();
  const [pdf] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export scenario", exact: true }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = fs.readFileSync(await pdf.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(50000);
  const [scenario] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page
        .getByRole("button", { name: "More scenario export options" })
        .click();
      await page.getByRole("menuitem", { name: "Scenario GeoJSON" }).click();
    })(),
  ]);
  const exported = JSON.parse(fs.readFileSync(await scenario.path(), "utf8"));
  expect(exported.features[0].properties.consumption.rows[0].energyKwh).toBe(
    2.788,
  );
  expect(JSON.stringify(exported)).not.toContain("PRIVATE-TEST");
  await page
    .getByRole("button", { name: "Remove Enefit consumption data" })
    .click();
  await settled(page);
  await expect(
    page.getByLabel("Consumption profile", { exact: true }),
  ).toHaveValue("estimate");
  expect(errors).toEqual([]);
});
