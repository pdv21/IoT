import React from "react";

export default function ThSort({ label, sortKey, activeKey, dir, onChange }) {
  const isActive = activeKey === sortKey;
  const nextDir = isActive ? (dir === "asc" ? "desc" : "asc") : "asc";

  return (
    <th>
      <div className="th-sort">
        <span className="th-label">{label}</span>
        <button
          type="button"
          className={`sort-btn ${isActive ? "active" : ""}`}
          aria-label={`Sắp xếp theo ${label} (${isActive ? (dir==="asc"?"tăng dần":"giảm dần") : "tăng dần"})`}
          title={isActive ? (dir==="asc"?"Sắp xếp giảm dần":"Sắp xếp tăng dần") : "Sắp xếp tăng dần"}
          onClick={() => onChange(sortKey, nextDir)}
        >
          {/* Ký hiệu mũi tên đơn giản để đỡ phụ thuộc icon */}
          <span className="sort-caret">{isActive ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </div>
    </th>
  );
}
