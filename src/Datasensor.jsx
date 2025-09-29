import { useEffect, useMemo, useRef, useState } from "react";
import "./styles/Datasensor.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

const COLUMNS = [
  { key: "id", label: "ID", width: 80 },
  { key: "temperature", label: "Temperature (°C)" },
  { key: "humidity", label: "Humidity (%)" },
  { key: "light", label: "Light (Lux)" },
  { key: "time", label: "Time", width: 260 },
];

const NUMERIC_FIELDS = ["temperature", "humidity", "light"];

/* ================== TIME HELPERS ================== */
// formats for input
const RE_HHMMSS = /^(\d{1,2}):(\d{2}):(\d{2})$/; // 14:10:05
const RE_HHMM = /^(\d{1,2}):(\d{2})$/; // 14:10
const RE_YMD_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/; // 2025/09/28
const RE_YMD_SLASH_HM = /^(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2})$/; // 2025/09/28 14:10
const RE_YMD_SLASH_HMS =
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/; // 2025/09/28 14:10:05
// (giữ thêm dạng gạch để tương thích nếu người dùng gõ nhầm)
const RE_YMD_DASH = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const RE_YMD_DASH_HM = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/;
const RE_YMD_DASH_HMS =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/;

const pad = (n) => String(n).padStart(2, "0");

// Hiển thị/copy: YYYY/MM/DD HH:MM:SS
function fmtSlashColon(d) {
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Parse chuỗi người dùng → khoảng thời gian [fromISO, toISO]
 *  - HH:MM:SS  -> 1 giây (hôm nay)
 *  - HH:MM     -> cả phút (hôm nay)
 *  - YYYY/MM/DD HH:MM:SS -> 1 giây ngày chỉ định
 *  - YYYY/MM/DD HH:MM    -> cả phút ngày chỉ định
 *  - YYYY/MM/DD          -> cả ngày
 */
function parseTimeFilter(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;

  let m;

  // Hôm nay - giây
  if ((m = s.match(RE_HHMMSS))) {
    const [_, H, M, S] = m;
    const now = new Date();
    const from = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      +H,
      +M,
      +S,
      0
    );
    const to = new Date(from.getTime() + 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }

  // Hôm nay - phút
  if ((m = s.match(RE_HHMM))) {
    const [_, H, M] = m;
    const now = new Date();
    const from = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      +H,
      +M,
      0,
      0
    );
    const to = new Date(from.getTime() + 59_999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }

  // Dạng slash - ngày/giờ/phút/giây
  if ((m = s.match(RE_YMD_SLASH_HMS))) {
    const [_, Y, Mo, D, H, Mi, S] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, +S, 0);
    const to = new Date(from.getTime() + 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_YMD_SLASH_HM))) {
    const [_, Y, Mo, D, H, Mi] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, 0, 0);
    const to = new Date(from.getTime() + 59_999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_YMD_SLASH))) {
    const [_, Y, Mo, D] = m;
    const from = new Date(+Y, +Mo - 1, +D, 0, 0, 0, 0);
    const to = new Date(+Y, +Mo - 1, +D, 23, 59, 59, 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }

  // Dạng dash (tương thích)
  if ((m = s.match(RE_YMD_DASH_HMS))) {
    const [_, Y, Mo, D, H, Mi, S] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, +S, 0);
    const to = new Date(from.getTime() + 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_YMD_DASH_HM))) {
    const [_, Y, Mo, D, H, Mi] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, 0, 0);
    const to = new Date(from.getTime() + 59_999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_YMD_DASH))) {
    const [_, Y, Mo, D] = m;
    const from = new Date(+Y, +Mo - 1, +D, 0, 0, 0, 0);
    const to = new Date(+Y, +Mo - 1, +D, 23, 59, 59, 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }

  return null;
}
/* ================================================== */

