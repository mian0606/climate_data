
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
                message = `Map year ${year} is outside the chart’s year range (${firstYear}–${lastYear}).`;
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

        updateHighlight = applyHighlight;
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
    document.addEventListener("map-scenario-change", redraw);
    document.addEventListener("regional-interval-change", () => {
        if (isComparingMaps() && renderedScenario !== regionalComparison.scenario) redraw();
        else updateInterval();
    });
    document.addEventListener("regional-focus", event => {
        highlightedRegion = highlightedRegion === event.detail ? null : event.detail;
        updateHighlight();
    });
    window.addEventListener("resize", redraw);
})();
