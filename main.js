// Bounds: [south, north, west, east]. Shared by the map and both regional charts.
const climateRegions = [
  { name: "Western North America", bounds: [30, 60, -130, -105], color: "#0072b2" },
  { name: "Europe", bounds: [35, 60, -10, 30], color: "#b8460c" },
  { name: "East Asia", bounds: [25, 50, 100, 145], color: "#087a59" },
  { name: "West Asia", bounds: [15, 40, 35, 65], color: "#8055ad" },
  { name: "West–Central Africa", bounds: [-5, 20, -20, 30], color: "#bb3870" }
];

// Read the annual regional anomalies once. The line chart and dumbbell reuse them.
let regionalWarmingPromise;
function loadRegionalWarming() {
  if (!regionalWarmingPromise) {
    regionalWarmingPromise = d3.csv("./regional_warming.csv", row => {
      const year = Number(row.year);
      const warming = Number(row.anomaly_c);
      if (!row.region || !row.scenario || !row.year?.trim() ||
          !row.anomaly_c?.trim() || !Number.isInteger(year) || !Number.isFinite(warming)) return null;
      return { region: row.region, scenario: row.scenario, year, warming };
    }).then(rows => {
      if (!rows.length) throw new Error("No valid regional warming data.");
      return rows;
    });
  }
  return regionalWarmingPromise;
}

// All comparison calculations live here in main.js.
// Each source value is already an area-weighted regional ANNUAL anomaly.
// delta is end minus start, not the mean anomaly within the selected interval.
function calculateRegionalChanges(rows, scenario, startYear, endYear) {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
    throw new Error("The start year must not be later than the end year.");
  }
  const relevant = rows.filter(row => row.scenario === scenario);
  const byRegion = d3.group(relevant, row => row.region);
  return climateRegions.map(region => {
    const values = byRegion.get(region.name) ?? [];
    const byYear = d3.rollup(values, group => d3.mean(group, row => row.warming), row => row.year);
    const start = byYear.get(startYear);
    const end = byYear.get(endYear);
    const interval = Array.from(byYear, ([year, value]) => ({ year, value }))
      .filter(row => row.year >= startYear && row.year <= endYear);
    const available = Number.isFinite(start) && Number.isFinite(end);
    return { ...region, start, end,
      delta: available ? end - start : undefined,
      periodMean: d3.mean(interval, row => row.value),
      available, startYear, endYear,
      observedYears: interval.length,
      expectedYears: endYear - startYear + 1
    };
  });
}

const mapWidth = 1100;
const mapHeight = 600;
const mapMargin = { top: 20, right: 25, bottom: 50, left: 60 };

const mapSvg = d3.select("#chart")
  .attr("viewBox", `0 0 ${mapWidth} ${mapHeight}`);

const mapTooltip = d3.select("#tooltip");
const mapScenarioSelect = document.querySelector("#scenario-select");
const mapSlider = document.querySelector("#year-slider");
const mapYearLabel = document.querySelector("#year-label");
const mapTitle = document.querySelector("#chart-title");
const mapStatus = document.querySelector("#status");

const mapScenarioNames = {
  historical: "Historical",
  ssp126: "SSP1-2.6",
  ssp585: "SSP5-8.5"
};

const missingColor = "#e7ebe5";
const mapX = d3.scaleLinear([-180, 180], [mapMargin.left, mapWidth - mapMargin.right]);
const mapY = d3.scaleLinear([-90, 90], [mapHeight - mapMargin.bottom, mapMargin.top]);

function lonText(value) {
  return value === 0 ? "0°" : `${Math.abs(value)}°${value < 0 ? "W" : "E"}`;
}

function latText(value) {
  return value === 0 ? "0°" : `${Math.abs(value)}°${value < 0 ? "S" : "N"}`;
}

mapSvg.append("rect")
  .attr("x", mapX(-180))
  .attr("y", mapY(90))
  .attr("width", mapX(180) - mapX(-180))
  .attr("height", mapY(-90) - mapY(90))
  .attr("fill", missingColor);

const mapCellsLayer = mapSvg.append("g");

mapSvg.append("g")
  .attr("transform", `translate(0,${mapY(-90)})`)
  .call(
    d3.axisBottom(mapX)
      .tickValues([-180, -120, -60, 0, 60, 120, 180])
      .tickFormat(lonText)
  );

