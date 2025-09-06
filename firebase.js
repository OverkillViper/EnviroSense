// firebase.js

const FIREBASE_URL = "https://envirosense-b9386-default-rtdb.asia-southeast1.firebasedatabase.app/sensor_data.json";
const LAST_N = 12; // 🔹 Change this to control how many recent entries are shown
const REFRESH_INTERVAL = 5000

/////////////////////////////////////////////////////////////////////////
// ===== Threshold configs =====
const TEMPERATURE_THRESHOLDS = [
  { label: 'Higher than Usual', value: 32, color: '#ef4444' },
  { label: 'Normal Temperature', value: 25, color: '#10b981' },
  { label: 'Lower than Usual', value: 18, color: '#3b82f6' },
];

const LIGHT_THRESHOLDS = [
  { label: 'Outdoor',   value: 1000, color: '#f59e0b' },
  { label: 'Indoor',    value: 300,   color: '#22c55e' },
  { label: 'Dark Room', value: 10,    color: '#3b82f6' },
  { label: 'No light',  value: 0,     color: '#6b7280' },
];

// ===== Plugin: draw horizontal threshold lines (no labels on chart) =====
const thresholdLinesPlugin = {
  id: 'thresholdLines',
  afterDatasetsDraw(chart, _args, pluginOptions) {
    const lines = pluginOptions?.lines || [];
    const { ctx, chartArea, scales } = chart;
    const y = scales.y;
    if (!y || !chartArea) return;

    ctx.save();
    lines.forEach(line => {
      if (line.value < y.min || line.value > y.max) return; // outside range
      const yPos = y.getPixelForValue(line.value);
      ctx.beginPath();
      ctx.setLineDash(line.dash || [6, 4]);
      ctx.lineWidth = line.width || 1.25;
      ctx.strokeStyle = line.color || '#000';
      ctx.moveTo(chartArea.left, yPos);
      ctx.lineTo(chartArea.right, yPos);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  }
};
Chart.register(thresholdLinesPlugin);

/////////////////////////////////////////////////////////////////////////
async function fetchData() {
    try {
        const res = await fetch(FIREBASE_URL);
        const data = await res.json();
        if (!data) return;

        // Sort entries by timestamp (latest first)
        const sortedData = Object.entries(data).sort((a, b) => b[0].localeCompare(a[0]));
        const recentData = sortedData.slice(0, LAST_N); // 🔹 take last N records

        // Extract labels (timestamps) and values
        const labels = recentData.map(([ts]) => ts).reverse(); // oldest → latest for charts
        const tempValues = recentData.map(([_, v]) => v.temperature).reverse();
        const lightValues = recentData.map(([_, v]) => v.light_lux).reverse();

        // Update latest values in dashboard
        const [latestTs, latestValues] = recentData[0];
        updateLatest(latestTs, latestValues);

        // Update tables
        updateTable("temperature_table", recentData, "temperature", "°C");
        updateTable("light_table", recentData, "light_lux", "lux");

        // Update charts
        drawChart("temperature_chart", "Temperature (°C)", labels, tempValues, "rgba(255,99,132,1)");
        drawChart("light_chart", "Light (lux)", labels, lightValues, "rgba(54,162,235,1)");

    } catch (err) {
        console.error("Error fetching Firebase data:", err);
    }
}

function updateLatest(timestamp, values) {
    const ts = new Date(parseInt(timestamp) * 1000); // assuming timestamp = seconds
    const formatted = ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) +
                      ", " + ts.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

    document.getElementById("latest_time").innerText = formatted;
    document.getElementById("latest_temperature").innerText = values.temperature.toFixed(2) + " °C";
    document.getElementById("latest_light").innerText = values.light_lux.toFixed(2) + " lux";
}

function updateTable(tableId, data, key, unit) {
    const table = document.getElementById(tableId);
    if (!table) return;

    // Clear table content first
    table.innerHTML = "";

    // Optional: Add header
    const header = `
        <tr class="font-semibold bg-gray-100">
            <th class="p-2">Timestamp</th>
            <th class="p-2">${key}</th>
        </tr>
    `;
    table.innerHTML = header;

    // Add rows for last N records
    data.forEach(([ts, v]) => {
        const date = new Date(parseInt(ts) * 1000);
        const formatted = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) +
                          ", " + date.toLocaleDateString("en-US", { day: "numeric", month: "short" });

        const row = `
            <tr>
                <td class="p-2 border">${formatted}</td>
                <td class="p-2 border text-center">${v[key].toFixed(2)} ${unit}</td>
            </tr>
        `;
        table.innerHTML += row;
    });
}


let tempChart = null;
let lightChart = null;

function drawChart(canvasId, label, labels, values, color) {
  const ctx = document.getElementById(canvasId)?.getContext("2d");
  if (!ctx) return;

  const isTemp = canvasId === "temperature_chart";
  const thresholds = isTemp ? TEMPERATURE_THRESHOLDS : LIGHT_THRESHOLDS;

  // Destroy old instance
  if (isTemp && tempChart) tempChart.destroy();
  if (!isTemp && lightChart) lightChart.destroy();

  // Main data line
  const mainDataset = {
    label,
    data: values,
    borderColor: color,
    borderWidth: 2,
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    order: 1
  };

  // Legend-only "dummy" datasets for thresholds
  const thresholdLegendDatasets = thresholds.map(t => ({
    label: t.label,
    data: [NaN],                // ensures nothing is drawn
    borderColor: t.color,
    borderWidth: 2,
    borderDash: t.dash || [6, 4],
    pointRadius: 0,
    fill: false,
    tension: 0,
    order: 99
  }));

  const newChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [mainDataset, ...thresholdLegendDatasets]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',           // ⬅️ legend under the chart
          labels: {
            // Optional: keep only threshold labels in legend
            // filter: (item) => ![label].includes(item.text)
          }
        },
        // this draws the actual threshold lines
        thresholdLines: { lines: thresholds }
      },
      scales: {
        x: { display: false },
        y: isTemp
          ? { beginAtZero: false, suggestedMin: 10, suggestedMax: 40 }
          : { beginAtZero: true,  suggestedMin: 0,  suggestedMax: 1200 }
        // If you often have very small lux but want to show big thresholds too,
        // consider a log scale instead:
        // y: { type: 'logarithmic', min: 0.1, max: 100000 }
      }
    }
  });

  if (isTemp) tempChart = newChart; else lightChart = newChart;
}


// Auto refresh every 10 seconds
fetchData();
setInterval(fetchData, REFRESH_INTERVAL);
