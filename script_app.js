/**************************************************************
 1) AUTH CHECK + LOGOUT
**************************************************************/
fetch('/.auth/me')
  .then((res) => res.json())
  .then((data) => {
    if (!data.clientPrincipal) {
      // Not logged in => go to login page
      window.location.href = 'index.html'; // or 'login.html' if that's your file
      return;
    }
    // Logged in => show main content
    document.getElementById('mainContent').style.display = 'block';

    // Now safe to init CSV and chart logic
    // (We fetch from Azure Blob using the default SAS token)
    initCSVData();
  })
  .catch((err) => {
    console.error('Error checking auth on app.html:', err);
    // If error, also default to login
    window.location.href = 'index.html';
  });

// Clicking “Logout” => call SWA’s sign-out
document.getElementById('btnLogout').addEventListener('click', () => {
  window.location.href = '/.auth/logout';
});


/**************************************************************
 2) SAS TOKEN & BLOB FETCH LOGIC
   - By default, we store your SAS token here.
   - Let the user update it at runtime if they wish.
**************************************************************/

// EXAMPLE: your existing SAS token
//   sp=cw&st=2025-02-24T22:15:29Z&se=2025-03-30T06:15:29Z&spr=https&sv=2022-11-02&sr=b&sig=...
let blobSasToken = "sp=cw&st=2025-02-24T22:15:29Z&se=2025-03-30T06:15:29Z&spr=https&sv=2022-11-02&sr=b&sig=XJ%2BMWxDIUz%2FYYoPkfENLl8eQamGwJ9zeoDYouBAUIJk%3D";

// Base URL to your CSV in the $web container
const blobBaseUrl = "https://fxcharts.blob.core.windows.net/$web/OHLC_Snapshot.csv";

// Update SAS token from user input & re-fetch data if needed
document.getElementById("btnUpdateToken").addEventListener("click", () => {
  const inputEl = document.getElementById("sasTokenInput");
  blobSasToken = inputEl.value.trim();
  console.log("SAS token updated to:", blobSasToken);

  // Re-fetch CSV data with new token (optional)
  initCSVData();

  // Update the displayed expiry info
  displayTokenExpiry();
});

// On page load, also show how many days left for the default token
displayTokenExpiry();
function displayTokenExpiry() {
  const expiryEl = document.getElementById("tokenExpiryInfo");
  const expiryDate = parseTokenExpiry(blobSasToken);
  if (!expiryDate) {
    expiryEl.textContent = "Unable to parse token expiry.";
    return;
  }

  const now = new Date();
  if (expiryDate <= now) {
    expiryEl.textContent = "Token has already expired!";
    return;
  }

  // Calculate difference in ms
  const diffMs = expiryDate - now;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHrs = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const diffMin = Math.floor((diffMs / (1000 * 60)) % 60);

  expiryEl.textContent = `Token expires in ${diffDays} day(s), ${diffHrs} hour(s), ${diffMin} min(s).`;
}

function parseTokenExpiry(sas) {
  // We look for 'se=YYYY-MM-DDTHH:mm:ssZ'
  const parts = sas.split("&");
  const seParam = parts.find((p) => p.startsWith("se="));
  if (!seParam) return null;

  const dateStr = seParam.substring(3); // remove 'se='
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d;
}


/**************************************************************
 3) FOREX DASHBOARD LOGIC
    (Mostly unchanged, except we now fetch from Blob, not local CSV)
***************************************************************/

// Global variables
let rawCSVLines = [];
let csvHeader = [];
let newestCandleUTCms = 0;
let csvModifiedUTCms = Date.now();
const dataBySymbol = {};
const brokerOffsetHours = 2;

