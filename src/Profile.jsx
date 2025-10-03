import "./styles/Profile.css";

export default function Profile({
  profile = {
    name: "Phạm Đức Việt",
    studentId: "B22DCCN899",
    avatar:"/ava.png",
    github: "https://github.com/pdv21/IoT",
    APIdoc: "https://documenter.getpostman.com/view/44306843/2sB3QDwszx",
    pdf: "https://docs.google.com/document/d/1TTCB2qogF9-JorSer2qSDUgHOZfkzlOd/edit?usp=sharing&ouid=117534923940571598753&rtpof=true&sd=true"             
  },
}) {
  const open = (url) => url && window.open(url, "_blank", "noopener,noreferrer");

  return (
    <div className="pf-wrap">
      <div className="pf-card">
        <h1 className="pf-title pf-title--in">Profile</h1>
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
                Github
              </button>
            ) : (
              <span className="pf-value pf-dim">—</span>
            )}
          </div>

          <div className="pf-field">
            <span className="pf-label">API doc:</span>
            {profile.APIdoc ? (
              <button className="pf-link" onClick={() => open(profile.APIdoc)}>
                API doc
              </button>
            ) : (
              <span className="pf-value pf-dim">—</span>
            )}
          </div>

          <div className="pf-field">
            <span className="pf-label">Pdf:</span>
            {profile.pdf ? (
              <button className="pf-link" onClick={() => open(profile.pdf)}>
                PDF
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
