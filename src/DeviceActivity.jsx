import { useEffect, useMemo, useRef, useState } from "react";
import "./styles/DeviceActivity.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const DEFAULT_SORT = "timestamp:desc";

const COLUMNS = [
  { key: "id", label: "ID", width: 80 },
  { key: "nameDevice", label: "Device" },
  { key: "action", label: "Status" },
  { key: "timestamp", label: "Time", width: 240 },
];

const pad = (n) => String(n).padStart(2, "0");
const fmtSlashColon = (d) =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// ====== Regex input thời gian ======
const RE_HHMMSS = /^(\d{1,2}):(\d{2}):(\d{2})$/;
const RE_HHMM = /^(\d{1,2}):(\d{2})$/;
const RE_YMD = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const RE_YMD_HM = /^(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2})$/;
const RE_YMD_HMS =
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/;
const RE_DASH_YMD = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const RE_DASH_YMD_HM = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/;
const RE_DASH_YMD_HMS =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/;

/** Parse input -> {fromISO, toISO} */
function parseTimeRange(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  let m;

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
  if ((m = s.match(RE_YMD_HMS))) {
    const [_, Y, Mo, D, H, Mi, S] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, +S, 0);
    const to = new Date(from.getTime() + 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_YMD_HM))) {
    const [_, Y, Mo, D, H, Mi] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, 0, 0);
    const to = new Date(from.getTime() + 59_999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_YMD))) {
    const [_, Y, Mo, D] = m;
    const from = new Date(+Y, +Mo - 1, +D, 0, 0, 0, 0);
    const to = new Date(+Y, +Mo - 1, +D, 23, 59, 59, 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_DASH_YMD_HMS))) {
    const [_, Y, Mo, D, H, Mi, S] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, +S, 0);
    const to = new Date(from.getTime() + 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_DASH_YMD_HM))) {
    const [_, Y, Mo, D, H, Mi] = m;
    const from = new Date(+Y, +Mo - 1, +D, +H, +Mi, 0, 0);
    const to = new Date(from.getTime() + 59_999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  if ((m = s.match(RE_DASH_YMD))) {
    const [_, Y, Mo, D] = m;
    const from = new Date(+Y, +Mo - 1, +D, 0, 0, 0, 0);
    const to = new Date(+Y, +Mo - 1, +D, 23, 59, 59, 999);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }
  return null;
}

export default function DeviceActivity() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const [pendingQuery, setPendingQuery] = useState("");
  const [query, setQuery] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [copiedId, setCopiedId] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pageSize),
          sort: DEFAULT_SORT, // cố định, không có UI sort
        });

        const q = query.trim();
        if (q) {
          const range = parseTimeRange(q);
          if (range) {
            params.set("from", range.fromISO);
            params.set("to", range.toISO);
          }
        }

        const url = `${API_BASE}/api/actions?${params.toString()}`;
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const list = Array.isArray(json.data) ? json.data : [];
        const t = Number(json.total) || 0;

        setRows(list);
        setTotal(t);
        setPages(Number(json.pages) || Math.max(1, Math.ceil(t / pageSize)));
      } catch (e) {
        if (e.name !== "AbortError")
          setError("Không tải được dữ liệu. Vui lòng thử lại.");
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [page, pageSize, query]);

  const pageCount = Math.max(1, pages);
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * pageSize;
  const goto = (p) => setPage(Math.min(pageCount, Math.max(1, p)));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount]);

  const pageWindow = useMemo(() => {
    const span = 5;
    const s = Math.max(1, curPage - Math.floor(span / 2));
    const e = Math.min(pageCount, s + span - 1);
    const arr = [];
    for (let i = Math.max(1, e - span + 1); i <= e; i++) arr.push(i);
    return arr;
  }, [curPage, pageCount]);

  const doSearch = () => {
    setQuery(pendingQuery);
    setPage(1);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") doSearch();
  };

  const copyTime = async (ts, id) => {
    try {
      const text = ts ? fmtSlashColon(new Date(ts)) : "";
      await navigator.clipboard.writeText(text);
      clearTimeout(timerRef.current);
      setCopiedId(id);
      timerRef.current = setTimeout(() => setCopiedId(null), 1200);
    } catch {}
  };

  return (
    <div className="board board-da">
      <div className="da-wrap">
        <div className="da-top">
          <h1 className="da-title">Device Activity</h1>
          <div className="da-controls" style={{ display: "flex", gap: 8 }}>
            <input
              className="da-search"
              placeholder="YYYY/MM/DD HH:MM(:SS)"
              value={pendingQuery}
              onChange={(e) => setPendingQuery(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Tìm thời gian"
            />
            <button
              className="da-search-btn"
              onClick={doSearch}
              disabled={loading}
            >
              Search
            </button>
          </div>
        </div>

        <div className="da-card">
          <div className="da-scroller">
            <table className="da-table da-sticky">
              <colgroup>
                {COLUMNS.map(({ width }, i) => (
                  <col key={i} style={width ? { width } : undefined} />
                ))}
              </colgroup>

              <thead>
                <tr>
                  {COLUMNS.map(({ key, label }) => (
                    <th key={key}>
                      <div className="th-static">{label}</div>
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
                      <td>{r.nameDevice}</td>
                      <td>
                        <span
                          className={
                            "status-pill " +
                            (String(r.action).toUpperCase() === "ON"
                              ? "status-on"
                              : String(r.action).toUpperCase() === "OFF"
                              ? "status-off"
                              : "")
                          }
                        >
                          {String(r.action)}
                        </span>
                      </td>

                      <td>
                        <button
                          className="time-copy-btn"
                          onClick={() => copyTime(r.timestamp, r.id)}
                          title="Copy (YYYY/MM/DD HH:MM:SS)"
                        >
                          {r.timestamp
                            ? fmtSlashColon(new Date(r.timestamp))
                            : ""}
                        </button>
                        {copiedId === r.id && (
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

          <div className="da-footer">
            <div className="da-results">
              Results: {total === 0 ? 0 : start + 1} -{" "}
              {Math.min(start + pageSize, total)} of {total}
            </div>

            <div className="da-pager">
              <select
                className="da-psize"
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
