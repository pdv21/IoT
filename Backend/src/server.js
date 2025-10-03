import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db.js';
import { sendByDeviceName, sendCommandByActionString } from './mqtt.js';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ==================== ONLINE TRACKING (USB + SENSOR) ==================== */
/** Online nếu: (A) tìm thấy thiết bị USB phù hợp, HOẶC (B) có mẫu SensorData trong <= ONLINE_WINDOW_MS */
const ONLINE_WINDOW_MS = 15_000;

// Cho phép cấu hình nhận diện USB qua ENV (khuyến nghị thiết lập để nhận diện chính xác):
//   ESP_VID=10C4        (vendorId, hex không '0x')
//   ESP_PID=EA60        (productId, hex)
//   ESP_PATH=ttyUSB     (chuỗi gợi ý trong path, ví dụ 'ttyUSB' / 'COM' / 'cu.SLAB_USBtoUART')
const USB_HINT = {
  vid: (process.env.ESP_VID || '').toLowerCase(),
  pid: (process.env.ESP_PID || '').toLowerCase(),
  pathHint: (process.env.ESP_PATH || '')
};

let SerialPortListFn = null;
try {
  // Dùng dynamic import để không crash nếu chưa cài "serialport"
  const mod = await import('serialport');
  SerialPortListFn = mod.SerialPort?.list || mod.SerialPortList || null;
} catch {
  SerialPortListFn = null;
}

async function detectUsbOnline() {
  if (!SerialPortListFn) return { online: false, via: 'sensor-only' };
  try {
    const ports = await SerialPortListFn();
    const match = ports.find(p => {
      const vid = (p.vendorId || '').toLowerCase();
      const pid = (p.productId || '').toLowerCase();
      const path = (p.path || '');
      const byVid = USB_HINT.vid && vid === USB_HINT.vid;
      const byPid = USB_HINT.pid && pid === USB_HINT.pid;
      const byPath = USB_HINT.pathHint && path.includes(USB_HINT.pathHint);
      return byVid || byPid || byPath;
    });
    return { online: !!match, via: 'usb' };
  } catch {
    return { online: false, via: 'sensor-only' };
  }
}

async function getLastSensorTime() {
  const [[row]] = await pool.query('SELECT MAX(time) AS last FROM SensorData');
  return row?.last ? new Date(row.last) : null;
}
async function detectSensorOnline() {
  const last = await getLastSensorTime();
  if (!last) return { online: false, last_seen: null };
  const diff = Date.now() - last.getTime();
  return { online: diff <= ONLINE_WINDOW_MS, last_seen: last };
}

// Tập tất cả client SSE (cả status stream lẫn sensors stream)
const sseClients = new Set();

function broadcast(event, dataObj) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(dataObj || {})}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

// Gửi lại trạng thái mong muốn khi thiết bị online trở lại
async function resendLatestActionsIfOnline() {
  const want = {};
  const [rows] = await pool.query(
    `SELECT da.nameDevice, da.action
       FROM DeviceActions da
       INNER JOIN (
         SELECT nameDevice, MAX(timestamp) AS ts
         FROM DeviceActions
         WHERE nameDevice IN ('air conditioner','fan','light')
         GROUP BY nameDevice
       ) t
       ON da.nameDevice = t.nameDevice AND da.timestamp = t.ts`
  );
  for (const r of rows) {
    want[String(r.nameDevice).toLowerCase()] = String(r.action).toUpperCase();
  }
  // Gửi lại các lệnh ON mong muốn (chờ 1s để firmware khởi động xong)
  setTimeout(() => {
    for (const name of ['air conditioner','fan','light']) {
      const act = want[name] || 'OFF';
      if (act === 'ON') {
        try { sendByDeviceName(name, 'ON'); } catch {}
      }
    }
  }, 1000);
}

// Trạng thái online hợp nhất
let prevOnline = null;
let lastOnlineSource = 'unknown';
let lastSeenAt = null;

async function recomputeAndBroadcastOnline(reason = 'poll') {
  const usb = await detectUsbOnline();                 // {online, via}
  const sens = await detectSensorOnline();             // {online, last_seen}
  const online = usb.online || sens.online;
  lastOnlineSource = usb.online ? 'usb' : (sens.online ? 'sensor' : 'none');
  lastSeenAt = sens.last_seen || (online ? new Date() : lastSeenAt);

  if (prevOnline === null || online !== prevOnline) {
    broadcast('device_online', { online, source: lastOnlineSource, last_seen: lastSeenAt });
    // Nếu vừa online lại → phục hồi trạng thái
    if (online === true && prevOnline === false) {
      await resendLatestActionsIfOnline();
    }
    prevOnline = online;
  }
}

/* ==================== HEALTH ==================== */
app.get('/health', async (_req, res) => {
  try {
    const [r] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: r[0].ok === 1 });
  } catch {
    res.json({ ok: false });
  }
});

