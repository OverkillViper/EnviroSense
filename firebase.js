// firebase.js

const FIREBASE_URL = "https://envirosense-b9386-default-rtdb.asia-southeast1.firebasedatabase.app/sensor_data.json";
const LAST_N = 12; // 🔹 Change this to control how many recent entries are shown
const REFRESH_INTERVAL = 5000

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
    if (!ctx) return; // canvas not found

    // Determine which chart variable to use
    let chartRef;
    if (canvasId === "temperature_chart") chartRef = tempChart;
    if (canvasId === "light_chart") chartRef = lightChart;

    // Destroy old chart if exists
    if (chartRef) chartRef.destroy();

    // Create new chart
    const newChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: values,
                borderColor: color,
                borderWidth: 2,
                fill: false,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            animation: false,
            plugins: {
                legend: { display: true }
            },
            scales: {
                x: { display: false },
                y: { beginAtZero: true }
            }
        }
    });

    // Update the chart reference
    if (canvasId === "temperature_chart") tempChart = newChart;
    if (canvasId === "light_chart") lightChart = newChart;
}

// Auto refresh every 10 seconds
fetchData();
setInterval(fetchData, REFRESH_INTERVAL);