mapSvg.append("g")
  .attr("transform", `translate(${mapX(-180)},0)`)
  .call(
    d3.axisLeft(mapY)
      .tickValues([-90, -60, -30, 0, 30, 60, 90])
      .tickFormat(latText)
  );

const mapRegionsLayer = mapSvg.append("g").attr("pointer-events", "none");

let mapData;
let mapYears = [];
let mapColor;
let mapCells;
let mapTemperatures;

function getSelectedMapYear() {
  return mapYears[Number(mapSlider.value)];
}

function selectMapYear(year) {
  const index = mapYears.indexOf(year);
  if (index < 0) return false;

  mapSlider.value = String(index);
  drawMapYear();
  return true;
}

function drawMapRegions(regions) {
  mapRegionsLayer.selectAll("rect")
    .data(regions, region => region.name)
    .join("rect")
    .attr("x", region => mapX(region.bounds[2]))
    .attr("y", region => mapY(region.bounds[1]))
    .attr("width", region => mapX(region.bounds[3]) - mapX(region.bounds[2]))
    .attr("height", region => mapY(region.bounds[0]) - mapY(region.bounds[1]))
    .attr("fill", "none")
    .attr("stroke", region => region.color)
    .attr("stroke-width", region => region.focused ? 3 : 1.5)
    .attr("opacity", region => region.muted ? 0.3 : 1)
    .attr("stroke-dasharray", "5 3")
    .attr("vector-effect", "non-scaling-stroke");
}

function getEdges(values, minimum, maximum) {
  return new Map(values.map((value, index) => {
    const previous = values[index - 1];
    const next = values[index + 1];
    const lowerGap = value - (previous ?? value - ((next ?? value + 1) - value));
    const upperGap = (next ?? value + lowerGap) - value;

    return [value, [
      Math.max(minimum, value - lowerGap / 2),
      Math.min(maximum, value + upperGap / 2)
    ]];
  }));
}

function drawMapLegend(minTemp, maxTemp) {
  const legend = d3.select("#legend").attr("viewBox", "0 0 520 60");
  const steps = 240;
  const legendWidth = 480;
  const legendScale = d3.scaleLinear([minTemp, maxTemp], [20, 500]);

  legend.selectAll("*").remove();

  legend.append("text")
    .attr("x", 20)
    .attr("y", 13)
    .attr("font-size", 13)
    .attr("fill", "#465d54")
    .text("July temperature (°C)");

  legend.selectAll("rect")
    .data(d3.range(steps))
    .join("rect")
    .attr("x", step => 20 + step * legendWidth / steps)
    .attr("y", 20)
    .attr("width", legendWidth / steps + 0.1)
    .attr("height", 12)
    .attr("fill", step => mapColor(
      minTemp + step / (steps - 1) * (maxTemp - minTemp)
    ));

  legend.append("g")
    .attr("transform", "translate(0,33)")
    .call(d3.axisBottom(legendScale).ticks(6).tickSize(3));
}

function changeMapScenario() {
  const previousYear = getSelectedMapYear();
  const scenario = mapScenarioSelect.value;
  const comparisonYears = isComparingMaps()
    ? mapData.get("ssp585")
    : null;
  mapYears = Array.from(mapData.get(scenario).keys())
    .filter(year => !comparisonYears || comparisonYears.has(year))
    .sort((a, b) => a - b);

  mapSlider.max = mapYears.length - 1;
  mapSlider.value = String(Math.max(0, mapYears.indexOf(previousYear)));
  mapSlider.disabled = mapYears.length < 2;

  drawMapYear();
  document.dispatchEvent(new Event("map-scenario-change"));
}

function drawMapYear() {
  const scenario = mapScenarioSelect.value;
  const year = getSelectedMapYear();
  const rows = mapData.get(scenario).get(year);

  mapTitle.textContent = isComparingMaps() ? `July ${year}` : `July ${year} — ${mapScenarioNames[scenario] ?? scenario}`;
  mapYearLabel.textContent = year;
  mapSlider.setAttribute("aria-valuetext", String(year));
  clearMapInspection();

  mapTemperatures = d3.rollup(
    rows,
    values => d3.mean(values, row => row.temperature_c),
    row => `${row.lat},${row.lon}`
  );

  mapCells.attr("fill", cell => {
    const temperature = mapTemperatures.get(cell.key);
    return Number.isFinite(temperature) ? mapColor(temperature) : missingColor;
  });

  drawSecondMap(year);
  document.dispatchEvent(new Event("map-year-change"));
}

