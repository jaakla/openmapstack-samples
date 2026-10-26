import { polygonMetrics } from "./analysis.js";
import { DEFAULT_STORAGE } from "./storage.js";

const C = {
  ink: "#192c23",
  green: "#24583c",
  leaf: "#78a84d",
  lime: "#d2eb83",
  mist: "#f3f6f3",
  muted: "#68766e",
  line: "#dde3df",
  white: "#ffffff",
};
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const num = (value, digits = 0) =>
  finite(value)
    ? new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(
        value,
      )
    : "—";
const pct = (value) => (finite(value) ? `${num(value, 1)}%` : "Unknown");
const money = (value) =>
  finite(value) ? `${value < 0 ? "−" : ""}€${num(Math.abs(value))}` : "—";
const safe = (value, fallback = "Not available") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
const stamp = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Tallinn",
    timeZoneName: "short",
  }).format(new Date(value));

/** A shareable report of this exact scenario. Raw imported meter rows and customer metadata are never serialized. */
export async function createScenarioReport({
  project = {},
  system = {},
  polygon,
  analysis,
  horizon,
  consumption,
  storage,
  mapImage,
  scenarioState,
  createdAt = new Date(),
} = {}) {
  if (!analysis?.summary)
    throw new Error("Run the scenario analysis before exporting a report.");
  if (!Number.isFinite(new Date(createdAt).getTime()))
    throw new Error("Report creation date is invalid.");
  const [{ jsPDF }, fonts] = await Promise.all([
    import("jspdf"),
    import("./report-font.js"),
  ]);
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  for (const [name, data, style] of [
    ["SolarAtlas-Regular.ttf", fonts.regular, "normal"],
    ["SolarAtlas-Bold.ttf", fonts.bold, "bold"],
  ]) {
    doc.addFileToVFS(name, data);
    doc.addFont(name, "SolarAtlas", style);
  }
  doc.setFont("SolarAtlas", "normal");
  doc.setCreationDate(new Date(createdAt));
  // PDF metadata is deliberately generic: no imported file name, account, address or pasted CSV.
  doc.setProperties({
    title: "Solar Atlas — PV scenario report",
    subject:
      "Historical PV planning, household energy and market-value estimate",
    author: "Solar Atlas",
    creator: "Solar Atlas / OpenMapStack",
    keywords: "PV, solar, planning, historical estimate",
  });
  const demand = analysis.consumption || consumption || {};
  const battery = analysis.storage || storage || {};
  const batteryConfig = battery.config || battery;
  const hasStorage = batteryConfig.enabled === true;
  const staleStorage =
    storage &&
    analysis.storage &&
    Object.keys(DEFAULT_STORAGE).some(
      (key) =>
        Object.hasOwn(storage, key) && storage[key] !== batteryConfig[key],
    );
  if ((hasStorage && !battery.summary) || staleStorage)
    throw new Error(
      "Run the current storage analysis before exporting a report.",
    );
  const totalPages = hasStorage ? 4 : 3;
  const liveContext = project.liveContext;
  const config = demand.config || demand;
  const profile = demand.provenance || {};
  const year =
    Number(typeof scenarioState === "object" ? scenarioState?.year : null) ||
    analysis.annual?.at(-1)?.year ||
    Number(analysis.monthly?.at(-1)?.month?.slice(0, 4)) ||
    project.canonical?.year;
  const summary =
    analysis.annual?.length > 1
      ? analysis.annual.find((row) => row.year === year) || analysis.summary
      : analysis.summary;
  const months = (analysis.monthly || [])
    .filter((row) => !year || row.month?.startsWith(String(year)))
    .slice(0, 12);
  const years = analysis.annual?.length
    ? analysis.annual.slice(0, 2)
    : [{ year: year || "Selected period", ...summary }];
  const state =
    typeof scenarioState === "string"
      ? scenarioState
      : scenarioState?.kind ||
        scenarioState?.state ||
        (scenarioState?.exploratory ? "exploratory" : "current scenario");
  let metrics;
  try {
    metrics = polygonMetrics(polygon);
  } catch {
    metrics = null;
  }
  const location = metrics
    ? `${num(metrics.latitude, 5)}° N · ${num(metrics.longitude, 5)}° E`
    : finite(system.latitude) && finite(system.longitude)
      ? `${num(system.latitude, 5)}° N · ${num(system.longitude, 5)}° E`
      : "Location unavailable";
  const width = 176,
    left = 17;

  function text(
    value,
    x,
    y,
    size = 9,
    color = C.ink,
    bold = false,
    options = {},
  ) {
    doc.setFont("SolarAtlas", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.text(String(value ?? ""), x, y, options);
  }
  function paragraph(
    value,
    x,
    y,
    maxWidth = width,
    size = 8,
    color = C.muted,
    lineHeight = 4.2,
    maxLines = Infinity,
  ) {
    doc.setFont("SolarAtlas", "normal");
    doc.setFontSize(size);
    let lines = doc.splitTextToSize(String(value ?? ""), maxWidth);
    if (lines.length > maxLines)
      lines = [
        ...lines.slice(0, maxLines - 1),
        `${lines[maxLines - 1].slice(0, -3)}…`,
      ];
    lines.forEach((line, i) => text(line, x, y + i * lineHeight, size, color));
    return y + lines.length * lineHeight;
  }
  function line(y, x = left, w = width) {
    doc.setDrawColor(C.line);
    doc.setLineWidth(0.25);
    doc.line(x, y, x + w, y);
  }
  function box(x, y, w, h, fill = C.mist) {
    doc.setFillColor(fill);
    doc.roundedRect(x, y, w, h, 2, 2, "F");
  }
  function section(label, y, detail) {
    text(label, left, y, 10.5, C.green, true);
    if (detail)
      text(detail, left + width, y, 7.4, C.muted, false, { align: "right" });
  }
  function brand(page, title, subtitle) {
    doc.setFillColor(C.green);
    doc.rect(0, 0, 210, 4, "F");
    doc.setDrawColor(C.green);
    doc.setLineWidth(0.45);
    doc.circle(20, 16, 2.5, "S");
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4;
      doc.line(
        20 + Math.cos(a) * 3.4,
        16 + Math.sin(a) * 3.4,
        20 + Math.cos(a) * 4.4,
        16 + Math.sin(a) * 4.4,
      );
    }
    text("Solar Atlas", 28, 18, 12, C.green, true);
    text("PV PLANNING REPORT", 193, 18, 7, C.muted, false, { align: "right" });
    text(title, left, 34, 23, C.green, true);
    paragraph(subtitle, left, 43, width, 8.3, C.muted, 4.2, 2);
  }
  function footer(page) {
    line(282);
    text(
      "Hypothetical planning estimate · no field calibration",
      left,
      288,
      7,
      C.muted,
    );
    text(
      `${year || "Historical replay"}  /  ${page} of ${totalPages}`,
      193,
      288,
      7,
      C.muted,
      false,
      { align: "right" },
    );
  }
  function metric(x, y, w, label, value, note, fill = C.mist, color = C.ink) {
    box(x, y, w, 29, fill);
    text(label, x + 4, y + 7, 7.5, color);
    doc.setFont("SolarAtlas", "bold");
    doc.setFontSize(18);
    const valueSize = Math.min(
      18,
      (18 * (w - 8)) / Math.max(1, doc.getTextWidth(value)),
    );
    text(value, x + 4, y + 18, valueSize, color, true);
    if (note) text(note, x + 4, y + 25, 7, color);
  }
  function footprintDiagram(x, y, w, h) {
    doc.setFillColor(C.mist);
    doc.rect(x, y, w, h, "F");
    doc.setDrawColor(C.line);
    doc.setLineWidth(0.2);
    for (let i = 1; i < 12; i += 1)
      doc.line(x + (i * w) / 12, y, x + (i * w) / 12, y + h);
    for (let i = 1; i < 6; i += 1)
      doc.line(x, y + (i * h) / 6, x + w, y + (i * h) / 6);
    if (metrics) {
      const ring = metrics.projectedRing;
      const xs = ring.map((p) => p[0]),
        ys = ring.map((p) => p[1]);
      const scale = Math.min(
        (w - 40) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
        (h - 24) / Math.max(1, Math.max(...ys) - Math.min(...ys)),
      );
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
        cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const points = ring.map(([a, b]) => [
        x + w / 2 + (a - cx) * scale,
        y + h / 2 - (b - cy) * scale,
      ]);
      doc.setFillColor(C.lime);
      doc.setDrawColor(C.green);
      doc.setLineWidth(0.6);
      doc.lines(
        points
          .slice(1)
          .map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]),
        points[0][0],
        points[0][1],
        [1, 1],
        "FD",
        true,
      );
      text(
        `${num(metrics.areaM2)} m²`,
        x + w / 2,
        y + h / 2 + 2,
        12,
        C.green,
        true,
        { align: "center" },
      );
    }
    text("N ↑", x + w - 12, y + 10, 9, C.green, true);
    text("Footprint diagram · metric projection", x + 4, y + h - 4, 7, C.muted);
  }

  brand(
    1,
    "Your PV scenario",
    `${year || "Historical"} weather & market replay · ${location}`,
  );
  box(left, 49, width, 9, C.green);
  text(
    `${String(state).replaceAll("-", " ")} · editable planning assumptions`,
    left + 4,
    55,
    7.6,
    C.white,
  );
  text(stamp(createdAt), 189, 55, 7.1, C.white, false, { align: "right" });
  const map = { x: left, y: 64, w: width, h: 85 };
  let imageDrawn = false,
    mapGraphicsOpen = false;
  if (mapImage) {
    try {
      const image =
        typeof mapImage === "string"
          ? mapImage
          : mapImage.dataUrl || mapImage.dataURL || mapImage.image;
      const properties = doc.getImageProperties(image);
      const corners =
        typeof mapImage === "object" ? mapImage.coordinates : null;
      const zoom =
        typeof mapImage === "object" && finite(mapImage.zoom)
          ? Math.max(1, Math.min(8, mapImage.zoom))
          : 1;
      const fit =
        typeof mapImage === "object" && mapImage.fit
          ? mapImage.fit
          : corners?.length === 4
            ? "cover"
            : "contain";
      const ratio =
        fit === "contain"
          ? Math.min(map.w / properties.width, map.h / properties.height)
          : Math.max(map.w / properties.width, map.h / properties.height) *
            zoom;
      const w = properties.width * ratio,
        h = properties.height * ratio;
      let x = map.x + (map.w - w) / 2,
        y = map.y + (map.h - h) / 2;
      const mercatorY = (lat) =>
        Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      if (fit !== "contain" && corners?.length === 4 && metrics) {
        x =
          map.x +
          map.w / 2 -
          ((metrics.longitude - corners[0][0]) /
            (corners[1][0] - corners[0][0])) *
            w;
        y =
          map.y +
          map.h / 2 -
          ((mercatorY(corners[0][1]) - mercatorY(metrics.latitude)) /
            (mercatorY(corners[0][1]) - mercatorY(corners[3][1]))) *
            h;
        x = Math.min(map.x, Math.max(map.x + map.w - w, x));
        y = Math.min(map.y, Math.max(map.y + map.h - h, y));
      }
      box(map.x, map.y, map.w, map.h, fit === "contain" ? C.white : C.mist);
      doc.saveGraphicsState();
      mapGraphicsOpen = true;
      doc.rect(map.x, map.y, map.w, map.h, null);
      doc.clip();
      doc.discardPath();
      doc.addImage(
        image,
        properties.fileType || "PNG",
        x,
        y,
        w,
        h,
        undefined,
        "FAST",
      );
      // Georeferenced aerial context keeps the actual hypothetical footprint at its source location.
      if (corners?.length === 4 && polygon?.coordinates?.[0]) {
        const ring = polygon.coordinates[0].map(([lon, lat]) => [
          x + ((lon - corners[0][0]) / (corners[1][0] - corners[0][0])) * w,
          y +
            ((mercatorY(corners[0][1]) - mercatorY(lat)) /
              (mercatorY(corners[0][1]) - mercatorY(corners[3][1]))) *
              h,
        ]);
        doc.setDrawColor(C.lime);
        doc.setLineWidth(0.9);
        ring
          .slice(1)
          .forEach((point, i) =>
            doc.line(ring[i][0], ring[i][1], point[0], point[1]),
          );
      }
      doc.restoreGraphicsState();
      mapGraphicsOpen = false;
      imageDrawn = true;
    } catch {
      if (mapGraphicsOpen)
        doc.restoreGraphicsState(); /* A failed map capture still produces a useful report. */
    }
  }
  if (!imageDrawn) footprintDiagram(map.x, map.y, map.w, map.h);
  const caption = imageDrawn
    ? (typeof mapImage === "object" && mapImage.caption) ||
      project.aerial?.attribution ||
      "Current scenario map · source context, hypothetical PV footprint"
    : "Map capture unavailable. The drawn footprint is shown in EPSG:3301; this diagram is not an aerial observation.";
  paragraph(caption, left, 155, width, 7, C.muted, 3.5, 2);
  section("Annual production", 172, "Same array · three modeled conditions");
  const mw = (width - 8) / 3;
  metric(
    left,
    178,
    mw,
    "Clear-sky reference",
    `${num(summary.clearKwh)} kWh`,
    "Modeled clear atmosphere",
  );
  metric(
    left + mw + 4,
    178,
    mw,
    "Weather adjusted",
    `${num(summary.weatherKwh)} kWh`,
    "ERA5 · before local shadows",
  );
  metric(
    left + 2 * (mw + 4),
    178,
    mw,
    "After local shadows",
    `${num(summary.shadedKwh)} kWh`,
    "Surface horizon estimate",
    C.green,
    C.white,
  );
  const shadowMoney = finite(summary.shadowNetBenefitLossEur)
    ? ` Shadow impact on household benefit${hasStorage ? " without storage" : ""}: ${money(summary.shadowNetBenefitLossEur)}/yr.`
    : finite(summary.shadowRevenueLossEur)
      ? ` Shadow impact on all-export revenue: ${money(summary.shadowRevenueLossEur)}/yr.`
      : "";
  const hasPowerLimit =
    system.inverterAcKw != null || system.gridExportLimitKw != null;
  paragraph(
    hasPowerLimit
      ? `Local shadows: ${num(summary.shadingLossKwh)} kWh (${pct(summary.shadingLossPct)}). Inverter clipping: ${num(summary.shadedInverterClippingKwh)} kWh. Grid-limit curtailment without battery: ${num(summary.curtailedKwh)} kWh. Specific yield before grid curtailment: ${num(summary.specificYieldKwhKwp)} kWh/kWp.`
      : `Local shadows: ${num(summary.shadingLossKwh)} kWh (${pct(summary.shadingLossPct)}) of modeled weather-adjusted production. Specific yield: ${num(summary.specificYieldKwhKwp)} kWh/kWp.${shadowMoney}`,
    left,
    215,
    width,
    8,
    C.muted,
    4.1,
    3,
  );
  section("Array parameters", 234, "Facing azimuth: north = 0°, east = 90°");
  const parameters = [
    ["Nominal capacity", `${num(system.kwp, 2)} kWp DC`],
    [
      "Inverter AC limit",
      finite(system.inverterAcKw)
        ? `${num(system.inverterAcKw, 2)} kW`
        : "Not specified",
    ],
    [
      "Grid export limit",
      finite(system.gridExportLimitKw)
        ? `${num(system.gridExportLimitKw, 2)} kW`
        : "Not specified",
    ],
    [
      "Tilt / facing azimuth",
      `${num(system.tiltDeg, 1)}° / ${num(system.azimuthDeg, 1)}°`,
    ],
    ["Height above terrain", `${num(system.mountingHeightM, 1)} m`],
    ["Electrical losses", `${num(system.systemLossPct, 1)}%`],
    ["Footprint area", `${num(metrics?.areaM2)} m²`],
    ["Export sales margin", `${num(system.salesMarginEurMWh, 1)} €/MWh`],
  ];
  parameters.forEach(([label, value], i) => {
    const x = left + (i % 4) * 45,
      y = 243 + Math.floor(i / 4) * 17;
    text(label, x, y, 7.1, C.muted);
    text(value, x, y + 6, 9.5, C.ink, true);
  });
  footer(1);

  doc.addPage();
  brand(
    2,
    "Consumption & value",
    "Local demand and PV · historical wholesale prices · comparison without storage",
  );
  const imported =
    config.mode === "csv-calendar" || config.mode === "csv-exact";
  box(left, 50, width, 25);
  text(
    imported
      ? "Imported historical consumption profile"
      : "Estimated day / night consumption",
    left + 4,
    57,
    9,
    C.green,
    true,
  );
  const profileText = imported
    ? `${safe(profile.format, "CSV profile")} · ${safe(profile.matchMethod, config.mode === "csv-calendar" ? "Repeated local calendar profile" : "Exact UTC intervals")} · ${safe(profile.timeZone || config.timeZone, "Europe/Tallinn")}`
    : `${num(config.dayKwh)} kWh/daytime + ${num(config.nightKwh)} kWh/night · ${String(config.dayStartHour ?? 7).padStart(2, "0")}:00–${String(config.dayEndHour ?? 23).padStart(2, "0")}:00 local day · ${safe(config.timeZone, "Europe/Tallinn")}`;
  const profileEnd = paragraph(
    profileText,
    left + 4,
    63,
    width - 8,
    7.4,
    C.muted,
    3.6,
    2,
  );
  if (imported && config.fillMissingWithEstimate) {
    paragraph(
      `Gap-fill assumption: ${num(config.dayKwh)} kWh/daytime + ${num(config.nightKwh)} kWh/night; local day ${String(config.dayStartHour ?? 7).padStart(2, "0")}:00–${String(config.dayEndHour ?? 23).padStart(2, "0")}:00 ${safe(config.timeZone, "Europe/Tallinn")}.`,
      left + 4,
      profileEnd,
      width - 8,
      7,
      C.muted,
      3.5,
      2,
    );
  }
  text(
    `Consumption coverage ${pct(summary.consumptionCoveragePct ?? demand.quality?.consumptionCoveragePct)} · ${num(summary.consumptionCoveredHours)} / ${num(summary.consumptionExpectedHours)} hours · ${num(summary.imputedHours ?? demand.quality?.imputedHours)} estimated gap hours`,
    left,
    82,
    7.2,
    C.muted,
  );
  const flows = [
    ["Demand", summary.consumptionKwh],
    ["PV used on site", summary.selfConsumedKwh],
    ["Grid import", summary.importKwh],
    ["Grid export", summary.exportKwh],
  ];
  flows.forEach(([label, value], i) => {
    const x = left + i * 45;
    text(label, x, 94, 7.6, C.muted);
    text(`${num(value)} kWh`, x, 103, 13.5, C.green, true);
  });
  text(
    `Self-consumption ${pct(summary.selfConsumptionPct)} · Self-sufficiency ${pct(summary.selfSufficiencyPct)}`,
    left,
    113,
    7.8,
    C.muted,
  );
  section(
    "Annual economic comparison",
    125,
    `Import adder ${num(config.importAdderEurMWh ?? 0, 1)} €/MWh · export margin ${num(system.salesMarginEurMWh, 1)} €/MWh`,
  );
  const cols = [left, 52, 88, 124, 159];
  [
    "Replay year",
    "Without PV",
    "With PV¹",
    "Benefit²",
    "Export receipts",
  ].forEach((v, i) => text(v, cols[i], 134, 7.3, C.muted));
  years.forEach((row, i) => {
    const y = 143 + i * 8;
    text(row.year, cols[0], y, 8.5, C.ink, true);
    [
      row.baselineImportCostEur,
      row.netGridCostEur,
      row.netBenefitEur,
      row.exportRevenueEur,
    ].forEach((v, j) =>
      text(money(v), cols[j + 1], y, 8.5, j === 2 ? C.green : C.ink, j === 2),
    );
  });
  const yAfterYears = 146 + years.length * 8;
  paragraph(
    "¹ Import cost less export receipts. ² Without-PV cost minus with-PV net grid cost; excludes investment, fixed charges, tax and financing. Missing coverage remains unknown (—), never zero.",
    left,
    yAfterYears,
    width,
    7,
    C.muted,
    3.5,
    2,
  );
  const chartTop = Math.max(169, yAfterYears + 12),
    chartHeight = 35;
  section(
    `Monthly energy · ${year || "selected year"}`,
    chartTop - 4,
    "Available AC kWh · before grid-limit curtailment",
  );
  const max = Math.max(
    1,
    ...months.flatMap((row) =>
      [row.clearKwh, row.weatherKwh, row.shadedKwh].filter(finite),
    ),
  );
  const chartLeft = 31,
    chartWidth = 160,
    baseline = chartTop + chartHeight;
  [0, 0.5, 1].forEach((ratio) => {
    doc.setDrawColor(C.line);
    doc.setLineWidth(0.15);
    doc.line(
      chartLeft,
      baseline - ratio * chartHeight,
      chartLeft + chartWidth,
      baseline - ratio * chartHeight,
    );
    text(
      num(max * ratio),
      28,
      baseline - ratio * chartHeight + 1,
      6,
      C.muted,
      false,
      { align: "right" },
    );
  });
  months.forEach((row, i) => {
    const step = chartWidth / Math.max(12, months.length),
      x = chartLeft + i * step + 2;
    [
      ["clearKwh", C.green],
      ["weatherKwh", C.leaf],
      ["shadedKwh", "#b0d18b"],
    ].forEach(([key, color], j) => {
      if (finite(row[key])) {
        doc.setFillColor(color);
        doc.rect(
          x + j * 2.8,
          baseline - (row[key] / max) * chartHeight,
          2.3,
          (row[key] / max) * chartHeight,
          "F",
        );
      }
    });
    text(
      MONTHS[Number(row.month?.slice(5, 7)) - 1] || "",
      x + 3.6,
      baseline + 4,
      6.2,
      C.muted,
      false,
      { align: "center" },
    );
  });
  let tableY = baseline + 14;
  const tx = [left, 45, 74, 104, 134, 164];
  [
    "Month",
    "Available PV",
    "Used on site",
    "Import kWh",
    "Export kWh",
    "Benefit €",
  ].forEach((v, i) => text(v, tx[i], tableY, 6.8, C.muted));
  line(tableY + 2);
  tableY += 7;
  months.forEach((row, i) => {
    const y = tableY + i * 4.3;
    if (i % 2 === 0) {
      doc.setFillColor(C.mist);
      doc.rect(left, y - 3.1, width, 4.3, "F");
    }
    [
      MONTHS[Number(row.month?.slice(5, 7)) - 1] || row.month,
      num(row.shadedKwh),
      num(row.selfConsumedKwh),
      num(row.importKwh),
      num(row.exportKwh),
      finite(row.netBenefitEur) ? num(row.netBenefitEur) : "—",
    ].forEach((v, j) => text(v, tx[j], y, 6.8, j === 5 ? C.green : C.ink));
  });
  footer(2);

  doc.addPage();
  brand(
    3,
    "Evidence & assumptions",
    "Read the coverage and model limits alongside the estimate.",
  );
  box(left, 50, width, 25, C.green);
  text(
    "Uncalibrated historical planning estimate",
    left + 4,
    58,
    10,
    C.white,
    true,
  );
  paragraph(
    `Weather coverage ${pct((summary.weatherHours / summary.expectedHours) * 100)} · price coverage ${pct((summary.pricedHours / summary.expectedHours) * 100)} · complete horizon rays ${pct(horizon?.coveragePct ?? analysis.quality?.horizonCoveragePct)}. Unobserved obstacles can add losses.`,
    left + 4,
    65,
    width - 8,
    7.5,
    C.white,
    4,
    2,
  );
  section("How this estimate works", 87);
  const methods = [
    "Clear sky: Haurwitz reference and Erbs decomposition. Hourly ERA5 irradiance is transposed to the tilted array with isotropic diffuse sky and ground reflection.",
    `Production: ${num(system.kwp, 2)} kWp DC, NOCT temperature adjustment and ${num(system.systemLossPct, 1)}% aggregate electrical/conversion loss. ${finite(system.inverterAcKw) ? `AC output capped at ${num(system.inverterAcKw, 2)} kW after losses.` : "No specified inverter AC cap."} Hourly-average clipping misses shorter peaks; no MPPT, snow or degradation model.${hasStorage ? " Storage comparison on page 4." : " Storage disabled."}`,
    `Local shade: ${num(horizon?.resolutionM ?? 5)} m surface grid, ${num(horizon?.sampleCount)} receiver samples and ${num(horizon?.radiusM)} m horizon radius. DSM treats buildings and trees as opaque; tree seasonality and electrical mismatch are unresolved.`,
    "Surface dates: DSM catalogue describes 2017–2020 acquisitions; exact local dates are unknown. The frozen surface can differ from the historical weather year and misses small objects.",
    imported
      ? `Consumption: ${safe(profile.seriesType, "imported grid-import profile")} matched by ${safe(profile.matchMethod, config.mode)}. Historical net grid import is a demand proxy; existing PV can make it smaller than gross household use.`
      : "Consumption: fixed local day/night totals distributed uniformly within each period. This assumed load shape is not a measured household profile.",
    `Valuation: import at EE spot plus ${num(config.importAdderEurMWh ?? 0, 1)} €/MWh; export at spot less ${num(system.salesMarginEurMWh, 1)} €/MWh, including negative prices. Quarter-hour 2025 prices are averaged hourly; all figures exclude investment and taxes.`,
  ];
  if (finite(system.gridExportLimitKw))
    methods[4] += ` Net exports capped at ${num(system.gridExportLimitKw, 2)} kW after local use; excess PV is curtailed.`;
  let my = 95;
  methods.forEach((value, i) => {
    text(`${String(i + 1).padStart(2, "0")}`, left, my, 7.2, C.leaf, true);
    my = paragraph(value, left + 8, my, width - 8, 7.4, C.ink, 3.8) + 3;
  });
  section(
    liveContext ? "Selected live source context" : "Source snapshots",
    my + 3,
  );
  let sy = my + 12;
  const groups = [
    [
      "Weather",
      /era5|weather/i,
      "Open-Meteo / Copernicus ERA5 · coarse reanalysis grid",
    ],
    [
      "Market",
      /prices|price/i,
      "Elering EE day-ahead · licence status unresolved",
    ],
    [
      "Surface",
      /^dsm$|^dtm$/,
      "Maa- ja Ruumiamet DSM / DTM · 5 m retained grid",
    ],
    [
      "Buildings",
      /building/i,
      "Maa- ja Ruumiamet ETAK · context, not PV detections",
    ],
    ["Imagery", /aerial/i, "Maa- ja Ruumiamet · rendered display context"],
  ];
  groups.forEach(([label, match, fallback]) => {
    const sources = (project.sources || []).filter((source) =>
      match.test(source.id),
    );
    text(label, left, sy, 7.2, C.green, true);
    text(fallback, left + 22, sy, 7.1, C.ink);
    const captured =
      sources[0]?.access?.retrieved_at || sources[0]?.retrieved_at;
    const hashes = sources
      .map((source) =>
        (source.pin?.sha256 || source.sha256)
          ?.replace(/^sha256:/, "")
          .slice(0, 10),
      )
      .filter(Boolean)
      .join(" / ");
    text(
      `${captured ? `Retrieved ${captured.slice(0, 10)}` : "See source provenance"}${hashes ? ` · SHA-256 ${hashes}` : ""}`,
      left + 22,
      sy + 4,
      6.1,
      C.muted,
    );
    if (sources[0]?.source_url)
      doc.link(left, sy - 3, width, 8, { url: sources[0].source_url });
    sy += 12;
  });
  paragraph(
    liveContext
      ? `Selected area: ${safe(liveContext.name, "Exploratory Estonian context")}. Live response hashes and retrieval records describe this context; the parent pinned run does not validate it. Aerial PV detection and installation inventory accuracy remain untested.`
      : "Government solar records in the checked application are municipal counts, not installations. Aerial detection and installation inventory accuracy have not been evaluated. Full source URLs, licences and SHA-256 pins remain in the project manifest.",
    left,
    sy + 1,
    width,
    7.1,
    C.muted,
    3.8,
    3,
  );
  const creditY = Math.min(265, Math.max(sy + 19, 252));
  line(creditY - 4);
  const author = project.author || project.project?.author || {};
  const toolkitUrl =
    project.generated_with?.url ||
    project.project?.generated_with?.url ||
    "https://jaakla.github.io/openmapstack-skills/";
  text(
    "Generated with AI using the free OpenMapStack toolkit",
    left,
    creditY + 1,
    7.1,
    C.green,
    true,
  );
  doc.link(left, creditY - 2, 107, 4, { url: toolkitUrl });
  text(
    `Project author: ${safe(author.name, "Not supplied")} · Solar Atlas`,
    left,
    creditY + 6,
    7,
    C.green,
  );
  const authorUrl =
    author.url || (author.email ? `mailto:${author.email}` : null);
  if (authorUrl) doc.link(left, creditY + 3, 107, 4, { url: authorUrl });
  text(
    `${liveContext ? "Parent pinned run" : "Source run"}: ${safe(project.run?.id, "Interactive scenario")} · ${safe(project.run?.completed_at, "Run time not supplied")}`,
    left,
    creditY + 11,
    6.3,
    C.muted,
  );
  text(
    `Report exported: ${stamp(createdAt)} · Current parameters and footprint are captured here.`,
    left,
    creditY + 16,
    6.7,
    C.muted,
  );
  footer(3);
  if (hasStorage) {
    doc.addPage();
    brand(
      4,
      "Battery storage",
      "Historical dispatch compared with the same PV and demand without storage",
    );
    const bs =
      battery.annual?.find((row) => row.year === year) || battery.summary;
    const bm = (battery.monthly || [])
      .filter((row) => !year || row.month?.startsWith(String(year)))
      .slice(0, 12);
    metric(
      left,
      50,
      mw,
      "Benefit versus no battery",
      money(bs.incrementalBenefitEur),
      "After explicit cycling cost",
      C.green,
      C.white,
    );
    metric(
      left + mw + 4,
      50,
      mw,
      "PV + storage benefit",
      money(bs.netBenefitEur),
      "Versus the no-PV import cost",
    );
    metric(
      left + 2 * (mw + 4),
      50,
      mw,
      "Storage conversion loss",
      `${num(bs.lossKwh)} kWh`,
      "Charge and discharge losses",
    );
    section(
      "Operating assumptions",
      90,
      `Coverage ${pct(bs.coveragePct)} · ${num(bs.coveredHours)} / ${num(bs.expectedHours)} h`,
    );
    const settings = [
      `Capacity ${num(batteryConfig.effectiveCapacityKwh, 2)} kWh (${safe(batteryConfig.capacityMode, "manual")}${batteryConfig.capacityMode === "auto" ? ": 2 × PV kWp" : ""}); reserve ${num(batteryConfig.reserveKwh, 2)} kWh (${pct(batteryConfig.reserveSocPct)}).`,
      `Charge / discharge limits ${num(batteryConfig.effectiveChargePowerKw, 2)} / ${num(batteryConfig.effectiveDischargePowerKw, 2)} kW; ${safe(batteryConfig.powerMode, "kW")} mode, configured current ${num(batteryConfig.chargeCurrentA)} / ${num(batteryConfig.dischargeCurrentA)} A, ${num(batteryConfig.phases)} phase, ${num(batteryConfig.voltageV)} V.`,
      `Round-trip efficiency ${pct(batteryConfig.roundTripEfficiencyPct)}; cycling cost ${num(batteryConfig.cyclingCostEurKwh, 3)} €/kWh discharged; grid charging ${batteryConfig.allowGridCharging ? "allowed" : "off"}; battery export ${batteryConfig.allowBatteryExport ? "allowed" : "off"}.`,
      `${batteryConfig.inverterConnection === "separate" ? "Separate battery inverter; the PV inverter limit applies to PV alone." : "Shared PV/battery AC output budget uses the configured inverter limit."} Net grid exports share the site export limit. No recovery of DC-clipped PV or full hybrid-inverter simulation.`,
      `Solver ${safe(battery.quality?.solver, "finite state historical optimization")}; ${num(batteryConfig.socSteps)} SOC steps; start / end SOC ${num(bs.socStartKwh, 2)} / ${num(bs.socEndKwh, 2)} kWh; maximum SOC ${num(bs.maxSocKwh, 2)} kWh.`,
    ];
    let by = 98;
    settings.forEach((value) => {
      by = paragraph(value, left, by, width, 7.1, C.ink, 3.7, 2) + 2;
    });
    const compareTop = Math.max(135, by + 3);
    section("Annual comparison", compareTop);
    const cx = [left, 80, 131, 164];
    ["Flow / value", "Without battery", "With battery", "Unit"].forEach(
      (value, i) => text(value, cx[i], compareTop + 8, 7, C.muted),
    );
    const comparisons = [
      ["Grid import", summary.importKwh, bs.importKwh, "kWh"],
      ["Grid export", summary.exportKwh, bs.exportKwh, "kWh"],
      [
        "Grid-limit PV curtailment",
        summary.curtailedKwh,
        bs.curtailedKwh,
        "kWh",
      ],
      [
        "PV serving local demand",
        summary.selfConsumedKwh,
        bs.pvSelfConsumedKwh,
        "kWh",
      ],
      [
        "Net operating cost",
        summary.netGridCostEur,
        bs.operatingCostEur,
        "EUR",
      ],
      ["Benefit versus no PV", summary.netBenefitEur, bs.netBenefitEur, "EUR"],
    ];
    comparisons.forEach(([label, before, after, unit], i) => {
      const y = compareTop + 16 + i * 5;
      [
        label,
        num(before, unit === "EUR" ? 2 : 1),
        num(after, unit === "EUR" ? 2 : 1),
        unit,
      ].forEach((value, j) =>
        text(value, cx[j], y, 7.1, j === 2 ? C.green : C.ink),
      );
    });
    const monthlyTop = compareTop + 54;
    section(
      "Monthly storage dispatch",
      monthlyTop,
      "Complete-period totals; unknown coverage remains —",
    );
    const bx = [left, 48, 83, 121, 159];
    [
      "Month",
      "Charge kWh",
      "Discharge kWh",
      "Loss kWh",
      "Extra benefit €",
    ].forEach((value, i) => text(value, bx[i], monthlyTop + 8, 7, C.muted));
    bm.forEach((row, i) => {
      const y = monthlyTop + 15 + i * 4.3;
      if (i % 2 === 0) {
        doc.setFillColor(C.mist);
        doc.rect(left, y - 3.1, width, 4.3, "F");
      }
      [
        MONTHS[Number(row.month?.slice(5, 7)) - 1] || row.month,
        num(row.chargeKwh),
        num(row.dischargeKwh),
        num(row.lossKwh),
        num(row.incrementalBenefitEur, 2),
      ].forEach((value, j) =>
        text(value, bx[j], y, 7, j === 4 ? C.green : C.ink),
      );
    });
    paragraph(
      "Historical prices are known in advance in this replay. Daily dispatch returns to reserve SOC and uses finite state resolution; this is not a live trading forecast. No battery purchase cost, financing, standing loss or degradation beyond the stated cycling cost is assumed. Missing demand or prices do not become zero.",
      left,
      258,
      width,
      7.1,
      C.muted,
      3.8,
      5,
    );
    footer(4);
  }
  return doc;
}

export async function downloadScenarioReport(args) {
  const createdAt = args?.createdAt || new Date();
  const doc = await createScenarioReport({ ...args, createdAt });
  const year =
    args?.scenarioState?.year ||
    args?.analysis?.annual?.at(-1)?.year ||
    "scenario";
  const filename = scenarioReportFilename(year, createdAt);
  await doc.save(filename, { returnPromise: true });
  return filename;
}

export function scenarioReportFilename(year, createdAt = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Tallinn",
  }).format(new Date(createdAt));
  return `solar-atlas-pv-${year}-${date}.pdf`;
}
