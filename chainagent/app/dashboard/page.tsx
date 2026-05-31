"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { signOut, useSession } from "next-auth/react"
import { useAgentStream } from "./hooks/useAgentStream"
import type { TraceLine } from "./hooks/useAgentStream"

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
interface RawSKU {
  id?: string; name: string; stock: number; velocity_per_day: number
  lead_time_days: number; supplier_name: string; reorder_qty: number
}
interface AuditRow { time: string; action: string; sku: string; label: string }
interface Supplier {
  id: string; name: string; contact: string; email: string; phone: string
  location: string; leadTime: string; moq: number; terms: string; rating: number
  active: boolean; skus: number; since: string; tags: string[]; notes: string
  onTimeRate: number; totalOrders: number; lastOrder: string
}
interface Invoice {
  ref: string; supplier: string; supplierEmail: string; desc: string
  amount: string; amountRaw: number; due: string
  status: "due-soon" | "upcoming" | "paid"; payable: boolean; paid: boolean
}
interface DeliveryCountry { flag: string; name: string; days: string; pct: number; orders: string }

// ── BRAND DATA ──
const BRANDS: Record<string, Brand> = {
  portland: {
    name:"Portland Optics", label:"brand: Portland Optics", days:"8.9", stock:"3,614",
    incoming:"800", crit:"PORTLAND AVIATOR PRO",
    agentTitle:"chainagent-runtime · brand: Portland Optics · 3 SKUs monitored",
    supplier:"Guangzhou Optics Co.", email:"wei@guangzhou-optics.cn",
    skus:[
      {name:"Portland Classic Frame",  id:"DHOD5-EC999002",stock:"1,592",inc:"+300",   vel:"47/day",days:"33.9",pct:85, risk:"Healthy", rc:"risk-ok"},
      {name:"Portland Aviator Pro",id:"DHOD5-EC999009",stock:"428",  inc:"+800 ↑", vel:"48/day",days:"8.9", pct:15, risk:"Critical",rc:"risk-critical"},
      {name:"Portland Aviator Pro Amber", id:"DHOD5-EC999003",stock:"1,594",inc:"—",      vel:"31/day",days:"21.0",pct:42, risk:"Watch",   rc:"risk-watch"},
    ]
  }
}

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
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
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