function positionMapTooltip(event) {
  const node = mapTooltip.node();
  const left = Math.max(8, Math.min(event.clientX + 12, window.innerWidth - node.offsetWidth - 8));
  const top = Math.max(8, Math.min(event.clientY + 12, window.innerHeight - node.offsetHeight - 8));

  mapTooltip.style("left", `${left}px`).style("top", `${top}px`);
}

function parseMapRow(row) {
  const date = String(row.time).match(/^(\d{4,})-(\d{2})-\d{2}/);
  if (!date || Number(date[2]) !== 7) return null;

  const rawLat = String(row.lat ?? "").trim();
  const rawLon = String(row.lon ?? "").trim();
  const lat = Number(rawLat);
  const longitude = Number(rawLon);

  if (
    !rawLat || !rawLon ||
    !Number.isFinite(lat) || !Number.isFinite(longitude) ||
    lat < -90 || lat > 90 || longitude < -180 || longitude > 360
  ) {
    return null;
  }

  const lon = ((longitude + 180) % 360 + 360) % 360 - 180;
  const rawTemperature = String(row.temperature_c ?? "").trim();
  const temperature = rawTemperature ? Number(rawTemperature) : NaN;

  return {
    year: Number(date[1]),
    lat,
    lon: Number(lon.toFixed(8)),
    temperature_c: Number.isFinite(temperature) ? temperature : NaN,
    scenario: String(row.scenario ?? "").trim()
  };
}

async function loadMap() {
  try {
    const response = await fetch("./july_temperature_2100.csv.gz");
    if (!response.ok) throw new Error(`Temperature data request failed (${response.status}).`);

    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const csvText = await new Response(stream).text();
    const rows = d3.csvParse(csvText, parseMapRow);

    const [lowest, highest] = d3.extent(rows, row => (
      Number.isFinite(row.temperature_c) ? row.temperature_c : undefined
    ));
    if (lowest === undefined) throw new Error("No valid July temperatures found.");

    let minTemp = Math.floor(lowest / 5) * 5;
    let maxTemp = Math.ceil(highest / 5) * 5;

    if (minTemp === maxTemp) {
      minTemp -= 5;
      maxTemp += 5;
    }

    const intermediateStops = [
      [-40, "#4b8fc1"],
      [0, "#e1eff4"],
      [15, "#f9dc79"],
      [30, "#e8773d"]
    ];

    const temperatureStops = [
      [minTemp, "#253494"],
      ...intermediateStops.filter(([temperature]) => temperature > minTemp && temperature < maxTemp),
      [maxTemp, "#a50026"]
    ];

    mapColor = d3.scaleLinear()
      .domain(temperatureStops.map(([temperature]) => temperature))
      .range(temperatureStops.map(([, fill]) => fill))
      .interpolate(d3.interpolateLab)
      .clamp(true);

    drawMapLegend(minTemp, maxTemp);

    const latitudes = Array.from(new Set(rows.map(row => row.lat))).sort((a, b) => a - b);
    const longitudes = Array.from(new Set(rows.map(row => row.lon))).sort((a, b) => a - b);
    const latEdges = getEdges(latitudes, -90, 90);
    const lonEdges = getEdges(longitudes, -180, 180);
    const grid = [];

    for (const lat of latitudes) {
      for (const lon of longitudes) {
        grid.push({ lat, lon, key: `${lat},${lon}` });
      }
    }

    mapCells = mapCellsLayer.selectAll("rect")
      .data(grid, cell => cell.key)
      .join("rect")
      .attr("x", cell => mapX(lonEdges.get(cell.lon)[0]))
      .attr("y", cell => mapY(latEdges.get(cell.lat)[1]))
      .attr("width", cell => {
        const [left, right] = lonEdges.get(cell.lon);
        return mapX(right) - mapX(left);
      })
      .attr("height", cell => {
        const [bottom, top] = latEdges.get(cell.lat);
        return mapY(bottom) - mapY(top);
      })
      .on("pointerenter", inspectMapCell)
      .on("pointermove", positionMapTooltip)
      .on("pointerleave", clearMapInspection)
      .on("click", inspectMapCell);

    mapData = d3.group(rows, row => row.scenario, row => row.year);
    const scenarios = Array.from(mapData.keys()).sort();

    d3.select(mapScenarioSelect)
      .selectAll("option")
      .data(scenarios)
      .join("option")
      .attr("value", scenario => scenario)
      .text(scenario => mapScenarioNames[scenario] ?? scenario);

    mapScenarioSelect.value = scenarios.includes("ssp585") ? "ssp585" : scenarios[0];
    mapScenarioSelect.disabled = false;

    syncMapMode();
    mapStatus.textContent = `${latitudes.length} × ${longitudes.length} grid cells · Gray indicates missing data.`;
  } catch (error) {
    console.error(error);
    mapTitle.textContent = "Could not load the map";
    mapStatus.textContent = error.message;
  }
}

