/**************************************************************
 1) AUTH CHECK + LOGOUT
**************************************************************/
// On load, confirm user is signed in via Azure SWA:
fetch('/.auth/me')
  .then((res) => res.json())
  .then((data) => {
    if (!data.clientPrincipal) {
      // Not logged in => go to your login page
      // (change 'login.html' to 'index.html' if that's your real login page name)
      window.location.href = 'login.html';
      return;
    }
    // If logged in, show main content
    document.getElementById('mainContent').style.display = 'block';

    // Now that user is authenticated, we can safely init CSV + charts
    initCSVData();
  })
  .catch((err) => {
    console.error('Error checking auth on app.html:', err);
    // If error, also default to login
    window.location.href = 'login.html';
  });

// “Logout” => SWA sign-out
document.getElementById('btnLogout').addEventListener('click', () => {
  window.location.href = '/.auth/logout';
});


/**************************************************************
 2) SAS TOKEN & BLOB FETCH LOGIC
**************************************************************/
// Put your existing SAS token here:
let blobSasToken = "sp=r&st=2025-02-27T22:21:31Z&se=2025-03-30T06:21:31Z&spr=https&sv=2022-11-02&sr=b&sig=4zW%2F%2B8b1uUDg8ymjQJ4ZhHzpN59bsVMmvV4j%2B%2B0kzJw%3D";
// Blob base URL: your CSV in the $web container
const blobBaseUrl = "https://fxcharts.blob.core.windows.net/$web/OHLC_Snapshot.csv";

// If you want the user to update the token at runtime, add an input + button in app.html
document.getElementById("btnUpdateToken").addEventListener("click", () => {
  const inputEl = document.getElementById("sasTokenInput");
  blobSasToken = inputEl.value.trim();
  console.log("SAS token updated to:", blobSasToken);

  // Re-fetch the CSV with new token:
  initCSVData();

  // Update displayed expiry
  displayTokenExpiry();
});

displayTokenExpiry();
function displayTokenExpiry() {
  const expiryEl = document.getElementById("tokenExpiryInfo");
  expiryEl.textContent = ""; // Clear previous

  const expiryDate = parseTokenExpiry(blobSasToken);
  if (!expiryDate) {
    expiryEl.textContent = "Unable to parse token expiry.";
    expiryEl.style.color = ""; // default
    return;
  }

  const now = new Date();
  if (expiryDate <= now) {
    expiryEl.textContent = "Token has already expired!";
    expiryEl.style.color = "red";
    return;
  }

  // Compute difference
  const diffMs = expiryDate - now;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHrs = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const diffMin = Math.floor((diffMs / (1000 * 60)) % 60);

  // Show only if < 7 days remain
  if (diffDays < 7) {
    expiryEl.textContent = `Token expires in ${diffDays} day(s), ${diffHrs} hour(s), ${diffMin} min(s).`;
    expiryEl.style.color = "red";
  } else {
    // Hide or skip entirely
    expiryEl.textContent = "";
    expiryEl.style.color = "";
  }
}


function parseTokenExpiry(sas) {
  // Look for 'se=YYYY-MM-DDTHH:mm:ssZ'
  const parts = sas.split("&");
  const seParam = parts.find((p) => p.startsWith("se="));
  if (!seParam) return null;
  const dateStr = seParam.substring(3); // remove 'se='
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}


/**************************************************************
 3) FOREX DASHBOARD LOGIC
**************************************************************/
let rawCSVLines = [];
let csvHeader = [];
let newestCandleUTCms = 0;
let csvModifiedUTCms = Date.now();
const dataBySymbol = {};
const brokerOffsetHours = 2;

// Same rowConfigs as before
const rowConfigs = [
  { label: "AUD", symbols: ["AUDCAD","AUDCHF","AUDJPY","AUDNZD","AUDUSD","EURAUD","GBPAUD"] },
  { label: "CAD", symbols: ["CADCHF","CADJPY","AUDCAD","EURCAD","GBPCAD","NZDCAD","USDCAD"] },
  // etc...
  { label: "METALS", symbols: ["XAUUSD","XAGUSD"] }
];

// Splits lines by comma or tab
function splitLine(line) {
  line = line.replace(/^\uFEFF/, '');
  if (line.indexOf(",") !== -1) return line.split(",");
  if (line.indexOf("\t") !== -1) return line.split("\t");
  return [line];
}

/**
 * Load CSV data from Azure Blob using SAS token
 */
function initCSVData() {
  // If user updated the token in an input field, we have it in blobSasToken
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

        // Clean up header line
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
    .catch((err) => {
      console.error("Error loading CSV from Blob:", err);
    });
}

// Optional: manual CSV upload override
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
    console.log("CSV Header (upload):", csvHeader);

    findNewestCandleInEntireCSV();
    rebuildTimeframes();
    updateInfoCards();
  };
  reader.readAsText(file, "UTF-8");
});

// On timeframe/timeZone changes
document.getElementById("timeframeSelect").addEventListener("change", () => {
  setupGrid(document.getElementById("timeframeSelect").value);
});
document.getElementById("timeZoneSelect").addEventListener("change", () => {
  reParseAndRenderAll();
});

// Row label click => highlight row
document.addEventListener("click", (e) => {
  if (e.target && e.target.classList.contains("row-label")) {
    document.querySelectorAll(".row-label").forEach((lbl) => lbl.classList.remove("selected"));
    document.querySelectorAll(".chart-container").forEach((chart) => chart.classList.remove("selected"));
    e.target.classList.add("selected");

    const rowCurrency = e.target.textContent.trim();
    document.querySelectorAll(".chart-container").forEach((chart) => {
      if (chart.dataset.rowCurrency === rowCurrency) {
        chart.classList.add("selected");
      }
    });
  }
});

// Finds newest candle time from CSV
function findNewestCandleInEntireCSV() {
  newestCandleUTCms = 0;
  const idxBar = csvHeader.indexOf("BarTime");
  if (idxBar === -1) {
    console.warn("No BarTime column in CSV header.");
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
  // Choose H1 if present
  tfSel.value = uniqueTF.has("H1") ? "H1" : uniqueTF.values().next().value;

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
      let cId = "chart-" + row.label.replace(/[^A-Za-z0-9]/g, "") + "-" + sym.replace(/[^A-Za-z0-9]/g, "");
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

  // Render each chart container
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

  // If row currency doesn't match symbol prefix => pink
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
 4) INFO CARDS
**************************************************************/
function updateInfoCards() {
  updateNewestCandleCard();
  updateCSVModifiedCard();
  updateDataAgeCard();
  updateTimeOverviewCard();
}
setInterval(updateInfoCards, 60000);

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
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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

let refreshIntervalHandle = null;

document.getElementById("btnSetRefresh").addEventListener("click", () => {
  const isChecked = document.getElementById("autoRefreshCheck").checked;
  const intervalStr = document.getElementById("autoRefreshInterval").value;
  const intervalMin = parseInt(intervalStr, 10);

  // Clear existing interval if any
  if (refreshIntervalHandle) {
    clearInterval(refreshIntervalHandle);
    refreshIntervalHandle = null;
  }

  // If not checked or invalid interval, do nothing
  if (!isChecked || intervalMin <= 0) {
    console.log("Auto‐refresh disabled or invalid interval.");
    return;
  }

  // Enable auto‐refresh
  refreshIntervalHandle = setInterval(() => {
    console.log(`Auto‐refresh triggered, fetching new data from Blob...`);
    initCSVData();
  }, intervalMin * 60_000);

  console.log(`Auto‐refresh set for every ${intervalMin} minute(s).`);
});