export default function DataSensor() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Tìm kiếm
  const [searchBy, setSearchBy] = useState("all"); // all|temperature|humidity|light
  const [pendingQuery, setPendingQuery] = useState("");
  const [query, setQuery] = useState("");

  // Phân trang & sort
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState("time");
  const [sortDir, setSortDir] = useState("desc");

  // Trạng thái
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Copy time feedback
  const [copiedAt, setCopiedAt] = useState(null);
  const copyTimer = useRef(null);

  // Fetch
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pageSize),
          sort: `${sortField}:${sortDir}`,
        });

        const q = query.trim();
        if (q) {
          // Thời gian ưu tiên: hỗ trợ YYYY/MM/DD HH:MM:SS & HH:MM:SS …
          const tf = parseTimeFilter(q);
          if (tf) {
            params.set("from", tf.fromISO);
            params.set("to", tf.toISO);
            // (gửi kèm at cho backend nào có hỗ trợ)
            // at = phút chính xác "YYYY-MM-DD HH:MM" hoặc "YYYY-MM-DD HH:MM:SS" – ở đây không bắt buộc
          } else {
            // Giá trị số/chuỗi
            const isInt = /^[0-9]+$/.test(q);
            if (
              searchBy !== "all" &&
              NUMERIC_FIELDS.includes(searchBy) &&
              isInt
            ) {
              params.set("q", q); // <-- gửi "10" thuần cho backend
              params.set("key", searchBy);
            } else {
              params.set("q", q);
              if (searchBy !== "all") params.set("key", searchBy);
            }
          }
        }

        const url = `${API_BASE}/api/sensors?${params.toString()}`;
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const list = Array.isArray(json.data) ? json.data : [];
        const t = Number(json.total) || 0;
        setRows(list);
        setTotal(t);
        setPages(Number(json.pages) || Math.max(1, Math.ceil(t / pageSize)));
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error(err);
          setError("Không tải được dữ liệu. Vui lòng thử lại.");
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [page, pageSize, query, searchBy, sortField, sortDir]);

  // Phân trang
  const pageCount = Math.max(1, pages);
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * pageSize;
  const goto = (p) => setPage(Math.min(pageCount, Math.max(1, p)));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount]);

  const pageWindow = useMemo(() => {
    const span = 5;
    const begin = Math.max(1, curPage - Math.floor(span / 2));
    const end = Math.min(pageCount, begin + span - 1);
    const arr = [];
    for (let i = Math.max(1, end - span + 1); i <= end; i++) arr.push(i);
    return arr;
  }, [curPage, pageCount]);

  // Sort header
  const caret = (key) =>
    sortField !== key ? "↕" : sortDir === "asc" ? "▲" : "▼";
  const onHeaderSort = (key) => {
    if (sortField === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  // Search triggers
  const doSearch = () => {
    setQuery(pendingQuery);
    setPage(1);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") doSearch();
  };

  // Copy time -> YYYY/MM/DD HH:MM:SS
  const copyTime = async (isoStr, id) => {
    try {
      const text = isoStr ? fmtSlashColon(new Date(isoStr)) : "";
      await navigator.clipboard.writeText(text);
      clearTimeout(copyTimer.current);
      setCopiedAt(id);
      copyTimer.current = setTimeout(() => setCopiedAt(null), 1200);
    } catch {}
  };

  return (
    <div className="board board-ds">
      <div className="ds-wrap">
        <div className="ds-top">
          <h1 className="ds-title">Data Sensor</h1>

          <div className="ds-controls" style={{ display: "flex", gap: 8 }}>
            <select
              value={searchBy}
              onChange={(e) => setSearchBy(e.target.value)}
              aria-label="Chọn trường tìm kiếm"
              className="ds-select"
            >
              <option value="all">All</option>
              <option value="temperature">Temperature</option>
              <option value="humidity">Humidity</option>
              <option value="light">Light</option>
            </select>

            <input
              className="ds-search"
              placeholder={
                searchBy === "all"
                  ? "YYYY/MM/DD HH:MM(:SS) hoặc giá trị"
                  : `Search by ${searchBy}`
              }
              value={pendingQuery}
              onChange={(e) => setPendingQuery(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Ô tìm kiếm"
            />

            <button
              className="ds-search-btn"
              onClick={doSearch}
              disabled={loading}
              title="Search"
            >
              Search
            </button>
          </div>
        </div>

        <div className="ds-card">
          <div className="ds-scroller">
            <table className="ds-table ds-sticky">
              <colgroup>
                {COLUMNS.map(({ width }, i) => (
                  <col key={i} style={width ? { width } : undefined} />
                ))}
              </colgroup>

              <thead>
                <tr>
                  {COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      aria-sort={
                        sortField === key
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <div
                        className="th-sort"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span className="th-label">{label}</span>
                        <button
                          type="button"
                          className={`sort-btn ${
                            sortField === key ? "active" : ""
                          }`}
                          onClick={() => onHeaderSort(key)}
                          title={
                            sortField === key
                              ? sortDir === "asc"
                                ? "Sắp xếp giảm dần"
                                : "Sắp xếp tăng dần"
                              : "Sắp xếp tăng dần"
                          }
                          aria-label={`Sắp xếp theo ${label}`}
                          disabled={loading}
                          style={{
                            border: "1px solid #ddd",
                            background: "#fff",
                            borderRadius: 6,
                            padding: "2px 6px",
                            lineHeight: 1,
                            cursor: loading ? "not-allowed" : "pointer",
                          }}
                        >
                          <span className="sort-caret">{caret(key)}</span>
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {error && (
                  <tr>
                    <td className="empty" colSpan={COLUMNS.length}>
                      {error}
                    </td>
                  </tr>
                )}

                {!error &&
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="id">{String(r.id).padStart(2, "0")}</td>
                      <td>{r.temperature}</td>
                      <td>{r.humidity}</td>
                      <td>{r.light}</td>
                      <td>
                        <button
                          className="time-copy-btn"
                          onClick={() => copyTime(r.time, r.id)}
                          title="Click to copy (YYYY/MM/DD HH:MM:SS)"
                        >
                          {r.time ? fmtSlashColon(new Date(r.time)) : ""}
                        </button>
                        {copiedAt === r.id && (
                          <span className="copied-tip"> Copied!</span>
                        )}
                      </td>
                    </tr>
                  ))}

                {!error && rows.length === 0 && !loading && (
                  <tr>
                    <td className="empty" colSpan={COLUMNS.length}>
                      No results
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td className="empty" colSpan={COLUMNS.length}>
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="ds-footer">
            <div className="ds-results">
              Results: {total === 0 ? 0 : start + 1} -{" "}
              {Math.min(start + pageSize, total)} of {total}
            </div>

            <div className="ds-pager">
              <select
                className="ds-psize"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                aria-label="Số dòng mỗi trang"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <button
                className="pg"
                onClick={() => goto(1)}
                disabled={curPage === 1 || loading}
                title="Trang đầu"
              >
                «
              </button>
              <button
                className="pg"
                onClick={() => goto(curPage - 1)}
                disabled={curPage === 1 || loading}
                title="Trang trước"
              >
                ‹
              </button>

              {pageWindow[0] > 1 && <span className="dots">…</span>}
              {pageWindow.map((p) => (
                <button
                  key={p}
                  className={`pg num ${p === curPage ? "active" : ""}`}
                  onClick={() => goto(p)}
                  disabled={loading}
                  title={`Trang ${p}`}
                >
                  {p}
                </button>
              ))}
              {pageWindow[pageWindow.length - 1] < pageCount && (
                <span className="dots">…</span>
              )}

              <button
                className="pg"
                onClick={() => goto(curPage + 1)}
                disabled={curPage === pageCount || loading}
                title="Trang sau"
              >
                ›
              </button>
              <button
                className="pg"
                onClick={() => goto(pageCount)}
                disabled={curPage === pageCount || loading}
                title="Trang cuối"
              >
                »
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