mapScenarioSelect.addEventListener("change", changeMapScenario);
mapSlider.addEventListener("input", drawMapYear);

const mapModeSelect = document.querySelector("#map-view");
const mapPair = document.querySelector("#map-pair");
const lowMapHeading = document.querySelector("#low-map-heading");
const highMapPanel = document.querySelector("#high-map-panel");
const mapScenarioField = mapScenarioSelect.closest(".field");

let previousSingleScenario;
let secondMapCells;
let secondMapRegions;
let secondMapTemperatures;

let secondMapOutline;

const mapOutline = appendCellOutline(mapSvg);

function appendCellOutline(svg) {
  return svg.append("rect")
    .attr("class", "map-cell-outline")
    .attr("display", "none")
    .attr("fill", "none")
    .attr("stroke", "#172c28")
    .attr("stroke-width", 2)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("pointer-events", "none");
}

function clearMapInspection() {
  mapTooltip.property("hidden", true);
  mapOutline.attr("display", "none");
  secondMapOutline?.attr("display", "none");
}

function inspectMapCell(event, cell) {
  const low = mapTemperatures.get(cell.key);
  const format = value => Number.isFinite(value) ? `${value.toFixed(2)} °C` : "Missing";
  const location = `July ${getSelectedMapYear()} · ${latText(cell.lat)}, ${lonText(cell.lon)}`;
  const lines = [location];

  if (isComparingMaps()) {
    const high = secondMapTemperatures.get(cell.key);
    const difference = Number.isFinite(low) && Number.isFinite(high)
      ? `${d3.format("+.2f")(high - low)} °C`
      : "Unavailable";
    lines.push(`SSP1-2.6: ${format(low)}`, `SSP5-8.5: ${format(high)}`,
      `Difference (SSP5-8.5 − SSP1-2.6): ${difference}`);

    for (const outline of [mapOutline, secondMapOutline]) {
      for (const attribute of ["x", "y", "width", "height"]) {
        outline.attr(attribute, event.currentTarget.getAttribute(attribute));
      }
      outline.attr("display", null);
    }
  } else {
    lines.push(format(low));
  }

  mapTooltip.text(lines.join("\n")).property("hidden", false);
  positionMapTooltip(event);
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") clearMapInspection();
});

function isComparingMaps() {
  return mapModeSelect.value === "scenarios" &&
    mapData?.has("ssp126") && mapData?.has("ssp585");
}

function syncMapMode() {
  if (!mapData) return;

  const compare = isComparingMaps();
  mapPair.classList.toggle("is-comparing", compare);
  mapScenarioField.hidden = compare;
  lowMapHeading.hidden = !compare;
  highMapPanel.hidden = !compare;
  document.querySelector("#map-inspect-hint").hidden = !compare;

  if (compare && previousSingleScenario === undefined) {
    previousSingleScenario = mapScenarioSelect.value;
    mapScenarioSelect.value = "ssp126";
  } else if (!compare && previousSingleScenario !== undefined) {
    mapScenarioSelect.value = previousSingleScenario;
    previousSingleScenario = undefined;
  }

  mapSvg.attr("aria-label", compare
    ? "July surface air temperature under SSP1-2.6"
    : "World map of July surface air temperature");

  changeMapScenario();
}

function createSecondMap() {
  const original = mapSvg.node();
  const clone = original.cloneNode(true);
  clone.removeAttribute("id");
  clone.setAttribute("aria-label", "July surface air temperature under SSP5-8.5");
  highMapPanel.append(clone);

  const cellLayerIndex = Array.from(original.children).indexOf(mapCellsLayer.node());
  const regionLayerIndex = Array.from(original.children).indexOf(mapRegionsLayer.node());
  secondMapRegions = clone.children[regionLayerIndex];
  secondMapOutline = d3.select(clone).select(".map-cell-outline");
  secondMapCells = d3.select(clone.children[cellLayerIndex])
    .selectAll("rect")
    .data(mapCells.data());

  secondMapCells
    .on("pointerenter", inspectMapCell)
      .on("pointermove", positionMapTooltip)
      .on("pointerleave", clearMapInspection)
      .on("click", inspectMapCell);
}

