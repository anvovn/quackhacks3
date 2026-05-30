"use client"
import { useState, useEffect, useRef, useCallback } from "react"

// ── TYPES ──
interface SKU {
  name: string; id: string; stock: string; inc: string
  vel: string; days: string; pct: number; risk: string; rc: string
}
interface Brand {
  name: string; label: string; days: string; stock: string
  incoming: string; crit: string; agentTitle: string
  supplier: string; email: string; skus: SKU[]
}
interface TraceLine { tag: string; msg: string; time: string }
interface AuditRow { time: string; action: string; sku: string; label: string }

// ── BRAND DATA ──
const BRANDS: Record<string, Brand> = {
  focal: {
    name:"Focal Eyewear", label:"brand: Focal", days:"8.9", stock:"3,614",
    incoming:"800", crit:"FOCAL ARC FRAME",
    agentTitle:"chainagent-runtime · brand: Focal · 3 SKUs monitored",
    supplier:"Guangzhou Focal Optics Co.", email:"wei@guangzhou-focal.cn",
    skus:[
      {name:"Focal Slim 01",  id:"FOCL-EC999001",stock:"1,592",inc:"+300",   vel:"47/day",days:"33.9",pct:85, risk:"Healthy", rc:"risk-ok"},
      {name:"Focal Arc Frame",id:"FOCL-EC999002",stock:"428",  inc:"+800 ↑", vel:"48/day",days:"8.9", pct:15, risk:"Critical",rc:"risk-critical"},
      {name:"Focal Round 03", id:"FOCL-EC999003",stock:"1,594",inc:"—",      vel:"31/day",days:"21.0",pct:42, risk:"Watch",   rc:"risk-watch"},
    ]
  },
  lens: {
    name:"LensLab Co.", label:"brand: LensLab", days:"14.2", stock:"2,210",
    incoming:"200", crit:"LENSLAB PRO 02",
    agentTitle:"chainagent-runtime · brand: LensLab · 2 SKUs monitored",
    supplier:"Shenzhen LensLab Factory", email:"ops@shenzhen-lenslab.cn",
    skus:[
      {name:"LensLab Classic",id:"LENS-EC001",stock:"980",inc:"—",    vel:"32/day",days:"30.6",pct:76,risk:"Healthy",rc:"risk-ok"},
      {name:"LensLab Pro 02", id:"LENS-EC002",stock:"455",inc:"+200", vel:"32/day",days:"14.2",pct:35,risk:"Watch",  rc:"risk-watch"},
    ]
  },
  arc: {
    name:"Arc Vision", label:"brand: Arc", days:"6.1", stock:"5,040",
    incoming:"500", crit:"ARC TITAN FRAME",
    agentTitle:"chainagent-runtime · brand: Arc Vision · 4 SKUs monitored",
    supplier:"Guangzhou Arc Optics Ltd.", email:"wei@arc-optics.cn",
    skus:[
      {name:"Arc Titan Frame",id:"ARC-EC001",stock:"290",  inc:"+500 ↑",vel:"47/day",days:"6.1", pct:12, risk:"Critical",rc:"risk-critical"},
      {name:"Arc Slim Sport", id:"ARC-EC002",stock:"2,100",inc:"—",     vel:"40/day",days:"52.5",pct:100,risk:"Healthy", rc:"risk-ok"},
      {name:"Arc Classic RX", id:"ARC-EC003",stock:"1,850",inc:"—",     vel:"28/day",days:"66.1",pct:100,risk:"Healthy", rc:"risk-ok"},
      {name:"Arc Lite Frame", id:"ARC-EC004",stock:"800",  inc:"+300",  vel:"38/day",days:"21.0",pct:42, risk:"Watch",   rc:"risk-watch"},
    ]
  }
}

const TRACE_SCRIPT = [
  {tag:"WATCH",msg:"Polling inventory · 3 SKUs · brand: Focal",d:400},
  {tag:"WATCH",msg:"Focal Slim 01 · stock: 1592 · incoming: +300 · days_left: 33.9 ✓",d:900},
  {tag:"WATCH",msg:"Focal Arc Frame · stock: 428 · incoming: +800 · days_left: 8.9 ⚠",d:1300},
  {tag:"WATCH",msg:"Focal Round 03 · stock: 1594 · days_left: 21.0",d:1700},
  {tag:"RISK", msg:"Threshold breach · Focal Arc Frame · lead_time: 21 days · coverage: 8.9 days",d:2200},
  {tag:"THINK",msg:"Invoking Claude · reasoning over stockout risk...",d:2700},
  {tag:"THINK",msg:"› incoming 800u · ETA May 31 · gap: 8.9 days vs 21 day lead — still critical",d:3100},
  {tag:"THINK",msg:"› velocity +12% WoW · Meta campaign active · recommendation: reorder now",d:3500},
  {tag:"THINK",msg:"› qty: 48/day × 30 buffer + 21 lead = 800 units · $10,000",d:3900},
  {tag:"ACT",  msg:"Drafting supplier email · Guangzhou Focal Optics Co.",d:4400},
  {tag:"ACT",  msg:"Email drafted · queued for approval · auto-sends in 02:00:00",d:5000},
  {tag:"ALERT",msg:"ElevenLabs · playing voice alert to founder...",d:5500},
  {tag:"ACT",  msg:"Action logged to Snowflake · inbound cross-referenced",d:6000},
]

const TAG_COLORS: Record<string,{bg:string,color:string}> = {
  WATCH:{bg:"rgba(74,158,255,0.1)",  color:"#4a9eff"},
  THINK:{bg:"rgba(167,139,250,0.1)", color:"#a78bfa"},
  ACT:  {bg:"rgba(0,229,160,0.1)",   color:"#00e5a0"},
  RISK: {bg:"rgba(239,68,68,0.08)",  color:"#ef4444"},
  ALERT:{bg:"rgba(245,158,11,0.1)",  color:"#f59e0b"},
  REPLY:{bg:"rgba(34,197,94,0.12)",  color:"#4ade80"},
}

// ── CSS VARS (injected once) ──
const CSS = `
:root{--bg:#060809;--surface:#0c0f12;--surface2:#121820;--surface3:#1a2030;--border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.12);--text:#e8edf2;--muted:#5a6478;--muted2:#8a97aa;--accent:#00e5a0;--accent-dim:rgba(0,229,160,0.1);--accent-mid:rgba(0,229,160,0.2);--blue:#4a9eff;--blue-dim:rgba(74,158,255,0.1);--purple:#a78bfa;--amber:#f59e0b;--amber-dim:rgba(245,158,11,0.1);--red:#ef4444;--red-dim:rgba(239,68,68,0.08);}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;margin:0}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px);background-size:56px 56px;pointer-events:none;z-index:0}
*{box-sizing:border-box}
@keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.7)}}
@keyframes flicker{0%,100%{opacity:1}50%{opacity:0.5}}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.live-dot{animation:pulse-dot 2s infinite}
.sync-dot{animation:pulse-dot 3s infinite}
.agent-dot{animation:pulse-dot 1.5s infinite}
.risk-critical{animation:flicker 2s infinite}
.trace-line{animation:fadeIn 0.3s both}
.email-panel{animation:slideUp 0.4s both}
.supplier-reply{animation:slideUp 0.4s both}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
`

// ── SHARED STYLE HELPERS ──
const S = {
  mono: {fontFamily:"'JetBrains Mono',monospace"} as React.CSSProperties,
  display: {fontFamily:"'Syne',sans-serif"} as React.CSSProperties,
  riskColor: (risk:string) => risk==="Critical"?"var(--red)":risk==="Watch"?"var(--amber)":"var(--accent)",
  riskBg: (risk:string) => risk==="Critical"?"var(--red-dim)":risk==="Watch"?"var(--amber-dim)":"var(--accent-dim)",
}

