import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { mockAreaSources } from "./fixtures/area-sources.js";
import { solarmanWorkbook } from "./fixtures/solarman-workbook.js";
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
      "time,energy_kwh\n2024-06-21T10:00:00Z,1\n2024-06-21T10:15:00Z,1\n2024-06-21T10:30:00Z,1\n2024-06-21T10:45:00Z,1\n",
    ),
  });
  await expect(
    page.getByText("1 complete hour", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Measured interval energy is aggregated into complete UTC model hours/,
    ),
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
  await page
    .getByLabel("Import scenario GeoJSON", { exact: true })
    .setInputFiles({
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

test.describe("Solarman production validation", () => {
  test.use({ timezoneId: "Europe/Tallinn" });
  test("monthly Excel files retain logger offsets and compare matching 2026 weather privately", async ({
    page,
  }) => {
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(
      "https://archive-api.open-meteo.com/v1/archive?**",
      (route) => {
        const url = new URL(route.request().url());
        requests.push(url);
        const start = Date.parse(url.searchParams.get("start_date"));
        const end = Date.parse(url.searchParams.get("end_date")) + 86400000;
        const time = Array.from({ length: (end - start) / 3600000 }, (_, i) =>
          new Date(start + i * 3600000).toISOString().slice(0, 16),
        );
        // Synthetic weather tests the UI/temporal path; it is not field-validation evidence.
        return route.fulfill({
          json: {
            latitude: 58.25,
            longitude: 26.75,
            utc_offset_seconds: 0,
            hourly_units: {
              temperature_2m: "°C",
              shortwave_radiation: "W/m²",
              direct_normal_irradiance: "W/m²",
              diffuse_radiation: "W/m²",
            },
            hourly: {
              time,
              temperature_2m: time.map(() => 20),
              shortwave_radiation: time.map(() => 500),
              direct_normal_irradiance: time.map(() => 600),
              diffuse_radiation: time.map(() => 100),
            },
          },
        });
      },
    );
    await page.goto("/");
    await settled(page);
    const annual = await page.getByTestId("shadedKwh").textContent();
    await page.getByRole("tab", { name: "Validate", exact: true }).click();
    const part = (startMinute) =>
      Array.from({ length: 13 }, (_, i) => [
        new Date(Date.UTC(2026, 5, 1, 12, startMinute + 5 * i)),
        "UTC+02:00",
        1000,
        -8000,
        8000,
      ]);
    await page
      .getByLabel("Upload production files", { exact: true })
      .setInputFiles([
        {
          name: "synthetic-month-part-1.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(solarmanWorkbook(part(0))),
        },
        {
          name: "synthetic-month-part-2.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(solarmanWorkbook(part(60))),
        },
      ]);
    await expect(page.getByTestId("production-import-summary")).toContainText(
      "25 power samples",
    );
    await expect(page.getByTestId("production-import-summary")).toContainText(
      "UTC+02:00",
    );
    await expect(page.getByTestId("production-import-summary")).toContainText(
      "2026-06-01 10:00 UTC",
    );
    await expect(page.getByTestId("production-no-overlap")).toContainText(
      "Load weather for imported dates",
    );
    await expect(
      page.getByRole("button", { name: "Export comparison", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Load weather for imported dates",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("production-comparison")).toContainText(
      "2 complete hours",
      { timeout: 30000 },
    );
    const actual = page
      .getByTestId("production-comparison")
      .locator("div")
      .filter({
        has: page.locator("dt", { hasText: "Measured / integrated" }),
      });
    await expect(actual.locator("dd")).toHaveText("2 kWh");
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("start_date")).toBe("2026-06-01");
    expect([...requests[0].searchParams.keys()].sort()).toEqual([
      "end_date",
      "hourly",
      "latitude",
      "longitude",
      "models",
      "start_date",
      "temperature_unit",
      "timezone",
    ]);
    expect(requests[0].href).not.toContain("synthetic");
    const [comparison] = await Promise.all([
      page.waitForEvent("download"),
      page
        .getByRole("button", { name: "Export comparison", exact: true })
        .click(),
    ]);
    const exported = fs.readFileSync(await comparison.path(), "utf8");
    expect(exported.trim().split("\n")).toHaveLength(3);
    expect(exported).toContain("2026-06-01T10:00:00.000Z,1,");
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage })),
    ).not.toContain("synthetic-month");
    await page
      .getByRole("button", { name: "Remove production data", exact: true })
      .click();
    await expect(page.getByTestId("production-import-summary")).toHaveCount(0);
    await expect(page.getByTestId("production-comparison")).toHaveCount(0);
    await expect(page.getByTestId("shadedKwh")).toHaveText(annual);
    expect(errors).toEqual([]);
  });
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

test("storage sizes automatically, accepts AC current limits and exports the configured dispatch", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await settled(page);
  await page.getByLabel("Enable battery storage", { exact: true }).check();
  await expect(page.getByTestId("battery-capacity")).toHaveText("40 kWh");
  await expect(page.getByTestId("battery-benefit")).not.toContainText("—", {
    timeout: 20000,
  });
  await settled(page);
  await expect(page.getByTestId("with-battery-value")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".maplibregl-canvas")
        .evaluate((canvas) =>
          Math.abs(canvas.clientHeight - canvas.closest(".map").clientHeight),
        ),
    )
    .toBeLessThan(2);
  await page
    .getByLabel("Battery power units", { exact: true })
    .selectOption("amps");
  await expect(page.getByText(/11.09 kW charge/)).toBeVisible();
  await page
    .getByRole("button", { name: "Enable price arbitrage", exact: true })
    .click();
  await expect(page.getByLabel("Allow charging from the grid")).toBeChecked();
  await expect(
    page.getByLabel("Allow battery sales to the grid"),
  ).toBeChecked();
  await settled(page);
  await page.getByLabel("DC capacity", { exact: true }).fill("30");
  await expect(page.getByTestId("battery-capacity")).toHaveText("60 kWh");
  await settled(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page
        .getByRole("button", { name: "More scenario export options" })
        .click();
      await page.getByRole("menuitem", { name: "Scenario GeoJSON" }).click();
    })(),
  ]);
  const scenario = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(scenario.features[0].properties.storage.enabled).toBe(true);
  expect(scenario.features[0].properties.storage.effectiveCapacityKwh).toBe(60);
  expect(scenario.features[0].properties.storage.powerMode).toBe("amps");
  const [pdf] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export scenario", exact: true }).click(),
  ]);
  expect(
    fs
      .readFileSync(await pdf.path())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
  await page.locator("[data-oms-reset]").first().click();
  await settled(page);
  await expect(
    page.getByLabel("Enable battery storage", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByTestId("storage-results")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("area picker and failed area loads preserve the published site", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await settled(page);
  const initial = await page.getByTestId("shadedKwh").textContent();
  await page
    .getByRole("button", { name: "Choose on map", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByTestId("area-picker-map").locator("canvas"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.route(
    "https://teenus.maaamet.ee/ows/ajakohane-haldusjaotus?**",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/xml",
        body: '<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="0"/>',
      }),
  );
  await page.getByLabel("Area latitude", { exact: true }).fill("56.9496");
  await page.getByLabel("Area longitude", { exact: true }).fill("24.1052");
  await page
    .getByRole("button", { name: "Load Estonia area", exact: true })
    .click();
  await expect(
    page.getByText(/Choose a location on Estonian land/),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("shadedKwh")).toHaveText(initial);
  await expect(page.locator("html")).toHaveAttribute(
    "data-oms-state",
    "canonical",
  );
  await page.getByLabel("Import area bundle", { exact: true }).setInputFiles({
    name: "broken-area.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"schema":"solar-atlas-area-bundle/v1","sha256":"wrong","area":{}}',
    ),
  });
  await expect(page.getByText(/checksum mismatch/)).toBeVisible();
  await expect(page.getByTestId("shadedKwh")).toHaveText(initial);
  expect(errors).toEqual([]);
});

test("loading retained real area fixtures replaces map context and clears prior results", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockAreaSources(page);
  await page.goto("/");
  await settled(page);
  await page.getByLabel("Area latitude", { exact: true }).fill("58.37");
  await page.getByLabel("Area longitude", { exact: true }).fill("26.72");
  await page
    .getByRole("button", { name: "Load Estonia area", exact: true })
    .click();
  await expect(page.locator(".empty-site")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("map")).toHaveAttribute(
    "data-map-ready",
    "true",
  );
  await expect(page.getByTestId("shadedKwh")).toContainText("—");
  await expect(page.locator("html")).toHaveAttribute(
    "data-oms-state",
    "exploratory",
  );
  const [bundle] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save area bundle", exact: true }).click(),
  ]);
  expect(
    JSON.parse(fs.readFileSync(await bundle.path(), "utf8")).area.weather[
      "2025"
    ].requestedLocation.latitude,
  ).toBe(58.37);
  await page.locator("[data-oms-reset]").first().click();
  await settled(page);
  await expect(page.getByTestId("shadedKwh")).toContainText(
    pretty(project.results["2025"].summary.shadedKwh),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-oms-state",
    "canonical",
  );
  expect(errors).toEqual([]);
});
