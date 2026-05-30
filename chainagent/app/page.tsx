'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// ── TYPES ──────────────────────────────────────────────────────────────────
type TerminalLine =
  | { type: 'line'; delay: number; time: string; tag: string; tagClass: string; msg: string }
  | { type: 'divider'; delay: number }
  | { type: 'email'; delay: number }
  | { type: 'approve'; delay: number };

// ── TERMINAL DATA ──────────────────────────────────────────────────────────
const LINES: TerminalLine[] = [
  { delay: 400,  type: 'line', time: '09:14:02', tag: 'WATCH', tagClass: 'tag-watch', msg: 'Polling inventory · <span class="hi">3 SKUs</span> · brand: Lense' },
  { delay: 900,  type: 'line', time: '09:14:03', tag: 'WATCH', tagClass: 'tag-watch', msg: 'Lense 5to9 · stock: 1592 · velocity: 47/day · days_left: <span class="hi">34</span> ✓' },
  { delay: 1300, type: 'line', time: '09:14:03', tag: 'WATCH', tagClass: 'tag-watch', msg: 'Lense Drop 001 · stock: <span class="warn">428</span> · velocity: 48/day · days_left: <span class="danger">8.9</span> ⚠' },
  { delay: 1700, type: 'divider' },
  { delay: 2000, type: 'line', time: '09:14:04', tag: 'RISK',  tagClass: 'tag-risk',  msg: 'Threshold breach · Lense Drop 001 · lead_time: <span class="warn">21 days</span> · coverage: <span class="danger">8.9 days</span>' },
  { delay: 2400, type: 'line', time: '09:14:04', tag: 'THINK', tagClass: 'tag-think', msg: 'Invoking Gemini · reasoning over stockout risk...' },
  { delay: 2900, type: 'line', time: '09:14:05', tag: 'THINK', tagClass: 'tag-think', msg: '<span class="dim">›</span> velocity trend: +12% WoW · <span class="dim">ad spend:</span> Meta campaign active' },
  { delay: 3300, type: 'line', time: '09:14:05', tag: 'THINK', tagClass: 'tag-think', msg: '<span class="dim">›</span> reorder qty calc: 48/day × 30 day buffer + 21 day lead = <span class="hi">800 units</span>' },
  { delay: 3700, type: 'line', time: '09:14:06', tag: 'THINK', tagClass: 'tag-think', msg: '<span class="dim">›</span> COGS: $12.50 · total order value: <span class="warn">$10,000</span> · recommendation: reorder now' },
  { delay: 4200, type: 'divider' },
  { delay: 4500, type: 'line', time: '09:14:07', tag: 'ACT',   tagClass: 'tag-act',   msg: 'Drafting supplier email · supplier: Guangzhou Lense Optics Co.' },
  { delay: 5000, type: 'email' },
  { delay: 5500, type: 'line', time: '09:14:09', tag: 'ALERT', tagClass: 'tag-alert', msg: 'ElevenLabs · playing voice alert to founder...' },
  { delay: 5900, type: 'line', time: '09:14:09', tag: 'ACT',   tagClass: 'tag-act',   msg: 'Action queued · auto-sends in <span class="warn">01:59:51</span> unless cancelled' },
  { delay: 6400, type: 'approve' },
];