// ── SUB COMPONENTS ──
function RunwayBar({days,pct,risk}:{days:string,pct:number,risk:string}) {
  return (
    <div>
      <div style={{...S.mono,fontSize:9,color:S.riskColor(risk)}}>{days} days</div>
      <div style={{height:4,background:"var(--surface3)",borderRadius:2,marginTop:3}}>
        <div style={{height:"100%",width:`${pct}%`,background:S.riskColor(risk),borderRadius:2}}/>
      </div>
    </div>
  )
}

function RiskPill({risk}:{risk:string}) {
  const styles:Record<string,React.CSSProperties> = {
    Healthy: {background:"rgba(34,197,94,0.12)",color:"#4ade80"},
    Watch:   {background:"var(--amber-dim)",color:"var(--amber)"},
    Critical:{background:"var(--red-dim)",color:"var(--red)"},
  }
  return (
    <span style={{...S.mono,fontSize:10,fontWeight:500,padding:"3px 8px",borderRadius:4,...(styles[risk]||{}),
      ...(risk==="Critical"?{animation:"flicker 2s infinite"}:{})}}>
      {risk}
    </span>
  )
}

function StatusPill({label,type}:{label:string,type:"transit"|"live"|"pending"|"disc"|"draft"}) {
  const map = {
    transit:{background:"var(--blue-dim)",color:"var(--blue)"},
    live:   {background:"var(--accent-dim)",color:"var(--accent)"},
    pending:{background:"var(--amber-dim)",color:"var(--amber)"},
    disc:   {background:"var(--red-dim)",color:"var(--red)"},
    draft:  {background:"var(--surface3)",color:"var(--muted)"},
  }
  return <span style={{...S.mono,fontSize:10,fontWeight:500,padding:"3px 8px",borderRadius:4,...map[type]}}>{label}</span>
}

function Btn({children,onClick,variant="ghost",style={}}:{children:React.ReactNode,onClick?:()=>void,variant?:"primary"|"ghost"|"danger"|"amber",style?:React.CSSProperties}) {
  const base:React.CSSProperties = {...S.mono,fontSize:11,fontWeight:500,letterSpacing:"0.04em",padding:"7px 13px",borderRadius:7,border:"none",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,transition:"all 0.15s"}
  const variants = {
    primary:{background:"var(--accent)",color:"#060809"},
    ghost:  {background:"var(--surface)",color:"var(--muted2)",border:"1px solid var(--border2)"},
    danger: {background:"var(--red-dim)",color:"var(--red)",border:"1px solid rgba(239,68,68,0.2)"},
    amber:  {background:"var(--amber-dim)",color:"var(--amber)",border:"1px solid rgba(245,158,11,0.2)"},
  }
  return <button style={{...base,...variants[variant],...style}} onClick={onClick}>{children}</button>
}

function Toggle({on,onChange}:{on:boolean,onChange:(v:boolean)=>void}) {
  return (
    <button onClick={()=>onChange(!on)} style={{width:38,height:20,borderRadius:100,border:"none",cursor:"pointer",position:"relative",background:on?"var(--accent)":"var(--surface3)",transition:"background 0.2s"}}>
      <span style={{position:"absolute",top:2,left:on?20:2,width:16,height:16,borderRadius:"50%",background:"white",transition:"left 0.2s",display:"block"}}/>
    </button>
  )
}

function Panel({children,style={}}:{children:React.ReactNode,style?:React.CSSProperties}) {
  return <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden",...style}}>{children}</div>
}

function PanelHeader({title,actions}:{title:React.ReactNode,actions?:React.ReactNode}) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 18px",borderBottom:"1px solid var(--border)",background:"var(--surface2)"}}>
      <div style={{...S.display,fontSize:13,fontWeight:700,letterSpacing:"-0.01em",display:"flex",alignItems:"center",gap:7}}>{title}</div>
      {actions && <div style={{display:"flex",gap:7,alignItems:"center"}}>{actions}</div>}
    </div>
  )
}

function RowHead({cols,children}:{cols:string,children:React.ReactNode}) {
  return <div style={{display:"grid",gridTemplateColumns:cols,gap:10,padding:"9px 18px",borderBottom:"1px solid var(--border)",background:"var(--surface2)"}}>{children}</div>
}

function Th({children}:{children?:React.ReactNode}) {
  return <div style={{...S.mono,fontSize:9,letterSpacing:"0.12em",color:"var(--muted)",textTransform:"uppercase" as const}}>{children}</div>
}

function SkuRow({sku,cols,isOverview=false}:{sku:SKU,cols:string,isOverview?:boolean}) {
  return (
    <div style={{display:"grid",gridTemplateColumns:cols,gap:10,padding:"12px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",cursor:"pointer",background:sku.risk==="Critical"?"rgba(239,68,68,0.03)":"transparent"}}>
      <div><div style={{fontSize:13,fontWeight:500,color:"var(--text)"}}>{sku.name}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)",marginTop:1}}>{sku.id}</div></div>
      <div style={{...S.mono,fontSize:12}}>{sku.stock}</div>
      <div style={{...S.mono,fontSize:12,color:sku.inc.startsWith("+")?"var(--accent)":"var(--muted2)"}}>{sku.inc}</div>
      <div style={{...S.mono,fontSize:12}}>{sku.vel}</div>
      <RunwayBar days={sku.days} pct={sku.pct} risk={sku.risk}/>
      <RiskPill risk={sku.risk}/>
      {isOverview && <div style={{...S.mono,fontSize:10,color:"var(--muted2)"}}>Monitoring</div>}
    </div>
  )
}

function BeHook({children}:{children:string}) {
  return <span style={{...S.mono,fontSize:9,color:"var(--blue)",background:"var(--blue-dim)",padding:"2px 7px",borderRadius:4,marginLeft:8}}>{children}</span>
}

function SectionHeader({eyebrow,title,hook,action}:{eyebrow?:string,title:string,hook?:string,action?:React.ReactNode}) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        {eyebrow && <div style={{...S.mono,fontSize:10,color:"var(--muted)",letterSpacing:"0.1em",textTransform:"uppercase" as const,marginBottom:2}}>{eyebrow}{hook&&<BeHook>{hook}</BeHook>}</div>}
        <h2 style={{...S.display,fontSize:22,fontWeight:800,letterSpacing:"-0.03em",margin:0}}>{title}</h2>
      </div>
      {action}
    </div>
  )
}

