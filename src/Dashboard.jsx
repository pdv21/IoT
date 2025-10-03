import { useEffect, useMemo, useRef, useState } from "react";
import { Fan, Snowflake, Lightbulb, RotateCcw, Activity } from "lucide-react";
import "./styles/Dashboard.css";

const API_BASE = "http://localhost:4000";

/* ------------ helpers ------------- */
async function getSensors(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  ).toString();
  const r = await fetch(`${API_BASE}/api/sensors?${qs}`);
  if (!r.ok) throw new Error("Failed to load sensors");
  return r.json();
}
async function postAction(nameDevice, action) {
  const r = await fetch(`${API_BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nameDevice, action }),
  });
  if (!r.ok) {
    let msg = "Failed to send action";
    try { const j = await r.json(); msg = j?.error || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
async function getActionState() {
  const r = await fetch(`${API_BASE}/api/actions/state`);
  if (!r.ok) throw new Error("Failed to fetch action state");
  return r.json();
}
async function getDeviceOnline() {
  const r = await fetch(`${API_BASE}/api/device/online`);
  if (!r.ok) throw new Error("Failed to fetch device online");
  return r.json(); // { online, source, last_seen }
}

/* ------------ chart ------------- */
function LineChart({ data, width = 820, height = 360, padding = 48, series, maxXTicks = 10 }) {
  const yLeftMin = 0, yLeftMax = 100;
  const luxVals = data.map((d) => d.lux ?? 0);
  const luxMaxRaw = Math.max(...luxVals, 1);
  const nice = (n) => {
    const p = 10 ** Math.floor(Math.log10(n));
    const u = n / p;
    const s = u <= 1 ? 1 : u <= 2 ? 2 : u <= 5 ? 5 : 10;
    return s * p;
  };
  const yRightMax = nice(luxMaxRaw);
  const x = (i) => padding + (i * (width - padding * 2)) / Math.max(1, data.length - 1);
  const yL = (v) => height - padding - ((v - yLeftMin) * (height - padding * 2)) / (yLeftMax - yLeftMin || 1);
  const yR = (v) => height - padding - (v * (height - padding * 2)) / (yRightMax || 1);
  function safePath(key, axis) {
    let p = "";
    data.forEach((d, i) => {
      const val = d[key];
      if (val == null) return;
      const cmd = p === "" ? "M" : "L";
      p += `${cmd} ${x(i)} ${(axis === "right" ? yR : yL)(val)} `;
    });
    return p.trim();
  }
  const leftTicks = [0, 25, 50, 75, 100];
  const rtStep = yRightMax / 4;
  const rightTicks = [0, rtStep, rtStep * 2, rtStep * 3, yRightMax];
  const tickCount = Math.min(maxXTicks, Math.max(1, data.length));
  const tickIdxs = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (Math.max(1, data.length) - 1)) / (tickCount - 1 || 1))
  );
  const uniqTickIdxs = [...new Set(tickIdxs)];
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`}>
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="axis" />
      <line x1={width - padding} y1={padding} x2={width - padding} y2={height - padding} className="axis" />
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="axis" />
      {leftTicks.map((t, i) => (<line key={i} x1={padding} y1={yL(t)} x2={width - padding} y2={yL(t)} className="grid" />))}
      {series.map((s, i) => (<path key={i} d={safePath(s.key, s.axis)} className={`line ${s.className}`} />))}
      <g className="legend" transform={`translate(${padding},${padding - 12})`}>
        {series.map((s, i) => (
          <g key={i} transform={`translate(${i * 210},0)`}>
            <rect width="16" height="3" y="-4" className={`line ${s.className}`} />
            <text x="22" y="0">{s.label} {s.axis === "left" ? "(Left Y)" : "(Right Y)"}</text>
          </g>
        ))}
      </g>
      {uniqTickIdxs.map((idx) => (
        <text key={`xt-${idx}`} x={x(idx)} y={height - padding + 18} className="tick" textAnchor="middle">
          {data[idx]?.time}
        </text>
      ))}
      {leftTicks.map((t, i) => (
        <text key={`yl-${i}`} x={padding - 10} y={yL(t)} className="tick" textAnchor="end" dominantBaseline="middle">{t}</text>
      ))}
      {rightTicks.map((t, i) => (
        <text key={`yr-${i}`} x={width - padding + 10} y={yR(t)} className="tick" textAnchor="start" dominantBaseline="middle">
          {t.toLocaleString()}
        </text>
      ))}
    </svg>
  );
}