// ── TERMINAL COMPONENT ─────────────────────────────────────────────────────
function Terminal() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [approved, setApproved] = useState(false);
  const [secs, setSecs] = useState(7200);
  const [items, setItems] = useState<TerminalLine[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const timers = LINES.map((line) =>
      setTimeout(() => {
        setItems((prev) => [...prev, line]);
        if (line.type === 'approve') {
          countdownRef.current = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
        }
      }, line.delay)
    );
    return () => {
      timers.forEach(clearTimeout);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const fmt = (s: number) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  return (
    <div className="terminal">
      <div className="terminal-header">
        <span className="t-dot t-red" /><span className="t-dot t-yellow" /><span className="t-dot t-green" />
        <span className="t-title">chainagent-runtime · brand: Lense · 3 SKUs monitored</span>
        <span className="t-status">agent running</span>
      </div>
      <div className="terminal-body" ref={bodyRef}>
        {items.map((item, i) => {
          if (item.type === 'divider') return <div key={i} className="t-divider visible" />;
          if (item.type === 'email') return (
            <div key={i} className="t-email-box visible">
              <div className="email-to">To: <span>guangzhou-lense@supplier.cn</span></div>
              <div className="email-to">Subject: <span>Urgent Reorder — Lense Drop 001 · 800 units</span></div>
              <div className="email-body">
                Hi Wei,<br /><br />
                We need to place an urgent reorder for <span className="em">800 units</span> of Lense Drop 001 (SKU: DHOD5-EC999009).<br />
                Current stock covers <span className="em">~9 days</span>. Please confirm availability and earliest ship date.<br /><br />
                <span className="dim">— Sent by ChainAgent on behalf of Lense</span>
              </div>
            </div>
          );
          if (item.type === 'approve') return (
            <div key={i} className="t-approve-row visible">
              <button
                className={`approve-btn ${approved ? 'btn-sent' : 'btn-approve'}`}
                onClick={() => { setApproved(true); if (countdownRef.current) clearInterval(countdownRef.current); }}
                disabled={approved}
              >
                {approved ? '✓ Sent to supplier' : '✓ Approve & send'}
              </button>
              <button className="approve-btn btn-edit">Edit quantity</button>
              <button className="approve-btn btn-cancel">Cancel</button>
              <div className={`countdown ${approved ? 'sent' : ''}`}>
                {approved ? '✓ Email dispatched 09:14:11' : `⏱ auto-sending in ${fmt(secs)}`}
              </div>
            </div>
          );
          if (item.type === 'line') return (
            <div key={i} className="t-line visible">
              <span className="t-time">{item.time}</span>
              <span className={`t-tag ${item.tagClass}`}>{item.tag}</span>
              <span className="t-msg" dangerouslySetInnerHTML={{ __html: item.msg }} />
            </div>
          );
          return null;
        })}
      </div>
    </div>
  );
}

// ── PAGE ───────────────────────────────────────────────────────────────────
export default function Home() {
  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        :root{
          --bg:#080a0c;--surface:#0e1114;--surface2:#141820;
          --border:rgba(255,255,255,0.07);--border-bright:rgba(255,255,255,0.14);
          --text:#e8eaed;--muted:#6b7280;
          --accent:#00e5a0;--accent-dim:rgba(0,229,160,0.12);--accent-mid:rgba(0,229,160,0.25);
          --warn:#f59e0b;--warn-dim:rgba(245,158,11,0.12);
          --danger:#ef4444;--danger-dim:rgba(239,68,68,0.1);
          --font-display:'Syne',sans-serif;--font-mono:'JetBrains Mono',monospace;--font-body:'Instrument Sans',sans-serif;
        }
        html{scroll-behavior:smooth}
        body{background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:16px;line-height:1.6;overflow-x:hidden}
        body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px);background-size:48px 48px;pointer-events:none;z-index:0}

        @keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
        @keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes flicker{0%,100%{opacity:1}50%{opacity:.6}}

        /* NAV */
        nav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:20px 48px;border-bottom:1px solid var(--border);background:rgba(8,10,12,0.85);backdrop-filter:blur(12px)}
        .nav-logo{font-family:var(--font-display);font-weight:800;font-size:18px;letter-spacing:-0.02em;color:var(--text);display:flex;align-items:center;gap:8px}
        .nav-logo .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse-dot 2s ease-in-out infinite}
        .nav-links{display:flex;gap:32px;align-items:center}
        .nav-links a{font-family:var(--font-mono);font-size:12px;color:var(--muted);text-decoration:none;letter-spacing:.05em;transition:color .2s}
        .nav-links a:hover{color:var(--text)}
        .nav-cta{font-family:var(--font-mono);font-size:12px;font-weight:500;letter-spacing:.05em;color:var(--bg)!important;background:var(--accent);padding:8px 18px;border-radius:4px;transition:opacity .2s!important}
        .nav-cta:hover{opacity:.85!important;color:var(--bg)!important}

        /* HERO */
        .hero{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:140px 48px 80px;max-width:1200px;margin:0 auto}
        .hero-eyebrow{font-family:var(--font-mono);font-size:11px;letter-spacing:.15em;color:var(--accent);text-transform:uppercase;margin-bottom:24px;opacity:0;animation:fade-up .6s .2s forwards}
        .hero-title{font-family:var(--font-display);font-size:clamp(52px,8vw,100px);font-weight:800;line-height:.95;letter-spacing:-0.04em;margin-bottom:32px;opacity:0;animation:fade-up .7s .35s forwards}
        .hero-title .line2{display:block;color:transparent;-webkit-text-stroke:1px rgba(255,255,255,0.3)}
        .hero-title .accent-word{color:var(--accent)}
        .hero-desc{font-size:18px;color:var(--muted);max-width:520px;line-height:1.7;margin-bottom:48px;opacity:0;animation:fade-up .7s .5s forwards}
        .hero-actions{display:flex;gap:16px;align-items:center;opacity:0;animation:fade-up .7s .65s forwards}
        .hero-stats{display:flex;gap:48px;margin-top:80px;padding-top:48px;border-top:1px solid var(--border);opacity:0;animation:fade-up .7s .8s forwards}
        .stat-val{font-family:var(--font-display);font-size:36px;font-weight:800;color:var(--text);letter-spacing:-0.03em}
        .stat-label{font-family:var(--font-mono);font-size:11px;color:var(--muted);letter-spacing:.08em;margin-top:4px}

        /* BUTTONS */
        .btn-primary{font-family:var(--font-mono);font-size:13px;font-weight:500;letter-spacing:.04em;color:var(--bg);background:var(--accent);padding:14px 28px;border-radius:4px;border:none;cursor:pointer;transition:opacity .2s,transform .15s}
        .btn-primary:hover{opacity:.88;transform:translateY(-1px)}
        .btn-secondary{font-family:var(--font-mono);font-size:13px;letter-spacing:.04em;color:var(--muted);background:none;border:1px solid var(--border-bright);padding:14px 28px;border-radius:4px;cursor:pointer;transition:color .2s,border-color .2s}
        .btn-secondary:hover{color:var(--text);border-color:rgba(255,255,255,.3)}

        /* TERMINAL */
        .terminal-section{position:relative;z-index:1;padding:0 48px 120px;max-width:1200px;margin:0 auto}
        .section-label{font-family:var(--font-mono);font-size:11px;letter-spacing:.15em;color:var(--accent);text-transform:uppercase;margin-bottom:16px}
        .section-title{font-family:var(--font-display);font-size:clamp(32px,4vw,52px);font-weight:800;letter-spacing:-0.03em;margin-bottom:48px;line-height:1.05}
        .terminal{background:var(--surface);border:1px solid var(--border-bright);border-radius:12px;overflow:hidden}
        .terminal-header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);background:var(--surface2)}
        .t-dot{width:10px;height:10px;border-radius:50%}
        .t-red{background:#ef4444}.t-yellow{background:#f59e0b}.t-green{background:#22c55e}
        .t-title{font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-left:8px;letter-spacing:.05em}
        .t-status{margin-left:auto;font-family:var(--font-mono);font-size:10px;color:var(--accent);display:flex;align-items:center;gap:6px}
        .t-status::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse-dot 1.5s infinite}
        .terminal-body{padding:24px;display:flex;flex-direction:column;gap:0}
        .t-line{font-family:var(--font-mono);font-size:12px;line-height:1.7;padding:2px 0;display:flex;gap:12px;align-items:flex-start;opacity:0;transition:opacity .3s}
        .t-line.visible{opacity:1}
        .t-time{color:var(--muted);min-width:80px;flex-shrink:0}
        .t-tag{font-size:10px;font-weight:500;letter-spacing:.05em;padding:1px 7px;border-radius:3px;margin-top:2px;flex-shrink:0;min-width:68px;text-align:center}
        .tag-watch{background:rgba(59,130,246,0.15);color:#60a5fa}
        .tag-think{background:rgba(168,85,247,0.15);color:#c084fc}
        .tag-act{background:var(--accent-dim);color:var(--accent)}
        .tag-alert{background:var(--warn-dim);color:var(--warn)}
        .tag-risk{background:var(--danger-dim);color:#f87171}
        .t-msg{color:var(--text)}
        .t-msg .hi{color:var(--accent)}
        .t-msg .warn{color:var(--warn)}
        .t-msg .dim{color:var(--muted)}
        .t-msg .danger{color:#f87171}
        .t-divider{height:1px;background:var(--border);margin:12px 0;opacity:0;transition:opacity .3s}
        .t-divider.visible{opacity:1}
        .t-email-box{background:var(--surface2);border:1px solid var(--border-bright);border-left:3px solid var(--accent);border-radius:8px;padding:16px 20px;margin:8px 0;opacity:0;font-family:var(--font-mono);font-size:11px;line-height:1.8;transition:opacity .3s}
        .t-email-box.visible{opacity:1}
        .email-to{color:var(--muted)}.email-to span{color:var(--text)}
        .email-body{color:var(--text);margin-top:8px}.email-body .em{color:var(--accent)}
        .t-approve-row{display:flex;gap:10px;margin-top:12px;opacity:0;transition:opacity .3s;align-items:center}
        .t-approve-row.visible{opacity:1}
        .approve-btn{font-family:var(--font-mono);font-size:11px;font-weight:500;padding:7px 16px;border-radius:4px;border:none;cursor:pointer;transition:opacity .2s,transform .1s}
        .approve-btn:hover{opacity:.85;transform:scale(.98)}
        .btn-approve{background:var(--accent);color:var(--bg)}
        .btn-sent{background:#16a34a;color:#fff}
        .btn-edit{background:var(--surface2);color:var(--muted);border:1px solid var(--border-bright)}
        .btn-cancel{background:transparent;color:var(--muted);border:none}
        .countdown{font-family:var(--font-mono);font-size:11px;color:var(--warn);display:flex;align-items:center;gap:6px;margin-left:auto}
        .countdown.sent{color:var(--accent)}

        /* HOW IT WORKS */
        .how-section{position:relative;z-index:1;padding:80px 48px 120px;max-width:1200px;margin:0 auto}
        .steps-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:48px}
        .step-card{background:var(--surface);padding:32px 28px;transition:background .2s}
        .step-card:hover{background:var(--surface2)}
        .step-num{font-family:var(--font-mono);font-size:11px;color:var(--muted);letter-spacing:.1em;margin-bottom:20px}
        .step-icon{width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:20px}
        .icon-watch{background:rgba(59,130,246,0.12)}.icon-think{background:rgba(168,85,247,0.12)}.icon-act{background:var(--accent-dim)}.icon-confirm{background:rgba(34,197,94,0.12)}
        .step-card-title{font-family:var(--font-display);font-size:20px;font-weight:700;letter-spacing:-0.02em;margin-bottom:10px}
        .step-card-desc{font-size:13px;color:var(--muted);line-height:1.65}

        /* SKU TABLE */
        .sku-section{position:relative;z-index:1;padding:0 48px 120px;max-width:1200px;margin:0 auto}
        .sku-table{background:var(--surface);border:1px solid var(--border-bright);border-radius:12px;overflow:hidden;margin-top:48px}
        .sku-table-head{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 100px;padding:12px 24px;border-bottom:1px solid var(--border);background:var(--surface2)}
        .sku-th{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
        .sku-row{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 100px;padding:16px 24px;border-bottom:1px solid var(--border);align-items:center;transition:background .15s}
        .sku-row:last-child{border-bottom:none}
        .sku-row:hover{background:var(--surface2)}
        .sku-row.critical{background:rgba(239,68,68,0.04)}
        .sku-row.critical:hover{background:rgba(239,68,68,0.07)}
        .sku-name{font-size:13px;font-weight:500;color:var(--text);display:flex;flex-direction:column;gap:2px}
        .sku-id{font-family:var(--font-mono);font-size:10px;color:var(--muted)}
        .sku-cell{font-family:var(--font-mono);font-size:12px;color:var(--text)}
        .sku-cell.muted{color:var(--muted)}
        .risk-pill{font-family:var(--font-mono);font-size:10px;font-weight:500;padding:3px 8px;border-radius:3px;display:inline-block}
        .risk-ok{background:rgba(34,197,94,0.12);color:#4ade80}
        .risk-warn{background:var(--warn-dim);color:var(--warn)}
        .risk-danger{background:var(--danger-dim);color:#f87171;animation:flicker 2s infinite}
        .agent-tag{font-family:var(--font-mono);font-size:10px;color:var(--accent);display:flex;align-items:center;gap:4px}
        .agent-tag::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--accent);animation:pulse-dot 1.5s infinite}

        /* STACK */
        .stack-section{position:relative;z-index:1;padding:0 48px 120px;max-width:1200px;margin:0 auto}
        .stack-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:48px}
        .stack-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;transition:border-color .2s,background .2s}
        .stack-card:hover{border-color:var(--border-bright);background:var(--surface2)}
        .stack-role{font-family:var(--font-mono);font-size:9px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:8px}
        .stack-name{font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px}
        .stack-desc{font-size:11px;color:var(--muted);line-height:1.5}

        /* CTA */
        .cta-section{position:relative;z-index:1;padding:0 48px 120px;max-width:1200px;margin:0 auto}
        .cta-box{background:var(--surface);border:1px solid var(--border-bright);border-radius:16px;padding:80px;text-align:center;position:relative;overflow:hidden}
        .cta-box::before{content:'';position:absolute;top:-60px;left:50%;transform:translateX(-50%);width:300px;height:300px;background:radial-gradient(circle,rgba(0,229,160,0.08) 0%,transparent 70%);pointer-events:none}
        .cta-title{font-family:var(--font-display);font-size:clamp(36px,5vw,60px);font-weight:800;letter-spacing:-0.03em;margin-bottom:20px;line-height:1.05}
        .cta-sub{font-size:16px;color:var(--muted);max-width:480px;margin:0 auto 40px;line-height:1.7}

        /* FOOTER */
        footer{position:relative;z-index:1;border-top:1px solid var(--border);padding:32px 48px;display:flex;align-items:center;justify-content:space-between;max-width:1200px;margin:0 auto}
        .footer-logo{font-family:var(--font-display);font-weight:800;font-size:15px;letter-spacing:-0.02em}
        .footer-note{font-family:var(--font-mono);font-size:11px;color:var(--muted)}

        @media(max-width:768px){
          nav{padding:16px 24px}.nav-links{display:none}
          .hero,.terminal-section,.how-section,.sku-section,.stack-section,.cta-section{padding-left:24px;padding-right:24px}
          .steps-grid{grid-template-columns:1fr 1fr}
          .sku-table-head{display:none}.sku-row{grid-template-columns:1fr 1fr;gap:6px}
          .hero-stats{gap:24px;flex-wrap:wrap}
          .cta-box{padding:48px 24px}
          footer{flex-direction:column;gap:12px;text-align:center}
        }
      `}</style>

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;500&family=Instrument+Sans:wght@400;500&display=swap" rel="stylesheet" />

      {/* NAV */}
      <nav>
        <div className="nav-logo"><span className="dot" />ChainAgent</div>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#dashboard">Dashboard</a>
          <a href="#stack">Stack</a>
          <Link href="/dashboard" className="nav-cta">Open dashboard</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <p className="hero-eyebrow">Autonomous supply chain · DTC brands · China fulfillment</p>
        <h1 className="hero-title">
          Your agent<br />
          <span className="line2">doesn&apos;t <span className="accent-word">wait.</span></span>
        </h1>
        <p className="hero-desc">
          ChainAgent monitors every SKU, reasons about stockout risk,
          drafts the reorder to your China supplier, and waits for your approval.
          You stay in control. It does the work.
        </p>
        <div className="hero-actions">
          <button className="btn-primary" onClick={() => document.getElementById('cta')?.scrollIntoView({ behavior: 'smooth' })}>
            Request early access
          </button>
          <button className="btn-secondary" onClick={() => document.getElementById('terminal')?.scrollIntoView({ behavior: 'smooth' })}>
            See the agent run →
          </button>
        </div>
        <div className="hero-stats">
          <div><div className="stat-val">9 days</div><div className="stat-label">avg. lead time saved</div></div>
          <div><div className="stat-val">0</div><div className="stat-label">stockouts since launch</div></div>
          <div><div className="stat-val">45s</div><div className="stat-label">from risk detect to action</div></div>
        </div>
      </section>

      {/* TERMINAL */}
      <section className="terminal-section" id="terminal">
        <p className="section-label">// live agent trace</p>
        <h2 className="section-title">Watch it think.<br />Watch it act.</h2>
        <Terminal />
      </section>

      {/* HOW IT WORKS */}
      <section className="how-section" id="how">
        <p className="section-label">// architecture</p>
        <h2 className="section-title">Four steps.<br />Fully autonomous.</h2>
        <div className="steps-grid">
          {[
            { num: '01', icon: '👁', iconClass: 'icon-watch', title: 'Watch', desc: 'Polls your inventory data continuously. Calculates real-time sales velocity per SKU against supplier lead times.' },
            { num: '02', icon: '🧠', iconClass: 'icon-think', title: 'Think', desc: 'Gemini reasons through the risk — stock level, velocity trend, lead time, upcoming promotions, reorder quantity.' },
            { num: '03', icon: '⚡', iconClass: 'icon-act',   title: 'Act',   desc: 'Drafts a reorder email to your China supplier with exact quantity, spec, and urgency. Queues it for approval.' },
            { num: '04', icon: '✓', iconClass: 'icon-confirm', title: 'Confirm', desc: 'You approve, edit, or cancel in one click. If you don\'t respond in 2 hours, it sends automatically. You set the rules.' },
          ].map((s) => (
            <div className="step-card" key={s.num}>
              <div className="step-num">{s.num}</div>
              <div className={`step-icon ${s.iconClass}`}>{s.icon}</div>
              <div className="step-card-title">{s.title}</div>
              <p className="step-card-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SKU DASHBOARD */}
      <section className="sku-section" id="dashboard">
        <p className="section-label">// inventory intelligence</p>
        <h2 className="section-title">Every SKU.<br />Scored in real time.</h2>
        <div className="sku-table">
          <div className="sku-table-head">
            {['Product','Stock','Velocity/day','Days left','Risk','Agent'].map((h) => (
              <div className="sku-th" key={h}>{h}</div>
            ))}
          </div>
          <div className="sku-row">
            <div className="sku-name">Lense 5to9<span className="sku-id">DHOD5-EC999002</span></div>
            <div className="sku-cell">1,592</div><div className="sku-cell">47</div><div className="sku-cell">34</div>
            <div className="sku-cell"><span className="risk-pill risk-ok">Healthy</span></div>
            <div className="sku-cell muted">—</div>
          </div>
          <div className="sku-row critical">
            <div className="sku-name">Lense Drop 001<span className="sku-id">DHOD5-EC999009</span></div>
            <div className="sku-cell">428</div><div className="sku-cell">48</div>
            <div className="sku-cell" style={{ color: '#f87171', fontWeight: 500 }}>8.9</div>
            <div className="sku-cell"><span className="risk-pill risk-danger">Critical</span></div>
            <div className="agent-tag">Acting now</div>
          </div>
          <div className="sku-row">
            <div className="sku-name">Lense Drop 001 Yellow<span className="sku-id">DHOD5-EC999003</span></div>
            <div className="sku-cell">1,594</div><div className="sku-cell">31</div>
            <div className="sku-cell" style={{ color: 'var(--warn)' }}>21</div>
            <div className="sku-cell"><span className="risk-pill risk-warn">Watch</span></div>
            <div className="sku-cell muted">Monitoring</div>
          </div>
        </div>
      </section>

      {/* STACK */}
      <section className="stack-section" id="stack">
        <p className="section-label">// built with</p>
        <h2 className="section-title">The stack behind<br />the agent.</h2>
        <div className="stack-grid">
          {[
            { role: 'Agent reasoning',   name: 'Gemini API',    desc: 'Multi-step reasoning chain for risk assessment and supplier email drafting' },
            { role: 'Document parsing',  name: 'Gemini Vision', desc: 'Extracts lead times and specs from supplier emails and quote PDFs' },
            { role: 'Data warehouse',    name: 'Snowflake',     desc: 'Time-series SKU history, reorder audit log, velocity patterns' },
            { role: 'Voice alerts',      name: 'ElevenLabs',    desc: 'Human-sounding audio briefings for every agent action taken' },
            { role: 'Frontend',          name: 'Next.js',       desc: 'Real-time dashboard with SSE streaming of agent reasoning trace' },
            { role: 'Ecommerce data',    name: 'Shopify API',   desc: 'Real-time order and inventory sync. Works with dev stores and production' },
          ].map((s) => (
            <div className="stack-card" key={s.name}>
              <div className="stack-role">{s.role}</div>
              <div className="stack-name">{s.name}</div>
              <div className="stack-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section" id="cta">
        <div className="cta-box">
          <h2 className="cta-title">Your last stockout<br />just happened.</h2>
          <p className="cta-sub">ChainAgent catches the next one before you even know it&apos;s coming — and handles it while you sleep.</p>
          <Link href="/dashboard">
            <button className="btn-primary" style={{ fontSize: 14, padding: '16px 36px' }}>Open dashboard</button>
          </Link>
        </div>
      </section>

      <footer>
        <div className="footer-logo">ChainAgent</div>
        <div className="footer-note">Built at QuackHacks 3.0 · University of Oregon</div>
      </footer>
    </>
  );
}