// ── SECTION COMPONENTS ──
function OverviewSection({brand,onRunAgent}:{brand:Brand,onRunAgent:()=>void}) {
  return (
    <>
      <SectionHeader eyebrow={`// overview · ${brand.name}`} title="Supply Chain Dashboard" action={<Btn variant="primary" onClick={onRunAgent}>▶ Run Agent Now</Btn>}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[
          {icon:"🚨",trend:"Critical",val:brand.days,label:`DAYS TO STOCKOUT · ${brand.crit}`,alert:true,valRed:true},
          {icon:"📦",trend:"+12% WoW",val:brand.stock,label:"TOTAL UNITS IN STOCK"},
          {icon:"📥",trend:"En route",val:brand.incoming,label:"UNITS INCOMING"},
          {icon:"✓",trend:"This week",val:"4",label:"AGENT ACTIONS TAKEN"},
        ].map((m,i)=>(
          <div key={i} style={{border:`1px solid ${m.alert?"rgba(239,68,68,0.3)":"var(--border)"}`,borderRadius:12,padding:"15px 17px",background:m.alert?"var(--red-dim)":"var(--surface)" as any}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:9}}>
              <div style={{width:30,height:30,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,background:m.alert?"var(--red-dim)":"var(--accent-dim)"}}>{m.icon}</div>
              <span style={{...S.mono,fontSize:10,padding:"2px 7px",borderRadius:100,background:m.alert?"var(--red-dim)":"var(--accent-dim)",color:m.alert?"var(--red)":"var(--accent)"}}>{m.trend}</span>
            </div>
            <div style={{...S.display,fontSize:26,fontWeight:800,letterSpacing:"-0.03em",color:m.valRed?"var(--red)":"var(--text)",lineHeight:1}}>{m.val}</div>
            <div style={{...S.mono,fontSize:9,color:"var(--muted)",marginTop:4,letterSpacing:"0.05em"}}>{m.label}</div>
          </div>
        ))}
      </div>
      <Panel>
        <PanelHeader title={<>📊 Live SKU Risk Monitor <BeHook>← /api/inventory</BeHook></>} actions={<><Btn onClick={()=>{}}>↻ Refresh</Btn><Btn variant="primary" onClick={onRunAgent}>▶ Run Agent</Btn></>}/>
        <RowHead cols="2fr 70px 85px 75px 120px 95px 105px"><Th>Product</Th><Th>Stock</Th><Th>Incoming</Th><Th>Velocity</Th><Th>Runway</Th><Th>Risk</Th><Th>Agent</Th></RowHead>
        {brand.skus.map(sku=><SkuRow key={sku.id} sku={sku} cols="2fr 70px 85px 75px 120px 95px 105px" isOverview/>)}
      </Panel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Panel>
          <PanelHeader title="📈 Velocity Trend (7d)"/>
          <div style={{padding:16}}>
            {brand.skus.map(sku=>{
              const vel=parseInt(sku.vel)
              const max=Math.max(...brand.skus.map(s=>parseInt(s.vel)))
              return (
                <div key={sku.id} style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",...S.mono,fontSize:11,color:"var(--muted)",marginBottom:5}}>
                    <span>{sku.name}</span><span style={{color:S.riskColor(sku.risk)}}>{sku.vel}</span>
                  </div>
                  <div style={{height:5,background:"var(--surface2)",borderRadius:3}}>
                    <div style={{height:"100%",width:`${Math.round(vel/max*100)}%`,background:S.riskColor(sku.risk),borderRadius:3}}/>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="📦 Reorder History" actions={<Btn onClick={()=>{}}>View all →</Btn>}/>
          {[
            {name:`${brand.skus[1]?.name||""} · 800u`,sub:"Pending approval · $10,000",status:<StatusPill label="Pending" type="pending"/>,date:"Today"},
            {name:`${brand.skus[0]?.name||""} · 500u`,sub:"May 14 · $5,000",status:<StatusPill label="Delivered" type="live"/>,date:"May 28"},
            {name:`${brand.skus[1]?.name||""} · 600u`,sub:"Apr 28 · $7,500",status:<StatusPill label="Delivered" type="live"/>,date:"May 12"},
          ].map((h,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 60px",gap:8,padding:"11px 18px",borderBottom:i<2?"1px solid var(--border)":"none",fontSize:12,alignItems:"center"}}>
              <div><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{h.name}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{h.sub}</div></div>
              {h.status}
              <span style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{h.date}</span>
            </div>
          ))}
        </Panel>
      </div>
    </>
  )
}

function InventorySection({brand}:{brand:Brand}) {
  const [search, setSearch] = useState("")
  const filtered = brand.skus.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||s.id.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <SectionHeader eyebrow="// inventory" title="Inventory" hook="← /api/inventory"
        action={<div style={{display:"flex",gap:8}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search SKUs..." style={{...S.mono,fontSize:11,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:6,padding:"6px 11px",color:"var(--text)",outline:"none",width:160}}/><Btn variant="primary">+ Add SKU</Btn></div>}/>
      <Panel>
        <RowHead cols="2fr 70px 85px 75px 120px 80px 80px 90px"><Th>Product</Th><Th>Stock</Th><Th>Incoming</Th><Th>Velocity</Th><Th>Runway</Th><Th>Lead Time</Th><Th>COGS</Th><Th>Risk</Th></RowHead>
        {filtered.map(sku=>(
          <div key={sku.id} style={{display:"grid",gridTemplateColumns:"2fr 70px 85px 75px 120px 80px 80px 90px",gap:10,padding:"12px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",background:sku.risk==="Critical"?"rgba(239,68,68,0.03)":"transparent"}}>
            <div><div style={{fontSize:13,fontWeight:500,color:"var(--text)"}}>{sku.name}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{sku.id}</div></div>
            <div style={{...S.mono,fontSize:12}}>{sku.stock}</div>
            <div style={{...S.mono,fontSize:12,color:sku.inc.startsWith("+")?"var(--accent)":"var(--muted2)"}}>{sku.inc}</div>
            <div style={{...S.mono,fontSize:12}}>{sku.vel}</div>
            <RunwayBar days={sku.days} pct={sku.pct} risk={sku.risk}/>
            <div style={{...S.mono,fontSize:12}}>21 days</div>
            <div style={{...S.mono,fontSize:12}}>$12.50</div>
            <RiskPill risk={sku.risk}/>
          </div>
        ))}
      </Panel>
    </>
  )
}

function InboundsSection({brand}:{brand:Brand}) {
  const [tab, setTab] = useState("all")
  const inbounds = [
    {status:"transit", name:`${brand.skus[1]?.name||""} Reorder`,ref:"INB-2026-031",units:800,eta:"May 31, 2026",tracking:"SF7492823"},
    {status:"approval",name:`${brand.skus[2]?.name||brand.skus[0]?.name||""} Restock`,ref:"INB-2026-029",units:400,eta:"Jun 12, 2026",tracking:"Pending"},
    {status:"discrepancy",name:`${brand.skus[2]?.name||""} ⚠`,ref:"INB-2026-025",units:150,eta:"May 20, 2026",tracking:"SF7389001"},
  ]
  const filtered = tab==="all"?inbounds:inbounds.filter(i=>i.status===tab)
  const spType = (s:string) => s==="transit"?"transit":s==="approval"?"pending":s==="discrepancy"?"disc":"draft"
  const spLabel = (s:string) => s==="transit"?"In Transit":s==="approval"?"Awaiting Approval":"Discrepancy"
  return (
    <>
      <SectionHeader eyebrow="// stock inbounds" title="Stock Inbounds" hook="← /api/inbounds" action={<Btn variant="primary">+ Create Inbound</Btn>}/>
      <Panel>
        <div style={{display:"flex",gap:6,padding:"12px 18px",borderBottom:"1px solid var(--border)",background:"var(--surface2)"}}>
          {["all","approval","discrepancy"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{...S.mono,fontSize:11,padding:"5px 12px",borderRadius:6,cursor:"pointer",border:tab===t?"1px solid var(--accent-mid)":"1px solid var(--border2)",background:tab===t?"var(--accent-dim)":"none",color:tab===t?"var(--accent)":"var(--muted2)"}}>
              {t==="all"?"All Inbounds":t==="approval"?"Awaiting Approval":"Discrepancies"}
            </button>
          ))}
        </div>
        <RowHead cols="2fr 80px 140px 100px 90px 110px"><Th>Inbound</Th><Th>Units</Th><Th>Status</Th><Th>ETA</Th><Th>Tracking</Th><Th>Actions</Th></RowHead>
        {filtered.map(inb=>(
          <div key={inb.ref} style={{display:"grid",gridTemplateColumns:"2fr 80px 140px 100px 90px 110px",gap:10,padding:"12px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",background:inb.status==="discrepancy"?"rgba(239,68,68,0.03)":inb.status==="approval"?"rgba(245,158,11,0.04)":"transparent"}}>
            <div><div style={{fontSize:13,fontWeight:500,color:"var(--text)"}}>{inb.name}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{inb.ref} · {brand.supplier}</div></div>
            <div style={{...S.mono,fontSize:12,color:inb.status==="discrepancy"?"var(--red)":"var(--text)"}}>{inb.units}</div>
            <StatusPill label={spLabel(inb.status)} type={spType(inb.status) as any}/>
            <div style={{...S.mono,fontSize:11}}>{inb.eta}</div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{inb.tracking}</div>
            <div style={{display:"flex",gap:5}}>
              {inb.status==="approval"&&<Btn variant="primary" style={{fontSize:10,padding:"4px 9px"}}>Approve</Btn>}
              {inb.status==="discrepancy"&&<Btn variant="danger" style={{fontSize:10,padding:"4px 9px"}}>Report</Btn>}
              {inb.status==="transit"&&<Btn style={{fontSize:10,padding:"4px 9px"}}>Track</Btn>}
            </div>
          </div>
        ))}
      </Panel>
    </>
  )
}

function OrdersSection({brand}:{brand:Brand}) {
  const [tab, setTab] = useState("all")
  const orders = [
    {tab:"done",  id:"ORD-29482",name:"J. Chen",      sku:brand.skus[1]?.name||"",qty:2,status:"Shipped",  st:"transit",dest:"New York"},
    {tab:"issue", id:"ORD-29481",name:"⚠ Address issue",sku:brand.skus[0]?.name||"",qty:1,status:"Issue",    st:"disc",   dest:"London"},
    {tab:"hold",  id:"ORD-29480",name:"⚠ Payment hold",sku:brand.skus[1]?.name||"",qty:3,status:"On Hold",  st:"pending", dest:"Sydney"},
    {tab:"done",  id:"ORD-29479",name:"M. Patel",     sku:brand.skus[2]?.name||brand.skus[0]?.name||"",qty:1,status:"Fulfilled",st:"live",dest:"Toronto"},
    {tab:"done",  id:"ORD-29478",name:"S. Kim",       sku:brand.skus[0]?.name||"",qty:2,status:"Fulfilled",st:"live",   dest:"Berlin"},
  ]
  const filtered = tab==="all"?orders:orders.filter(o=>o.tab===tab)
  return (
    <>
      <SectionHeader eyebrow="// order management" title="Orders" hook="← /api/orders" action={<Btn variant="primary">+ New Order</Btn>}/>
      <Panel>
        <div style={{display:"flex",gap:6,padding:"12px 18px",borderBottom:"1px solid var(--border)",background:"var(--surface2)"}}>
          {["all","issue","hold","done"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{...S.mono,fontSize:11,padding:"5px 12px",borderRadius:6,cursor:"pointer",border:tab===t?"1px solid var(--accent-mid)":"1px solid var(--border2)",background:tab===t?"var(--accent-dim)":"none",color:tab===t?"var(--accent)":"var(--muted2)"}}>
              {t==="all"?"All":t==="issue"?"Issues":t==="hold"?"On Hold":"Fulfilled"}
            </button>
          ))}
        </div>
        <RowHead cols="1fr 110px 60px 100px 80px 130px"><Th>Order</Th><Th>SKU</Th><Th>Qty</Th><Th>Status</Th><Th>Dest.</Th><Th>Actions</Th></RowHead>
        {filtered.map(o=>(
          <div key={o.id} style={{display:"grid",gridTemplateColumns:"1fr 110px 60px 100px 80px 130px",gap:10,padding:"12px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",background:o.tab==="issue"?"rgba(239,68,68,0.03)":o.tab==="hold"?"rgba(245,158,11,0.04)":"transparent"}}>
            <div><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{o.id} · {o.name}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>May 30</div></div>
            <div style={{...S.mono,fontSize:11,color:"var(--muted2)"}}>{o.sku.split(" ").slice(0,2).join(" ")}</div>
            <div style={{...S.mono,fontSize:12}}>{o.qty}</div>
            <StatusPill label={o.status} type={o.st as any}/>
            <div style={{...S.mono,fontSize:11,color:"var(--muted)"}}>{o.dest}</div>
            <div style={{display:"flex",gap:4}}>
              {o.tab==="issue"&&<><Btn variant="danger" style={{fontSize:10,padding:"3px 8px"}}>Fix</Btn><Btn variant="amber" style={{fontSize:10,padding:"3px 8px"}}>Hold</Btn></>}
              {o.tab==="hold"&&<Btn variant="primary" style={{fontSize:10,padding:"3px 9px"}}>Release</Btn>}
              {o.tab==="done"&&<Btn style={{fontSize:10,padding:"3px 9px"}}>View</Btn>}
            </div>
          </div>
        ))}
      </Panel>
    </>
  )
}