function Toggle({ on, onChange, disabled }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => !disabled && onChange(!on)} aria-pressed={on} disabled={disabled}>
      <span />
    </button>
  );
}

const tempLevel = (t) => (t >= 35 ? "temp-l3" : t >= 25 ? "temp-l2" : "temp-l1");
const humLevel  = (h) => (h > 60 ? "hum-l3" : h >= 30 ? "hum-l2" : "hum-l1");
const luxLevel  = (x) => (x > 800 ? "lux-l3" : x >= 300 ? "lux-l2" : "lux-l1");

export default function DashboardPage() {
  const [ac, setAc] = useState(false),
        [fan, setFan] = useState(false),
        [lamp, setLamp] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [error, setError] = useState("");

  const [live, setLive] = useState(true); // Live chỉ ảnh hưởng chart, KHÔNG ảnh hưởng trạng thái online
  const [sseState, setSseState] = useState("disconnected");

  // Kết nối thật (từ server, dựa trên USB + Sensor)
  const [connected, setConnected] = useState(false);

  // Lần cuối tắt Live (hiển thị cho vui)
  const [lastLiveOffAt, setLastLiveOffAt] = useState(null);

  const esChartRef = useRef(null);   // SSE cho chart (bật/tắt theo Live)
  const esStatusRef = useRef(null);  // SSE cho trạng thái (luôn bật)

  // Chart window
  const [windowMs, setWindowMs] = useState(10 * 60_000);
  const presets = [
    { label: "10 seconds", value: 10_000 },
    { label: "30 seconds", value: 30_000 },
    { label: "1 minute", value: 60_000 },
    { label: "5 minutes", value: 5 * 60_000 },
    { label: "10 minutes", value: 10 * 60_000 },
    { label: "30 minutes", value: 30 * 60_000 },
  ];

  // Data & KPI
  const [chartRows, setChartRows] = useState([]);
  const [latestRow, setLatestRow] = useState(null);

  async function fetchLatestRow() {
    const r = await getSensors({ sort: "time:desc", page: 1, limit: 1 });
    return r?.data?.[0] || null;
  }
  async function fetchWindowByNow(windowMsOverride) {
    const range = windowMsOverride ?? windowMs;
    const samplesPerSecGuess = 5;
    const effectiveLimit = Math.min(200000, Math.ceil((range / 1000) * samplesPerSecGuess) + 200);
    const toISO = new Date().toISOString();
    const fromISO = new Date(Date.now() - range).toISOString();
    const r = await getSensors({ from: fromISO, to: toISO, sort: "time:asc", page: 1, limit: effectiveLimit });
    const rows = r?.data || [];
    setChartRows(rows);
    const last = rows[rows.length - 1] ?? (await fetchLatestRow());
    setLatestRow(last || null);
  }
  async function syncActionState() {
    try {
      const s = await getActionState();
      if (typeof s.ac === "boolean") setAc(s.ac);
      if (typeof s.fan === "boolean") setFan(s.fan);
      if (typeof s.light === "boolean") setLamp(s.light);
    } catch {}
  }

  /* ====== INIT: seed online + state + window ====== */
  useEffect(() => {
    (async () => {
      try {
        setError("");
        const online = await getDeviceOnline().then((x) => !!x.online).catch(() => false);
        setConnected(online);
        await syncActionState();
        await fetchWindowByNow();
      } catch (e) {
        setError(e.message || "Load error");
      }
    })();
    // eslint-disable-next-line
  }, []);

  /* ====== SSE STATUS (luôn bật, không phụ thuộc Live) ====== */
  useEffect(() => {
    if (esStatusRef.current) { esStatusRef.current.close(); esStatusRef.current = null; }
    const es = new EventSource(`${API_BASE}/api/status/stream`);
    esStatusRef.current = es;

    es.addEventListener("device_online", (ev) => {
      try {
        const data = JSON.parse(ev.data); // { online, source, last_seen }
        const online = !!data.online;
        setConnected(online);
        if (online) syncActionState(); // vừa online -> đồng bộ nút theo trạng thái mong muốn
      } catch {}
    });
    es.onerror = () => { /* giữ yên; server sẽ tự push lại khi có thay đổi */ };

    return () => { es.close(); esStatusRef.current = null; };
  }, []);

  /* ====== LIVE: SSE CHART (bật/tắt theo Live) ====== */
/* ====== LIVE: SSE CHART (luôn có polling fallback, kể cả khi Live OFF) ====== */
useEffect(() => {
  let sseTimer;       // poll khi Live ON
  let fallbackTimer;  // poll khi Live OFF
  let es;

  // Helper: safe fetch
  const refetch = () => fetchWindowByNow().catch(() => {});

  if (live) {
    // Poll đều tay để cửa sổ tự trượt (kể cả khi SSE đứt)
    sseTimer = setInterval(refetch, 10_000);

    // Mở SSE cho chart
    if (esChartRef.current) { esChartRef.current.close(); esChartRef.current = null; }
    setSseState("connecting");
    es = new EventSource(`${API_BASE}/api/sensors/stream`);
    esChartRef.current = es;

    es.onopen = () => setSseState("open");
    es.onerror = () => setSseState("disconnected");

    es.addEventListener("init", refetch);
    es.addEventListener("new", refetch);
    es.onmessage = refetch;
  } else {
    // Live OFF vẫn tiếp tục vẽ dữ liệu từ DB (poll nhẹ hơn)
    setSseState("paused");
    if (esChartRef.current) { esChartRef.current.close(); esChartRef.current = null; }
    fallbackTimer = setInterval(refetch, 15_000);
    // gọi 1 nhịp ngay để cập nhật tức thời
    refetch();
  }

  return () => {
    if (sseTimer) clearInterval(sseTimer);
    if (fallbackTimer) clearInterval(fallbackTimer);
    if (esChartRef.current) { esChartRef.current.close(); esChartRef.current = null; }
  };
// eslint-disable-next-line
}, [live, windowMs]);


  /* ====== KPI & Chart view ====== */
  const latest = useMemo(() => {
    if (!latestRow) return { temp: 0, hum: 0, lux: 0 };
    return {
      temp: Number(latestRow.temperature),
      hum: Number(latestRow.humidity),
      lux: Number(latestRow.light),
    };
  }, [latestRow]);
  const tempCls = tempLevel(latest.temp);
  const humCls  = humLevel(latest.hum);
  const luxCls  = luxLevel(latest.lux);

  const chartView = useMemo(() => {
    const useSecond = windowMs <= 60_000;
    const unitMs = useSecond ? 1000 : 60_000;
    const steps = Math.max(1, Math.round(windowMs / unitMs));
    const bucket = new Map();
    for (const r of chartRows) {
      const d = new Date(r.time);
      if (useSecond) {
        const key = d.toISOString().slice(0, 19);
        const cur = bucket.get(key);
        if (!cur || d.getTime() > cur.ts) bucket.set(key, { row: r, ts: d.getTime() });
      } else {
        const key = d.toISOString().slice(0, 16);
        const sec = d.getSeconds();
        const score = Math.abs(sec);
        const cur = bucket.get(key);
        if (!cur || (!cur.exact && (sec === 0 || score < cur.score)) || (cur.exact && sec === 0 && d.getTime() > cur.ts)) {
          bucket.set(key, { row: r, score, exact: sec === 0, ts: d.getTime() });
        }
      }
    }
    const end = new Date(Math.floor(Date.now() / unitMs) * unitMs);
    const out = new Array(steps);
    let lastVal = { temp: undefined, hum: undefined, lux: undefined };
    for (let i = steps - 1; i >= 0; i--) {
      const t = new Date(end.getTime() - i * unitMs);
      const key = useSecond ? t.toISOString().slice(0, 19) : t.toISOString().slice(0, 16);
      const picked = bucket.get(key)?.row;
      const val = picked
        ? { temp: Number(picked.temperature), hum: Number(picked.humidity), lux: Number(picked.light) }
        : lastVal;
      out[steps - 1 - i] = {
        time: t.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        temp: val.temp ?? null, hum: val.hum ?? null, lux: val.lux ?? null,
      };
      if (picked) lastVal = val;
    }
    const firstIdx = out.findIndex((p) => p.temp != null || p.hum != null || p.lux != null);
    if (firstIdx > 0) {
      const firstVal = { temp: out[firstIdx].temp, hum: out[firstIdx].hum, lux: out[firstIdx].lux };
      for (let i = 0; i < firstIdx; i++) { out[i].temp = firstVal.temp; out[i].hum = firstVal.hum; out[i].lux = firstVal.lux; }
    }
    return out;
  }, [chartRows, windowMs]);

  /* ====== Actions ====== */
  async function handleRefresh() {
    try {
      setError("");
      await fetchWindowByNow();
      await syncActionState();
      const online = await getDeviceOnline().then((x) => !!x.online).catch(() => false);
      setConnected(online);
    } catch (e) { setError(e.message || "Refresh error"); }
  }
  async function handleAction(nameDevice, on) {
    try {
      setLoadingAction(true);
      await postAction(nameDevice, on ? "ON" : "OFF");
    } catch (e) {
      setError(e.message || "Action error");
      if (nameDevice === "air conditioner") setAc((v) => !v);
      if (nameDevice === "fan") setFan((v) => !v);
      if (nameDevice === "light") setLamp((v) => !v);
    } finally { setLoadingAction(false); }
  }
  function changeDeviceSafely(kind, next) {
    if (!connected) { alert("Chưa kết nối ESP32 — không thể điều khiển."); return; }
    if (kind === "air conditioner") setAc(next);
    else if (kind === "fan") setFan(next);
    else if (kind === "light") setLamp(next);
    handleAction(kind, next);
  }
  const handleToggleLive = () => {
    setLive((prev) => { const next = !prev; if (!next) setLastLiveOffAt(new Date()); return next; });
  };
  const lastPausedText =
    lastLiveOffAt &&
    lastLiveOffAt.toLocaleString("en-GB", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="board">
      {/* KPI */}
      <section className="kpis">
        <div className={`kpi ${tempCls} kpi-temp`}>
          <div className="kpi-inner">
            <div className="kpi-left">
              <div className="kpi-title"><Activity size={16} /> Temperature</div>
              <div className="kpi-value"><span className="num">{latest.temp}</span><span className="unit">°C</span></div>
            </div>
            <div className="kpi-icon"><img src="/device_thermostat.png" alt="" /></div>
          </div>
        </div>
        <div className={`kpi ${humLevel(latest.hum)} kpi-hum`}>
          <div className="kpi-inner">
            <div className="kpi-left">
              <div className="kpi-title"><Activity size={16} /> Humidity</div>
              <div className="kpi-value"><span className="num">{latest.hum}</span><span className="unit">%</span></div>
            </div>
            <div className="kpi-icon"><img src="/water_drop.png" alt="" /></div>
          </div>
        </div>
        <div className={`kpi ${luxLevel(latest.lux)} kpi-lux`}>
          <div className="kpi-inner">
            <div className="kpi-left">
              <div className="kpi-title"><Activity size={16} /> Light</div>
              <div className="kpi-value"><span className="num">{latest.lux}</span><span className="unit">lux</span></div>
            </div>
            <div className="kpi-icon"><img src="/sunny.png" alt="" /></div>
          </div>
        </div>
      </section>

      {/* CONTENT */}
      <section className="content">
        <div className="card chart-card">
          <LineChart
            data={chartView}
            series={[
              { key: "temp", label: "Temperature (°C)", className: "s-temp", axis: "left" },
              { key: "hum",  label: "Humidity (%)",    className: "s-hum",  axis: "left" },
              { key: "lux",  label: "Light (Lux)",     className: "s-lux",  axis: "right" },
            ]}
          />
        </div>

        {/* CONTROLS */}
        <div className="card controls">
          <div className="controls-head">
            <div className="actions">
              <button className={`btn ${live ? "primary" : ""}`} onClick={handleToggleLive}>
                {live ? "Live On" : "Live Off"}
              </button>
              <button className="btn refresh" onClick={handleRefresh}>
                <RotateCcw size={16} /> Refresh
              </button>
            </div>

            <div className="live-meta">
              <span className={`badge ${connected ? "on" : "off"}`} style={{ marginRight: 8 }} title={`SSE: ${sseState}`}>
                {connected ? "ESP32: Online" : "ESP32: Offline"}
              </span>
              {lastPausedText && <>Last paused: {lastPausedText}</>}
            </div>
          </div>

          <div className="controls-subrow">
            <span className="cw-label">Chart window:</span>
            <select
              value={windowMs}
              onChange={async (e) => { const v = +e.target.value; setWindowMs(v); await fetchWindowByNow(v); }}
              className="btn cw-select"
              title="Hiển thị dữ liệu trong vòng N đơn vị thời gian gần nhất"
            >
              {[
                { label: "10 seconds", value: 10_000 },
                { label: "30 seconds", value: 30_000 },
                { label: "1 minute", value: 60_000 },
                { label: "5 minutes", value: 5 * 60_000 },
                { label: "10 minutes", value: 10 * 60_000 },
                { label: "30 minutes", value: 30 * 60_000 },
              ].map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div className={`control ${ac ? "on" : "off"}`}>
            <div className="icon ac"><Snowflake /></div>
            <div className="label">
              <div className="name">Air conditioner</div>
              <div className="sub">Cooling control • Auto</div>
            </div>
            <div className="right">
              <span className={`badge ${ac ? "on" : "off"}`}>{ac ? "ON" : "OFF"}</span>
              <Toggle on={ac} onChange={(v) => changeDeviceSafely("air conditioner", v)} disabled={loadingAction || !connected} />
            </div>
          </div>

          <div className={`control ${fan ? "on" : "off"}`}>
            <div className="icon fan"><Fan /></div>
            <div className="label">
              <div className="name">Fan</div>
              <div className="sub">Air circulation</div>
            </div>
            <div className="right">
              <span className={`badge ${fan ? "on" : "off"}`}>{fan ? "ON" : "OFF"}</span>
              <Toggle on={fan} onChange={(v) => changeDeviceSafely("fan", v)} disabled={loadingAction || !connected} />
            </div>
          </div>

          <div className={`control ${lamp ? "on" : "off"}`}>
            <div className="icon light"><Lightbulb /></div>
            <div className="label">
              <div className="name">Light</div>
              <div className="sub">Ambient lighting</div>
            </div>
            <div className="right">
              <span className={`badge ${lamp ? "on" : "off"}`}>{lamp ? "ON" : "OFF"}</span>
              <Toggle on={lamp} onChange={(v) => changeDeviceSafely("light", v)} disabled={loadingAction || !connected} />
            </div>
          </div>

          {!connected && <div className="hint muted" style={{ marginTop: 8 }}>ESP32 disconnected — the control button is temporarily locked.</div>}
        </div>
      </section>

      {error && <div className="card error">{error}</div>}
    </div>
  );
}
