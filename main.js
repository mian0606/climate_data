const width = 1100;
const height = 600;

const margin = {
  top: 20,
  right: 25,
  bottom: 50,
  left: 60
};

const svg = d3.select("#chart")
  .attr("viewBox", `0 0 ${width} ${height}`);

const tooltip = d3.select("#tooltip");
const scenarioSelect = document.querySelector("#scenario-select");
const slider = document.querySelector("#year-slider");

const scenarioNames = {
  historical: "Historical",
  ssp126: "SSP126",
  ssp585: "SSP585"
};


const x = d3.scaleLinear()
  .domain([-180, 180])
  .range([margin.left, width - margin.right]);


const y = d3.scaleLinear()
  .domain([-90, 90])
  .range([height - margin.bottom, margin.top]);

function lonText(value) {
  if (value === 0) return "0°";
  return `${Math.abs(value)}°${value < 0 ? "W" : "E"}`;
}

function latText(value) {
  if (value === 0) return "0°";
  return `${Math.abs(value)}°${value < 0 ? "S" : "N"}`;
}


svg.append("rect")
  .attr("x", x(-180))
  .attr("y", y(90))
  .attr("width", x(180) - x(-180))
  .attr("height", y(-90) - y(90))
  .attr("fill", "#e7ebe5");

const cellsLayer = svg.append("g");


svg.append("g")
  .attr("class", "axis")
  .attr("transform", `translate(0, ${y(-90)})`)
  .call(
    d3.axisBottom(x)
      .tickValues([-180, -120, -60, 0, 60, 120, 180])
      .tickFormat(lonText)
  );


svg.append("g")
  .attr("class", "axis")
  .attr("transform", `translate(${x(-180)}, 0)`)
  .call(
    d3.axisLeft(y)
      .tickValues([-90, -60, -30, 0, 30, 60, 90])
      .tickFormat(latText)
  );

let groupedData;
let years = [];
let color;
let cells;


function getEdges(values, minimum, maximum) {
  const edges = new Map();

  values.forEach((value, i) => {
    const previous = values[i - 1];
    const next = values[i + 1];

    const left = i > 0
      ? (previous + value) / 2
      : value - (next === undefined ? 1 : next - value) / 2;

    const right = i < values.length - 1
      ? (value + next) / 2
      : value + (previous === undefined ? 1 : value - previous) / 2;

    edges.set(value, [
      Math.max(minimum, left),
      Math.min(maximum, right)
    ]);
  });

  return edges;
}

function drawLegend(minTemp, maxTemp) {
  const legend = d3.select("#legend")
    .attr("viewBox", "0 0 520 75");

  legend.selectAll("*").remove();

  legend.append("text")
    .attr("x", 20)
    .attr("y", 15)
    .attr("font-size", 12)
    .attr("fill", "#526c5d")
    .text("气温（°C）· 所有年份、情景共用色标");


  const steps = 240;
  const legendWidth = 480;

  legend.selectAll("rect")
    .data(d3.range(steps))
    .join("rect")
    .attr("x", d => 20 + d * legendWidth / steps)
    .attr("y", 27)
    .attr("width", legendWidth / steps + 0.1)
    .attr("height", 12)
    .attr("fill", d => {
      const temperature =
        minTemp + d / (steps - 1) * (maxTemp - minTemp);

      return color(temperature);
    });

  const legendScale = d3.scaleLinear()
    .domain([minTemp, maxTemp])
    .range([20, 500]);

  legend.append("g")
    .attr("class", "axis")
    .attr("transform", "translate(0, 41)")
    .call(
      d3.axisBottom(legendScale)
        .ticks(6)
        .tickSize(3)
    );
}

function changeScenario() {
  const scenario = scenarioSelect.value;

  years = Array.from(groupedData.get(scenario).keys())
    .sort((a, b) => a - b);

  slider.max = years.length - 1;
  slider.value = 0;
  slider.disabled = years.length < 2;

  drawYear();
}

function drawYear() {
  const scenario = scenarioSelect.value;
  const year = years[Number(slider.value)];

  const rows = groupedData.get(scenario).get(year);

  const temperatures = d3.rollup(
    rows,
    values => d3.mean(values, d => d.temperature_c),
    d => `${d.lat},${d.lon}`
  );

  cells.attr("fill", d => {
    const temperature = temperatures.get(`${d.lat},${d.lon}`);

    return Number.isFinite(temperature)
      ? color(temperature)
      : "#e7ebe5";
  });

  cells
    .on("pointerenter", (event, d) => {
      const temperature = temperatures.get(`${d.lat},${d.lon}`);

      tooltip
        .property("hidden", false)
        .text(
          `${year} 年 7 月 | ` +
          `${latText(d.lat)}, ${lonText(d.lon)} | ` +
          (
            Number.isFinite(temperature)
              ? `${temperature.toFixed(2)} °C`
              : "缺测"
          )
        );
    })
    .on("pointermove", event => {
      const node = tooltip.node();

      const left = Math.max(
        8,
        Math.min(
          event.clientX + 12,
          window.innerWidth - node.offsetWidth - 8
        )
      );

      const top = Math.max(
        8,
        Math.min(
          event.clientY + 12,
          window.innerHeight - node.offsetHeight - 8
        )
      );

      tooltip
        .style("left", `${left}px`)
        .style("top", `${top}px`);
    })
    .on("pointerleave", () => {
      tooltip.property("hidden", true);
    });

  document.querySelector("#chart-title").textContent =
    `${year} 年 7 月 · ${scenarioNames[scenario] ?? scenario}`;

  document.querySelector("#year-label").textContent = year;
  slider.setAttribute("aria-valuetext", `${year}年`);
}