function SuppliersSection({brand}:{brand:Brand}) {
  return (
    <>
      <SectionHeader eyebrow="// suppliers" title="Supplier Network" action={<Btn variant="primary">+ Add Supplier</Btn>}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {[
          {name:brand.supplier,email:brand.email,active:true},
          {name:"Shenzhen Optical Partners Ltd.",email:"amy@sz-optical.cn",active:false},
        ].map((s,i)=>(
          <div key={i} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:13,fontWeight:500,color:"var(--text)",marginBottom:4}}>{s.name}</div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)",lineHeight:1.7}}>
              Contact: {s.email}<br/>Location: China · Lead: 21 days<br/>MOQ: 500 · Net-30 · ★★★★{s.active?"★":"☆"}
            </div>
            <div style={{...S.mono,fontSize:10,color:s.active?"var(--accent)":"var(--muted)",marginTop:6,display:"flex",alignItems:"center",gap:4}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:s.active?"var(--accent)":"var(--muted)",display:"inline-block"}}/>
              {s.active?"Active · 3 SKUs":"Backup supplier"}
            </div>
            <div style={{display:"flex",gap:7,marginTop:10}}>
              <Btn style={{fontSize:10,padding:"5px 10px"}}>📧 Email</Btn>
              <Btn style={{fontSize:10,padding:"5px 10px"}}>◉ Profile</Btn>
              <Btn variant="primary" style={{fontSize:10,padding:"5px 10px"}}>+ Inbound</Btn>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function InvoicesSection({brand}:{brand:Brand}) {
  const [paid, setPaid] = useState(false)
  return (
    <>
      <SectionHeader eyebrow="// invoice payments" title="Invoice Payments" hook="← /api/invoices"
        action={<div style={{...S.mono,fontSize:12,color:"var(--muted)"}}>Total due: <span style={{color:"var(--amber)",fontWeight:500}}>$13,000</span></div>}/>
      <Panel>
        <RowHead cols="1fr 100px 100px 100px 100px"><Th>Invoice</Th><Th>Amount</Th><Th>Due Date</Th><Th>Status</Th><Th>Action</Th></RowHead>
        {[
          {ref:"INV-2026-041",supplier:brand.supplier,desc:`${brand.skus[1]?.name||""} reorder · 800 units`,amount:"$10,000",due:"Jun 3, 2026",dueColor:"var(--red)",payable:true},
          {ref:"INV-2026-038",supplier:"Shenzhen Optical",desc:"Round 03 materials",amount:"$3,000",due:"Jun 10, 2026",dueColor:"var(--muted)",payable:false},
          {ref:"INV-2026-034",supplier:brand.supplier,desc:`${brand.skus[0]?.name||""} restock`,amount:"$6,250",due:"May 14, 2026",dueColor:"var(--muted)",payable:false,paid:true},
        ].map((inv,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 100px 100px 100px 100px",gap:10,padding:"13px 18px",borderBottom:i<2?"1px solid var(--border)":"none",alignItems:"center",opacity:inv.paid?0.6:1}}>
            <div><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{inv.ref} · {inv.supplier}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{inv.desc}</div></div>
            <div style={{...S.mono,fontSize:13,fontWeight:500,color:inv.paid?"var(--muted)":"var(--text)"}}>{inv.amount}</div>
            <div style={{...S.mono,fontSize:11,color:inv.dueColor}}>{inv.due}</div>
            <StatusPill label={inv.paid?"Paid":inv.payable?"Due Soon":"Upcoming"} type={inv.paid?"live":inv.payable?"pending":"draft"}/>
            {inv.payable?<Btn variant="primary" style={{fontSize:11,padding:"6px 14px"}} onClick={()=>setPaid(true)}>{paid?"Paid ✓":"Pay Now"}</Btn>
             :inv.paid?<Btn style={{fontSize:11,padding:"6px 14px",cursor:"default",opacity:0.5}}>Paid</Btn>
             :<Btn style={{fontSize:11,padding:"6px 14px"}}>Schedule</Btn>}
          </div>
        ))}
      </Panel>
    </>
  )
}

function DeliverySection() {
  const countries = [
    {flag:"🇺🇸",name:"United States",days:"4.2",pct:98,orders:"2,841"},
    {flag:"🇬🇧",name:"United Kingdom",days:"5.1",pct:96,orders:"1,204"},
    {flag:"🇦🇺",name:"Australia",days:"6.8",pct:94,orders:"892"},
    {flag:"🇩🇪",name:"Germany",days:"5.4",pct:97,orders:"743"},
    {flag:"🇨🇦",name:"Canada",days:"5.0",pct:95,orders:"621"},
    {flag:"🇳🇱",name:"Netherlands",days:"4.8",pct:99,orders:"418"},
  ]
  return (
    <>
      <SectionHeader eyebrow="// delivery performance" title="Delivery Performance" hook="← /api/delivery"/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {[{icon:"🚀",val:"5.8",label:"AVG DELIVERY DAYS"},{icon:"📦",val:"97.2%",label:"ON-TIME RATE"},{icon:"🌍",val:"38",label:"COUNTRIES SERVED"}].map((m,i)=>(
          <div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:12,padding:"15px 17px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:9}}>
              <div style={{width:30,height:30,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,background:"var(--accent-dim)"}}>{m.icon}</div>
              <span style={{...S.mono,fontSize:10,padding:"2px 7px",borderRadius:100,background:"var(--accent-dim)",color:"var(--accent)"}}>Global</span>
            </div>
            <div style={{...S.display,fontSize:26,fontWeight:800,letterSpacing:"-0.03em",lineHeight:1}}>{m.val}</div>
            <div style={{...S.mono,fontSize:9,color:"var(--muted)",marginTop:4,letterSpacing:"0.05em"}}>{m.label}</div>
          </div>
        ))}
      </div>
      <Panel>
        <PanelHeader title="🌍 Delivery by Country" actions={<Btn>↓ Export</Btn>}/>
        <RowHead cols="1fr 90px 150px 70px"><Th>Country</Th><Th>Avg Days</Th><Th>On-Time Rate</Th><Th>Orders</Th></RowHead>
        {countries.map(c=>(
          <div key={c.name} style={{display:"grid",gridTemplateColumns:"1fr 90px 150px 70px",gap:10,padding:"11px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",fontSize:12}}>
            <div style={{fontWeight:500}}>{c.flag} {c.name}</div>
            <div style={{...S.mono,fontSize:12}}>{c.days} days</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1,height:4,background:"var(--surface3)",borderRadius:2}}>
                <div style={{width:`${c.pct}%`,height:"100%",background:"var(--accent)",borderRadius:2}}/>
              </div>
              <span style={{...S.mono,fontSize:10,color:"var(--accent)"}}>{c.pct}%</span>
            </div>
            <div style={{...S.mono,fontSize:12}}>{c.orders}</div>
          </div>
        ))}
        <div style={{display:"grid",gridTemplateColumns:"1fr 90px 150px 70px",gap:10,padding:"11px 18px",alignItems:"center",fontSize:12,color:"var(--muted)"}}>
          <div>+ 32 more countries</div>
          <div style={{...S.mono,fontSize:11}}>6.2 avg</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{flex:1,height:4,background:"var(--surface3)",borderRadius:2}}><div style={{width:"92%",height:"100%",background:"var(--muted)",borderRadius:2}}/></div>
            <span style={{...S.mono,fontSize:10}}>92%</span>
          </div>
          <div style={{...S.mono,fontSize:11}}>3,600</div>
        </div>
      </Panel>
    </>
  )
}

