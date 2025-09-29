import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db.js';
import { sendByDeviceName, sendCommandByActionString } from './mqtt.js';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== Utils: sort & time parsing =====
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

// ===== Health =====
app.get('/health', async (_req, res) => {
  try {
    const [r] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: r[0].ok === 1 });
  } catch {
    res.json({ ok: false });
  }
});

// ===== SensorData API =====
// Hỗ trợ: /api/sensors?key=temperature|humidity|light&q=...&at=...&from=...&to=...&sort=col:dir&page=&limit=
app.get('/api/sensors', async (req, res) => {
  try {
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const offset = (page - 1) * limit;

    const { col, dir } = parseSort(req.query.sort);
    const qRaw  = (req.query.q || '').trim();
    const key   = String(req.query.key || '').toLowerCase(); // NEW
    const where = [];
    const params = [];

    // --- Thời gian: ưu tiên `at` (mở rộng tới phút/giờ/ngày), sau đó from/to ---
    if (req.query.at) {
      const [from, to] = expandAt(req.query.at);
      if (from && to) { where.push('time BETWEEN ? AND ?'); params.push(from, to); }
    } else {
      if (req.query.from) { where.push('time >= ?'); params.push(new Date(req.query.from)); }
      if (req.query.to)   { where.push('time <= ?'); params.push(new Date(req.query.to)); }
    }

    // --- Tìm theo giá trị ---
    if (qRaw) {
      const NUMERIC_COLS = new Set(['temperature','humidity','light']);

      // Nếu có `key` hợp lệ -> chỉ tìm đúng 1 cột đó
      if (NUMERIC_COLS.has(key)) {
        // 1) Số nguyên: n  =>  n.00 .. < n+1 (bao trọn .xx)
        if (/^[0-9]+$/.test(qRaw)) {
          const n = parseInt(qRaw, 10);
          where.push(`${key} >= ? AND ${key} < ?`);
          params.push(n, n + 1);
        }
        // 2) Tiền tố thập phân: "39." hay "39.5" => dùng LIKE bắt đầu bằng tiền tố
        else if (/^[0-9]+\.[0-9]*$/.test(qRaw)) {
          where.push(`CAST(${key} AS CHAR) LIKE ?`);
          // "39." -> "39.%", "39.5" -> "39.5%"
          params.push(`${qRaw}%`);
        }
        // 3) Chuỗi khác => contains
        else {
          where.push(`CAST(${key} AS CHAR) LIKE ?`);
          params.push(`%${qRaw}%`);
        }
      }
      // Nếu KHÔNG có `key` -> giữ hành vi tổng quát hiện tại (tìm trên cả 3 cột)
      else {
        const num = Number(qRaw);
        if (!Number.isNaN(num)) {
          // so sánh bằng số cho temperature/humidity; light có thể là int
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

// ===== DeviceActions API =====
app.get('/api/actions', async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const offset = (page - 1) * limit;

    // sort theo timestamp hoặc id
    const sort = (req.query.sort || 'timestamp:desc');
    let [col, dir] = String(sort).split(':');
    col = ['id','nameDevice','action','timestamp'].includes(col) ? col : 'timestamp';
    dir = (dir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const where = [];
    const params = [];
    const q = (req.query.q || '').trim();
    if (q) {
      where.push('(nameDevice LIKE ? OR action LIKE ?)');
      params.push(`%${q}%`,`%${q}%`);
    }
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

// Gửi lệnh điều khiển: body { nameDevice?, action: "LED1:ON" }
app.post('/api/actions', async (req, res) => {
  try {
    const { nameDevice, action, actionText } = req.body || {};

    if (actionText) {
      // hỗ trợ ngược định dạng LED1:ON
      sendCommandByActionString(actionText);
      await pool.query('INSERT INTO DeviceActions (nameDevice, action) VALUES (?, ?)',
                       [nameDevice || '', actionText]);
      return res.status(201).json({ ok: true });
    }

    if (!nameDevice || !action) {
      return res.status(400).json({ error: 'nameDevice (fan|air conditioner|light) & action (ON|OFF) are required' });
    }

    // publish MQTT đúng thiết bị
    sendByDeviceName(nameDevice, action);

    // lưu log (ghi đúng tên thiết bị bạn yêu cầu)
    await pool.query('INSERT INTO DeviceActions (nameDevice, action) VALUES (?, ?)',
                     [nameDevice, action.toUpperCase()]);

    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== Sensors SSE stream (realtime) =====
app.get('/api/sensors/stream', async (req, res) => {
  // headers SSE
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders?.();

  // tham số cửa sổ chart (phút), mặc định 10
  const windowMin = Math.max(parseInt(req.query.window) || 10, 1);

  // gửi dữ liệu khởi tạo cho chart: 10 phút gần nhất
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

  // theo dõi bản ghi mới (poll nhẹ DB)
  let lastId = 0;
  const checkLatest = async () => {
    try {
      const [rows] = await pool.query(
        `SELECT id, temperature, humidity, light, time
         FROM SensorData
         ORDER BY id DESC
         LIMIT 1`
      );
      if (rows.length && rows[0].id !== lastId) {
        lastId = rows[0].id;
        res.write(`event: new\n`);
        res.write(`data: ${JSON.stringify(rows[0])}\n\n`);
      }
    } catch { /* bỏ qua lần lỗi đơn lẻ */ }
  };

  // heartbeat để giữ kết nối
  const hb = setInterval(() => {
    res.write(`event: ping\ndata: {}\n\n`);
  }, 15000);

  const poll = setInterval(checkLatest, 2000); // 2s/lần

  // dọn khi client đóng
  req.on('close', () => {
    clearInterval(poll);
    clearInterval(hb);
    res.end();
  });
});


// ===== Start server =====
const port = +process.env.PORT || 4000;
app.listen(port, () => console.log(`API running at http://localhost:${port}`));
