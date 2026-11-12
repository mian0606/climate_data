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
    .attr("stroke", "#18352e")
    .attr("stroke-width", 1.5)
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
  mapTooltip.property("hidden", true);

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
      .on("pointerenter", (event, cell) => {
        const temperature = mapTemperatures.get(cell.key);
        const value = Number.isFinite(temperature) ? `${temperature.toFixed(2)} °C` : "Missing";

        mapTooltip
          .text(`July ${getSelectedMapYear()} · ${latText(cell.lat)}, ${lonText(cell.lon)} · ${value}`)
          .property("hidden", false);

        positionMapTooltip(event);
      })
      .on("pointermove", positionMapTooltip)
      .on("pointerleave", () => mapTooltip.property("hidden", true));

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

const mapModeSelect = document.querySelector("#warming-view");
const mapPair = document.querySelector("#map-pair");
const lowMapHeading = document.querySelector("#low-map-heading");
const highMapPanel = document.querySelector("#high-map-panel");
const mapScenarioField = mapScenarioSelect.closest(".field");

let previousSingleScenario;
let secondMapCells;
let secondMapRegions;
let secondMapTemperatures;

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

  if (compare) {
    previousSingleScenario = mapScenarioSelect.value;
    mapScenarioSelect.value = "ssp126";
  } else if (previousSingleScenario !== undefined) {
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
  secondMapCells = d3.select(clone.children[cellLayerIndex])
    .selectAll("rect")
    .data(mapCells.data());

  secondMapCells
    .on("pointerenter", (event, cell) => {
      const temperature = secondMapTemperatures.get(cell.key);
      const value = Number.isFinite(temperature) ? `${temperature.toFixed(2)} °C` : "Missing";

      mapTooltip
        .text(`SSP5-8.5 · July ${getSelectedMapYear()} · ${latText(cell.lat)}, ${lonText(cell.lon)} · ${value}`)
        .property("hidden", false);

      positionMapTooltip(event);
    })
    .on("pointermove", positionMapTooltip)
    .on("pointerleave", () => mapTooltip.property("hidden", true));
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