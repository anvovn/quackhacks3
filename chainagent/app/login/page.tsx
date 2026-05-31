'use client';

import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'authenticated') {
      window.location.href = '/dashboard';
    }
  }, [status]);

  async function handleGoogleLogin() {
    setError('');
    setGoogleLoading(true);
    try {
      await signIn('google', { callbackUrl: '/dashboard' });
    } catch {
      setError('Sign-in failed. Check AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env.local.');
      setGoogleLoading(false);
    }
  }

  async function handleUseAnotherAccount() {
    await signOut({ callbackUrl: '/login' });
  }

  async function handleEmailLogin() {
    if (!email || !password) {
      setError('Please enter your email and password');
      return;
    }
    setError('');
    setEmailLoading(true);
    try {
      const result = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
        callbackUrl: '/dashboard',
      });
      if (result?.error) {
        setError('Invalid email or password');
        setEmailLoading(false);
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      setError('Email sign-in failed. Add AUTH_EMAIL and AUTH_PASSWORD_HASH to .env.local.');
      setEmailLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500&family=Instrument+Sans:wght@400;500&display=swap');

        *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #060809;
          --surface: #0c0f12;
          --border: rgba(255,255,255,0.08);
          --text: #e8eaed;
          --muted: #5a6478;
          --accent: #00e5a0;
          --font-display: 'Syne', sans-serif;
          --font-mono: 'JetBrains Mono', monospace;
          --font-body: 'Instrument Sans', sans-serif;
        }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          min-height: 100vh;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.3; transform: scale(0.6); }
        }

        .login-page {
          position: fixed;
          inset: 0;
          background: var(--bg);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 0;
          font-family: var(--font-body);
        }

        .login-grid-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px);
          background-size: 56px 56px;
          pointer-events: none;
        }

        .login-glow {
          position: absolute;
          top: -120px;
          left: 50%;
          transform: translateX(-50%);
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(0,229,160,0.06) 0%, transparent 70%);
          pointer-events: none;
        }

        .login-inner {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          width: 100%;
          max-width: 400px;
          padding: 0 24px;
        }

        .login-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }

        .login-brand-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .login-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--accent);
          animation: pulse-dot 2s infinite;
        }

        .login-brand-name {
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 22px;
          letter-spacing: -0.02em;
          color: var(--text);
        }

        .login-brand-sub {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted);
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .login-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 32px;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .login-card-header {
          text-align: center;
        }

        .login-card-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 700;
          color: var(--text);
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .login-card-sub {
          font-size: 13px;
          color: var(--muted);
        }

        .google-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background: white;
          color: #3c4043;
          border: none;
          border-radius: 8px;
          padding: 12px 20px;
          font-family: var(--font-body);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          width: 100%;
          transition: box-shadow 0.2s, opacity 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .google-btn:hover:not(:disabled) {
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }

        .google-btn:disabled {
          opacity: 0.7;
          cursor: default;
        }

        .google-btn.done {
          background: #e8f5e9;
        }

        .divider-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .divider-line {
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.06);
        }

        .divider-or {
          font-size: 12px;
          color: var(--muted);
          font-family: var(--font-mono);
        }

        .email-fields {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .login-input {
          background: #121820;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          padding: 11px 14px;
          color: var(--text);
          font-family: var(--font-body);
          font-size: 13px;
          outline: none;
          width: 100%;
          transition: border-color 0.2s;
        }

        .login-input:focus {
          border-color: var(--accent);
        }

        .login-submit {
          background: var(--accent);
          color: #060809;
          border: none;
          border-radius: 8px;
          padding: 11px;
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          width: 100%;
          letter-spacing: 0.04em;
          transition: opacity 0.2s;
        }

        .login-submit:hover {
          opacity: 0.88;
        }

        .login-error {
          font-family: var(--font-mono);
          font-size: 11px;
          color: #ef4444;
          text-align: center;
          background: rgba(239,68,68,0.08);
          padding: 8px;
          border-radius: 6px;
        }
      `}</style>

      <div className="login-page">
        <div className="login-grid-bg" />
        <div className="login-glow" />

        <div className="login-inner">
          {/* Brand */}
          <div className="login-brand">
            <div className="login-brand-row">
              <div className="login-dot" />
              <span className="login-brand-name">ChainAgent</span>
            </div>
            <span className="login-brand-sub">Autonomous Supply Chain Agent</span>
          </div>

          {/* Card */}
          <div className="login-card">
            <div className="login-card-header">
              <div className="login-card-title">Sign in to your dashboard</div>
              <div className="login-card-sub">Access your supply chain monitor</div>
            </div>

            {/* Google button */}
            <button
              id="googleBtn"
              className="google-btn"
              onClick={handleGoogleLogin}
              disabled={googleLoading || emailLoading}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              <span id="googleBtnText">
                {googleLoading ? 'Signing in...' : 'Continue with Google'}
              </span>
            </button>

            {/* Divider */}
            <div className="divider-row">
              <div className="divider-line" />
              <span className="divider-or">or</span>
              <div className="divider-line" />
            </div>

            {/* Email + password */}
            <div className="email-fields">
              <input
                id="emailInput"
                className="login-input"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                id="passInput"
                className="login-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleEmailLogin(); }}
              />
              <button
                className="login-submit"
                onClick={handleEmailLogin}
                disabled={emailLoading || googleLoading}
              >
                {emailLoading ? 'Signing in...' : 'Sign in →'}
              </button>
            </div>

            {status === 'authenticated' && session?.user?.email && (
              <div className="login-error" style={{ color: 'var(--muted)', background: 'rgba(255,255,255,0.04)' }}>
                Signed in as {session.user.email}.{' '}
                <button
                  type="button"
                  onClick={handleUseAnotherAccount}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}
                >
                  Use another account
                </button>
              </div>
            )}

            {error && (
              <div id="loginError" className="login-error">{error}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
