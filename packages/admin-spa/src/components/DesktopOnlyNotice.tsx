import { useOutletContext } from 'react-router-dom';

// Shown on the Android app in place of features that only exist in the
// desktop app (clients/vouchers/plans/revenue management).
export default function DesktopOnlyNotice() {
  const context = useOutletContext<{ platform?: string } | null>() ?? {};
  if (context.platform !== 'android') return null;

  return (
    <div>
      <h2>Available on desktop</h2>
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ marginBottom: 12 }}>
          This feature is only available in the hotshare desktop app for Windows, macOS and Linux.
        </p>
        <p style={{ color: '#94a3b8', fontSize: 13 }}>
          Download the desktop app on your shop's computer to manage clients, vouchers, plans and
          revenue. The Android app is designed to run the hotspot; billing and shop management live
          on the desktop apps.
        </p>
      </div>
    </div>
  );
}
