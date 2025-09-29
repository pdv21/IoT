import "./styles/Profile.css";

export default function Profile({
  profile = {
    name: "Phạm Đức Việt",
    studentId: "B22DCCN899",
    avatar:"/ava.png", // đường dẫn ảnh đại diện
    github: "",          // ví dụ: "https://github.com/username"
    APIdoc: "",
    pdf: ""              // ví dụ: "/cv.pdf"
  },
}) {
  const open = (url) => url && window.open(url, "_blank", "noopener,noreferrer");

  return (
    <div className="pf-wrap">
      <h1 className="pf-title">Profile</h1>

      <div className="pf-card">
        {/* LEFT: avatar */}
        <div className="pf-left">
          <div className="pf-avatar">
            <img src={profile.avatar} alt={profile.name} />
          </div>
        </div>

        {/* RIGHT: details */}
        <div className="pf-right">
          <div className="pf-field">
            <span className="pf-label">Name:</span>
            <span className="pf-value">{profile.name}</span>
          </div>

          <div className="pf-field">
            <span className="pf-label">Mã sinh viên:</span>
            <span className="pf-value">{profile.studentId}</span>
          </div>

          <div className="pf-field">
            <span className="pf-label">Github:</span>
            {profile.github ? (
              <button className="pf-link" onClick={() => open(profile.github)}>
                Mở Github
              </button>
            ) : (
              <span className="pf-value pf-dim">—</span>
            )}
          </div>

          <div className="pf-field">
            <span className="pf-label">API doc:</span>
            {profile.APIdoc ? (
              <button className="pf-link" onClick={() => open(profile.APIdoc)}>
                Mở API doc
              </button>
            ) : (
              <span className="pf-value pf-dim">—</span>
            )}
          </div>

          <div className="pf-field">
            <span className="pf-label">Pdf:</span>
            {profile.pdf ? (
              <button className="pf-link" onClick={() => open(profile.pdf)}>
                Xem PDF
              </button>
            ) : (
              <span className="pf-value pf-dim">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