/* ==================== SENSORS (giữ nguyên logic cũ) ==================== */
const SENSOR_SORT_WHITELIST = new Set(['id','temperature','humidity','light','time']);
function parseSort(sort = 'time:desc') {
  let [col, dir] = String(sort).split(':');
  col = (col || 'time').toLowerCase();
  dir = (dir || 'desc').toUpperCase();
  if (!SENSOR_SORT_WHITELIST.has(col)) col = 'time';
  if (!['ASC','DESC'].includes(dir)) dir = 'DESC';
  return { col, dir };
}
function expandAt(atStr) {
  if (!atStr) return [null, null];
  const now = new Date();
  const s = atStr.trim();
  const hhmm = /^(\d{1,2}):(\d{2})$/;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ymd_hm = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
  const ymd_hms = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
  let from, to;
  if (hhmm.test(s)) {
    const [,H,M] = s.match(hhmm);
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +H, +M, 0, 0);
    to   = new Date(from); to.setSeconds(59, 999);
    return [from, to];
  }
  if (ymd.test(s)) {
    const [,Y,m,d] = s.match(ymd);
    from = new Date(+Y, +m-1, +d, 0, 0, 0, 0);
    to   = new Date(+Y, +m-1, +d, 23, 59, 59, 999);
    return [from, to];
  }
  if (ymd_hm.test(s)) {
    const [,Y,m,d,H,M] = s.match(ymd_hm);
    from = new Date(+Y, +m-1, +d, +H, +M, 0, 0);
    to   = new Date(from); to.setSeconds(59, 999);
    return [from, to];
  }
  if (ymd_hms.test(s)) {
    const [,Y,m,d,H,M,S] = s.match(ymd_hms);
    from = new Date(+Y, +m-1, +d, +H, +M, +S, 0);
    to   = new Date(from); to.setMilliseconds(999);
    return [from, to];
  }
  const dt = new Date(s);
  if (!isNaN(dt)) {
    from = new Date(dt); from.setSeconds(0,0);
    to   = new Date(from); to.setSeconds(59,999);
    return [from, to];
  }
  return [null, null];
}