function syncSecondMapRegions() {
  if (!secondMapRegions) return;

  const outlines = Array.from(mapRegionsLayer.node().children, outline => outline.cloneNode(true));
  secondMapRegions.replaceChildren(...outlines);
}

function drawSecondMap(year) {
  if (!isComparingMaps()) return;
  if (!secondMapCells) createSecondMap();

  const rows = mapData.get("ssp585").get(year);
  secondMapTemperatures = d3.rollup(
    rows,
    values => d3.mean(values, row => row.temperature_c),
    row => `${row.lat},${row.lon}`
  );

  secondMapCells.attr("fill", cell => {
    const temperature = secondMapTemperatures.get(cell.key);
    return Number.isFinite(temperature) ? mapColor(temperature) : missingColor;
  });

  syncSecondMapRegions();
}

mapModeSelect.addEventListener("change", syncMapMode);
loadMap();

// Dumbbell chart: compare all five regional annual means at two selected years.
// The source CSV supplies annual anomalies; no annual means are inferred from July data.
let regionalComparison;

async function initDumbbellChart() {
  const chart = d3.select("#dumbbell-chart");
  if (chart.empty()) return;
  const scenarioField = document.querySelector("#dumbbell-scenario");
  const startField = document.querySelector("#dumbbell-start");
  const endField = document.querySelector("#dumbbell-end");
  const message = document.querySelector("#dumbbell-message");
  let rows;
  try {
    rows = await loadRegionalWarming();
  } catch (error) {
    message.textContent = `Could not load annual regional data: ${error.message}`;
    return;
  }
  const scenarios = Array.from(new Set(rows.map(row => row.scenario))).sort();
  d3.select(scenarioField).selectAll("option").data(scenarios).join("option")
    .attr("value", value => value).text(value => mapScenarioNames[value] ?? value);
  const scenarioControl = document.querySelector("#regional-scenario-field");
  scenarioField.value = scenarios.includes(mapScenarioSelect.value) ? mapScenarioSelect.value
    : scenarios.includes("ssp585") ? "ssp585" : scenarios[0];
  let availableYears = [];
  // A common x domain across scenarios and year ranges prevents scale changes from
  // making small differences look larger. A little room left of 0 accommodates negatives.
  const minAnomaly = Math.min(-0.5, d3.min(rows, row => row.warming));
  const maxAnomaly = Math.max(1, d3.max(rows, row => row.warming));
  const axisMin = Math.floor(minAnomaly * 2) / 2;
  const axisMax = Math.ceil((maxAnomaly + 0.3) * 2) / 2;
  const tooltip = d3.select("body").append("div").property("hidden", true)
    .attr("class", "dumbbell-tooltip").attr("role", "tooltip")
    .style("position", "fixed").style("z-index", 4).style("pointer-events", "none")
    .style("max-width", "calc(100vw - 16px)").style("padding", "9px 12px")
    .style("background", "#18352e").style("color", "white")
    .style("border-radius", "7px").style("font-size", "13px").style("white-space", "pre-line");
  const signed = d3.format("+.2f");

  function hideTooltip() { tooltip.property("hidden", true); }
  function showTooltip(event, comparison) {
    const details = comparison.available
      ? `${comparison.name}\n${comparison.startYear}: ${signed(comparison.start)} °C\n` +
        `${comparison.endYear}: ${signed(comparison.end)} °C\n` +
        `End − start: ${signed(comparison.delta)} °C\n` +
        `Mean anomaly within interval: ${signed(comparison.periodMean)} °C\n` +
        `Available years: ${comparison.observedYears}/${comparison.expectedYears}`
      : `${comparison.name}\nAnnual regional data missing for one or both selected years.`;
    tooltip.text(details).property("hidden", false);
    const anchor = event.currentTarget.getBoundingClientRect();
    const clientX = Number.isFinite(event.clientX) ? event.clientX : anchor.left + anchor.width / 2;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : anchor.bottom;
    const box = tooltip.node();
    tooltip.style("left", `${Math.max(8, Math.min(clientX + 14, innerWidth - box.offsetWidth - 8))}px`)
      .style("top", `${Math.max(8, Math.min(clientY + 14, innerHeight - box.offsetHeight - 8))}px`);
  }

  function render() {
    hideTooltip();
    document.querySelector("#endpoint-map-status").textContent = "";
    if (!availableYears.length) return;
    const startYear = availableYears[Number(startField.value)];
    const endYear = availableYears[Number(endField.value)];
    document.querySelector("#dumbbell-start-label").textContent = startYear;
    document.querySelector("#dumbbell-end-label").textContent = endYear;
    startField.setAttribute("aria-valuetext", String(startYear));
    endField.setAttribute("aria-valuetext", String(endYear));
    regionalComparison = { scenario: scenarioField.value, startYear, endYear };
    document.dispatchEvent(new Event("regional-interval-change"));
    const comparisons = calculateRegionalChanges(rows, scenarioField.value, startYear, endYear);
    const width = Math.max(320, chart.node().clientWidth);
    const height = 350;
    const left = width < 480 ? 132 : 178;
    const right = width - 71;
    const top = 35, bottom = 289;
    const x = d3.scaleLinear([axisMin, axisMax], [left, right]);
    const y = d3.scalePoint(climateRegions.map(region => region.name), [top + 20, bottom - 34]);
    chart.attr("viewBox", `0 0 ${width} ${height}`);
    chart.selectAll("*").remove();
    chart.append("title").text(`${mapScenarioNames[scenarioField.value] ?? scenarioField.value}: ${startYear} to ${endYear}`);

    const ticks = Array.from(new Set([...x.ticks(width < 480 ? 4 : 7), 0])).sort((a, b) => a - b);
    chart.append("g").attr("transform", `translate(0,${bottom})`)
      .call(d3.axisBottom(x).tickValues(ticks).tickSize(-(bottom - top)).tickPadding(8))
      .call(axis => axis.select(".domain").attr("stroke", "#899e94"))
      .call(axis => axis.selectAll(".tick line").attr("stroke", "#e3eae5"));
    chart.append("line").attr("class", "dumbbell-zero")
      .attr("x1", x(0)).attr("x2", x(0)).attr("y1", top).attr("y2", bottom)
      .attr("stroke", "#526b5e").attr("stroke-width", 1.2).attr("stroke-dasharray", "4 3");
    chart.append("text").attr("x", x(0)).attr("y", 20).attr("text-anchor", "middle")
      .attr("font-size", 11).attr("fill", "#465d54").text("Baseline 0°C");
    chart.append("text").attr("x", width - 6).attr("y", 20).attr("text-anchor", "end")
      .attr("font-size", 11).attr("fill", "#465d54").text("Δ (°C)");
    chart.append("text").attr("x", (left + right) / 2).attr("y", height - 8)
      .attr("text-anchor", "middle").attr("font-size", 12)
      .text("Annual temperature anomaly (°C)");

    const groups = chart.selectAll(".dumbbell-row").data(comparisons).join("g")
      .attr("class", "dumbbell-row").attr("transform", row => `translate(0,${y(row.name)})`)
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", row => row.available
        ? `${row.name}: ${startYear}, ${signed(row.start)} degrees; ${endYear}, ${signed(row.end)} degrees; change ${signed(row.delta)} degrees`
        : `${row.name}: annual data missing`)
      .on("pointerenter", showTooltip).on("pointermove", showTooltip)
      .on("pointerleave", hideTooltip).on("focus", showTooltip).on("blur", hideTooltip)
      .on("click", (_, row) => focusRegion(row.name))
      .on("keydown", (event, row) => {
        if (event.key === "Escape") hideTooltip();
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusRegion(row.name);
      });
    groups.append("rect").attr("x", 0).attr("y", -23).attr("width", width).attr("height", 46)
      .attr("fill", "transparent");
    groups.append("text").attr("x", left - 12).attr("y", 4).attr("text-anchor", "end")
      .attr("font-size", width < 480 ? 10 : 12).attr("fill", row => row.color)
      .text(row => width < 480 && row.name === "Western North America" ? "W. North America" : row.name);
    const valid = groups.filter(row => row.available);
    valid.append("line").attr("class", "dumbbell-connector")
      .attr("x1", row => x(row.start)).attr("x2", row => x(row.end))
      .attr("stroke", row => row.color).attr("stroke-width", 3).attr("stroke-opacity", 0.65);
    valid.append("circle").attr("class", "dumbbell-start-dot")
      .attr("cx", row => x(row.start)).attr("r", 5.5).attr("fill", "white")
      .attr("stroke", row => row.color).attr("stroke-width", 2);
    valid.append("circle").attr("class", "dumbbell-end-dot")
      .attr("cx", row => x(row.end)).attr("r", 5.5).attr("fill", row => row.color)
      .attr("stroke", "white").attr("stroke-width", 0.8);
    valid.append("text").attr("class", "dumbbell-start-value")
      .attr("x", row => x(row.start)).attr("y", -11).attr("text-anchor", "middle")
      .attr("font-size", 10).attr("fill", "#465d54").text(row => signed(row.start));
    valid.append("text").attr("class", "dumbbell-end-value")
      .attr("x", row => x(row.end)).attr("y", 20).attr("text-anchor", "middle")
      .attr("font-size", 10).attr("fill", row => row.color).text(row => signed(row.end));
    valid.append("text").attr("class", "dumbbell-delta")
      .attr("x", width - 6).attr("y", 4).attr("text-anchor", "end")
      .attr("font-size", 12).attr("fill", row => row.color).text(row => signed(row.delta));
    groups.filter(row => !row.available).append("text")
      .attr("x", x(0) + 8).attr("y", 4).attr("font-size", 11).attr("fill", "#7b8c81")
      .text("Annual data unavailable");
    const missing = comparisons.filter(row => !row.available).map(row => row.name);
    message.textContent = `${mapScenarioNames[scenarioField.value] ?? scenarioField.value} · ${startYear}–${endYear}. ` +
      (missing.length ? `Missing annual data: ${missing.join(", ")}.`
        : "Open dot: start year; filled dot: end year. Δ is the change between the two annual regional means.");
  }

  function focusRegion(region) {
    document.dispatchEvent(new CustomEvent("regional-focus", { detail: region }));
  }

  function setScenario() {
    const previousStart = availableYears[Number(startField.value)];
    const previousEnd = availableYears[Number(endField.value)];
    availableYears = Array.from(new Set(rows.filter(row => row.scenario === scenarioField.value)
      .map(row => row.year))).sort((a, b) => a - b);
    const startIndex = availableYears.indexOf(previousStart);
    const endIndex = availableYears.indexOf(previousEnd);
    startField.max = endField.max = availableYears.length - 1;
    startField.value = String(startIndex >= 0 ? startIndex : 0);
    endField.value = String(endIndex >= 0 ? endIndex : availableYears.length - 1);
    if (+startField.value > +endField.value) startField.value = endField.value;
    startField.disabled = endField.disabled = availableYears.length < 2;
    render();
  }
  startField.addEventListener("input", () => {
    if (+startField.value > +endField.value) endField.value = startField.value;
    render();
  });
  endField.addEventListener("input", () => {
    if (+endField.value < +startField.value) startField.value = endField.value;
    render();
  });
  scenarioField.addEventListener("change", setScenario);
  function syncRegionalScenario() {
    const comparing = isComparingMaps();
    scenarioControl.hidden = !comparing;
    scenarioField.disabled = !comparing;
    if (!comparing && scenarios.includes(mapScenarioSelect.value)) {
      scenarioField.value = mapScenarioSelect.value;
    } else if (comparing && scenarioField.value === "historical") {
      scenarioField.value = scenarios.includes("ssp585") ? "ssp585" : scenarios[0];
    }
    setScenario();
  }

  document.addEventListener("map-scenario-change", syncRegionalScenario);
  for (const [id, field] of [["start", startField], ["end", endField]]) {
    document.querySelector(`#show-${id}-on-map`).addEventListener("click", () => {
      const year = availableYears[Number(field.value)];
      document.querySelector("#endpoint-map-status").textContent = selectMapYear(year)
        ? `Map updated to July ${year}.`
        : year === undefined
          ? "Regional data are still loading."
          : `July ${year} is unavailable in the current map view.`;
    });
  }
  d3.select(scenarioField).selectAll("option").filter(value => value === "historical")
    .property("hidden", true).property("disabled", true);
  window.addEventListener("resize", render);
  syncRegionalScenario();
}

initDumbbellChart();