function LogsSection({auditRows}:{auditRows:AuditRow[]}) {
  return (
    <>
      <SectionHeader eyebrow="// audit log" title="Audit Log" hook="← snowflake_log.py" action={<Btn>↓ Export CSV</Btn>}/>
      <Panel>
        <RowHead cols="100px 1fr 90px 80px"><Th>Time</Th><Th>Action</Th><Th>SKU</Th><Th>Status</Th></RowHead>
        {auditRows.map((r,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"100px 1fr 90px 80px",gap:10,padding:"10px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",fontSize:12}}>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{r.time}</div>
            <div>{r.action}</div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted2)"}}>{r.sku}</div>
            <div><StatusPill label={r.label} type={r.label==="Sent"||r.label==="Paid"||r.label==="Created"?"live":r.label==="Cancelled"?"draft":"pending"}/></div>
          </div>
        ))}
      </Panel>
    </>
  )
}

function NotificationsSection() {
  const channels = [
    {icon:"💬",bg:"#4A154B",name:"Slack",sub:"Connected · #chainagent-alerts",on:true,preview:"🚨 ChainAgent: Focal Arc Frame 8.9 days stock. Lead 21 days. Reorder drafted 800 units. Approve →"},
    {icon:"📧",bg:"#EA4335",name:"Email",sub:"founder@focal.com",on:true,preview:"[ChainAgent] Action Required — Focal Arc Frame stockout in 8.9 days. Reorder awaiting approval."},
    {icon:"📱",bg:"#25D366",name:"SMS / WhatsApp",sub:"via Twilio API",on:false,preview:"ChainAgent: ⚠ Focal Arc Frame — 8.9 days left. Reorder drafted ($10k). Reply YES to approve."},
    {icon:"🔊",bg:"var(--accent-dim)",name:"Voice Alert",sub:"ElevenLabs · Rachel",on:true,preview:"\"Focal Arc Frame has 8 days of stock. Lead time is 21 days. I've drafted a reorder for 800 units. Awaiting your approval.\""},
  ]
  const [states, setStates] = useState(channels.map(c=>c.on))
  return (
    <>
      <SectionHeader eyebrow="// notifications" title="Notifications"/>
      <Panel>
        <PanelHeader title="🔔 Notification Channels"/>
        <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
          {channels.map((c,i)=>(
            <div key={i} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
                <div style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,background:c.bg,flexShrink:0}}>{c.icon}</div>
                <div style={{flex:1}}><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{c.name}</div><div style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{c.sub}</div></div>
                <Toggle on={states[i]} onChange={v=>setStates(s=>{const n=[...s];n[i]=v;return n})}/>
              </div>
              <div style={{fontSize:11,color:"var(--muted2)",lineHeight:1.6,borderTop:"1px solid var(--border)",paddingTop:8}}><strong>Preview:</strong> {c.preview}</div>
            </div>
          ))}
          <Btn style={{width:"100%",justifyContent:"center",padding:10}}>📤 Send test notification</Btn>
        </div>
      </Panel>
    </>
  )
}