const rowConfigs = [
  { label: "AUD", symbols: ["AUDCAD","AUDCHF","AUDJPY","AUDNZD","AUDUSD","EURAUD","GBPAUD"] },
  { label: "CAD", symbols: ["CADCHF","CADJPY","AUDCAD","EURCAD","GBPCAD","NZDCAD","USDCAD"] },
  { label: "CHF", symbols: ["CHFJPY","AUDCHF","CADCHF","EURCHF","GBPCHF","NZDCHF","USDCHF"] },
  { label: "EUR", symbols: ["EURAUD","EURCAD","EURCHF","EURGBP","EURJPY","EURNZD","EURUSD"] },
  { label: "GBP", symbols: ["GBPAUD","GBPCAD","GBPCHF","GBPJPY","GBPNZD","GBPUSD","EURGBP"] },
  { label: "JPY", symbols: ["AUDJPY","CADJPY","CHFJPY","EURJPY","GBPJPY","NZDJPY","USDJPY"] },
  { label: "NZD", symbols: ["NZDCAD","NZDCHF","NZDJPY","NZDUSD","AUDNZD","EURNZD","GBPNZD"] },
  { label: "USD", symbols: ["USDCAD","USDCHF","USDJPY","AUDUSD","EURUSD","GBPUSD","NZDUSD"] },
  { label: "METALS", symbols: ["XAUUSD","XAGUSD"] }
];

// Helper function: split line by comma or tab
function splitLine(line) {
  line = line.replace(/^\uFEFF/, '');
  if (line.indexOf(",") !== -1) return line.split(",");
  if (line.indexOf("\t") !== -1) return line.split("\t");
  return [line];
}

/**
 * Load CSV data from Azure Blob using the current SAS token.
 * The user can override the SAS token from the input field at runtime.
 */
