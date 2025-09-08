// firebase.js

const FIREBASE_URL = "https://envirosense-b9386-default-rtdb.asia-southeast1.firebasedatabase.app/sensor_data.json";
const LAST_N = 12; // 🔹 Change this to control how many recent entries are shown
const REFRESH_INTERVAL = 5000

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

////////////////////////
// ---- Timestamp helpers: support "DD-MM-YYYY-HH-mm-ss" or epoch seconds ----
function parseTimestampFlexible(ts) {
  if (ts == null) return null;
  const s = String(ts).trim();

  // Case A: epoch seconds
  if (/^\d{9,}$/.test(s)) {
    const ms = parseInt(s, 10) * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  // Case B: "DD-MM-YYYY-HH-mm-ss"
  //        1-2   1-2   4     1-2  1-2  1-2  (no leading zeros required)
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})-(\d{1,2})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const day   = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1; // JS months 0-11
    const year  = parseInt(m[3], 10);
    const hour  = parseInt(m[4], 10);
    const min   = parseInt(m[5], 10);
    const sec   = parseInt(m[6], 10);
    const d = new Date(year, month, day, hour, min, sec);
    return isNaN(d.getTime()) ? null : d; // interpreted in browser's local TZ
  }

  return null;
}

// Long format for the top KPIs (e.g., "10:42 AM, 7 September 2025")
function formatTsLong(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
         ", " +
         d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

// Short format for tables/axes (e.g., "10:42, 7 Sep")
function formatTsShort(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
         ", " +
         d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

////////////////////////

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

async function fetchData() {
  try {
    const res = await fetch(FIREBASE_URL);
    const data = await res.json();
    if (!data) return;

    // Build [{ key, v, dt }] and sort by real Date (newest first).
    const entries = Object.entries(data)
      .map(([key, v]) => {
        // Prefer parsing the Firebase key. If that fails, fall back to the value.timestamp field.
        const dt = parseTimestampFlexible(key) || parseTimestampFlexible(v?.timestamp);
        return { key, v, dt };
      })
      .filter(e => e.dt && !isNaN(e.dt.getTime()))
      .sort((a, b) => b.dt - a.dt)         // newest → oldest
      .slice(0, LAST_N);                   // keep latest N

    if (entries.length === 0) return;

    // Labels & series for charts (oldest → latest for a left-to-right line)
    const labels      = entries.map(e => formatTsShort(e.dt)).reverse();
    const tempValues  = entries.map(e => e.v.temperature).reverse();
    const lightValues = entries.map(e => e.v.light_lux).reverse();

    // Latest tile (entries[0] is newest due to sort)
    const latest = entries[0];
    updateLatest(latest.dt, latest.v);

    // Tables (show newest first, same as before)
    updateTable("temperature_table", entries, "temperature", "°C");
    updateTable("light_table",       entries, "light_lux",   "lux");

    // Charts
    drawChart("temperature_chart", "Temperature (°C)", labels, tempValues, "rgba(255,99,132,1)");
    drawChart("light_chart",       "Light (lux)",      labels, lightValues, "rgba(54,162,235,1)");
  } catch (err) {
    console.error("Error fetching Firebase data:", err);
  }
}

function updateLatest(dateObj, values) {
  const formatted = formatTsLong(dateObj);
  console.log(formatted);
  document.getElementById("latest_time").innerText        = formatted;
  document.getElementById("latest_temperature").innerText = values.temperature.toFixed(2) + " °C";
  document.getElementById("latest_light").innerText       = values.light_lux.toFixed(2) + " lux";
}


function updateTable(tableId, entries, key, unit) {
  const table = document.getElementById(tableId);
  if (!table) return;

  // Header
  table.innerHTML = `
    <tr class="font-semibold bg-gray-100">
      <th class="p-2">Timestamp</th>
      <th class="p-2">${key}</th>
    </tr>
  `;

  // Rows (newest first, like your original UI)
  entries.forEach(e => {
    const formatted = formatTsShort(e.dt);
    table.innerHTML += `
      <tr>
        <td class="p-2 border">${formatted}</td>
        <td class="p-2 border text-center">${e.v[key].toFixed(2)} ${unit}</td>
      </tr>
    `;
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
          position: 'bottom',           // legend under the chart
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