async function loadData() {
  try {
    const response = await fetch("./july_temperature.csv.gz");
    if (!response.ok) throw new Error(`failed：${response.status}`);
    const stream = response.body.pipeThrough(
      new DecompressionStream("gzip")
    );
    const csvText = await new Response(stream).text();

    const data = d3.csvParse(csvText, row => {
      const date = String(row.time).match(
        /^(\d{4,})-(\d{2})-\d{2}/
      );


      if (!date || Number(date[2]) !== 7) return null;

      const lat = Number(row.lat);
      const rawLon = Number(row.lon);

      if (
        !String(row.lat ?? "").trim() ||
        !String(row.lon ?? "").trim() ||
        !Number.isFinite(lat) ||
        !Number.isFinite(rawLon) ||
        lat < -90 || lat > 90 ||
        rawLon < -180 || rawLon > 360
      ) {
        return null;
      }


      const lon = ((rawLon + 180) % 360 + 360) % 360 - 180;

      const rawTemperature = String(
        row.temperature_c ?? ""
      ).trim();

      const temperature = rawTemperature === ""
        ? NaN
        : Number(rawTemperature);

      return {
        year: Number(date[1]),
        lat,
        lon: Number(lon.toFixed(8)),
        temperature_c: Number.isFinite(temperature)
          ? temperature
          : NaN,
        scenario: String(row.scenario ?? "").trim()
      };
    });

    const valid = data.filter(d =>
      Number.isFinite(d.temperature_c)
    );

    if (valid.length === 0) {
      throw new Error("No Temp available");
    }


    groupedData = d3.group(
      data,
      d => d.scenario,
      d => d.year
    );

    const scenarios = Array.from(groupedData.keys()).sort();

    d3.select("#scenario-select")
      .selectAll("option")
      .data(scenarios)
      .join("option")
      .attr("value", d => d)
      .text(d => scenarioNames[d] ?? d);

    scenarioSelect.disabled = false;
    scenarioSelect.value = scenarios[0];


    let minTemp = Math.floor(
      d3.min(valid, d => d.temperature_c) / 5
    ) * 5;

    let maxTemp = Math.ceil(
      d3.max(valid, d => d.temperature_c) / 5
    ) * 5;

    if (minTemp === maxTemp) {
      minTemp -= 5;
      maxTemp += 5;
    }

    color = d3.scaleLinear()
      .domain([
        minTemp,
        minTemp + (maxTemp - minTemp) / 3,
        minTemp + 2 * (maxTemp - minTemp) / 3,
        maxTemp
      ])
      .range([
        "#4cc9c0", // 青
        "#ffe680", // 黄
        "#f99b48", // 橙
        "#c83f3f"  // 红
      ])
      .clamp(true);

    drawLegend(minTemp, maxTemp);

    const latitudes = Array.from(
      new Set(data.map(d => d.lat))
    ).sort((a, b) => a - b);

    const longitudes = Array.from(
      new Set(data.map(d => d.lon))
    ).sort((a, b) => a - b);

    const latEdges = getEdges(latitudes, -90, 90);
    const lonEdges = getEdges(longitudes, -180, 180);


    const grid = [];

    for (const lat of latitudes) {
      for (const lon of longitudes) {
        grid.push({ lat, lon });
      }
    }

    cells = cellsLayer.selectAll("rect")
      .data(grid, d => `${d.lat},${d.lon}`)
      .join("rect")
      .attr("x", d => x(lonEdges.get(d.lon)[0]))
      .attr("y", d => y(latEdges.get(d.lat)[1]))
      .attr("width", d => {
        const [left, right] = lonEdges.get(d.lon);
        return x(right) - x(left);
      })
      .attr("height", d => {
        const [bottom, top] = latEdges.get(d.lat);
        return y(bottom) - y(top);
      });

    changeScenario();

    document.querySelector("#status").textContent =
      `${latitudes.length} lats ` +
      `${longitudes.length} longs；` +
      `grey means missingness`;

    } catch (error) {
      console.error("数据加载失败：", error);

      const title = document.querySelector("#chart-title");
      if (title) {
        title.textContent = "Invalid Data";
      }
    }

    document.querySelector("#status").textContent =
      error.message;
}


scenarioSelect.addEventListener("change", changeScenario);
slider.addEventListener("input", drawYear);

loadData();