function SettingsSection() {
  const [settings,setSettings] = useState({autoApprove:false,voice:true,snowflake:true,schedule:true})
  return (
    <>
      <SectionHeader eyebrow="// settings" title="Settings"/>
      <Panel>
        <PanelHeader title="◎ Agent Configuration"/>
        <div style={{padding:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          {[
            {key:"autoApprove",label:"Auto-approve reorders",sub:"Send without manual approval"},
            {key:"voice",label:"Voice alerts",sub:"ElevenLabs audio"},
            {key:"snowflake",label:"Snowflake logging",sub:"Log all actions"},
            {key:"schedule",label:"Auto-schedule agent",sub:"Run every X hours"},
          ].map(({key,label,sub})=>(
            <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 13px",background:"var(--surface2)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div><div style={{fontSize:13,color:"var(--text)"}}>{label}</div><div style={{...S.mono,fontSize:10,color:"var(--muted)",marginTop:1}}>{sub}</div></div>
              <Toggle on={settings[key as keyof typeof settings]} onChange={v=>setSettings(s=>({...s,[key]:v}))}/>
            </div>
          ))}
          {[
            {label:"Risk threshold (days)",sub:"Alert below this level",val:"21"},
            {label:"Auto-send window (hrs)",sub:"Hours before auto-approve",val:"2"},
            {label:"Schedule interval (hrs)",sub:"How often agent runs",val:"2"},
            {label:"Reorder buffer (days)",sub:"Safety stock buffer",val:"30"},
          ].map(({label,sub,val})=>(
            <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 13px",background:"var(--surface2)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div><div style={{fontSize:13,color:"var(--text)"}}>{label}</div><div style={{...S.mono,fontSize:10,color:"var(--muted)",marginTop:1}}>{sub}</div></div>
              <input defaultValue={val} type="number" style={{...S.mono,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:6,padding:"5px 9px",color:"var(--text)",fontSize:11,outline:"none",width:85}}/>
            </div>
          ))}
        </div>
        <div style={{padding:"0 16px 16px"}}><Btn variant="primary">Save Changes</Btn></div>
      </Panel>
      <Panel>
        <PanelHeader title={<>🔌 API Connections <BeHook>← .env.local</BeHook></>}/>
        <div style={{padding:16,display:"flex",flexDirection:"column",gap:8}}>
          {[
            {name:"Shopify",sub:"● Connected · dev store",subColor:"var(--accent)",action:"Reconnect"},
            {name:"Claude API",sub:"● Connected",subColor:"var(--accent)",action:"Update Key"},
            {name:"ElevenLabs",sub:"● Connected",subColor:"var(--accent)",action:"Update Key"},
            {name:"Snowflake",sub:"◎ Pending setup",subColor:"var(--amber)",action:"Connect",primary:true},
            {name:"Gemini Vision",sub:"● Connected · PDF parsing",subColor:"var(--accent)",action:"Update Key"},
          ].map(({name,sub,subColor,action,primary})=>(
            <div key={name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 13px",background:"var(--surface2)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div><div style={{fontSize:13,color:"var(--text)"}}>{name}</div><div style={{...S.mono,fontSize:10,color:subColor,marginTop:1}}>{sub}</div></div>
              <Btn variant={primary?"primary":"ghost"} style={{fontSize:10,padding:"5px 12px"}}>{action}</Btn>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

// ── AGENT SECTION ──
function AgentSection({brand,agentRunning,trace,showEmail,emailResult,showReply,cdVal,onRun,onReset,onApprove,onCancel}:{
  brand:Brand,agentRunning:boolean,trace:TraceLine[],showEmail:boolean,emailResult:string,showReply:boolean,cdVal:string,
  onRun:()=>void,onReset:()=>void,onApprove:()=>void,onCancel:()=>void
}) {
  const traceRef = useRef<HTMLDivElement>(null)
  useEffect(()=>{if(traceRef.current)traceRef.current.scrollTop=traceRef.current.scrollHeight},[trace])
  const tagStyle = (tag:string) => TAG_COLORS[tag]||TAG_COLORS.WATCH
  return (
    <>
      <SectionHeader eyebrow="// autonomous agent" title="Agent Control Center" hook="← /api/stream (SSE)"
        action={<div style={{display:"flex",gap:8}}>
          {agentRunning&&<Btn onClick={onReset}>↺ Reset</Btn>}
          <Btn variant="primary" onClick={onRun}>{agentRunning?"✓ Complete":"▶ Run Agent"}</Btn>
        </div>}/>
      <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:7,padding:"11px 16px",borderBottom:"1px solid var(--border)",background:"var(--surface2)"}}>
          <span style={{width:9,height:9,borderRadius:"50%",background:"#ef4444",display:"inline-block"}}/>
          <span style={{width:9,height:9,borderRadius:"50%",background:"#f59e0b",display:"inline-block"}}/>
          <span style={{width:9,height:9,borderRadius:"50%",background:"#22c55e",display:"inline-block"}}/>
          <span style={{...S.mono,fontSize:10,color:"var(--muted)",marginLeft:6}}>{brand.agentTitle}</span>
          {agentRunning&&trace.length<TRACE_SCRIPT.length&&(
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,...S.mono,fontSize:10,color:"var(--accent)"}}>
              <span className="agent-dot" style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>agent running
            </div>
          )}
        </div>
        <div ref={traceRef} style={{padding:"14px 18px",maxHeight:280,overflowY:"auto",display:"flex",flexDirection:"column",gap:1}}>
          {trace.length===0?(
            <div style={{...S.mono,fontSize:12,color:"var(--muted)",padding:"20px 0",textAlign:"center"}}>Click "Run Agent" to start the autonomous loop</div>
          ):trace.map((l,i)=>(
            <div key={i} className="trace-line" style={{display:"flex",gap:9,alignItems:"flex-start",...S.mono,fontSize:11,lineHeight:1.7}}>
              <span style={{color:"var(--muted)",flexShrink:0,fontSize:10,paddingTop:1}}>{l.time}</span>
              <span style={{fontSize:9,fontWeight:500,padding:"2px 6px",borderRadius:3,flexShrink:0,minWidth:48,textAlign:"center" as const,marginTop:2,...tagStyle(l.tag)}}>{l.tag}</span>
              <span style={{color:"var(--text)"}}>{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
      {showEmail&&(
        <div className="email-panel" style={{background:"var(--surface)",border:"1px solid var(--border)",borderLeft:"3px solid var(--accent)",borderRadius:14,overflow:"hidden"}}>
          <PanelHeader title={<>📧 Drafted Supplier Email <BeHook>← claude_draft.py</BeHook></>}/>
          <div style={{padding:"12px 18px",borderBottom:"1px solid var(--border)"}}>
            <div style={{display:"flex",gap:10,...S.mono,fontSize:12,padding:"4px 0"}}><span style={{color:"var(--muted)",minWidth:55}}>To:</span><span>{brand.email}</span></div>
            <div style={{display:"flex",gap:10,...S.mono,fontSize:12,padding:"4px 0"}}><span style={{color:"var(--muted)",minWidth:55}}>Subject:</span><span>Urgent Reorder — {brand.skus[1]?.name||""} · 800 units</span></div>
          </div>
          <div style={{padding:"12px 18px",borderBottom:"1px solid var(--border)"}}>
            <div style={{...S.mono,fontSize:11,lineHeight:1.9,color:"var(--text)",background:"var(--surface2)",borderRadius:8,padding:"12px 14px",whiteSpace:"pre-wrap"}}>
              {`Hi,\n\nWe need to place an urgent reorder for 800 units of ${brand.skus[1]?.name||""} (SKU: ${brand.skus[1]?.id||""}).\n\nCurrent stock covers approximately 9 days. Lead time is 21 days. Please confirm availability and earliest ship date.\n\nTotal order value: $10,000 USD (800 × $12.50)\n\nBest,\n${brand.name} Operations Team\n\n— Sent by ChainAgent`}
            </div>
          </div>
          {!emailResult?(
            <div style={{padding:"12px 18px",display:"flex",alignItems:"center",gap:9,flexWrap:"wrap" as const}}>
              <Btn variant="primary" style={{padding:"9px 20px"}} onClick={onApprove}>✓ Approve & Send</Btn>
              <Btn style={{padding:"9px 18px"}}>✏ Edit</Btn>
              <button onClick={onCancel} style={{background:"none",color:"var(--muted)",border:"none",...S.mono,fontSize:12,cursor:"pointer",padding:9}}>Cancel</button>
              <div style={{marginLeft:"auto",...S.mono,fontSize:11,color:"var(--amber)"}}>⏱ auto-sending in {cdVal}</div>
            </div>
          ):(
            <div style={{padding:"12px 18px",...S.mono,fontSize:12,color:emailResult.startsWith("✓")?"var(--accent)":"var(--muted)"}}>{emailResult}</div>
          )}
          {showReply&&(
            <div className="supplier-reply" style={{background:"var(--surface2)",border:"1px solid rgba(34,197,94,0.2)",borderLeft:"3px solid #4ade80",borderRadius:10,padding:"12px 16px",margin:"0 18px 12px"}}>
              <div style={{...S.mono,fontSize:10,color:"#4ade80",marginBottom:6}}>✉ Supplier Reply · just now</div>
              <div style={{...S.mono,fontSize:11,color:"var(--text)",lineHeight:1.7}}>Hi, confirmed — <strong>800 units</strong> available. Ships Monday. ETA 7 business days. Invoice to follow.<br/><br/>— {brand.supplier}</div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── MAIN COMPONENT ──
export default function Dashboard() {
  const [section, setSection]     = useState("overview")
  const [brandId, setBrandId]     = useState("focal")
  const [brandDDOpen, setBrandDD] = useState(false)
  const [syncSecs, setSyncSecs]   = useState(0)
  const [scheduleSecs, setScheduleSecs] = useState(7200)
  const [scheduleOn, setScheduleOn]     = useState(true)
  const [agentRunning, setAgentRunning] = useState(false)
  const [trace, setTrace]         = useState<TraceLine[]>([])
  const [showEmail, setShowEmail] = useState(false)
  const [emailResult, setEmailResult] = useState("")
  const [showReply, setShowReply] = useState(false)
  const [cdSecs, setCdSecs]       = useState(7200)
  const [auditRows, setAuditRows] = useState<AuditRow[]>([
    {time:"Today 09:14",action:"Reorder drafted · 800 units · $10,000",sku:"FOCL-EC999002",label:"Pending"},
    {time:"Yesterday",  action:"Inbound INB-2026-029 created · 400 units",sku:"FOCL-EC999003",label:"Created"},
    {time:"May 28",     action:"Reorder approved & sent · 500 units",sku:"FOCL-EC999001",label:"Sent"},
    {time:"May 26",     action:"Discrepancy flagged · 50 unit shortfall",sku:"FOCL-EC999003",label:"Open"},
  ])
  const cdInt  = useRef<ReturnType<typeof setInterval>|null>(null)
  const replyTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const brand  = BRANDS[brandId]

  // Sync timer
  useEffect(()=>{
    const t=setInterval(()=>setSyncSecs(s=>s+1),1000)
    return ()=>clearInterval(t)
  },[])

  // Schedule countdown
  useEffect(()=>{
    if(!scheduleOn){return}
    const t=setInterval(()=>{
      setScheduleSecs(s=>{
        if(s<=1){return 7200}
        return s-1
      })
    },1000)
    return ()=>clearInterval(t)
  },[scheduleOn])

  // Countdown for email
  useEffect(()=>{
    if(showEmail&&!emailResult){
      cdInt.current=setInterval(()=>setCdSecs(s=>Math.max(0,s-1)),1000)
    }
    return ()=>{if(cdInt.current)clearInterval(cdInt.current)}
  },[showEmail,emailResult])

  const fmt = (s:number)=>{
    const h=String(Math.floor(s/3600)).padStart(2,"0")
    const m=String(Math.floor((s%3600)/60)).padStart(2,"0")
    const sc=String(s%60).padStart(2,"0")
    return `${h}:${m}:${sc}`
  }

  const handleRunAgent = useCallback(()=>{
    if(agentRunning) return
    setAgentRunning(true)
    setTrace([])
    setShowEmail(false)
    setEmailResult("")
    setShowReply(false)
    setCdSecs(7200)
    TRACE_SCRIPT.forEach((l,i)=>{
      setTimeout(()=>{
        const now=new Date().toLocaleTimeString("en-US",{hour12:false})
        setTrace(prev=>[...prev,{tag:l.tag,msg:l.msg,time:now}])
        if(i===TRACE_SCRIPT.length-1){
          setTimeout(()=>setShowEmail(true),500)
        }
      },l.d)
    })
  },[agentRunning])

  const handleApprove = useCallback(()=>{
    if(cdInt.current)clearInterval(cdInt.current)
    setEmailResult("✓ Email sent to supplier · Logged to Snowflake · Inbound auto-created")
    const now=new Date().toLocaleTimeString("en-US",{hour12:false})
    setTrace(prev=>[...prev,{tag:"REPLY",msg:"Supplier confirmed · 800 units · ships Monday ✓",time:now}])
    setAuditRows(prev=>[{time:`Today ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}`,action:"Reorder approved & sent · 800 units · $10,000",sku:"FOCL-EC999002",label:"Sent"},...prev])
    replyTimer.current=setTimeout(()=>setShowReply(true),2500)
  },[])

  const handleCancel = useCallback(()=>{
    if(cdInt.current)clearInterval(cdInt.current)
    setEmailResult("✗ Action cancelled by founder")
    setAuditRows(prev=>[{time:`Today ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}`,action:"Reorder cancelled by founder",sku:"FOCL-EC999002",label:"Cancelled"},...prev])
  },[])

  const handleReset = useCallback(()=>{
    setAgentRunning(false)
    setTrace([])
    setShowEmail(false)
    setEmailResult("")
    setShowReply(false)
    setCdSecs(7200)
    if(cdInt.current)clearInterval(cdInt.current)
    if(replyTimer.current)clearTimeout(replyTimer.current)
  },[])

  const navItems = [
    {id:"overview",icon:"◈",label:"Monitor"},
    {id:"agent",   icon:"⚡",label:"Monitor",badge:"1 alert",badgeColor:"red"},
    {id:"inventory",icon:"◫",label:"Monitor"},
    {id:"inbounds",icon:"📥",label:"Monitor",badge:"1",badgeColor:"amber"},
    {id:"orders",  icon:"📦",label:"Monitor",badge:"2 issues",badgeColor:"red"},
    {id:"suppliers",icon:"◉",label:"Manage"},
    {id:"invoices",icon:"💳",label:"Manage",badge:"$10k",badgeColor:"amber"},
    {id:"delivery",icon:"🌍",label:"Manage"},
    {id:"logs",    icon:"≡", label:"Manage",badge:String(auditRows.length),badgeColor:"green"},
    {id:"notifications",icon:"🔔",label:"Manage"},
    {id:"settings",icon:"◎",label:"Manage"},
  ]

  const sectionGroups = {Monitor:navItems.filter(n=>n.label==="Monitor"), Manage:navItems.filter(n=>n.label==="Manage")}

  return (
    <>
      <style dangerouslySetInnerHTML={{__html:CSS}}/>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>

      {/* NAV */}
      <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",height:54,borderBottom:"1px solid var(--border)",background:"rgba(6,8,9,0.95)",backdropFilter:"blur(16px)"}}>
        <a style={{...S.display,fontWeight:800,fontSize:16,letterSpacing:"-0.02em",color:"var(--text)",display:"flex",alignItems:"center",gap:8,cursor:"pointer",textDecoration:"none"}} onClick={()=>setSection("overview")}>
          <span className="live-dot" style={{width:7,height:7,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>ChainAgent
        </a>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:6,...S.mono,fontSize:10,color:"var(--muted)",padding:"4px 10px",background:"var(--surface2)",borderRadius:100,border:"1px solid var(--border)"}}>
            <span className="sync-dot" style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>
            {syncSecs<60?`synced ${syncSecs}s ago`:`synced ${Math.floor(syncSecs/60)}m ago`}
          </div>
          <div style={{position:"relative",display:"flex",alignItems:"center",gap:8,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:8,padding:"6px 12px",cursor:"pointer",...S.mono,fontSize:11,color:"var(--text)"}} onClick={()=>setBrandDD(!brandDDOpen)}>
            🏷 {brand.label} <span style={{color:"var(--muted)",fontSize:10}}>▾</span>
            {brandDDOpen&&(
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"var(--surface)",border:"1px solid var(--border2)",borderRadius:10,minWidth:210,zIndex:300,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
                {Object.entries(BRANDS).map(([id,b])=>(
                  <div key={id} onClick={(e)=>{e.stopPropagation();setBrandId(id);setBrandDD(false)}} style={{padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",color:brandId===id?"var(--accent)":"var(--muted2)",cursor:"pointer",transition:"background 0.15s"}} onMouseOver={e=>(e.currentTarget.style.background="var(--surface2)")} onMouseOut={e=>(e.currentTarget.style.background="transparent")}>
                    {b.name}<span style={{fontSize:9,color:"var(--muted)",background:"var(--surface2)",padding:"2px 6px",borderRadius:100}}>{b.skus.length} SKUs</span>
                  </div>
                ))}
                <div style={{padding:"10px 14px",color:"var(--accent)",cursor:"pointer",borderTop:"1px solid var(--border)"}} onMouseOver={e=>(e.currentTarget.style.background="var(--accent-dim)")} onMouseOut={e=>(e.currentTarget.style.background="transparent")}>+ Add new brand</div>
              </div>
            )}
          </div>
          <div style={{...S.mono,fontSize:10,color:"var(--muted)",background:"var(--surface2)",padding:"4px 10px",borderRadius:100,border:"1px solid var(--border)",cursor:"pointer"}} onClick={()=>setSection("settings")}>
            Next run: {fmt(scheduleSecs)}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,...S.mono,fontSize:10,padding:"5px 12px",borderRadius:100,border:"1px solid var(--accent-mid)",background:"var(--accent-dim)",color:"var(--accent)"}}>
            <span className="agent-dot" style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>Agent ready
          </div>
        </div>
      </nav>

      {/* LAYOUT */}
      <div style={{display:"grid",gridTemplateColumns:"224px 1fr",minHeight:"100vh",paddingTop:54,position:"relative",zIndex:1}} onClick={()=>brandDDOpen&&setBrandDD(false)}>

        {/* SIDEBAR */}
        <aside style={{borderRight:"1px solid var(--border)",background:"var(--surface)",padding:"18px 0",position:"sticky",top:54,height:"calc(100vh - 54px)",overflowY:"auto",display:"flex",flexDirection:"column"}}>
          {Object.entries(sectionGroups).map(([group,items])=>(
            <div key={group}>
              <div style={{padding:"0 12px",marginBottom:18}}>
                <div style={{...S.mono,fontSize:9,letterSpacing:"0.15em",color:"var(--muted)",textTransform:"uppercase" as const,padding:"0 8px",marginBottom:5}}>{group}</div>
                {items.map(item=>(
                  <button key={item.id} id={`nav-${item.id}`} onClick={()=>setSection(item.id)} style={{display:"flex",alignItems:"center",gap:9,padding:"7px 10px",borderRadius:8,cursor:"pointer",transition:"all 0.15s",color:section===item.id?"var(--accent)":"var(--muted2)",fontSize:13,border:section===item.id?"1px solid var(--accent-mid)":"none",background:section===item.id?"var(--accent-dim)":"none",width:"100%",textAlign:"left" as const}}>
                    <span style={{width:15,textAlign:"center" as const,flexShrink:0,fontSize:13}}>{item.icon}</span>
                    {item.label==="Monitor"?["Overview","Run Agent","Inventory","Stock Inbounds","Orders"][navItems.findIndex(n=>n.id===item.id)]:["Suppliers","Invoices","Delivery Perf.","Audit Log","Notifications","Settings"][navItems.filter(n=>n.label==="Manage").findIndex(n=>n.id===item.id)]}
                    {item.badge&&<span style={{marginLeft:"auto",...S.mono,fontSize:9,padding:"2px 6px",borderRadius:100,background:item.badgeColor==="red"?"var(--red-dim)":item.badgeColor==="green"?"var(--accent-dim)":"var(--amber-dim)",color:item.badgeColor==="red"?"var(--red)":item.badgeColor==="green"?"var(--accent)":"var(--amber)"}}>{item.badge}</span>}
                  </button>
                ))}
              </div>
              <div style={{height:1,background:"var(--border)",margin:"0 12px 18px"}}/>
            </div>
          ))}
          <div style={{margin:"0 12px 12px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:12}}>
            <div style={{...S.mono,fontSize:9,color:"var(--muted)",letterSpacing:"0.1em",textTransform:"uppercase" as const,marginBottom:6}}>Agent Schedule</div>
            <div style={{...S.display,fontSize:20,fontWeight:700,color:"var(--text)",letterSpacing:"-0.02em"}}>{fmt(scheduleSecs)}</div>
            <div style={{...S.mono,fontSize:9,color:"var(--muted)",marginTop:1}}>until next auto-run</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:9}}>
              <span style={{fontSize:11,color:"var(--muted2)"}}>Auto-run</span>
              <Toggle on={scheduleOn} onChange={setScheduleOn}/>
            </div>
          </div>
          <div style={{marginTop:"auto",padding:12}}>
            <div style={{background:"var(--red-dim)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,padding:10,marginBottom:7}}>
              <div style={{...S.display,fontSize:20,fontWeight:800,color:"var(--red)",letterSpacing:"-0.02em"}}>{brand.days}</div>
              <div style={{...S.mono,fontSize:9,color:"var(--muted)",letterSpacing:"0.06em",marginTop:2}}>DAYS TO STOCKOUT</div>
            </div>
            <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:10}}>
              <div style={{...S.display,fontSize:20,fontWeight:800,color:"var(--text)",letterSpacing:"-0.02em"}}>{auditRows.length}</div>
              <div style={{...S.mono,fontSize:9,color:"var(--muted)",letterSpacing:"0.06em",marginTop:2}}>ACTIONS THIS WEEK</div>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main style={{padding:"22px 26px",display:"flex",flexDirection:"column",gap:16,overflow:"hidden"}}>
          {section==="overview"    &&<OverviewSection brand={brand} onRunAgent={()=>{setSection("agent");setTimeout(handleRunAgent,200)}}/>}
          {section==="agent"       &&<AgentSection brand={brand} agentRunning={agentRunning} trace={trace} showEmail={showEmail} emailResult={emailResult} showReply={showReply} cdVal={fmt(cdSecs)} onRun={handleRunAgent} onReset={handleReset} onApprove={handleApprove} onCancel={handleCancel}/>}
          {section==="inventory"   &&<InventorySection brand={brand}/>}
          {section==="inbounds"    &&<InboundsSection brand={brand}/>}
          {section==="orders"      &&<OrdersSection brand={brand}/>}
          {section==="suppliers"   &&<SuppliersSection brand={brand}/>}
          {section==="invoices"    &&<InvoicesSection brand={brand}/>}
          {section==="delivery"    &&<DeliverySection/>}
          {section==="logs"        &&<LogsSection auditRows={auditRows}/>}
          {section==="notifications"&&<NotificationsSection/>}
          {section==="settings"    &&<SettingsSection/>}
        </main>
      </div>
    </>
  )
}