function initCSVData() {
  const fullUrl = `${blobBaseUrl}?${blobSasToken}`;
  console.log("Fetching CSV from:", fullUrl);

  fetch(fullUrl)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Blob fetch failed. Status: ${res.status}`);
      }
      return res.blob();
    })
    .then((blob) => {
      csvModifiedUTCms = Date.now();

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target.result;
        rawCSVLines = text.split(/\r?\n/).filter((x) => x.trim());

        if (rawCSVLines.length < 2) {
          console.warn("CSV has too few lines or is empty");
          return;
        }

        // Clean header
        csvHeader = splitLine(rawCSVLines[0]).map((h) =>
          h.trim().replace(/[^\x20-\x7E]/g, '')
        );
        console.log("CSV Header from Blob:", csvHeader);

        findNewestCandleInEntireCSV();
        rebuildTimeframes();
        updateInfoCards();
      };
      reader.readAsText(blob, "UTF-8");
    })
    .catch((err) => console.error("Error loading CSV from Blob:", err));
}

// (Optional) The manual CSV upload will override the data from the blob
document.getElementById("csvFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  csvModifiedUTCms = file.lastModified;

  const reader = new FileReader();
  reader.onload = (evt) => {
    const text = evt.target.result;
    rawCSVLines = text.split(/\r?\n/).filter((x) => x.trim());

    if (rawCSVLines.length < 2) {
      console.warn("CSV has too few lines");
      return;
    }

    csvHeader = splitLine(rawCSVLines[0]).map((h) =>
      h.trim().replace(/[^\x20-\x7E]/g, '')
    );
    console.log("CSV Header (uploaded):", csvHeader);

    findNewestCandleInEntireCSV();
    rebuildTimeframes();
    updateInfoCards();
  };
  reader.readAsText(file, "UTF-8");
});

// On timeframe or timeZone changes
document
  .getElementById("timeframeSelect")
  .addEventListener("change", () => {
    setupGrid(document.getElementById("timeframeSelect").value);
  });
document
  .getElementById("timeZoneSelect")
  .addEventListener("change", () => {
    reParseAndRenderAll();
  });

// Row label click => highlight row
document.addEventListener("click", (e) => {
  if (e.target && e.target.classList.contains("row-label")) {
    document
      .querySelectorAll(".row-label")
      .forEach((lbl) => lbl.classList.remove("selected"));
    document
      .querySelectorAll(".chart-container")
      .forEach((chart) => chart.classList.remove("selected"));
    e.target.classList.add("selected");

    const rowCurrency = e.target.textContent.trim();
    document.querySelectorAll(".chart-container").forEach((chart) => {
      if (chart.dataset.rowCurrency === rowCurrency) {
        chart.classList.add("selected");
      }
    });
  }
});

// Find newest candle in CSV
function findNewestCandleInEntireCSV() {
  newestCandleUTCms = 0;
  const idxBar = csvHeader.indexOf("BarTime");
  if (idxBar === -1) {
    console.warn("No BarTime column found in CSV header.");
    return;
  }
  for (let i = 1; i < rawCSVLines.length; i++) {
    let cols = splitLine(rawCSVLines[i]);
    if (cols.length <= idxBar) continue;
    let dtStr = cols[idxBar].trim();
    if (!dtStr) continue;
    let realUTC = parseBrokerTimeToUTC(dtStr, brokerOffsetHours);
    if (realUTC > newestCandleUTCms) newestCandleUTCms = realUTC;
  }
}

function parseBrokerTimeToUTC(dtStr, offsetH) {
  let [ymd, hms] = dtStr.split(" ");
  if (!ymd || !hms) return 0;
  let [yy, mm, dd] = ymd.split(".");
  let [HH, MI, SS] = hms.split(":");
  let Y = parseInt(yy, 10);
  let M = parseInt(mm, 10) - 1;
  let D = parseInt(dd, 10);
  let h = parseInt(HH, 10);
  let mn = parseInt(MI, 10);
  let sc = parseInt(SS, 10);

  return Date.UTC(Y, M, D, h - offsetH, mn, sc);
}

function rebuildTimeframes() {
  const idxSymbol = csvHeader.indexOf("Symbol");
  const idxTF = csvHeader.indexOf("Timeframe");
  if (idxSymbol === -1 || idxTF === -1) {
    console.warn("No Symbol/Timeframe columns in CSV.");
    return;
  }
  const uniqueTF = new Set();
  for (let i = 1; i < rawCSVLines.length; i++) {
    let cols = splitLine(rawCSVLines[i]);
    if (cols.length < 2) continue;
    let s = (cols[idxSymbol] || "").trim().replace(/\.\.$/, "");
    let t = (cols[idxTF] || "").trim().replace(/^PERIOD_/, "");
    if (s && t) uniqueTF.add(t);
  }

  const tfSel = document.getElementById("timeframeSelect");
  tfSel.innerHTML = "";
  tfSel.disabled = true;
  if (uniqueTF.size === 0) return;

  uniqueTF.forEach((tf) => {
    let opt = document.createElement("option");
    opt.value = tf;
    opt.textContent = tf;
    tfSel.appendChild(opt);
  });
  tfSel.disabled = false;
  tfSel.value = uniqueTF.has("H1")
    ? "H1"
    : uniqueTF.values().next().value;

  setupGrid(tfSel.value);
}

function setupGrid(tf) {
  const grid = document.getElementById("grid-container");
  grid.innerHTML = "";
  rowConfigs.forEach((row) => {
    let lbl = document.createElement("div");
    lbl.className = "row-label";
    lbl.textContent = row.label;
    grid.appendChild(lbl);

    row.symbols.forEach((sym) => {
      let cId =
        "chart-" +
        row.label.replace(/[^A-Za-z0-9]/g, "") +
        "-" +
        sym.replace(/[^A-Za-z0-9]/g, "");
      let div = document.createElement("div");
      div.id = cId;
      div.className = "chart-container";
      div.dataset.rowCurrency = row.label;
      div.dataset.symbol = sym.replace(/\.\.$/, "");
      div.dataset.timeframe = tf;
      grid.appendChild(div);
    });
  });
  reParseAndRenderAll();
}

function reParseAndRenderAll() {
  // Clear old data
  for (let k in dataBySymbol) delete dataBySymbol[k];

  const tf = document.getElementById("timeframeSelect").value;
  const tz = document.getElementById("timeZoneSelect").value;
  const idxSymbol = csvHeader.indexOf("Symbol");
  const idxTF = csvHeader.indexOf("Timeframe");
  const idxBar = csvHeader.indexOf("BarTime");
  const idxOpen = csvHeader.indexOf("Open");
  const idxHigh = csvHeader.indexOf("High");
  const idxLow = csvHeader.indexOf("Low");
  const idxClose = csvHeader.indexOf("Close");

  for (let i = 1; i < rawCSVLines.length; i++) {
    let cols = splitLine(rawCSVLines[i]);
    if (cols.length < 8) continue;
    let s = (cols[idxSymbol] || "").trim().replace(/\.\.$/, "");
    let t = (cols[idxTF] || "").trim().replace(/^PERIOD_/, "");
    if (t !== tf) continue;

    let dtStr = (cols[idxBar] || "").trim();
    let oVal = parseFloat(cols[idxOpen] || "0");
    let hVal = parseFloat(cols[idxHigh] || "0");
    let lVal = parseFloat(cols[idxLow] || "0");
    let cVal = parseFloat(cols[idxClose] || "0");
    let chartDate = parseCsvBarTime(dtStr, tz);

    if (!dataBySymbol[s]) dataBySymbol[s] = {};
    if (!dataBySymbol[s][t]) dataBySymbol[s][t] = [];
    dataBySymbol[s][t].push([chartDate, oVal, hVal, lVal, cVal]);
  }

  document.querySelectorAll(".chart-container").forEach((div) => {
    let sy = div.dataset.symbol;
    let rc = div.dataset.rowCurrency;
    let timeframe = div.dataset.timeframe;
    renderChart(div.id, sy, rc, timeframe);
  });

  updateInfoCards();
}

function parseCsvBarTime(dtStr, tz) {
  let [ymd, hms] = dtStr.split(" ");
  if (!ymd || !hms) return new Date(NaN);
  let [yy, mm, dd] = ymd.split(".");
  let [HH, MI, SS] = hms.split(":");
  let Y = parseInt(yy, 10);
  let M = parseInt(mm, 10) - 1;
  let D = parseInt(dd, 10);
  let h = parseInt(HH, 10);
  let mn = parseInt(MI, 10);
  let sc = parseInt(SS, 10);

  if (tz === "broker") {
    return new Date(Y, M, D, h, mn, sc);
  } else if (tz === "utc") {
    return new Date(Y, M, D, h - brokerOffsetHours, mn, sc);
  } else {
    // local
    let localOffH = -new Date().getTimezoneOffset() / 60;
    return new Date(Y, M, D, h - brokerOffsetHours + localOffH, mn, sc);
  }
}

function renderChart(containerId, symbol, rowCurrency, timeframe) {
  const container = document.getElementById(containerId);
  const containerWidth = container.clientWidth;

  if (!dataBySymbol[symbol] || !dataBySymbol[symbol][timeframe]) {
    Plotly.newPlot(
      containerId,
      [],
      {
        title: {
          text: symbol + " (" + timeframe + ") - No Data",
          x: 0.5,
          xanchor: "center",
        },
        width: containerWidth,
        height: containerWidth,
      },
      { displayModeBar: false }
    );
    return;
  }

  let arr = dataBySymbol[symbol][timeframe];
  let x = arr.map((d) => d[0]);
  let open = arr.map((d) => d[1]);
  let high = arr.map((d) => d[2]);
  let low = arr.map((d) => d[3]);
  let close = arr.map((d) => d[4]);

  let rootStyles = getComputedStyle(document.documentElement);
  let greenColor = rootStyles.getPropertyValue("--green-bg").trim() || "#ccffcc";
  let pinkColor = rootStyles.getPropertyValue("--pink-bg").trim() || "#ffcccc";
  let bgColor = greenColor;

  // If row currency does NOT match symbol prefix, use pink
  if (
    rowCurrency.toUpperCase() !== "METALS" &&
    !symbol.toUpperCase().startsWith(rowCurrency.toUpperCase())
  ) {
    bgColor = pinkColor;
  }

  const tfmt = decideTickFormat(timeframe);
  const trace = {
    x,
    open,
    high,
    low,
    close,
    type: "candlestick",
    name: symbol,
    increasing: { line: { color: "green" } },
    decreasing: { line: { color: "red" } },
    hoverinfo: "x+y",
  };

  const layout = {
    title: { text: symbol, x: 0.5, xanchor: "center", font: { size: 14 } },
    dragmode: "zoom",
    showlegend: false,
    xaxis: {
      autorange: true,
      showline: true,
      showgrid: true,
      tickformat: tfmt,
      tickangle: -45,
      rangeslider: { visible: false },
    },
    yaxis: {
      autorange: true,
      showline: true,
      showgrid: true,
      side: "right",
    },
    margin: { t: 60, r: 40, l: 40, b: 50 },
    paper_bgcolor: bgColor,
    plot_bgcolor: bgColor,
    width: containerWidth,
    height: containerWidth,
  };

  Plotly.newPlot(containerId, [trace], layout, { displayModeBar: false });
}

function decideTickFormat(tf) {
  return ["D1", "W1", "MN1"].includes(tf) ? "%d-%b" : "%H:%M";
}

/**************************************************************
 4) INFO CARD LOGIC
**************************************************************/
function updateInfoCards() {
  updateNewestCandleCard();
  updateCSVModifiedCard();
  updateDataAgeCard();
  updateTimeOverviewCard();
}
// Periodically update data age, time info
setInterval(updateInfoCards, 60_000);

function updateNewestCandleCard() {
  const el = document.getElementById("newestCandleValue");
  el.innerHTML = "";
  if (!newestCandleUTCms) {
    el.textContent = "--";
    return;
  }
  let dt = new Date(newestCandleUTCms);
  let line1 = document.createElement("div");
  line1.textContent = formatDDMonYYYY(dt);
  let line2 = document.createElement("div");
  line2.textContent = formatHHMMUTC(dt) + " UTC";
  el.appendChild(line1);
  el.appendChild(line2);
}

function updateCSVModifiedCard() {
  const el = document.getElementById("csvModifiedValue");
  el.innerHTML = "";
  if (!csvModifiedUTCms) {
    el.textContent = "--";
    return;
  }
  let dt = new Date(csvModifiedUTCms);
  let line1 = document.createElement("div");
  line1.textContent = formatDDMonYYYY(dt);
  let line2 = document.createElement("div");
  line2.textContent = formatHHMMUTC(dt) + " UTC";
  el.appendChild(line1);
  el.appendChild(line2);
}

function updateDataAgeCard() {
  const el = document.getElementById("dataAgeValue");
  el.classList.remove("stale");
  if (!newestCandleUTCms) {
    el.textContent = "--";
    return;
  }
  let diffMin = Math.floor((Date.now() - newestCandleUTCms) / 60000);
  let text =
    diffMin < 60
      ? `${diffMin} minute${diffMin === 1 ? "" : "s"} old`
      : `${(diffMin / 60).toFixed(1)} hour${
          (diffMin / 60).toFixed(1) === "1.0" ? "" : "s"
        } old`;
  if (diffMin > 5) el.classList.add("stale");
  el.textContent = text;
}

function updateTimeOverviewCard() {
  const el = document.getElementById("timeOverviewValue");
  el.innerHTML = "";

  let nowLocal = new Date();
  let nowUTC = new Date(nowLocal.getTime() + nowLocal.getTimezoneOffset() * 60000);

  let row1 = document.createElement("div");
  row1.className = "timeOverviewDateRow";
  let calIcon = document.createElement("i");
  calIcon.className = "fas fa-calendar-alt";
  row1.appendChild(calIcon);
  row1.appendChild(document.createTextNode(formatDDMonYYYY(nowUTC)));
  el.appendChild(row1);

  let table = document.createElement("div");
  table.className = "timeOverviewTable";

  let hdrRow = document.createElement("div");
  hdrRow.className = "timeOverviewRow";
  ["UTC", "BROKER", "LOCAL"].forEach((text) => {
    let cell = document.createElement("div");
    cell.className = "timeOverviewCell timeOverviewHeader";
    cell.textContent = text;
    hdrRow.appendChild(cell);
  });
  table.appendChild(hdrRow);

  let timeRow = document.createElement("div");
  timeRow.className = "timeOverviewRow";
  let nowBroker = new Date(nowUTC.getTime() + brokerOffsetHours * 3600000);
  [nowUTC, nowBroker, nowLocal].forEach((dt) => {
    let cell = document.createElement("div");
    cell.className = "timeOverviewCell";
    cell.textContent = formatHHMMUTC(dt);
    timeRow.appendChild(cell);
  });
  table.appendChild(timeRow);

  el.appendChild(table);
}

function formatDDMonYYYY(dt) {
  if (!dt || isNaN(dt)) return "--";
  const months = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"];
  return (
    (dt.getUTCDate() < 10 ? "0" : "") +
    dt.getUTCDate() +
    "-" +
    months[dt.getUTCMonth()] +
    "-" +
    dt.getUTCFullYear()
  );
}

function formatHHMMUTC(dt) {
  let H = dt.getUTCHours();
  let M = dt.getUTCMinutes();
  return (H < 10 ? "0" : "") + H + ":" + (M < 10 ? "0" : "") + M;
}
