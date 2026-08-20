import { useState, useEffect } from 'react';
import { detectPlatform, type Platform } from './platform';

const WINDOWS_URL = 'https://github.com/YOUR_USER/hotshare/releases/latest/download/hotshare-setup.exe';
const ANDROID_URL = 'https://github.com/YOUR_USER/hotshare/releases/latest/download/hotshare.apk';
const LINUX_URL = 'https://github.com/YOUR_USER/hotshare/releases/latest/download/hotshare-0.1.0.AppImage';
const MACOS_URL = 'https://github.com/YOUR_USER/hotshare/releases/latest/download/hotshare-0.1.0-universal.dmg';

const PLATFORM_URLS: Record<Platform, string> = {
  windows: WINDOWS_URL,
  android: ANDROID_URL,
  linux: LINUX_URL,
  macos: MACOS_URL,
  other: WINDOWS_URL,
};

export default function App() {
  const [platform, setPlatform] = useState<Platform>('other');

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  return (
    <div className="site">
      <header className="nav">
        <div className="nav-inner">
          <span className="nav-logo">hotshare</span>
          <a
            href={PLATFORM_URLS[platform]}
            className="btn btn-nav"
            download
          >
            Download
          </a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-content">
            <h1>
              Turn any PC or phone into a<br />
              <span className="accent">paid WiFi hotspot</span>
            </h1>
            <p className="hero-sub">
              Share your internet. Earn money.<br />
              Clients connect, pay via voucher, and browse. You keep the revenue.
            </p>

            <div className="download-group">
              <a
                href={WINDOWS_URL}
                className={`btn btn-lg ${platform === 'windows' ? 'btn-primary' : 'btn-outline'}`}
                download
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
                </svg>
                Download for Windows
              </a>
              <a
                href={ANDROID_URL}
                className={`btn btn-lg ${platform === 'android' ? 'btn-primary' : 'btn-outline'}`}
                download
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.523 2.094a.336.336 0 0 0-.06-.008h-.005c-.103.008-.548.048-1.07.365-.52.316-1.17.876-1.882 1.673-.713-.797-1.364-1.356-1.884-1.672-.522-.317-.965-.357-1.068-.365h-.005a.336.336 0 0 0-.06.008C9.558 2.356 8.7 3.57 8.7 5.35v3.1h6.6V5.35c0-1.78-.858-2.994-1.777-3.256zM6.3 12.1v7.1c0 .3.2.5.5.5h1.1c.3 0 .5-.2.5-.5v-2.3h7.6v2.3c0 .3.2.5.5.5h1.1c.3 0 .5-.2.5-.5v-7.1H6.3z"/>
                </svg>
                Get on Android
              </a>
              <a
                href={LINUX_URL}
                className={`btn btn-lg ${platform === 'linux' ? 'btn-primary' : 'btn-outline'}`}
                download
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22.5c-5.799 0-10.5-4.701-10.5-10.5S6.201 1.5 12 1.5 22.5 6.201 22.5 12 17.799 22.5 12 22.5zm1.5-13.5c0 .828-.672 1.5-1.5 1.5s-1.5-.672-1.5-1.5.672-1.5 1.5-1.5 1.5.672 1.5 1.5zM12 13c-2.76 0-5 1.79-5 4h10c0-2.21-2.24-4-5-4z"/>
                </svg>
                Download for Linux
              </a>
              <a
                href={MACOS_URL}
                className={`btn btn-lg ${platform === 'macos' ? 'btn-primary' : 'btn-outline'}`}
                download
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                Download for macOS
              </a>
            </div>

            <div className="hero-meta">
              <span>Windows, macOS, Linux, and Android</span>
              <span className="dot">·</span>
              <span>1-month free trial</span>
              <span className="dot">·</span>
              <span>No credit card required</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="mockup">
              <div className="mockup-bar">
                <span className="mockup-dot" />
                <span className="mockup-dot" />
                <span className="mockup-dot" />
              </div>
              <div className="mockup-screen">
                <div className="mockup-header">
                  <span className="mockup-title">hotshare</span>
                  <span className="mockup-badge">Online</span>
                </div>
                <div className="mockup-grid">
                  <div className="mockup-card">
                    <div className="mockup-card-label">Connected</div>
                    <div className="mockup-card-value">12</div>
                  </div>
                  <div className="mockup-card">
                    <div className="mockup-card-label">Revenue</div>
                    <div className="mockup-card-value accent">KES 4,800</div>
                  </div>
                  <div className="mockup-card">
                    <div className="mockup-card-label">Uptime</div>
                    <div className="mockup-card-value">99.8%</div>
                  </div>
                  <div className="mockup-card">
                    <div className="mockup-card-label">Vouchers</div>
                    <div className="mockup-card-value">156</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>hotshare &copy; 2026</span>
      </footer>
    </div>
  );
}
