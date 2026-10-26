import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createScenarioReport, scenarioReportFilename } from "../src/report.js";

const parser = spawnSync("python3", ["-c", "import pypdf"], {
  encoding: "utf8",
});
const summary = {
  clearKwh: 12000,
  weatherKwh: 10000,
  shadedKwh: 9000,
  shadingLossKwh: 1000,
  shadingLossPct: 10,
  specificYieldKwhKwp: 900,
  expectedHours: 8760,
  weatherHours: 8760,
  pricedHours: 8760,
  consumptionKwh: 7000,
  selfConsumedKwh: 3000,
  importKwh: 4000,
  exportKwh: 6000,
  baselineImportCostEur: 1200,
  gridImportCostEur: 700,
  exportRevenueEur: 300,
  netGridCostEur: 400,
  netBenefitEur: 800,
  selfConsumptionPct: 100 / 3,
  selfSufficiencyPct: 300 / 7,
  consumptionExpectedHours: 8760,
  consumptionCoveredHours: 8760,
  consumptionCoveragePct: 100,
  imputedHours: 0,
};
function fixture(overrides = {}) {
  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [26.72, 58.37],
        [26.7203, 58.37],
        [26.7203, 58.3701],
        [26.72, 58.3701],
        [26.72, 58.37],
      ],
    ],
  };
  return {
    project: {
      project: { id: "report-test" },
      run: { id: "test-run", completed_at: "2026-10-26T10:00:00Z" },
      author: { name: "Sample project author" },
      sources: [],
    },
    system: {
      kwp: 10,
      tiltDeg: 35,
      azimuthDeg: 180,
      mountingHeightM: 2,
      systemLossPct: 14,
      salesMarginEurMWh: 5,
    },
    polygon,
    analysis: {
      summary,
      annual: [{ year: 2025, ...summary }],
      monthly: Array.from({ length: 12 }, (_, i) => ({
        month: `2025-${String(i + 1).padStart(2, "0")}`,
        ...summary,
      })),
      consumption: {
        config: {
          mode: "estimate",
          dayKwh: 10,
          nightKwh: 4,
          dayStartHour: 7,
          dayEndHour: 23,
          timeZone: "Europe/Tallinn",
          importAdderEurMWh: 40,
        },
      },
    },
    horizon: {
      coveragePct: 94.9,
      resolutionM: 5,
      sampleCount: 9,
      radiusM: 500,
    },
    scenarioState: { year: 2025, exploratory: true },
    createdAt: "2026-10-26T10:30:00Z",
    ...overrides,
  };
}
function inspect(doc) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "solar-atlas-report-"),
  );
  try {
    const file = path.join(directory, "scenario.pdf");
    fs.writeFileSync(file, Buffer.from(doc.output("arraybuffer")));
    const result = spawnSync(
      "python3",
      [
        "-c",
        `import json,sys
from pypdf import PdfReader
r=PdfReader(sys.argv[1])
print(json.dumps({'pages':len(r.pages),'text':[p.extract_text() for p in r.pages],'metadata':dict(r.metadata),'images':sum(len(p.images) for p in r.pages),'imageTransforms':[list(map(float,ops[i-1][0])) for p in r.pages for ops in [p.get_contents().operations] for i,(_,op) in enumerate(ops) if op == b'Do' and i>0 and ops[i-1][1]==b'cm'],'validClipPaths':all(i>0 and ops[i-1][1] == b're' for p in r.pages for ops in [p.get_contents().operations] for i,(_,op) in enumerate(ops) if op in (b'W',b'W*')),'a4':[[float(p.mediabox.width),float(p.mediabox.height)] for p in r.pages]}))`,
        file,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "PDF contains readable A4 scenario, economics, monthly results and provenance",
  {
    skip:
      parser.status !== 0 &&
      "Python pypdf is needed for independent PDF parsing",
  },
  async () => {
    const doc = await createScenarioReport(fixture());
    assert.equal(doc.getNumberOfPages(), 3);
    const pdf = inspect(doc),
      text = pdf.text.join("\n");
    assert.equal(pdf.pages, 3);
    for (const [w, h] of pdf.a4) {
      assert.ok(Math.abs(w - 595.28) < 0.1);
      assert.ok(Math.abs(h - 841.89) < 0.1);
    }
    for (const section of [
      "Your PV scenario",
      "Weather adjusted",
      "After local shadows",
      "Consumption & value",
      "Annual economic comparison",
      "Without PV",
      "With PV",
      "Monthly energy",
      "Jan",
      "Dec",
      "Evidence & assumptions",
      "2017–2020",
      "test-run",
      "Generated with AI using the free OpenMapStack toolkit",
      "2026-10-26T10:00:00Z",
    ])
      assert.ok(text.includes(section), `Missing readable text: ${section}`);
    assert.ok(
      text.includes("€800"),
      "annual benefit rendered from actual analysis",
    );
    assert.ok(
      text.includes("40 €/MWh"),
      "explicit import tariff adder is disclosed",
    );
    assert.equal(pdf.metadata["/Author"], "Solar Atlas");
  },
);

test(
  "embeds the actual map image and preserves Estonian Unicode; omits private import metadata",
  {
    skip:
      parser.status !== 0 &&
      "Python pypdf is needed for independent PDF parsing",
  },
  async () => {
    const args = fixture();
    args.mapImage = {
      dataUrl: `data:image/jpeg;base64,${fs.readFileSync(new URL("../public/data/aerial.jpg", import.meta.url)).toString("base64")}`,
      caption: "Maa- ja Ruumiamet · Päev / Öö · põõsad",
      coordinates: [
        [26.7, 58.38],
        [26.74, 58.38],
        [26.74, 58.36],
        [26.7, 58.36],
      ],
    };
    args.analysis.consumption = {
      config: {
        mode: "csv-calendar",
        timeZone: "Europe/Tallinn",
        importAdderEurMWh: 40,
      },
      provenance: {
        format: "Enefit historical report",
        matchMethod: "repeat local month/day/clock",
        seriesType: "grid-import",
        fileName: "PRIVATE_FILENAME_SENTINEL.csv",
        customerName: "PRIVATE_CUSTOMER_SENTINEL",
        address: "PRIVATE_ADDRESS_SENTINEL",
        eic: "PRIVATE_EIC_SENTINEL",
      },
      rawCsv: "PRIVATE_RAW_CSV_SENTINEL",
    };
    const pdf = inspect(await createScenarioReport(args));
    const content = JSON.stringify(pdf);
    assert.ok(pdf.images > 0, "map image is embedded in the PDF");
    assert.ok(
      pdf.validClipPaths,
      "map clipping consumes an open rectangle path so the image stays visible",
    );
    assert.ok(
      content.includes("Päev / Öö · põõsad"),
      "Unicode survives independent PDF text extraction",
    );
    assert.ok(content.includes("Enefit historical report"));
    assert.ok(content.includes("grid-import"));
    assert.ok(
      !content.includes("PRIVATE_"),
      "no private fields, raw CSV or filename in document or metadata",
    );
  },
);

test(
  "partial consumption stays unknown and negative currency keeps its sign",
  {
    skip:
      parser.status !== 0 &&
      "Python pypdf is needed for independent PDF parsing",
  },
  async () => {
    const args = fixture();
    const partial = {
      ...summary,
      consumptionKwh: null,
      selfConsumedKwh: null,
      importKwh: null,
      exportKwh: null,
      baselineImportCostEur: null,
      netGridCostEur: null,
      netBenefitEur: null,
      exportRevenueEur: -40,
      consumptionCoveredHours: 4380,
      consumptionCoveragePct: 50,
      coveredNetBenefitEur: 999999,
    };
    args.analysis.summary = partial;
    args.analysis.annual = [{ year: 2025, ...partial }];
    args.analysis.monthly = [];
    args.mapImage = "data:image/png;base64,invalid";
    const pdf = inspect(await createScenarioReport(args)),
      text = pdf.text.join("\n");
    assert.ok(text.includes("50%"));
    assert.ok(
      text.includes("−€40"),
      "negative receipts retain the monetary loss sign",
    );
    assert.ok(text.includes("Missing coverage remains unknown"));
    assert.ok(
      !text.includes("999,999"),
      "covered sums are not presented as full annual results",
    );
    assert.ok(
      text.includes("Footprint diagram"),
      "failed map capture falls back to the real polygon",
    );
  },
);

test("requires an analyzed scenario and rejects invalid report dates", async () => {
  await assert.rejects(createScenarioReport({}), /Run the scenario analysis/);
  await assert.rejects(
    createScenarioReport(fixture({ createdAt: "invalid" })),
    /date is invalid/,
  );
});

test(
  "plain map captures preserve the full image and imported gap-fill assumptions are explicit",
  {
    skip:
      parser.status !== 0 &&
      "Python pypdf is needed for independent PDF parsing",
  },
  async () => {
    const args = fixture();
    args.mapImage = {
      dataUrl: `data:image/jpeg;base64,${fs.readFileSync(new URL("../public/data/aerial.jpg", import.meta.url)).toString("base64")}`,
      fit: "contain",
    };
    args.analysis.consumption = {
      config: {
        mode: "csv-calendar",
        fillMissingWithEstimate: true,
        dayKwh: 13,
        nightKwh: 7,
        dayStartHour: 8,
        dayEndHour: 22,
        timeZone: "Europe/Tallinn",
        importAdderEurMWh: 40,
      },
      provenance: {
        format: "Enefit historical report",
        matchMethod: "repeat local month/day/clock (DST occurrence explicit)",
        timeZone: "Europe/Tallinn",
        seriesType: "grid-import",
      },
    };
    const pdf = inspect(await createScenarioReport(args)),
      text = pdf.text.join("\n");
    assert.ok(
      text.includes("Gap-fill assumption: 13 kWh/daytime + 7 kWh/night"),
    );
    assert.ok(text.includes("08:00–22:00 Europe/Tallinn"));
    assert.ok(pdf.imageTransforms.length > 0);
    const transform = pdf.imageTransforms[0];
    assert.ok(
      Math.abs(transform[0] - transform[3]) < 0.01,
      "square image remains square",
    );
    assert.ok(
      Math.abs(transform[0] - (85 / 25.4) * 72) < 0.1,
      "whole square image is contained in the 85mm map height",
    );
  },
);

test("PDF download dates follow the Tallinn calendar around UTC midnight", () => {
  assert.equal(
    scenarioReportFilename(2025, "2025-06-30T21:30:00Z"),
    "solar-atlas-pv-2025-2025-07-01.pdf",
  );
  assert.equal(
    scenarioReportFilename(2025, "2026-10-25T22:30:00Z"),
    "solar-atlas-pv-2025-2026-10-26.pdf",
  );
});

test(
  "enabled storage adds a readable comparison page and distinguishes live AOI provenance",
  {
    skip:
      parser.status !== 0 &&
      "Python pypdf is needed for independent PDF parsing",
  },
  async () => {
    const args = fixture();
    args.project.liveContext = { name: "Tallinna valitud ala" };
    args.project.sources = [
      {
        id: "dsm",
        source_url: "https://example.test/live-dsm",
        access: { retrieved_at: "2026-10-26T12:00:00Z" },
        pin: { sha256: "sha256:1234567890abcdef" },
      },
    ];
    const stored = {
      importKwh: 3000,
      exportKwh: 5000,
      pvSelfConsumedKwh: 4000,
      chargeKwh: 2000,
      dischargeKwh: 1800,
      lossKwh: 200,
      operatingCostEur: 150,
      netBenefitEur: 1050,
      incrementalBenefitEur: 250,
      socStartKwh: 4,
      socEndKwh: 4,
      maxSocKwh: 40,
      coveragePct: 100,
      coveredHours: 8760,
      expectedHours: 8760,
    };
    args.analysis.storage = {
      config: {
        enabled: true,
        capacityMode: "auto",
        effectiveCapacityKwh: 40,
        reserveKwh: 4,
        reserveSocPct: 10,
        powerMode: "kw",
        effectiveChargePowerKw: 10,
        effectiveDischargePowerKw: 10,
        chargeCurrentA: 16,
        dischargeCurrentA: 16,
        phases: 3,
        voltageV: 400,
        roundTripEfficiencyPct: 90,
        cyclingCostEurKwh: 0.02,
        allowGridCharging: false,
        allowBatteryExport: false,
        socSteps: 80,
      },
      summary: stored,
      monthly: Array.from({ length: 12 }, (_, i) => ({
        ...stored,
        month: `2025-${String(i + 1).padStart(2, "0")}`,
      })),
      quality: { solver: "daily finite-state dispatch" },
    };
    const pdf = inspect(await createScenarioReport(args));
    assert.equal(pdf.pages, 4);
    const text = pdf.text.join("\n");
    for (const phrase of [
      "Battery storage",
      "Benefit versus no battery",
      "€250",
      "€1,050",
      "40 kWh",
      "10 / 10 kW",
      "90%",
      "0.02 €/kWh",
      "Monthly storage dispatch",
      "prices are known in advance",
      "Parent pinned run",
      "Tallinna valitud ala",
      "1234567890",
      "4 of 4",
    ])
      assert.ok(
        text.includes(phrase),
        `Missing storage/context evidence: ${phrase}`,
      );
    assert.ok(pdf.text[1].includes("comparison without storage"));
    args.analysis.storage.summary = {
      ...stored,
      incrementalBenefitEur: null,
      netBenefitEur: null,
      coveredIncrementalBenefitEur: 999999,
      coveragePct: 50,
      coveredHours: 4380,
    };
    args.analysis.storage.monthly = [];
    const partial = inspect(await createScenarioReport(args)).text.join("\n");
    assert.ok(partial.includes("50%"));
    assert.ok(
      !partial.includes("999,999"),
      "matched subset totals never appear as annual storage benefits",
    );
  },
);

test("enabled storage report requires current dispatch results", async () => {
  await assert.rejects(
    createScenarioReport(fixture({ storage: { enabled: true } })),
    /current storage analysis/,
  );
  const stale = fixture({ storage: { enabled: true, capacityKwh: 80 } });
  stale.analysis.storage = {
    config: { enabled: false, capacityKwh: 40 },
    summary: {},
  };
  await assert.rejects(createScenarioReport(stale), /current storage analysis/);
});

test(
  "report records independent DC, inverter and export limits and separates clipping from grid curtailment",
  { skip: parser.status !== 0 },
  async () => {
    const args = fixture();
    args.system = {
      ...args.system,
      kwp: 20,
      inverterAcKw: 15,
      gridExportLimitKw: 5,
    };
    args.analysis.summary = {
      ...args.analysis.summary,
      shadedInverterClippingKwh: 350,
      curtailedKwh: 600,
    };
    args.analysis.annual = [{ year: 2025, ...args.analysis.summary }];
    const doc = await createScenarioReport(args);
    const pdf = inspect(doc);
    assert.equal(pdf.pages, 3);
    const text = pdf.text.join("\n");
    for (const phrase of [
      "20 kWp DC",
      "Inverter AC limit",
      "15 kW",
      "Grid export limit",
      "5 kW",
      "Inverter clipping: 350 kWh",
      "curtailment without battery: 600 kWh",
      "Hourly-average clipping",
    ])
      assert.ok(text.includes(phrase), phrase);
    assert.ok(!text.includes("No inverter clipping"));
  },
);