function RefreshBtn({onClick}:{onClick?:()=>void}) {
  const [phase, setPhase] = useState<"idle"|"loading"|"done">("idle")
  function handleClick() {
    if (phase !== "idle") return
    setPhase("loading")
    onClick?.()
    setTimeout(() => {
      setPhase("done")
      setTimeout(() => setPhase("idle"), 1200)
    }, 900)
  }
  const styles: Record<string, React.CSSProperties> = {
    idle:    { background:"var(--surface)", color:"var(--muted2)", border:"1px solid var(--border2)" },
    loading: { background:"var(--accent-dim)", color:"var(--accent)", border:"1px solid var(--accent-mid)" },
    done:    { background:"rgba(34,197,94,0.12)", color:"#4ade80", border:"1px solid rgba(34,197,94,0.25)" },
  }
  const base: React.CSSProperties = {...S.mono,fontSize:11,fontWeight:500,letterSpacing:"0.04em",padding:"7px 13px",borderRadius:7,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6,transition:"background 0.2s, color 0.2s, border-color 0.2s"}
  return (
    <button style={{...base,...styles[phase]}} onClick={handleClick}>
      {phase === "done" ? (
        <span style={{fontSize:12}}>✓</span>
      ) : (
        <span style={{display:"inline-block", animation: phase==="loading" ? "spin 0.7s linear infinite" : "none"}}>↻</span>
      )}
      {phase === "idle"    && "Refresh"}
      {phase === "loading" && "Refreshing…"}
      {phase === "done"    && "Updated"}
    </button>
  )
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
function OverviewSection({brand,onRunAgent,onViewAllReorders}:{brand:Brand,onRunAgent:()=>void,onViewAllReorders:()=>void}) {
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
        <PanelHeader title={<>📊 Live SKU Risk Monitor <BeHook>← /api/inventory</BeHook></>} actions={<><RefreshBtn/><Btn variant="primary" onClick={onRunAgent}>▶ Run Agent</Btn></>}/>
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
          <PanelHeader title="📦 Reorder History" actions={<Btn onClick={onViewAllReorders}>View all →</Btn>}/>
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

function SuppliersSection({suppliers: initSuppliers, onGoToInbounds}:{suppliers:Supplier[], onGoToInbounds:()=>void}) {
  const [suppliers, setSuppliers] = useState(initSuppliers)
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({name:"",contact:"",email:"",location:"",leadTime:"",moq:"",terms:""})
  const [saved, setSaved] = useState(false)

  useEffect(()=>setSuppliers(initSuppliers),[initSuppliers])

  function addSupplier() {
    if(!form.name||!form.email) return
    const s:Supplier = {
      id:`SUP-${suppliers.length+1}`,name:form.name,contact:form.contact,email:form.email,
      phone:"",location:form.location,leadTime:form.leadTime||"—",moq:parseInt(form.moq)||0,
      terms:form.terms||"Net-30",rating:3,active:false,skus:0,since:new Date().getFullYear().toString(),
      tags:["new"],notes:"",onTimeRate:0,totalOrders:0,lastOrder:"—"
    }
    setSuppliers(prev=>[...prev,s])
    setSaved(true)
    setTimeout(()=>{setShowModal(false);setSaved(false);setForm({name:"",contact:"",email:"",location:"",leadTime:"",moq:"",terms:""})},700)
  }

  return (
    <>
      <SectionHeader eyebrow="// suppliers" title="Supplier Network"
        action={<Btn variant="primary" onClick={()=>setShowModal(true)}>+ Add Supplier</Btn>}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {suppliers.map(s=>(
          <div key={s.id} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
              <div>
                <div style={{fontSize:13,fontWeight:500,color:"var(--text)",marginBottom:4}}>{s.name}</div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap" as const}}>
                  {s.tags.map(t=>(
                    <span key={t} style={{...S.mono,fontSize:9,padding:"2px 6px",borderRadius:4,background:"var(--surface3)",color:"var(--muted2)"}}>{t}</span>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:1,flexShrink:0}}>
                {[1,2,3,4,5].map(n=><span key={n} style={{fontSize:11,color:n<=s.rating?"var(--amber)":"var(--surface3)"}}>★</span>)}
              </div>
            </div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)",lineHeight:1.9,marginBottom:6}}>
              Contact: {s.contact} · {s.email}<br/>
              Location: {s.location} · Lead: {s.leadTime}<br/>
              MOQ: {s.moq.toLocaleString()} · {s.terms}
            </div>
            <div style={{...S.mono,fontSize:10,color:s.active?"var(--accent)":"var(--muted)",marginBottom:8,display:"flex",alignItems:"center",gap:4}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:s.active?"var(--accent)":"var(--muted)",display:"inline-block"}}/>
              {s.active?`Active · ${s.skus} SKUs`:"Inactive"} · Since {s.since}
            </div>
            {expandedId===s.id&&(
              <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",marginBottom:10,...S.mono,fontSize:10,color:"var(--muted2)",lineHeight:1.9}}>
                {s.phone&&<div>Phone: {s.phone}</div>}
                <div>On-time rate: <span style={{color:"var(--accent)"}}>{s.onTimeRate}%</span> · Total orders: {s.totalOrders}</div>
                <div>Last order: {s.lastOrder}</div>
                {s.notes&&<div style={{color:"var(--muted)",marginTop:4,fontStyle:"italic"}}>{s.notes}</div>}
              </div>
            )}
            <div style={{display:"flex",gap:7}}>
              <Btn style={{fontSize:10,padding:"5px 10px"}} onClick={()=>window.open(`mailto:${s.email}?subject=Re: Portland Optics Supply Inquiry`)}>📧 Email</Btn>
              <Btn style={{fontSize:10,padding:"5px 10px"}} onClick={()=>setExpandedId(expandedId===s.id?null:s.id)}>
                {expandedId===s.id?"✕ Close":"◉ Profile"}
              </Btn>
              <Btn variant="primary" style={{fontSize:10,padding:"5px 10px"}} onClick={onGoToInbounds}>+ Inbound</Btn>
            </div>
          </div>
        ))}
      </div>

      {showModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",backdropFilter:"blur(4px)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowModal(false)}>
          <div style={{background:"var(--surface)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:420,maxWidth:"90vw"}} onClick={e=>e.stopPropagation()}>
            <div style={{...S.display,fontSize:16,fontWeight:700,marginBottom:3}}>Add Supplier</div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginBottom:18}}>New supplier saved to session.</div>
            {([
              {key:"name",    label:"Company Name *", placeholder:"e.g. Osaka Lens Works"},
              {key:"contact", label:"Contact Name",   placeholder:"e.g. Kenji Tanaka"},
              {key:"email",   label:"Email *",        placeholder:"kenji@osaka-lens.jp"},
              {key:"location",label:"Location",       placeholder:"e.g. Osaka, Japan"},
              {key:"leadTime",label:"Lead Time",      placeholder:"e.g. 25 days"},
              {key:"moq",     label:"MOQ",            placeholder:"e.g. 500"},
              {key:"terms",   label:"Payment Terms",  placeholder:"e.g. Net-30"},
            ] as {key:string,label:string,placeholder:string}[]).map(({key,label,placeholder})=>(
              <div key={key} style={{marginBottom:11}}>
                <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginBottom:4}}>{label}</div>
                <input value={form[key as keyof typeof form]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={placeholder}
                  style={{...S.mono,fontSize:11,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:6,padding:"7px 11px",color:"var(--text)",outline:"none",width:"100%"}}/>
              </div>
            ))}
            <div style={{display:"flex",gap:9,marginTop:4}}>
              <Btn variant={saved?"ghost":"primary"} onClick={addSupplier} style={{flex:1,justifyContent:"center"}}>
                {saved?"Saved ✓":"Save Supplier"}
              </Btn>
              <Btn onClick={()=>setShowModal(false)} style={{flex:1,justifyContent:"center"}}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function InvoicesSection({invoices: initInvoices}:{invoices:Invoice[]}) {
  const [invoices, setInvoices] = useState(initInvoices)
  const [scheduled, setScheduled] = useState<Set<string>>(new Set())

  useEffect(()=>setInvoices(initInvoices),[initInvoices])

  function payInvoice(ref:string) {
    setInvoices(prev=>prev.map(inv=>inv.ref===ref?{...inv,paid:true,status:"paid" as const}:inv))
  }
  function scheduleInvoice(ref:string) {
    setScheduled(prev=>new Set([...prev,ref]))
  }

  const dueColor = (inv:Invoice) => inv.paid?"var(--muted)":inv.status==="due-soon"?"var(--red)":"var(--amber)"
  const statusLabel = (inv:Invoice) => inv.paid?"Paid":inv.status==="due-soon"?"Due Soon":scheduled.has(inv.ref)?"Scheduled":"Upcoming"
  const statusType  = (inv:Invoice):React.ComponentProps<typeof StatusPill>["type"] =>
    inv.paid?"live":inv.status==="due-soon"?"pending":scheduled.has(inv.ref)?"pending":"draft"

  const outstanding = invoices.filter(inv=>!inv.paid).reduce((s,inv)=>s+inv.amountRaw,0)

  return (
    <>
      <SectionHeader eyebrow="// invoice payments" title="Invoice Payments" hook="← /api/invoices"
        action={<div style={{...S.mono,fontSize:12,color:"var(--muted)"}}>Outstanding: <span style={{color:"var(--amber)",fontWeight:500}}>${outstanding.toLocaleString()}</span></div>}/>
      <Panel>
        <RowHead cols="1fr 100px 110px 110px 110px"><Th>Invoice</Th><Th>Amount</Th><Th>Due Date</Th><Th>Status</Th><Th>Action</Th></RowHead>
        {invoices.map((inv,i)=>(
          <div key={inv.ref} style={{display:"grid",gridTemplateColumns:"1fr 100px 110px 110px 110px",gap:10,padding:"13px 18px",borderBottom:i<invoices.length-1?"1px solid var(--border)":"none",alignItems:"center",opacity:inv.paid?0.55:1}}>
            <div>
              <div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{inv.ref} · {inv.supplier}</div>
              <div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{inv.desc}</div>
            </div>
            <div style={{...S.mono,fontSize:13,fontWeight:500,color:inv.paid?"var(--muted)":"var(--text)"}}>{inv.amount}</div>
            <div style={{...S.mono,fontSize:11,color:dueColor(inv)}}>{inv.due}</div>
            <StatusPill label={statusLabel(inv)} type={statusType(inv)}/>
            {inv.paid?(
              <Btn style={{fontSize:11,padding:"6px 14px",cursor:"default",opacity:0.5}}>Receipt</Btn>
            ):inv.status==="due-soon"&&!scheduled.has(inv.ref)?(
              <Btn variant="primary" style={{fontSize:11,padding:"6px 14px"}} onClick={()=>payInvoice(inv.ref)}>Pay Now</Btn>
            ):scheduled.has(inv.ref)?(
              <Btn style={{fontSize:11,padding:"6px 14px",cursor:"default",opacity:0.7}}>Scheduled ✓</Btn>
            ):(
              <Btn style={{fontSize:11,padding:"6px 14px"}} onClick={()=>scheduleInvoice(inv.ref)}>Schedule</Btn>
            )}
          </div>
        ))}
      </Panel>
    </>
  )
}

function DeliverySection({countries}:{countries:DeliveryCountry[]}) {
  function exportCSV() {
    const header = "Country,Avg Days,On-Time Rate (%),Orders\n"
    const rows = countries.map(c=>`"${c.name}",${c.days},${c.pct},"${c.orders}"`).join("\n")
    const blob = new Blob([header+rows],{type:"text/csv"})
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href=url; a.download="delivery-performance.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  const avgDays = countries.length
    ? (countries.reduce((s,c)=>s+parseFloat(c.days),0)/countries.length).toFixed(1)
    : "—"
  const avgOnTime = countries.length
    ? Math.round(countries.reduce((s,c)=>s+c.pct,0)/countries.length)
    : 0

  return (
    <>
      <SectionHeader eyebrow="// delivery performance" title="Delivery Performance" hook="← /api/delivery"/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {[
          {icon:"🚀",val:avgDays,   label:"AVG DELIVERY DAYS"},
          {icon:"📦",val:`${avgOnTime}%`,label:"ON-TIME RATE"},
          {icon:"🌍",val:"38",      label:"COUNTRIES SERVED"},
        ].map((m,i)=>(
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
        <PanelHeader title="🌍 Delivery by Country" actions={<Btn onClick={exportCSV}>↓ Export CSV</Btn>}/>
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
          <div>+ 29 more countries</div>
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
  function exportCSV() {
    const header = "Time,Action,SKU,Status\n"
    const rows = auditRows.map(r=>`"${r.time}","${r.action}","${r.sku}","${r.label}"`).join("\n")
    const blob = new Blob([header+rows],{type:"text/csv"})
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href=url; a.download="audit-log.csv"; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <SectionHeader eyebrow="// audit log" title="Audit Log" hook="← snowflake_log.py" action={<Btn onClick={exportCSV}>↓ Export CSV</Btn>}/>
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
    {icon:"💬",bg:"#4A154B",name:"Slack",sub:"Connected · #chainagent-alerts",on:true,preview:"🚨 ChainAgent: Portland Aviator Pro 8.9 days stock. Lead 21 days. Reorder drafted 800 units. Approve →"},
    {icon:"📧",bg:"#EA4335",name:"Email",sub:"founder@portlandoptics.com",on:true,preview:"[ChainAgent] Action Required — Portland Aviator Pro stockout in 8.9 days. Reorder awaiting approval."},
    {icon:"📱",bg:"#25D366",name:"SMS / WhatsApp",sub:"via Twilio API",on:false,preview:"ChainAgent: ⚠ Portland Aviator Pro — 8.9 days left. Reorder drafted ($10k). Reply YES to approve."},
    {icon:"🔊",bg:"var(--accent-dim)",name:"Voice Alert",sub:"ElevenLabs · Rachel",on:true,preview:"\"Portland Aviator Pro has 8 days of stock. Lead time is 21 days. I've drafted a reorder for 800 units. Awaiting your approval.\""},
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
  const { data: session } = useSession()
  const [settings,setSettings] = useState({autoApprove:false,voice:true,snowflake:true,schedule:true})
  return (
    <>
      <SectionHeader eyebrow="// settings" title="Settings"/>
      <Panel>
        <PanelHeader title="◎ Account"/>
        <div style={{padding:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div>
            <div style={{fontSize:13,color:"var(--text)"}}>{session?.user?.name ?? "Signed in"}</div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginTop:4}}>{session?.user?.email ?? "—"}</div>
          </div>
          <Btn variant="ghost" onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</Btn>
        </div>
      </Panel>
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
function AgentSection({brand,agentRunning,trace,showEmail,emailResult,showReply,cdVal,emailContent,onRun,onReset,onApprove,onCancel}:{
  brand:Brand,agentRunning:boolean,trace:TraceLine[],showEmail:boolean,emailResult:string,showReply:boolean,cdVal:string,emailContent:string,
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
          {agentRunning&&(
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
              {emailContent || `Hi,\n\nWe need to place an urgent reorder for 800 units of ${brand.skus[1]?.name||""} (SKU: ${brand.skus[1]?.id||""}).\n\nCurrent stock covers approximately 9 days. Lead time is 21 days. Please confirm availability and earliest ship date.\n\nTotal order value: $10,000 USD (800 × $12.50)\n\nBest,\n${brand.name} Operations Team\n\n— Sent by ChainAgent`}
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
  const [brandId, setBrandId]     = useState("portland")
  const [syncSecs, setSyncSecs]   = useState(0)
  const [syncPhase, setSyncPhase] = useState<"idle"|"syncing"|"done">("idle")
  const [scheduleSecs, setScheduleSecs] = useState(7200)
  const [scheduleOn, setScheduleOn]     = useState(true)
  const [cdSecs, setCdSecs]       = useState(7200)
  const [liveSkus, setLiveSkus]   = useState<RawSKU[] | null>(null)
  const [auditRows, setAuditRows] = useState<AuditRow[]>([
    {time:"Today 09:14",  action:"Reorder drafted · Portland Aviator Pro · 800 units · $10,000", sku:"DHOD5-EC999009", label:"Pending"},
    {time:"Today 08:30",  action:"Agent cycle completed · 3 SKUs evaluated",                     sku:"all",           label:"Created"},
    {time:"Yesterday",    action:"Inbound INB-2026-029 created · 400 units",                     sku:"DHOD5-EC999003", label:"Created"},
    {time:"May 29",       action:"Invoice INV-2026-038 scheduled for Jun 10",                    sku:"—",             label:"Pending"},
    {time:"May 28",       action:"Reorder approved & sent · 500 units",                          sku:"DHOD5-EC999002", label:"Sent"},
    {time:"May 27",       action:"Stock sync completed · data refreshed from Shopify",           sku:"all",           label:"Created"},
    {time:"May 26",       action:"Discrepancy flagged · INB-2026-025 · 50 unit shortfall",       sku:"DHOD5-EC999003", label:"Open"},
    {time:"May 25",       action:"Invoice INV-2026-034 paid · $6,250",                           sku:"—",             label:"Paid"},
    {time:"May 24",       action:"Reorder cancelled by founder · 200 units",                     sku:"DHOD5-EC999003", label:"Cancelled"},
    {time:"May 22",       action:"New supplier vetted · Taipei Precision Eyewear",               sku:"—",             label:"Created"},
  ])
  const [suppliers,  setSuppliers]  = useState<Supplier[]>([])
  const [invoices,   setInvoices]   = useState<Invoice[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryCountry[]>([])
  const cdInt = useRef<ReturnType<typeof setInterval>|null>(null)

  // ── real backend hook ──
  const stream = useAgentStream()
  const { agentRunning, showEmail, emailResult, showReply, backendOnline } = stream

  // ── load real SKU data ──
  useEffect(()=>{
    fetch("/api/skus")
      .then(r=>r.json())
      .then((data: RawSKU[])=>setLiveSkus(data))
      .catch(()=>{}) // fall back to hardcoded BRANDS
  },[])

  // ── load suppliers / invoices / deliveries ──
  useEffect(()=>{
    fetch("/api/suppliers").then(r=>r.json()).then((d:Supplier[])=>setSuppliers(d)).catch(()=>{})
    fetch("/api/invoices").then(r=>r.json()).then((d:Invoice[])=>setInvoices(d)).catch(()=>{})
    fetch("/api/deliveries").then(r=>r.json()).then((d:DeliveryCountry[])=>setDeliveries(d)).catch(()=>{})
  },[])

  // Build the active brand: prefer live SKU data when loaded
  const brand: Brand = (() => {
    if (liveSkus) {
      // Map raw SKUs into the dashboard SKU format
      const mappedSkus: SKU[] = liveSkus.map((s, i) => {
        const days = s.stock / s.velocity_per_day
        const risk = days < s.lead_time_days ? "Critical" : days < s.lead_time_days * 2 ? "Watch" : "Healthy"
        const pct  = Math.min(100, Math.round((days / (s.lead_time_days * 3)) * 100))
        return {
          name: s.name,
          id: `SKU-${String(i+1).padStart(3,"0")}`,
          stock: s.stock.toLocaleString(),
          inc: "—",
          vel: `${s.velocity_per_day}/day`,
          days: days.toFixed(1),
          pct,
          risk,
          rc: risk==="Critical"?"risk-critical":risk==="Watch"?"risk-watch":"risk-ok",
        }
      })
      const critSku = mappedSkus.reduce((a,b)=>parseFloat(a.days)<parseFloat(b.days)?a:b)
      const totalStock = liveSkus.reduce((a,s)=>a+s.stock,0)
      return {
        name: "Live Inventory",
        label: "brand: Live Data",
        days: critSku.days,
        stock: totalStock.toLocaleString(),
        incoming: "—",
        crit: critSku.name.toUpperCase(),
        agentTitle: `chainagent-runtime · ${mappedSkus.length} SKUs monitored`,
        supplier: liveSkus[0]?.supplier_name ?? "—",
        email: "supplier@example.com",
        skus: mappedSkus,
      }
    }
    return BRANDS[brandId]
  })()

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

  // Countdown for email approval
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

  // ── delegate agent actions to real hook ──
  const handleRunAgent = useCallback(()=>{
    stream.runAgent()
  },[stream])

  const handleApprove = useCallback(()=>{
    if(cdInt.current)clearInterval(cdInt.current)
    stream.approve()
    const now=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})
    setAuditRows(prev=>[{time:`Today ${now}`,action:"Reorder approved & sent · via ChainAgent",sku:brand.skus[0]?.id||"",label:"Sent"},...prev])
  },[stream, brand.skus])

  const handleCancel = useCallback(()=>{
    if(cdInt.current)clearInterval(cdInt.current)
    stream.cancel()
    const now=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})
    setAuditRows(prev=>[{time:`Today ${now}`,action:"Reorder cancelled by founder",sku:brand.skus[0]?.id||"",label:"Cancelled"},...prev])
  },[stream, brand.skus])

  const handleReset = useCallback(()=>{
    stream.reset()
    setCdSecs(7200)
    if(cdInt.current)clearInterval(cdInt.current)
  },[stream])

  const handleResync = useCallback(()=>{
    if (syncPhase !== "idle") return
    setSyncPhase("syncing")
    setSyncSecs(0)
    fetch("/api/skus").then(r=>r.json()).then((data: RawSKU[])=>setLiveSkus(data)).catch(()=>{})
    setTimeout(()=>{
      setSyncPhase("done")
      setTimeout(()=>setSyncPhase("idle"), 1200)
    }, 1200)
  },[syncPhase])

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
          {/* Sync pill + Resync button */}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{display:"flex",alignItems:"center",gap:6,...S.mono,fontSize:10,
              color: syncPhase==="syncing"?"var(--accent)": syncPhase==="done"?"#4ade80":"var(--muted)",
              padding:"4px 10px",
              background: syncPhase==="syncing"?"var(--accent-dim)": syncPhase==="done"?"rgba(34,197,94,0.1)":"var(--surface2)",
              borderRadius:100,
              border: syncPhase==="syncing"?"1px solid var(--accent-mid)": syncPhase==="done"?"1px solid rgba(34,197,94,0.25)":"1px solid var(--border)",
              transition:"all 0.2s"
            }}>
              {syncPhase==="syncing" ? (
                <span style={{display:"inline-block",animation:"spin 0.7s linear infinite"}}>↻</span>
              ) : syncPhase==="done" ? (
                <span>✓</span>
              ) : (
                <span className="sync-dot" style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>
              )}
              {syncPhase==="syncing" && "Syncing…"}
              {syncPhase==="done"    && "Synced"}
              {syncPhase==="idle"    && (syncSecs<60?`synced ${syncSecs}s ago`:`synced ${Math.floor(syncSecs/60)}m ago`)}
            </div>
            <button
              onClick={handleResync}
              title="Resync data"
              style={{
                ...S.mono, fontSize:10, fontWeight:500,
                padding:"4px 10px", borderRadius:100,
                border:"1px solid var(--border2)",
                background:"var(--surface2)",
                color: syncPhase==="idle" ? "var(--muted2)" : "var(--muted)",
                cursor: syncPhase==="idle" ? "pointer" : "default",
                display:"flex", alignItems:"center", gap:5,
                transition:"all 0.15s",
                opacity: syncPhase==="idle" ? 1 : 0.5,
              }}
            >
              <span style={{display:"inline-block", animation: syncPhase==="syncing" ? "spin 0.7s linear infinite" : "none"}}>↻</span>
              Resync
            </button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:8,padding:"6px 12px",...S.mono,fontSize:11,color:"var(--text)"}}>
            🏷 {brand.label}
          </div>
          <div style={{...S.mono,fontSize:10,color:"var(--muted)",background:"var(--surface2)",padding:"4px 10px",borderRadius:100,border:"1px solid var(--border)",cursor:"pointer"}} onClick={()=>setSection("settings")}>
            Next run: {fmt(scheduleSecs)}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,...S.mono,fontSize:10,padding:"5px 12px",borderRadius:100,
            border:`1px solid ${backendOnline===false?"rgba(239,68,68,0.3)":backendOnline===null?"rgba(245,158,11,0.3)":"var(--accent-mid)"}`,
            background:backendOnline===false?"var(--red-dim)":backendOnline===null?"var(--amber-dim)":"var(--accent-dim)",
            color:backendOnline===false?"var(--red)":backendOnline===null?"var(--amber)":"var(--accent)"}}>
            <span className={backendOnline?"agent-dot":""} style={{width:5,height:5,borderRadius:"50%",background:backendOnline===false?"var(--red)":backendOnline===null?"var(--amber)":"var(--accent)",display:"inline-block"}}/>
            {backendOnline===false?"Backend offline":backendOnline===null?"Connecting...":agentRunning?"Agent running":"Agent ready"}
          </div>
        </div>
      </nav>

      {/* LAYOUT */}
      <div style={{display:"grid",gridTemplateColumns:"224px 1fr",minHeight:"100vh",paddingTop:54,position:"relative",zIndex:1}}>

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
          {section==="overview"    &&<OverviewSection brand={brand} onRunAgent={()=>{setSection("agent");setTimeout(handleRunAgent,200)}} onViewAllReorders={()=>setSection("logs")}/>}
          {section==="agent"       &&<AgentSection brand={brand} agentRunning={agentRunning} trace={stream.trace} showEmail={showEmail} emailResult={emailResult} showReply={showReply} cdVal={fmt(cdSecs)} onRun={handleRunAgent} onReset={handleReset} onApprove={handleApprove} onCancel={handleCancel} emailContent={stream.emailContent}/>}
          {section==="inventory"   &&<InventorySection brand={brand}/>}
          {section==="inbounds"    &&<InboundsSection brand={brand}/>}
          {section==="orders"      &&<OrdersSection brand={brand}/>}
          {section==="suppliers"   &&<SuppliersSection suppliers={suppliers} onGoToInbounds={()=>setSection("inbounds")}/>}
          {section==="invoices"    &&<InvoicesSection invoices={invoices}/>}
          {section==="delivery"    &&<DeliverySection countries={deliveries}/>}
          {section==="logs"        &&<LogsSection auditRows={auditRows}/>}
          {section==="notifications"&&<NotificationsSection/>}
          {section==="settings"    &&<SettingsSection/>}
        </main>
      </div>
    </>
  )
}