app.get('/api/sensors', async (req, res) => {
  try {
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const offset = (page - 1) * limit;

    const { col, dir } = parseSort(req.query.sort);
    const qRaw  = (req.query.q || '').trim();
    const key   = String(req.query.key || '').toLowerCase();
    const where = [];
    const params = [];

    if (req.query.at) {
      const [from, to] = expandAt(req.query.at);
      if (from && to) { where.push('time BETWEEN ? AND ?'); params.push(from, to); }
    } else {
      if (req.query.from) { where.push('time >= ?'); params.push(new Date(req.query.from)); }
      if (req.query.to)   { where.push('time <= ?'); params.push(new Date(req.query.to)); }
    }

    if (qRaw) {
      const NUMERIC_COLS = new Set(['temperature','humidity','light']);
      if (NUMERIC_COLS.has(key)) {
        if (/^[0-9]+$/.test(qRaw)) {
          const n = parseInt(qRaw, 10);
          where.push(`${key} >= ? AND ${key} < ?`);
          params.push(n, n + 1);
        } else if (/^[0-9]+\.[0-9]*$/.test(qRaw)) {
          where.push(`CAST(${key} AS CHAR) LIKE ?`);
          params.push(`${qRaw}%`);
        } else {
          where.push(`CAST(${key} AS CHAR) LIKE ?`);
          params.push(`%${qRaw}%`);
        }
      } else {
        const num = Number(qRaw);
        if (!Number.isNaN(num)) {
          where.push('(temperature = ? OR humidity = ? OR light = ?)');
          params.push(num, num, Math.trunc(num));
        } else {
          where.push('(CAST(temperature AS CHAR) LIKE ? OR CAST(humidity AS CHAR) LIKE ? OR CAST(light AS CHAR) LIKE ?)');
          params.push(`%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`);
        }
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT id, temperature, humidity, light, time
         FROM SensorData
         ${whereSql}
         ORDER BY ${col} ${dir}
         LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM SensorData ${whereSql}`,
      params
    );

    res.json({
      data: rows,
      page, limit, total,
      pages: Math.max(1, Math.ceil(total / limit)),
      sort: `${col}:${dir}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ==================== ACTIONS LIST ==================== */
app.get('/api/actions', async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const offset = (page - 1) * limit;

    const sort = (req.query.sort || 'timestamp:desc');
    let [col, dir] = String(sort).split(':');
    col = ['id','nameDevice','action','timestamp'].includes(col) ? col : 'timestamp';
    dir = (dir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const where = [];
    const params = [];
    const q = (req.query.q || '').trim();
    if (q) { where.push('(nameDevice LIKE ? OR action LIKE ?)'); params.push(`%${q}%`,`%${q}%`); }
    if (req.query.from) { where.push('timestamp >= ?'); params.push(new Date(req.query.from)); }
    if (req.query.to)   { where.push('timestamp <= ?'); params.push(new Date(req.query.to)); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT id, nameDevice, action, timestamp
       FROM DeviceActions
       ${whereSql}
       ORDER BY ${col} ${dir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM DeviceActions ${whereSql}`,
      params
    );

    res.json({ data: rows, page, limit, total, pages: Math.max(1, Math.ceil(total/limit)), sort: `${col}:${dir}` });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

/* ==================== ACTIONS WRITE (CHẶN KHI OFFLINE) ==================== */
app.post('/api/actions', async (req, res) => {
  try {
    const { nameDevice, action, actionText } = req.body || {};

    // CHẶN nếu thiết bị đang offline (USB hoặc Sensor đều báo off)
    await recomputeAndBroadcastOnline('pre-post');
    if (prevOnline === false) {
      return res.status(503).json({ error: 'Device is offline' });
    }

    if (actionText) {
      sendCommandByActionString(actionText);
      await pool.query('INSERT INTO DeviceActions (nameDevice, action) VALUES (?, ?)', [nameDevice || '', actionText]);
      return res.status(201).json({ ok: true });
    }

    if (!nameDevice || !action) {
      return res.status(400).json({ error: 'nameDevice (fan|air conditioner|light) & action (ON|OFF) are required' });
    }

    sendByDeviceName(nameDevice, action);
    await pool.query('INSERT INTO DeviceActions (nameDevice, action) VALUES (?, ?)',
                     [nameDevice, action.toUpperCase()]);

    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ==================== ACTIONS STATE (SOURCE OF TRUTH) ==================== */
app.get('/api/actions/state', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT da.nameDevice, da.action
         FROM DeviceActions da
         INNER JOIN (
           SELECT nameDevice, MAX(timestamp) AS ts
           FROM DeviceActions
           WHERE nameDevice IN ('air conditioner','fan','light')
           GROUP BY nameDevice
         ) t
         ON da.nameDevice = t.nameDevice AND da.timestamp = t.ts`
    );
    const state = { 'air conditioner': false, fan: false, light: false };
    for (const r of rows) {
      const name = String(r.nameDevice || '').toLowerCase();
      const on = String(r.action || '').toUpperCase() === 'ON';
      if (name in state) state[name] = on;
    }
    res.json({ ac: state['air conditioner'], fan: state['fan'], light: state['light'] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read action state' });
  }
});

/* ==================== ONLINE INFO API ==================== */
app.get('/api/device/online', async (_req, res) => {
  try {
    await recomputeAndBroadcastOnline('http');
    res.json({ online: prevOnline === true, source: lastOnlineSource, last_seen: lastSeenAt });
  } catch {
    res.status(500).json({ error: 'Cannot determine device online state' });
  }
});

/* ==================== SSE: SENSORS STREAM (giữ, nhưng cũng add vào sseClients) ==================== */
app.get('/api/sensors/stream', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders?.();

  sseClients.add(res);

  const windowMin = Math.max(parseInt(req.query.window) || 10, 1);

  try {
    const [initRows] = await pool.query(
      `SELECT id, temperature, humidity, light, time
       FROM SensorData
       WHERE time >= NOW() - INTERVAL ? MINUTE
       ORDER BY time ASC`,
      [windowMin]
    );
    res.write(`event: init\n`);
    res.write(`data: ${JSON.stringify(initRows)}\n\n`);
  } catch (e) {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'Init query failed' })}\n\n`);
  }

  // Gửi trạng thái online hiện thời ngay khi kết nối
  await recomputeAndBroadcastOnline('sensors:open');

  req.on('close', () => {
    sseClients.delete(res);
    res.end();
  });
});

/* ==================== SSE: STATUS STREAM (mới, chỉ để nghe device_online) ==================== */
app.get('/api/status/stream', async (_req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders?.();

  sseClients.add(res);

  // Gửi trạng thái hiện tại ngay khi client nối vào
  await recomputeAndBroadcastOnline('status:open');

  _req.on('close', () => {
    sseClients.delete(res);
    res.end();
  });
});

/* ==================== PERIODIC PUSH ==================== */
let lastId = 0;
async function periodicPush() {
  // new sensor row
  try {
    const [rows] = await pool.query(
      `SELECT id, temperature, humidity, light, time
       FROM SensorData
       ORDER BY id DESC
       LIMIT 1`
    );
    if (rows.length && rows[0].id !== lastId) {
      lastId = rows[0].id;
      broadcast('new', rows[0]);
    }
  } catch {}

  // online (kết hợp USB + Sensor)
  await recomputeAndBroadcastOnline('poll');
}
setInterval(periodicPush, 2000);

/* ==================== START ==================== */
const port = +process.env.PORT || 4000;
app.listen(port, () => console.log(`API running at http://localhost:${port}`));
