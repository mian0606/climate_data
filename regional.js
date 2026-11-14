(async function () {
    const regions = climateRegions;

    const warmingScenario = document.querySelector("#warming-scenario");
    const scenarioNote = document.querySelector("#warming-scenario-note");
    const yearNote = document.querySelector("#warming-year");
    const hoverNote = document.querySelector("#warming-hover");
    const key = d3.select("#warming-key");
    const chart = d3.select("#warming-chart");
    const chartNode = chart.node();
    const hoverHint = "Hover for annual values. Click a year to move the map.";

    let rows;
    try {
        rows = await loadRegionalWarming();

        if (!rows.length) throw new Error("No valid regional warming data.");
    } catch (error) {
        console.error(error);
        yearNote.textContent = "Could not load regional_warming.csv.";
        return;
    }

    const projectionRows = rows.filter(row => row.scenario !== "historical");
    const availableScenarios = Array.from(new Set(projectionRows.map(row => row.scenario))).sort();
    if (!availableScenarios.length) {
        yearNote.textContent = "No annual projection scenarios are available.";
        return;
    }
    const initialScenario = warmingScenario.value || mapScenarioSelect.value;
    d3.select(warmingScenario).selectAll("option")
        .data(availableScenarios)
        .join("option")
        .attr("value", scenario => scenario)
        .text(scenario => mapScenarioNames[scenario] ?? scenario);
    warmingScenario.value = availableScenarios.includes(initialScenario) ? initialScenario
        : availableScenarios.includes("ssp585") ? "ssp585" : availableScenarios[0];
    warmingScenario.disabled = false;
    const yDomain = [
        Math.min(0, d3.min(projectionRows, row => row.warming)),
        d3.max(projectionRows, row => row.warming)
    ];
    const formatValue = d3.format("+.2f");
    let highlightedRegion = null;

    const warmingTooltip = d3.select("body").append("div")
        .attr("aria-hidden", "true")
        .property("hidden", true)
        .style("position", "fixed")
        .style("z-index", "3")
        .style("pointer-events", "none")
        .style("max-width", "calc(100vw - 16px)")
        .style("padding", "8px 12px")
        .style("background", "#18352e")
        .style("color", "white")
        .style("border-radius", "8px")
        .style("font-size", "0.875rem")
        .style("white-space", "pre-line")
        .style("box-shadow", "0 4px 14px #0002");

    function draw() {
        warmingTooltip.property("hidden", true);
        const activeScenario = warmingScenario.value;
        const historicalMode = activeScenario === "historical";
        drawMapRegions(regions);
        syncSecondMapRegions();

        if (!activeScenario) {
            scenarioNote.textContent = "Waiting for annual scenario data.";
            key.selectAll("*").remove();
            chart.selectAll("*").remove();
            chart.attr("hidden", "");
            yearNote.textContent = "";
            hoverNote.hidden = true;
            return () => { };
        }

        chart.attr("hidden", null);
        hoverNote.hidden = false;
        scenarioNote.textContent = historicalMode
            ? "Historical simulation, 1995–2014. Zero marks each region’s baseline mean."
            : `Scenario: ${mapScenarioNames[activeScenario] ?? activeScenario}`;

        const series = regions.map(region => ({
                label: region.name,
                color: region.color,
                values: rows.filter(row =>
                    row.region === region.name && row.scenario === activeScenario
                )
            }));

        for (const line of series) {
            line.values.sort((a, b) => a.year - b.year);
            line.byYear = new Map(line.values.map(row => [row.year, row.warming]));
        }

        key.selectAll("*").remove();
        key.attr("role", "group").attr("aria-label", "Highlight a region in the warming chart");
        const allButton = key.append("button")
            .attr("type", "button")
            .attr("class", "key-item key-all")
            .text("All regions")
            .on("click", () => {
                highlightedRegion = null;
                applyHighlight();
            });
        const items = key.selectAll(".key-item")
            .filter(function () { return !this.classList.contains("key-all"); })
            .data(series)
            .join("button")
            .attr("type", "button")
            .attr("class", "key-item")
            .style("--series-color", line => line.color)
            .attr("title", line => `Highlight ${line.label}; click again to show all regions`)
            .on("click", (event, line) => {
                highlightedRegion = highlightedRegion === line.label ? null : line.label;
                applyHighlight();
            });

        items.append("span")
            .attr("class", "swatch")
            .style("border-color", line => line.color)
            .style("border-top-style", line => line.dash ? "dashed" : "solid");

        items.append("span").text(line => line.label);

        function applyHighlight() {
            warmingTooltip.property("hidden", true);
            allButton.attr("aria-pressed", String(highlightedRegion === null));
            items.attr("aria-pressed", line => String(line.label === highlightedRegion))
                .classed("is-muted", line => highlightedRegion !== null && line.label !== highlightedRegion);
            const lines = chart.selectAll(".warming-line")
                .attr("opacity", line => highlightedRegion === null || line.label === highlightedRegion ? 1 : 0.05)
                .attr("stroke-width", line => line.label === highlightedRegion ? 4 : 3);
            if (highlightedRegion !== null) {
                lines.filter(line => line.label === highlightedRegion).raise();
            }
        }

        applyHighlight();

        const width = Math.max(240, chartNode.clientWidth);
        const height = 270;
        const margin = { top: 20, right: 20, bottom: 42, left: 56 };
        const bottom = height - margin.bottom;
        const right = width - margin.right;
        const visibleRows = series.flatMap(line => line.values);
        if (!visibleRows.length) {
            chart.selectAll("*").remove();
            yearNote.textContent = "No annual regional data for this selection.";
            return () => {};
        }
        const [firstYear, lastYear] = d3.extent(visibleRows, row => row.year);
        const visibleYDomain = historicalMode
            ? [
                Math.min(0, d3.min(visibleRows, row => row.warming)),
                Math.max(0, d3.max(visibleRows, row => row.warming))
            ]
            : yDomain;

        const x = d3.scaleLinear([firstYear, lastYear], [margin.left, right]);
        const y = d3.scaleLinear(visibleYDomain, [bottom, margin.top]).nice();

        chart.attr("viewBox", `0 0 ${width} ${height}`)
            .attr("aria-label", `Annual regional warming under ${mapScenarioNames[activeScenario] ?? activeScenario}`);
        chart.selectAll("*").remove();

        chart.append("g")
            .attr("transform", `translate(${margin.left},0)`)
            .call(d3.axisLeft(y).ticks(5).tickSize(-(right - margin.left)))
            .call(axis => axis.select(".domain").remove())
            .call(axis => axis.selectAll(".tick line").attr("stroke", "#dbe5df"));

        chart.append("g")
            .attr("transform", `translate(0,${bottom})`)
            .call(d3.axisBottom(x).ticks(width < 500 ? 4 : 8).tickFormat(d3.format("d")));

        chart.append("text")
            .attr("x", (margin.left + right) / 2)
            .attr("y", height - 7)
            .attr("text-anchor", "middle")
            .attr("font-size", 12)
            .text("Year");

        chart.append("text")
            .attr("transform", `translate(13,${(margin.top + bottom) / 2}) rotate(-90)`)
            .attr("text-anchor", "middle")
            .attr("font-size", 12)
            .text("Temperature anomaly (°C)");

        if (historicalMode) {
            chart.append("line")
                .attr("x1", margin.left)
                .attr("x2", right)
                .attr("y1", y(0))
                .attr("y2", y(0))
                .attr("stroke", "#768880")
                .attr("stroke-dasharray", "3 3");
        }

        const path = d3.line().x(row => x(row.year)).y(row => y(row.warming));

        chart.selectAll(".warming-line")
            .data(series)
            .join("path")
            .attr("class", "warming-line")
            .attr("fill", "none")
            .attr("stroke", line => line.color)
            .attr("stroke-width", 3)
            .attr("stroke-opacity", 1)
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("vector-effect", "non-scaling-stroke")
            .attr("pointer-events", "none")
            .attr("stroke-dasharray", line => line.dash ?? null)
            .attr("d", line => path(line.values));

        const marker = chart.append("line")
            .attr("y1", margin.top)
            .attr("y2", bottom)
            .attr("stroke", "#18352e")
            .attr("stroke-dasharray", "4 4");

        function showMapYear() {
            const year = getSelectedMapYear();
            const inRange = year >= firstYear && year <= lastYear;
            marker.attr("display", inRange ? null : "none");

            if (inRange) {
                marker.attr("x1", x(year)).attr("x2", x(year));
            }

            let message = "The chart will mark the selected year once the map loads.";
            if (inRange) {
                message = `Dashed marker: ${year}, the selected map year.`;
            } else if (year !== undefined) {
                message = `Map year ${year} is outside the chart’s projection period (${firstYear}–${lastYear}).`;
            }

            if (yearNote.textContent !== message) yearNote.textContent = message;
        }

        function pointerYear(event) {
            const [pointerX] = d3.pointer(event, chartNode);
            return Math.max(firstYear, Math.min(lastYear, Math.round(x.invert(pointerX))));
        }

        chart.append("rect")
            .attr("x", margin.left)
            .attr("y", margin.top)
            .attr("width", right - margin.left)
            .attr("height", bottom - margin.top)
            .attr("fill", "transparent")
            .style("cursor", "crosshair")
      .on("pointermove", event => {
        const [mouseX, mouseY] = d3.pointer(event, chartNode);
        const screenScale = chartNode.getScreenCTM();
        const tolerance = 6 / Math.hypot(screenScale.a, screenScale.b);
        let nearestLine;
        let nearestDistance = tolerance;

        for (const line of series) {
          if (highlightedRegion !== null && line.label !== highlightedRegion) continue;
          for (let i = 1; i < line.values.length; i++) {
            const start = line.values[i - 1];
            const end = line.values[i];
            const startX = x(start.year);
            const endX = x(end.year);
            if (mouseX < startX - tolerance || mouseX > endX + tolerance) continue;

            const startY = y(start.warming);
            const dx = endX - startX;
            const dy = y(end.warming) - startY;
            const along = ((mouseX - startX) * dx + (mouseY - startY) * dy) /
              (dx * dx + dy * dy);
            const fraction = Math.max(0, Math.min(1, along));
            const distance = Math.hypot(
              mouseX - (startX + fraction * dx),
              mouseY - (startY + fraction * dy)
            );

            if (distance <= nearestDistance) {
              nearestDistance = distance;
              nearestLine = line;
            }
          }
        }

        const year = pointerYear(event);
        const value = nearestLine?.byYear.get(year);
        if (value === undefined) {
          warmingTooltip.property("hidden", true);
          return;
        }

        warmingTooltip
          .text(`${year}\n${nearestLine.label}: ${formatValue(value)} °C`)
          .property("hidden", false);

        const box = warmingTooltip.node();
        const left = Math.max(8, Math.min(event.clientX + 14, window.innerWidth - box.offsetWidth - 8));
        const top = Math.max(8, Math.min(event.clientY + 14, window.innerHeight - box.offsetHeight - 8));
        warmingTooltip.style("left", `${left}px`).style("top", `${top}px`);
      })
            .on("pointerleave", () => {
                warmingTooltip.property("hidden", true);
                hoverNote.textContent = hoverHint;
            })
            .on("click", event => {
                const year = pointerYear(event);
                if (!selectMapYear(year)) {
                    hoverNote.textContent = getSelectedMapYear() === undefined
                        ? "The map is still loading or could not load."
                        : `${year} is outside the available map years.`;
                }
            });

        applyHighlight();
        hoverNote.textContent = hoverHint;
        showMapYear();
        return showMapYear;
    }

    let refreshMarker = draw();

    function redraw() {
        refreshMarker = draw();
    }

    document.addEventListener("map-year-change", () => refreshMarker());
    warmingScenario.addEventListener("change", redraw);
    document.addEventListener("map-scenario-change", redraw);
    window.addEventListener("resize", redraw);
})();
