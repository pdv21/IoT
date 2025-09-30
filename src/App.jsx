import { BrowserRouter, Routes, Route, NavLink, Outlet, useLocation } from "react-router-dom";
import "./styles/App.css";

import DashboardPage from "./Dashboard.jsx";
import DatasensorPage from "./Datasensor.jsx";
import DeviceActivityPage from "./DeviceActivity.jsx";
import ProfilePage from "./Profile.jsx";

function Shell() {
  const location = useLocation();
  const isDashboard = location.pathname === "/" || location.pathname === "/dashboard";
  const isDataSensor = location.pathname.startsWith("/data-sensor");
  const isDeviceActivity = location.pathname.startsWith("/device");
  const items = [
    { to: "/",            label: "Dashboard",       icon: "/analytics.png", end: true },
    { to: "/data-sensor", label: "Data Sensor",     icon: "/bar_chart.png" },
    { to: "/device",      label: "Device Activity", icon: "/graph_1.png"   },
    { to: "/profile",     label: "My Profile",      icon: "/account_circle.png" },
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
  <img src="/logo1 1.png" alt="IoT logo" className="logo" />
  <h1 className="title">IoT Controller</h1>
</div>
        <nav className="menu" aria-label="Main">
          {items.map(({to,label,icon,end}) => (
            <NavLink key={to} to={to} end={end}
              className={({isActive}) => "item" + (isActive ? " active" : "")}>
              <img src={icon} alt="" width={22} height={22} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className={`main ${ (isDashboard || isDataSensor || isDeviceActivity) ? "lock" : ""}`}>
        <header className="topbar">
          <div className="user">
            <span>Phạm Đức Việt</span>
            <img src="/ava.png" alt="avatar" />
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="data-sensor" element={<DatasensorPage />} />
          <Route path="device" element={<DeviceActivityPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
