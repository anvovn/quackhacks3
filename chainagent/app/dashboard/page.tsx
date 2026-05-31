"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { signOut, useSession } from "next-auth/react"
import { useAgentStream } from "./hooks/useAgentStream"
import type { TraceLine } from "./hooks/useAgentStream"

// ── TYPES ──
interface SKU {
  name: string; id: string; stock: string; inc: string
  vel: string; days: string; pct: number; risk: string; rc: string
  price: string
  velSource?: "shopify_orders" | "no_data"
}
interface Brand {
  name: string; label: string; days: string; stock: string
  incoming: string; crit: string; agentTitle: string
  supplier: string; email: string; skus: SKU[]
}
interface RawSKU {
  id?: string; name: string; stock: number; velocity_per_day: number | null
  price?: string
  velocity_source?: "shopify_orders" | "no_data"
}
interface AuditRow { time: string; action: string; sku: string; label: string }
interface Supplier {
  id: string; name: string; skuCount: number; active: boolean; source: "shopify"|"manual"
  // optional manual fields:
  contact?: string; email?: string; phone?: string; location?: string
  leadTime?: string; moq?: number; terms?: string; rating?: number
  since?: string; tags?: string[]; notes?: string
  onTimeRate?: number; totalOrders?: number; lastOrder?: string
}
interface PurchaseOrder {
  ref: string; sku: string; skuId: string; supplier: string; supplierEmail: string
  qty: number; orderDate: string; eta: string
  status: "sent" | "confirmed" | "in-transit" | "received"
}
interface StockInbound {
  id: string; name: string; skuId: string; supplier: string
  qty: number; variantId?: number; approvedAt: string
  status: "pending" | "in-transit" | "received"
  poRef?: string
}
interface ShopifyOrder {
  id: string; customer: string; email: string; sku: string; skuCode: string
  qty: number; financialStatus: string; fulfillmentStatus: string | null
  date: string; dest: string; total: string
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

function Btn({children,onClick,variant="ghost",style={},disabled=false}:{children:React.ReactNode,onClick?:()=>void,variant?:"primary"|"ghost"|"danger"|"amber",style?:React.CSSProperties,disabled?:boolean}) {
  const base:React.CSSProperties = {...S.mono,fontSize:11,fontWeight:500,letterSpacing:"0.04em",padding:"7px 13px",borderRadius:7,border:"none",cursor:disabled?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",gap:5,transition:"all 0.15s"}
  const variants = {
    primary:{background:"var(--accent)",color:"#060809"},
    ghost:  {background:"var(--surface)",color:"var(--muted2)",border:"1px solid var(--border2)"},
    danger: {background:"var(--red-dim)",color:"var(--red)",border:"1px solid rgba(239,68,68,0.2)"},
    amber:  {background:"var(--amber-dim)",color:"var(--amber)",border:"1px solid rgba(245,158,11,0.2)"},
  }
  return <button style={{...base,...variants[variant],...style}} onClick={onClick} disabled={disabled}>{children}</button>
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
function OverviewSection({brand,orders,onRunAgent,onViewAllReorders}:{brand:Brand,orders:PurchaseOrder[],onRunAgent:()=>void,onViewAllReorders:()=>void}) {
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
        <PanelHeader title={<>📊 Live SKU Risk Monitor <BeHook>← /api/inventory</BeHook></>} actions={<Btn variant="primary" onClick={onRunAgent}>▶ Run Agent</Btn>}/>
        <RowHead cols="2fr 70px 85px 75px 120px 95px 105px"><Th>Product</Th><Th>Stock</Th><Th>Incoming</Th><Th>Velocity</Th><Th>Runway</Th><Th>Risk</Th><Th>Agent</Th></RowHead>
        {brand.skus.map(sku=><SkuRow key={sku.id} sku={sku} cols="2fr 70px 85px 75px 120px 95px 105px" isOverview/>)}
      </Panel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Panel>
          <PanelHeader title="📈 Sales Velocity (30d avg)"/>
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
          <PanelHeader title="📦 Order History" actions={<Btn onClick={onViewAllReorders}>View all →</Btn>}/>
          {orders.length===0?(
            <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,padding:"28px 0"}}>
              No orders yet — run the agent and approve a reorder to see history here.
            </div>
          ):orders.slice(0,3).map((po,i)=>(
            <div key={po.ref} style={{display:"grid",gridTemplateColumns:"1fr 90px 60px",gap:8,padding:"11px 18px",borderBottom:i<Math.min(orders.length,3)-1?"1px solid var(--border)":"none",fontSize:12,alignItems:"center"}}>
              <div><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{po.sku} · {(po.qty??0).toLocaleString()}u</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{po.supplier} · {po.orderDate}</div></div>
              <StatusPill label={po.status==="received"?"Received":po.status==="in-transit"?"In Transit":po.status==="confirmed"?"Confirmed":"Sent"} type={po.status==="received"?"live":po.status==="in-transit"?"transit":"draft"}/>
              <span style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{po.ref}</span>
            </div>
          ))}
        </Panel>
      </div>
    </>
  )
}

function InventorySection({brand, suppliers, skuSupplierMap, onAssign}:{
  brand:Brand, suppliers:Supplier[], skuSupplierMap:Record<string,string>, onAssign:(skuId:string,suppId:string)=>void
}) {
  const [search, setSearch] = useState("")
  const filtered = brand.skus.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||s.id.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <SectionHeader eyebrow="// inventory" title="Inventory" hook="← Shopify"
        action={<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search SKUs..." style={{...S.mono,fontSize:11,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:6,padding:"6px 11px",color:"var(--text)",outline:"none",width:160}}/>}/>
      <Panel>
        <RowHead cols="2fr 70px 75px 120px 90px 80px 160px 90px">
          <Th>Product</Th><Th>Stock</Th><Th>Velocity</Th><Th>Runway</Th><Th>Lead Time</Th><Th>Price</Th><Th>Supplier</Th><Th>Risk</Th>
        </RowHead>
        {filtered.map(sku=>(
          <div key={sku.id} style={{display:"grid",gridTemplateColumns:"2fr 70px 75px 120px 90px 80px 160px 90px",gap:10,padding:"12px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",background:sku.risk==="Critical"?"rgba(239,68,68,0.03)":"transparent"}}>
            <div><div style={{fontSize:13,fontWeight:500,color:"var(--text)"}}>{sku.name}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{sku.id}</div></div>
            <div style={{...S.mono,fontSize:12}}>{sku.stock}</div>
            <div>
              <div style={{...S.mono,fontSize:12}}>{sku.vel}</div>
              <div style={{...S.mono,fontSize:8,marginTop:1,color:sku.velSource==="shopify_orders"?"var(--accent)":"var(--amber)"}}>
                {sku.velSource==="shopify_orders"?"● live 30d":"● estimated"}
              </div>
            </div>
            <RunwayBar days={sku.days} pct={sku.pct} risk={sku.risk}/>
            <div style={{...S.mono,fontSize:12,color:"var(--muted)"}}>—</div>
            <div style={{...S.mono,fontSize:12}}>{sku.price}</div>
            <select
              value={skuSupplierMap[sku.id]||""}
              onChange={e=>onAssign(sku.id,e.target.value)}
              style={{...S.mono,fontSize:10,background:"var(--surface2)",border:`1px solid ${skuSupplierMap[sku.id]?"var(--accent-mid)":"var(--border2)"}`,borderRadius:6,padding:"4px 8px",color:skuSupplierMap[sku.id]?"var(--text)":"var(--muted)",outline:"none",width:"100%",cursor:"pointer"}}
            >
              <option value="">— assign supplier —</option>
              {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <RiskPill risk={sku.risk}/>
          </div>
        ))}
        {suppliers.length===0&&(
          <div style={{...S.mono,fontSize:10,color:"var(--amber)",padding:"10px 18px",borderTop:"1px solid var(--border)"}}>
            ⚠ Add suppliers in the Suppliers tab to assign them to SKUs
          </div>
        )}
      </Panel>
    </>
  )
}

function InboundsSection({inbounds, onSetInTransit, onReceive}: {
  inbounds: StockInbound[]
  onSetInTransit: (id: string) => void
  onReceive: (id: string, poRef?: string) => void
}) {
  const [receiving, setReceiving] = useState<string | null>(null)

  async function handleReceive(inbound: StockInbound) {
    setReceiving(inbound.id)
    try {
      // Only call Shopify when actually receiving stock
      if(inbound.variantId && inbound.qty) {
        await fetch("/api/reorder/receive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant_id: inbound.variantId, qty: inbound.qty }),
        })
      }
    } finally {
      setReceiving(null)
      onReceive(inbound.id, inbound.poRef)
    }
  }

  return (
    <>
      <SectionHeader eyebrow="// stock inbounds" title="Stock Inbounds"/>
      {inbounds.length === 0 ? (
        <Panel>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 0",gap:10}}>
            <div style={{fontSize:28}}>📦</div>
            <div style={{...S.display,fontSize:15,fontWeight:700}}>No pending inbounds</div>
            <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,maxWidth:320,lineHeight:1.7}}>
              When you approve an agent reorder, the shipment will appear here.<br/>
              Confirm receipt once the stock arrives at your warehouse.
            </div>
          </div>
        </Panel>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {inbounds.map(inbound => {
            const isReceiving = receiving === inbound.id
            const inTransit = inbound.status === "in-transit"
            const borderColor = inTransit ? "var(--blue)" : "var(--amber)"
            const badgeBg = inTransit ? "rgba(59,130,246,0.12)" : "rgba(251,191,36,0.12)"
            const badgeColor = inTransit ? "var(--blue)" : "var(--amber)"
            const badgeBorder = inTransit ? "1px solid rgba(59,130,246,0.25)" : "1px solid rgba(251,191,36,0.25)"
            const badgeLabel = inTransit ? "IN TRANSIT" : "AWAITING SHIPMENT"
            return (
              <div key={inbound.id} style={{background:"var(--surface)",border:"1px solid var(--border)",borderLeft:`4px solid ${borderColor}`,borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
                  {/* Header */}
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{inbound.name}</div>
                      <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginTop:3}}>
                        {inbound.skuId} · Approved {inbound.approvedAt}
                      </div>
                    </div>
                    <span style={{...S.mono,fontSize:9,padding:"3px 8px",borderRadius:100,background:badgeBg,color:badgeColor,border:badgeBorder,flexShrink:0}}>{badgeLabel}</span>
                  </div>

                  {/* Details row */}
                  <div style={{display:"flex",gap:24}}>
                    <div>
                      <div style={{...S.mono,fontSize:9,color:"var(--muted)",marginBottom:2}}>SUPPLIER</div>
                      <div style={{fontSize:12,color:"var(--text)"}}>{inbound.supplier}</div>
                    </div>
                    <div>
                      <div style={{...S.mono,fontSize:9,color:"var(--muted)",marginBottom:2}}>UNITS ORDERED</div>
                      <div style={{...S.mono,fontSize:14,fontWeight:700,color:"var(--text)"}}>{(inbound.qty??0).toLocaleString()}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{borderTop:"1px solid var(--border)",paddingTop:12,display:"flex",alignItems:"center",gap:10}}>
                    {!inTransit && (
                      <button
                        onClick={()=>onSetInTransit(inbound.id)}
                        style={{...S.mono,fontSize:11,fontWeight:600,padding:"9px 18px",borderRadius:8,border:"1px solid var(--border2)",cursor:"pointer",background:"var(--surface2)",color:"var(--text)",flexShrink:0}}
                      >
                        🚚 Mark In Transit
                      </button>
                    )}
                    <button
                      onClick={()=>handleReceive(inbound)}
                      disabled={isReceiving}
                      style={{...S.mono,fontSize:11,fontWeight:600,padding:"9px 20px",borderRadius:8,border:"none",cursor:isReceiving?"not-allowed":"pointer",background:isReceiving?"var(--surface3)":"var(--accent)",color:isReceiving?"var(--muted)":"#000",transition:"background 0.2s",flexShrink:0}}
                    >
                      {isReceiving ? "Confirming…" : "✓ Confirm Stock Received"}
                    </button>
                    <div style={{...S.mono,fontSize:10,color:"var(--muted)",lineHeight:1.5}}>
                      {inTransit ? `Receiving ${(inbound.qty??0).toLocaleString()} units into Shopify.` : "Mark shipment received to update inventory."}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function OrdersSection({orders: allOrders}:{orders:ShopifyOrder[]}) {
  const [tab, setTab] = useState("all")

  function classify(o:ShopifyOrder) {
    if(o.financialStatus==="voided"||o.financialStatus==="refunded") return "issue"
    if(o.financialStatus==="pending"||o.fulfillmentStatus===null) return "hold"
    return "done"
  }

  const tagged = allOrders.map(o=>({...o,tab:classify(o)}))
  const filtered = tab==="all"?tagged:tagged.filter(o=>o.tab===tab)

  function statusPillType(o:ShopifyOrder): React.ComponentProps<typeof StatusPill>["type"] {
    if(o.financialStatus==="voided"||o.financialStatus==="refunded") return "disc"
    if(o.fulfillmentStatus==="fulfilled") return "live"
    if(o.fulfillmentStatus==="partial") return "transit"
    if(o.financialStatus==="pending") return "pending"
    return "draft"
  }
  function statusLabel(o:ShopifyOrder) {
    if(o.financialStatus==="voided") return "Voided"
    if(o.financialStatus==="refunded") return "Refunded"
    if(o.fulfillmentStatus==="fulfilled") return "Fulfilled"
    if(o.fulfillmentStatus==="partial") return "Partial"
    if(o.financialStatus==="pending") return "Pending"
    return "Unfulfilled"
  }

  return (
    <>
      <SectionHeader eyebrow="// order management" title="Orders" hook="← /api/orders"/>
      <Panel>
        {allOrders.length === 0 ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 0",gap:10}}>
            <div style={{fontSize:28}}>📦</div>
            <div style={{...S.display,fontSize:15,fontWeight:700}}>No orders yet</div>
            <div style={{...S.mono,fontSize:11,color:"var(--muted)"}}>Orders from your Shopify store will appear here.</div>
          </div>
        ) : (<>
          <div style={{display:"flex",gap:6,padding:"12px 18px",borderBottom:"1px solid var(--border)",background:"var(--surface2)"}}>
            {["all","issue","hold","done"].map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{...S.mono,fontSize:11,padding:"5px 12px",borderRadius:6,cursor:"pointer",border:tab===t?"1px solid var(--accent-mid)":"1px solid var(--border2)",background:tab===t?"var(--accent-dim)":"none",color:tab===t?"var(--accent)":"var(--muted2)"}}>
                {t==="all"?"All":t==="issue"?"Issues":t==="hold"?"Unfulfilled":"Fulfilled"}
              </button>
            ))}
          </div>
          <RowHead cols="1fr 1fr 60px 110px 80px 70px"><Th>Order</Th><Th>Product</Th><Th>Qty</Th><Th>Status</Th><Th>Dest.</Th><Th>Total</Th></RowHead>
          {filtered.map(o=>(
            <div key={o.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 60px 110px 80px 70px",gap:10,padding:"12px 18px",borderBottom:"1px solid var(--border)",alignItems:"center",background:o.tab==="issue"?"rgba(239,68,68,0.03)":o.tab==="hold"?"rgba(245,158,11,0.04)":"transparent"}}>
              <div><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{o.id}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{o.customer} · {o.date}</div></div>
              <div style={{...S.mono,fontSize:10,color:"var(--muted2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{o.sku}</div>
              <div style={{...S.mono,fontSize:12}}>{o.qty}</div>
              <StatusPill label={statusLabel(o)} type={statusPillType(o)}/>
              <div style={{...S.mono,fontSize:11,color:"var(--muted)"}}>{o.dest}</div>
              <div style={{...S.mono,fontSize:11}}>{o.total}</div>
            </div>
          ))}
        </>)}
      </Panel>
    </>
  )
}

const BLANK_FORM = {name:"",contact:"",email:"",location:"",leadTime:"",moq:"",terms:""}

function SuppliersSection({suppliers, onAdd, onUpdate}:{suppliers:Supplier[], onAdd:(s:Supplier)=>void, onUpdate:(s:Supplier)=>void}) {
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier|null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saved, setSaved] = useState(false)

  function openAdd() { setEditingSupplier(null); setForm(BLANK_FORM); setShowModal(true) }
  function openEdit(s:Supplier) {
    setEditingSupplier(s)
    setForm({name:s.name,contact:s.contact||"",email:s.email||"",location:s.location||"",leadTime:s.leadTime||"",moq:s.moq?String(s.moq):"",terms:s.terms||""})
    setShowModal(true)
  }

  function saveSupplier() {
    if(!form.name) return
    if(editingSupplier) {
      onUpdate({...editingSupplier, name:form.name, contact:form.contact||undefined, email:form.email||undefined,
        location:form.location||undefined, leadTime:form.leadTime||undefined,
        moq:form.moq?parseInt(form.moq):undefined, terms:form.terms||undefined})
    } else {
      onAdd({id:`MAN-${Date.now()}`, name:form.name, skuCount:0, active:true, source:"manual",
        contact:form.contact||undefined, email:form.email||undefined, location:form.location||undefined,
        leadTime:form.leadTime||undefined, moq:form.moq?parseInt(form.moq):undefined,
        terms:form.terms||undefined, rating:3, since:new Date().getFullYear().toString(), tags:["manual"]})
    }
    setSaved(true)
    setTimeout(()=>{setShowModal(false);setSaved(false);setForm(BLANK_FORM);setEditingSupplier(null)},700)
  }

  return (
    <>
      <SectionHeader eyebrow="// suppliers" title="Suppliers"
        action={<Btn variant="primary" onClick={openAdd}>+ Add Supplier</Btn>}/>
      {suppliers.length === 0 ? (
        <div style={{...S.mono,fontSize:12,color:"var(--muted)",textAlign:"center" as const,padding:"48px 0"}}>
          No suppliers found in your Shopify store. Product vendors will appear here automatically.
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {suppliers.map(s=>(
            <div key={s.id} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
                <div>
                  <div style={{fontSize:13,fontWeight:500,color:"var(--text)",marginBottom:4}}>{s.name}</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap" as const}}>
                    <span style={{...S.mono,fontSize:9,padding:"2px 6px",borderRadius:4,background:"var(--surface3)",color:"var(--muted2)"}}>{s.source}</span>
                    {(s.tags||[]).map(t=>(
                      <span key={t} style={{...S.mono,fontSize:9,padding:"2px 6px",borderRadius:4,background:"var(--surface3)",color:"var(--muted2)"}}>{t}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{...S.mono,fontSize:10,color:"var(--muted)",lineHeight:1.9,marginBottom:6}}>
                {s.contact && <>{s.contact}<br/></>}
                {s.email && <>{s.email}<br/></>}
                {(s.location||s.leadTime) && <>{[s.location,s.leadTime&&`Lead: ${s.leadTime}`].filter(Boolean).join(" · ")}<br/></>}
                {(s.moq||s.terms) && <>{[s.moq&&`MOQ: ${s.moq.toLocaleString()}`,s.terms].filter(Boolean).join(" · ")}<br/></>}
              </div>
              <div style={{...S.mono,fontSize:10,color:s.active?"var(--accent)":"var(--muted)",marginBottom:8,display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:s.active?"var(--accent)":"var(--muted)",display:"inline-block"}}/>
                {s.active ? `Active · ${s.skuCount} SKU${s.skuCount!==1?"s":""}` : "Inactive"}
                {s.since && ` · Since ${s.since}`}
              </div>
              {expandedId===s.id && (s.onTimeRate!=null||s.totalOrders!=null||s.notes) && (
                <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",marginBottom:10,...S.mono,fontSize:10,color:"var(--muted2)",lineHeight:1.9}}>
                  {s.phone && <div>Phone: {s.phone}</div>}
                  {s.onTimeRate!=null && <div>On-time rate: <span style={{color:"var(--accent)"}}>{s.onTimeRate}%</span></div>}
                  {s.totalOrders!=null && <div>Total orders: {s.totalOrders}</div>}
                  {s.lastOrder && <div>Last order: {s.lastOrder}</div>}
                  {s.notes && <div style={{color:"var(--muted)",marginTop:4,fontStyle:"italic"}}>{s.notes}</div>}
                </div>
              )}
              <div style={{display:"flex",gap:7}}>
                {s.email
                  ? <Btn style={{fontSize:10,padding:"5px 10px"}} onClick={()=>window.open(`mailto:${s.email}?subject=Re: Supply Inquiry`)}>📧 Email</Btn>
                  : <Btn style={{fontSize:10,padding:"5px 10px",opacity:0.4,cursor:"default"}}>📧 No email</Btn>
                }
                <Btn style={{fontSize:10,padding:"5px 10px"}} onClick={()=>setExpandedId(expandedId===s.id?null:s.id)}>
                  {expandedId===s.id?"✕ Close":"◉ Profile"}
                </Btn>
                <Btn style={{fontSize:10,padding:"5px 10px"}} onClick={()=>openEdit(s)}>✏ Edit</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",backdropFilter:"blur(4px)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowModal(false)}>
          <div style={{background:"var(--surface)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:420,maxWidth:"90vw"}} onClick={e=>e.stopPropagation()}>
            <div style={{...S.display,fontSize:16,fontWeight:700,marginBottom:3}}>{editingSupplier?"Edit Supplier":"Add Supplier"}</div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginBottom:18}}>{editingSupplier?"Update contact info and terms.":"Manually add a supplier not in Shopify."}</div>
            {([
              {key:"name",    label:"Company Name *", placeholder:"e.g. Osaka Lens Works"},
              {key:"contact", label:"Contact Name",   placeholder:"e.g. Kenji Tanaka"},
              {key:"email",   label:"Email",          placeholder:"kenji@osaka-lens.jp"},
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
              <Btn variant={saved?"ghost":"primary"} onClick={saveSupplier} style={{flex:1,justifyContent:"center"}}>
                {saved?"Saved ✓":editingSupplier?"Update Supplier":"Save Supplier"}
              </Btn>
              <Btn onClick={()=>{setShowModal(false);setEditingSupplier(null);setForm(BLANK_FORM)}} style={{flex:1,justifyContent:"center"}}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const PO_STATUSES: PurchaseOrder["status"][] = ["sent","confirmed","in-transit","received"]
const PO_STATUS_LABEL: Record<PurchaseOrder["status"],string> = {
  "sent":"Sent","confirmed":"Confirmed","in-transit":"In Transit","received":"Received"
}

function OrderHistorySection({orders, auditRows, inbounds, onUpdateOrder}:{orders:PurchaseOrder[], auditRows:AuditRow[], inbounds:StockInbound[], onUpdateOrder:(ref:string, status:PurchaseOrder["status"])=>void}) {
  const pillType = (s:PurchaseOrder["status"]):React.ComponentProps<typeof StatusPill>["type"] =>
    s==="received"?"live":s==="in-transit"?"transit":s==="confirmed"?"pending":"draft"

  function exportCSV() {
    const header = "Time,Event,SKU,Detail,Status\n"
    const rows = auditRows.map(r=>`"${r.time}","${r.action}","${r.sku}","","${r.label}"`).join("\n")
    const blob = new Blob([header+rows],{type:"text/csv"})
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href=url; a.download="order-history.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  const isEmpty = orders.length===0 && auditRows.length===0 && inbounds.length===0

  return (
    <>
      <SectionHeader eyebrow="// agent orders" title="Agent Orders" action={<Btn onClick={exportCSV}>↓ Export CSV</Btn>}/>

      {/* Purchase Orders */}
      <Panel>
        <PanelHeader title="📋 Purchase Orders"/>
        {orders.length===0?(
          <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,padding:"24px 0"}}>
            No purchase orders yet — approve an agent reorder to create one.
          </div>
        ):<>
          <RowHead cols="110px 1fr 1fr 60px 110px 110px 120px">
            <Th>PO Ref</Th><Th>SKU</Th><Th>Supplier</Th><Th>Qty</Th><Th>Date</Th><Th>Status</Th><Th>Update</Th>
          </RowHead>
          {orders.map((po,i)=>(
            <div key={po.ref} style={{display:"grid",gridTemplateColumns:"110px 1fr 1fr 60px 110px 110px 120px",gap:10,padding:"12px 18px",borderBottom:i<orders.length-1?"1px solid var(--border)":"none",alignItems:"center",background:po.status==="received"?"rgba(0,229,160,0.02)":"transparent"}}>
              <div style={{...S.mono,fontSize:11,color:"var(--text)"}}>{po.ref}</div>
              <div><div style={{fontSize:12,color:"var(--text)"}}>{po.sku}</div><div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{po.skuId}</div></div>
              <div><div style={{fontSize:12,color:"var(--text)"}}>{po.supplier}</div>{po.supplierEmail&&<div style={{...S.mono,fontSize:9,color:"var(--muted)"}}>{po.supplierEmail}</div>}</div>
              <div style={{...S.mono,fontSize:12}}>{(po.qty??0).toLocaleString()}</div>
              <div style={{...S.mono,fontSize:11,color:"var(--muted)"}}>{po.orderDate}</div>
              <StatusPill label={PO_STATUS_LABEL[po.status]} type={pillType(po.status)}/>
              <select
                value={po.status}
                onChange={e=>onUpdateOrder(po.ref, e.target.value as PurchaseOrder["status"])}
                style={{...S.mono,fontSize:10,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:6,padding:"4px 8px",color:"var(--text)",outline:"none",cursor:"pointer",width:"100%"}}
              >
                {PO_STATUSES.map(s=><option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          ))}
        </>}
      </Panel>

      {/* Stock Inbounds awaiting receipt */}
      {inbounds.length>0&&(
        <Panel>
          <PanelHeader title="📦 Awaiting Receipt"/>
          <RowHead cols="1fr 1fr 80px 80px"><Th>SKU</Th><Th>Supplier</Th><Th>Qty</Th><Th>Approved</Th></RowHead>
          {inbounds.map((r,i)=>(
            <div key={r.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 80px 80px",gap:10,padding:"12px 18px",borderBottom:i<inbounds.length-1?"1px solid var(--border)":"none",alignItems:"center",borderLeft:"3px solid var(--amber)"}}>
              <div style={{fontSize:12,color:"var(--text)"}}>{r.name}</div>
              <div style={{...S.mono,fontSize:11,color:"var(--muted)"}}>{r.supplier}</div>
              <div style={{...S.mono,fontSize:12}}>{(r.qty??0).toLocaleString()}</div>
              <div style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{r.approvedAt}</div>
            </div>
          ))}
        </Panel>
      )}

      {/* Agent Activity Log */}
      <Panel>
        <PanelHeader title="🤖 Agent Activity Log"/>
        {auditRows.length===0?(
          <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,padding:"24px 0"}}>
            {isEmpty?"No activity yet — run the agent to get started.":"No activity logged yet."}
          </div>
        ):<>
          <RowHead cols="110px 1fr 100px 80px"><Th>Time</Th><Th>Event</Th><Th>SKU</Th><Th>Status</Th></RowHead>
          {auditRows.map((r,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"110px 1fr 100px 80px",gap:10,padding:"10px 18px",borderBottom:i<auditRows.length-1?"1px solid var(--border)":"none",alignItems:"center",fontSize:12}}>
              <div style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{r.time}</div>
              <div style={{color:"var(--text)"}}>{r.action}</div>
              <div style={{...S.mono,fontSize:10,color:"var(--muted2)"}}>{r.sku}</div>
              <StatusPill label={r.label} type={r.label==="Sent"?"live":r.label==="Cancelled"?"draft":"pending"}/>
            </div>
          ))}
        </>}
      </Panel>
    </>
  )
}

function NotificationsSection() {
  const staticChannels = [
    {icon:"💬",bg:"#4A154B",name:"Slack",sub:"Connected · #chainagent-alerts",on:true,preview:"🚨 ChainAgent: Portland Aviator Pro 8.9 days stock. Lead 21 days. Reorder drafted 800 units. Approve →"},
    {icon:"📧",bg:"#EA4335",name:"Email",sub:"founder@portlandoptics.com",on:true,preview:"[ChainAgent] Action Required — Portland Aviator Pro stockout in 8.9 days. Reorder awaiting approval."},
    {icon:"🔊",bg:"var(--accent-dim)",name:"Voice Alert",sub:"ElevenLabs · Rachel",on:true,preview:"\"Portland Aviator Pro has 8 days of stock. Lead time is 21 days. I've drafted a reorder for 800 units. Awaiting your approval.\""},
  ]
  const [states, setStates] = useState(staticChannels.map(c=>c.on))

  // SMS state — persisted via backend
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [smsPhone, setSmsPhone]     = useState("")
  const [smsSaving, setSmsSaving]   = useState(false)
  const [smsSaved,  setSmsSaved]    = useState(false)

  useEffect(()=>{
    fetch("/api/sms-config").then(r=>r.json()).then(d=>{
      setSmsEnabled(d.enabled ?? false)
      setSmsPhone(d.phone ?? "")
    }).catch(()=>{})
  },[])

  async function saveSmsConfig(enabled: boolean, phone: string) {
    setSmsSaving(true); setSmsSaved(false)
    try {
      await fetch("/api/sms-config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,phone})})
      setSmsSaved(true)
      setTimeout(()=>setSmsSaved(false),2000)
    } finally { setSmsSaving(false) }
  }

  function handleSmsToggle(v: boolean) {
    setSmsEnabled(v)
    saveSmsConfig(v, smsPhone)
  }

  function handlePhoneSave() {
    saveSmsConfig(smsEnabled, smsPhone)
  }

  return (
    <>
      <SectionHeader eyebrow="// notifications" title="Notifications"/>
      <Panel>
        <PanelHeader title="🔔 Notification Channels"/>
        <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
          {staticChannels.map((c,i)=>(
            <div key={i} style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
                <div style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,background:c.bg,flexShrink:0}}>{c.icon}</div>
                <div style={{flex:1}}><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{c.name}</div><div style={{...S.mono,fontSize:10,color:"var(--muted)"}}>{c.sub}</div></div>
                <Toggle on={states[i]} onChange={v=>setStates(s=>{const n=[...s];n[i]=v;return n})}/>
              </div>
              <div style={{fontSize:11,color:"var(--muted2)",lineHeight:1.6,borderTop:"1px solid var(--border)",paddingTop:8}}><strong>Preview:</strong> {c.preview}</div>
            </div>
          ))}

          {/* SMS — live Twilio integration */}
          <div style={{background:"var(--surface2)",border:`1px solid ${smsEnabled?"rgba(37,211,102,0.25)":"var(--border)"}`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
              <div style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,background:"#25D366",flexShrink:0}}>📱</div>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>SMS</div>
                <div style={{...S.mono,fontSize:10,color:smsEnabled?"var(--accent)":"var(--muted)"}}>
                  {smsEnabled ? (smsPhone ? `● ${smsPhone}` : "● Enabled · no phone set") : "◌ via Twilio API"}
                </div>
              </div>
              <Toggle on={smsEnabled} onChange={handleSmsToggle}/>
            </div>
            <div style={{fontSize:11,color:"var(--muted2)",lineHeight:1.6,borderTop:"1px solid var(--border)",paddingTop:8}}>
              <strong>Preview:</strong> ChainAgent: ⚠ Portland Aviator Pro — 8.9 days left. Reorder drafted. Log in to approve.
            </div>
            <div style={{marginTop:10,display:"flex",gap:7,alignItems:"center"}}>
              <input
                type="tel"
                placeholder="+1 555 000 0000"
                value={smsPhone}
                onChange={e=>setSmsPhone(e.target.value)}
                style={{...S.mono,flex:1,background:"var(--surface)",border:"1px solid var(--border2)",borderRadius:6,padding:"6px 10px",color:"var(--text)",fontSize:11,outline:"none"}}
              />
              <Btn onClick={handlePhoneSave} disabled={smsSaving} style={{fontSize:10,padding:"6px 12px",opacity:smsSaving?0.6:1}}>
                {smsSaving?"Saving…":smsSaved?"Saved ✓":"Save"}
              </Btn>
            </div>
            <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginTop:6}}>
              Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM in .env
            </div>
          </div>

          <Btn style={{width:"100%",justifyContent:"center",padding:10}}>📤 Send test notification</Btn>
        </div>
      </Panel>
    </>
  )
}

type AgentSettings = { autoApprove:boolean; scheduleEnabled:boolean; scheduleIntervalMins:number; autoSendWindowMins:number; riskThresholdDays:number }

function SettingsSection({agentSettings, onSaveSettings}:{agentSettings:AgentSettings, onSaveSettings:(s:AgentSettings)=>void}) {
  const { data: session } = useSession()
  const [draft, setDraft] = useState(agentSettings)
  const [saved, setSaved] = useState(false)

  function save() {
    onSaveSettings(draft)
    setSaved(true)
    setTimeout(()=>setSaved(false), 1500)
  }

  // ── Shopify connection state ──
  const [shopifyConnected, setShopifyConnected] = useState<boolean|null>(null)
  const [shopifyStore,     setShopifyStore]     = useState("")
  const [showShopify,      setShowShopify]       = useState(false)
  const [shopifyDomain,    setShopifyDomain]     = useState("")
  const [shopifyToken,     setShopifyToken]      = useState("")
  const [shopifyPhase,     setShopifyPhase]      = useState<"idle"|"saving"|"ok"|"err">("idle")
  const [shopifyErr,       setShopifyErr]        = useState("")
  const [shopifyName,      setShopifyName]       = useState("")

  useEffect(()=>{
    fetch("/api/settings")
      .then(r=>r.json())
      .then(d=>{setShopifyConnected(d.connected); setShopifyStore(d.store||"")})
      .catch(()=>setShopifyConnected(false))
  },[])

  async function connectShopify() {
    setShopifyPhase("saving"); setShopifyErr("")
    try {
      const res = await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({store:shopifyDomain,token:shopifyToken})})
      const data = await res.json()
      if(!res.ok){setShopifyPhase("err"); setShopifyErr(data.error||"Unknown error"); return}
      setShopifyPhase("ok")
      setShopifyConnected(true)
      setShopifyStore(shopifyDomain.replace(/^https?:\/\//,"").replace(/\/$/,""))
      setShopifyName(data.shopName||"")
      setTimeout(()=>{setShowShopify(false); setShopifyPhase("idle"); setShopifyToken("")},900)
    } catch {
      setShopifyPhase("err"); setShopifyErr("Network error — is the dev server running?")
    }
  }

  async function disconnectShopify() {
    await fetch("/api/settings",{method:"DELETE"})
    setShopifyConnected(false); setShopifyStore(""); setShopifyName("")
  }

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
          <Btn variant="ghost" onClick={()=>signOut({callbackUrl:"/login"})}>Sign out</Btn>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="◎ Agent Configuration"/>
        <div style={{padding:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          {([
            {key:"autoApprove",    label:"Auto-approve reorders", sub:"Send without manual approval"},
            {key:"scheduleEnabled",label:"Auto-schedule agent",   sub:"Run on set interval"},
          ] as {key:keyof AgentSettings, label:string, sub:string}[]).map(({key,label,sub})=>(
            <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 13px",background:"var(--surface2)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div><div style={{fontSize:13,color:"var(--text)"}}>{label}</div><div style={{...S.mono,fontSize:10,color:"var(--muted)",marginTop:1}}>{sub}</div></div>
              <Toggle on={draft[key] as boolean} onChange={v=>setDraft(d=>({...d,[key]:v}))}/>
            </div>
          ))}
          {([
            {key:"riskThresholdDays",  label:"Risk threshold (days)",    sub:"Flag SKUs below this runway"},
            {key:"autoSendWindowMins",  label:"Auto-send window (mins)",  sub:"Mins before auto-approve fires"},
            {key:"scheduleIntervalMins",label:"Schedule interval (mins)", sub:"How often agent auto-runs"},
          ] as {key:keyof AgentSettings, label:string, sub:string}[]).map(({key,label,sub})=>(
            <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 13px",background:"var(--surface2)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div><div style={{fontSize:13,color:"var(--text)"}}>{label}</div><div style={{...S.mono,fontSize:10,color:"var(--muted)",marginTop:1}}>{sub}</div></div>
              <input value={draft[key] as number} type="number" min={1}
                onChange={e=>setDraft(d=>({...d,[key]:Math.max(1,parseInt(e.target.value)||1)}))}
                style={{...S.mono,background:"var(--surface2)",border:"1px solid var(--border2)",borderRadius:6,padding:"5px 9px",color:"var(--text)",fontSize:11,outline:"none",width:70}}/>
            </div>
          ))}
        </div>
        <div style={{padding:"0 16px 16px"}}>
          <Btn variant={saved?"ghost":"primary"} onClick={save}>{saved?"Saved ✓":"Save Changes"}</Btn>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title={<>🔌 API Connections <BeHook>← .env.local</BeHook></>}/>
        <div style={{padding:16,display:"flex",flexDirection:"column",gap:8}}>

          {/* ── Shopify — live connection ── */}
          <div style={{background:"var(--surface2)",borderRadius:10,border:`1px solid ${shopifyConnected?"rgba(0,229,160,0.2)":"var(--border)"}`,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 13px"}}>
              <div>
                <div style={{fontSize:13,color:"var(--text)"}}>Shopify</div>
                <div style={{...S.mono,fontSize:10,marginTop:1,color:shopifyConnected?"var(--accent)":"var(--muted)"}}>
                  {shopifyConnected===null?"◎ Checking…":shopifyConnected?`● Connected · ${shopifyName||shopifyStore}`:"◌ Not connected"}
                </div>
              </div>
              <div style={{display:"flex",gap:7}}>
                {shopifyConnected&&<Btn variant="danger" style={{fontSize:10,padding:"5px 12px"}} onClick={disconnectShopify}>Disconnect</Btn>}
                <Btn variant={shopifyConnected?"ghost":"primary"} style={{fontSize:10,padding:"5px 12px"}} onClick={()=>{setShowShopify(v=>!v);setShopifyPhase("idle");setShopifyErr("")}}>
                  {shopifyConnected?"Reconnect":"Connect"}
                </Btn>
              </div>
            </div>

            {showShopify&&(
              <div style={{borderTop:"1px solid var(--border)",padding:"14px 13px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  <div>
                    <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginBottom:4}}>Store domain</div>
                    <input value={shopifyDomain} onChange={e=>setShopifyDomain(e.target.value)} placeholder="your-store.myshopify.com"
                      style={{...S.mono,fontSize:11,background:"var(--surface)",border:"1px solid var(--border2)",borderRadius:6,padding:"7px 10px",color:"var(--text)",outline:"none",width:"100%"}}/>
                  </div>
                  <div>
                    <div style={{...S.mono,fontSize:10,color:"var(--muted)",marginBottom:4}}>Admin API access token</div>
                    <input value={shopifyToken} onChange={e=>setShopifyToken(e.target.value)} placeholder="shpat_xxxxxxxxxxxxx" type="password"
                      style={{...S.mono,fontSize:11,background:"var(--surface)",border:"1px solid var(--border2)",borderRadius:6,padding:"7px 10px",color:"var(--text)",outline:"none",width:"100%"}}/>
                  </div>
                </div>
                {shopifyErr&&<div style={{...S.mono,fontSize:10,color:"var(--red)",background:"var(--red-dim)",borderRadius:6,padding:"7px 10px"}}>{shopifyErr}</div>}
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <Btn variant={shopifyPhase==="ok"?"ghost":"primary"} style={{fontSize:11,padding:"7px 16px"}} onClick={connectShopify}>
                    {shopifyPhase==="saving"?"Testing…":shopifyPhase==="ok"?"✓ Connected":shopifyPhase==="err"?"Retry":"Test & Save"}
                  </Btn>
                  <div style={{...S.mono,fontSize:10,color:"var(--muted)"}}>
                    Needs <code style={{background:"var(--surface3)",padding:"1px 5px",borderRadius:3}}>read_products</code> + <code style={{background:"var(--surface3)",padding:"1px 5px",borderRadius:3}}>read_inventory</code> scopes
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Other static integrations ── */}
          {[
            {name:"Claude API",  sub:"● Connected",                subColor:"var(--accent)", action:"Update Key"},
            {name:"ElevenLabs",  sub:"● Connected",                subColor:"var(--accent)", action:"Update Key"},
            {name:"Snowflake",   sub:"◎ Pending setup",            subColor:"var(--amber)",  action:"Connect", primary:true},
            {name:"Gemini Vision",sub:"● Connected · PDF parsing", subColor:"var(--accent)", action:"Update Key"},
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
function AgentSection({brand,supplierEmail,supplierName,reorderQty,agentRunning,trace,showEmail,emailResult,showReply,cdVal,emailContent,onRun,onReset,onApprove,onCancel}:{
  brand:Brand,supplierEmail:string,supplierName:string,reorderQty:number,agentRunning:boolean,trace:TraceLine[],showEmail:boolean,emailResult:string,showReply:boolean,cdVal:string,emailContent:string,
  onRun:()=>void,onReset:()=>void,onApprove:()=>void,onCancel:()=>void
}) {
  const traceRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState("")

  useEffect(()=>{if(traceRef.current)traceRef.current.scrollTop=traceRef.current.scrollHeight},[trace])
  // Seed draft from agent output; never fall back to a pre-written template
  useEffect(()=>{ if(emailContent){ setDraft(emailContent); setEditing(false) } },[emailContent])

  const tagStyle = (tag:string) => TAG_COLORS[tag]||TAG_COLORS.WATCH
  const critSku  = brand.skus.find(s=>s.risk==="Critical")||brand.skus[0]
  const subject  = `Reorder Request — ${critSku?.name||brand.name} · ${reorderQty} units`

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
          <PanelHeader title={<>📧 AI-Drafted Supplier Email <BeHook>← gemini</BeHook></>}/>
          <div style={{padding:"12px 18px",borderBottom:"1px solid var(--border)"}}>
            <div style={{display:"flex",gap:10,...S.mono,fontSize:12,padding:"4px 0"}}>
              <span style={{color:"var(--muted)",minWidth:55}}>To:</span>
              {supplierEmail
                ? <span>{supplierEmail}<span style={{color:"var(--muted)"}}> · {supplierName}</span></span>
                : <span style={{color:"var(--amber)"}}>⚠ No email on file — add contact in Suppliers tab</span>}
            </div>
            <div style={{display:"flex",gap:10,...S.mono,fontSize:12,padding:"4px 0"}}>
              <span style={{color:"var(--muted)",minWidth:55}}>Subject:</span>
              <span>{subject}</span>
            </div>
          </div>
          <div style={{padding:"12px 18px",borderBottom:"1px solid var(--border)"}}>
            {editing?(
              <textarea
                value={draft}
                onChange={e=>setDraft(e.target.value)}
                style={{...S.mono,fontSize:11,lineHeight:1.9,color:"var(--text)",background:"var(--surface2)",borderRadius:8,padding:"12px 14px",width:"100%",minHeight:180,border:"1px solid var(--accent-mid)",outline:"none",resize:"vertical" as const,boxSizing:"border-box" as const}}
              />
            ):(
              <div style={{...S.mono,fontSize:11,lineHeight:1.9,color:draft?"var(--text)":"var(--muted)",background:"var(--surface2)",borderRadius:8,padding:"12px 14px",whiteSpace:"pre-wrap" as const,minHeight:60}}>
                {draft || "Generating email draft from live Shopify data…"}
              </div>
            )}
          </div>
          {!emailResult?(
            <div style={{padding:"12px 18px",display:"flex",alignItems:"center",gap:9,flexWrap:"wrap" as const}}>
              <Btn variant="primary" style={{padding:"9px 20px"}} onClick={onApprove}>✓ Approve & Send</Btn>
              <Btn style={{padding:"9px 18px"}} onClick={()=>setEditing(e=>!e)}>
                {editing?"✓ Save edit":"✏ Edit"}
              </Btn>
              <button onClick={onCancel} style={{background:"none",color:"var(--muted)",border:"none",...S.mono,fontSize:12,cursor:"pointer",padding:9}}>Cancel</button>
              <div style={{marginLeft:"auto",...S.mono,fontSize:11,color:"var(--amber)"}}>⏱ auto-sending in {cdVal}</div>
            </div>
          ):(
            <div style={{padding:"12px 18px",...S.mono,fontSize:12,color:emailResult.startsWith("✓")?"var(--accent)":"var(--muted)"}}>{emailResult}</div>
          )}
          {showReply&&(
            <div className="supplier-reply" style={{background:"var(--surface2)",border:"1px solid rgba(34,197,94,0.2)",borderLeft:"3px solid #4ade80",borderRadius:10,padding:"12px 16px",margin:"0 18px 12px"}}>
              <div style={{...S.mono,fontSize:10,color:"#4ade80",marginBottom:6}}>✉ Supplier Reply · just now</div>
              <div style={{...S.mono,fontSize:11,color:"var(--text)",lineHeight:1.7}}>
                Hi, confirmed — <strong>{reorderQty} units</strong> available. Ships Monday. ETA 7 business days. Invoice to follow.
                <br/><br/>— {supplierName||brand.supplier}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ShopifyGate({onSettings}:{onSettings:()=>void}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:320,gap:12}}>
      <div style={{fontSize:32}}>🛍</div>
      <div style={{...S.display,fontSize:18,fontWeight:700}}>Connect your Shopify store</div>
      <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,maxWidth:320,lineHeight:1.8}}>
        Link your store in Settings → API Connections to pull live inventory, orders, and suppliers.
      </div>
      <Btn variant="primary" onClick={onSettings}>Go to Settings →</Btn>
    </div>
  )
}

// ── MAIN COMPONENT ──
export default function Dashboard() {
  const { data: session } = useSession()
  const userKey = session?.user?.email ?? "guest"

  const [section, setSection]     = useState("overview")
  const [syncSecs, setSyncSecs]   = useState(0)
  const [syncPhase, setSyncPhase] = useState<"idle"|"syncing"|"done">("idle")
  const [agentSettings, setAgentSettings] = useState({
    autoApprove: false, scheduleEnabled: false,
    scheduleIntervalMins: 30, autoSendWindowMins: 120, riskThresholdDays: 14,
  })
  const [scheduleSecs, setScheduleSecs] = useState(30 * 60)
  const [cdSecs, setCdSecs]       = useState(120 * 60)
  const [liveSkus, setLiveSkus]   = useState<RawSKU[] | "error" | null>(null)
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [suppliers,        setSuppliers]        = useState<Supplier[]>([])
  const [skuSupplierMap,   setSkuSupplierMap]   = useState<Record<string,string>>({})
  const [orders,           setOrders]           = useState<PurchaseOrder[]>([])
  const [inbounds,         setInbounds]         = useState<StockInbound[]>([])

  const [shopifyOrders,    setShopifyOrders]    = useState<ShopifyOrder[]>([])
  const [shopifyConnected, setShopifyConnected] = useState<boolean|null>(null)

  // ── persist suppliers + SKU map to localStorage keyed by signed-in email ──
  useEffect(()=>{
    try {
      const raw = localStorage.getItem(`chainagent:${userKey}:suppliers`)
      if(raw) setSuppliers(JSON.parse(raw))
      const raw2 = localStorage.getItem(`chainagent:${userKey}:skuSupplierMap`)
      if(raw2) setSkuSupplierMap(JSON.parse(raw2))
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[userKey])

  useEffect(()=>{
    try { localStorage.setItem(`chainagent:${userKey}:suppliers`, JSON.stringify(suppliers)) } catch {}
  },[userKey, suppliers])

  useEffect(()=>{
    try { localStorage.setItem(`chainagent:${userKey}:skuSupplierMap`, JSON.stringify(skuSupplierMap)) } catch {}
  },[userKey, skuSupplierMap])

  // persist everything to localStorage keyed by user
  useEffect(()=>{
    try {
      const raw = localStorage.getItem(`chainagent:${userKey}:agentSettings`)
      if(raw){
        const saved = JSON.parse(raw)
        // migrate old hrs fields to mins
        if(saved.scheduleIntervalHrs!=null && saved.scheduleIntervalMins==null) saved.scheduleIntervalMins = saved.scheduleIntervalHrs * 60
        if(saved.autoSendWindowHrs!=null && saved.autoSendWindowMins==null) saved.autoSendWindowMins = saved.autoSendWindowHrs * 60
        setAgentSettings(s=>({...s,...saved}))
      }
      const rawOrders = localStorage.getItem(`chainagent:${userKey}:orders`)
      if(rawOrders) setOrders(JSON.parse(rawOrders))
      const rawAudit = localStorage.getItem(`chainagent:${userKey}:auditRows`)
      if(rawAudit) setAuditRows(JSON.parse(rawAudit))
      const rawInbounds = localStorage.getItem(`chainagent:${userKey}:inbounds`)
      if(rawInbounds) setInbounds(JSON.parse(rawInbounds))
      const rawSched = localStorage.getItem(`chainagent:${userKey}:scheduleTarget`)
      if(rawSched){
        const target = parseInt(rawSched)
        const remaining = Math.floor((target - Date.now()) / 1000)
        if(remaining > 0) setScheduleSecs(remaining)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[userKey])

  useEffect(()=>{ try { localStorage.setItem(`chainagent:${userKey}:agentSettings`, JSON.stringify(agentSettings)) } catch {} },[userKey, agentSettings])
  useEffect(()=>{ try { localStorage.setItem(`chainagent:${userKey}:orders`, JSON.stringify(orders)) } catch {} },[userKey, orders])
  useEffect(()=>{ try { localStorage.setItem(`chainagent:${userKey}:auditRows`, JSON.stringify(auditRows)) } catch {} },[userKey, auditRows])
  useEffect(()=>{ try { localStorage.setItem(`chainagent:${userKey}:inbounds`, JSON.stringify(inbounds)) } catch {} },[userKey, inbounds])

  const cdInt = useRef<ReturnType<typeof setInterval>|null>(null)

  // ── real backend hook ──
  const stream = useAgentStream()
  const { agentRunning, showEmail, emailResult, showReply, backendOnline, stagedReorder } = stream

  // ── check Shopify connection status ──
  useEffect(()=>{
    fetch("/api/settings")
      .then(r=>r.json())
      .then(d=>setShopifyConnected(d.connected===true))
      .catch(()=>setShopifyConnected(false))
  },[])

  // ── load real SKU data from Shopify ──
  useEffect(()=>{
    fetch("/api/skus")
      .then(r=>{ if(!r.ok) throw new Error("api"); return r.json() })
      .then((data: RawSKU[] | {error?:string, configured?:boolean})=>{
        if(Array.isArray(data)) setLiveSkus(data)
        else if((data as {configured?:boolean}).configured===false) setLiveSkus([])
        else setLiveSkus("error")
      })
      .catch(()=>setLiveSkus("error"))
  },[])

  // ── load Shopify suppliers / deliveries / orders ──
  useEffect(()=>{
    function safeFetch<T>(url:string, setter:(v:T[])=>void) {
      fetch(url).then(r=>r.json()).then((d:T[]|{configured?:boolean})=>{ if(Array.isArray(d)) setter(d) }).catch(()=>{})
    }
    safeFetch<ShopifyOrder>("/api/orders", setShopifyOrders)
  },[])

  // Build brand from live Shopify data only — no hardcoded fallback
  const brand: Brand | null = (() => {
    if (!Array.isArray(liveSkus) || liveSkus.length === 0) return null
    const mappedSkus: SKU[] = liveSkus.map((s: RawSKU, i: number) => {
      const vel = s.velocity_per_day
      const days = vel != null && vel > 0 ? s.stock / vel : null
      // Without lead time data from Shopify, flag as Critical if < 14 days, Watch if < 30
      const risk = days == null ? "No data" : days < 14 ? "Critical" : days < 30 ? "Watch" : "Healthy"
      const pct  = days == null ? 0 : Math.min(100, Math.round((days / 90) * 100))
      return {
        name: s.name,
        id: s.id || `SKU-${String(i+1).padStart(3,"0")}`,
        stock: s.stock.toLocaleString(),
        inc: "—",
        vel: vel != null ? `${vel}/day` : "No data",
        velSource: s.velocity_source,
        days: days != null ? days.toFixed(1) : "—",
        pct,
        risk,
        rc: risk==="Critical"?"risk-critical":risk==="Watch"?"risk-watch":risk==="No data"?"risk-watch":"risk-ok",
        price: s.price ? `$${parseFloat(s.price).toFixed(2)}` : "—",
      }
    })
    const critSku = mappedSkus.reduce((a: SKU, b: SKU) => parseFloat(a.days) < parseFloat(b.days) ? a : b)
    const totalStock = liveSkus.reduce((a: number, s: RawSKU) => a + s.stock, 0)
    return {
      name: "Portland Optics",
      label: "brand: Portland Optics",
      days: critSku.days,
      stock: totalStock.toLocaleString(),
      incoming: inbounds.length > 0 ? inbounds.reduce((s, r) => s + (r.qty??0), 0).toLocaleString() : "—",
      crit: critSku.name.toUpperCase(),
      agentTitle: `chainagent-runtime · ${mappedSkus.length} SKUs monitored`,
      supplier: suppliers[0]?.name || "—",
      email: suppliers[0]?.email || "",
      skus: mappedSkus,
    }
  })()

  // Resolve supplier contact for the agent email via skuSupplierMap
  const critMapped = brand?.skus.find(s=>s.risk==="Critical") ?? brand?.skus[0]
  const agentSupplier = critMapped ? (suppliers.find(s => s.id === skuSupplierMap[critMapped.id]) ?? null) : null
  const agentSupplierEmail = agentSupplier?.email || ""
  const agentSupplierName  = agentSupplier?.name  || ""
  const agentReorderQty = stagedReorder?.qty ?? 0

  // Sync timer
  useEffect(()=>{
    const t=setInterval(()=>setSyncSecs(s=>s+1),1000)
    return ()=>clearInterval(t)
  },[])

  // Schedule countdown — auto-runs agent when interval expires
  useEffect(()=>{
    if(!agentSettings.scheduleEnabled) return
    const interval = agentSettings.scheduleIntervalMins * 60
    // save target so it survives refresh
    try { localStorage.setItem(`chainagent:${userKey}:scheduleTarget`, String(Date.now() + interval * 1000)) } catch {}
    const t = setInterval(()=>{
      setScheduleSecs(s=>{
        if(s<=1){
          handleRunAgent()
          try { localStorage.setItem(`chainagent:${userKey}:scheduleTarget`, String(Date.now() + interval * 1000)) } catch {}
          return interval
        }
        return s-1
      })
    },1000)
    return ()=>clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[agentSettings.scheduleEnabled, agentSettings.scheduleIntervalMins])

  // When supplier replies → confirm the pending PO
  useEffect(()=>{
    if(!showReply) return
    setOrders(prev=>prev.map((po,i)=>i===0&&po.status==="sent"?{...po,status:"confirmed" as const}:po))
    const now=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})
    setAuditRows(prev=>[{time:`Today ${now}`,action:"Supplier confirmed reorder · shipment pending",sku:brand?.skus[0]?.id||"",label:"Created"},...prev])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[showReply])

  // Countdown for email approval — auto-approves if setting is on
  useEffect(()=>{
    if(showEmail&&!emailResult){
      const window = agentSettings.autoSendWindowMins * 60
      setCdSecs(window)
      cdInt.current=setInterval(()=>{
        setCdSecs(s=>{
          if(s<=1){
            if(agentSettings.autoApprove) handleApprove()
            return 0
          }
          return s-1
        })
      },1000)
    }
    return ()=>{if(cdInt.current)clearInterval(cdInt.current)}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[showEmail,emailResult])

  const fmt = (s:number)=>{
    const h=String(Math.floor(s/3600)).padStart(2,"0")
    const m=String(Math.floor((s%3600)/60)).padStart(2,"0")
    const sc=String(s%60).padStart(2,"0")
    return `${h}:${m}:${sc}`
  }

  // ── delegate agent actions to real hook ──
  const handleRunAgent = useCallback(()=>{
    stream.runAgent(agentSupplier ? { name: agentSupplierName, email: agentSupplierEmail } : undefined)
  },[stream, agentSupplier, agentSupplierName, agentSupplierEmail])

  const handleApprove = useCallback(()=>{
    if(cdInt.current)clearInterval(cdInt.current)
    stream.approve()
    const critSku  = brand?.skus.find(s=>s.risk==="Critical")||brand?.skus[0]
    const qty      = agentReorderQty
    const supplier = agentSupplierName || brand?.supplier || "Supplier"
    const now      = new Date()
    const timeStr  = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})
    const dateStr  = now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})

    setAuditRows(prev=>[{time:`Today ${timeStr}`,action:`Reorder approved · ${critSku?.name||""} · ${qty} units → ${supplier}`,sku:critSku?.id||"",label:"Sent"},...prev])

    if(critSku){
      const ref=`PO-${now.getFullYear()}-${String(Date.now()).slice(-4)}`
      setOrders(prev=>[{ref,sku:critSku.name,skuId:critSku.id,supplier,supplierEmail:agentSupplierEmail,qty,orderDate:dateStr,eta:dateStr,status:"sent" as const},...prev])
      setInbounds(prev=>[{id:`INB-${Date.now()}`,name:critSku.name,skuId:critSku.id,supplier,qty,approvedAt:dateStr,status:"pending" as const,poRef:ref},...prev])
    }
  },[stream, brand, agentReorderQty, agentSupplierEmail, agentSupplierName, setInbounds])

  const handleCancel = useCallback(()=>{
    if(cdInt.current)clearInterval(cdInt.current)
    stream.cancel()
    const now=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})
    setAuditRows(prev=>[{time:`Today ${now}`,action:"Reorder cancelled by founder",sku:brand?.skus[0]?.id||"",label:"Cancelled"},...prev])
  },[stream, brand])

  const handleReset = useCallback(()=>{
    stream.reset()
    setCdSecs(7200)
    if(cdInt.current)clearInterval(cdInt.current)
  },[stream])

  const handleResync = useCallback(()=>{
    if (syncPhase !== "idle") return
    setSyncPhase("syncing")
    setSyncSecs(0)
    fetch("/api/skus")
      .then(r=>{ if(!r.ok) throw new Error("api"); return r.json() })
      .then((data: RawSKU[] | {error:string})=>setLiveSkus(Array.isArray(data) ? data : "error"))
      .catch(()=>setLiveSkus("error"))
    setTimeout(()=>{
      setSyncPhase("done")
      setTimeout(()=>setSyncPhase("idle"), 1200)
    }, 1200)
  },[syncPhase])

  const navItems = [
    {id:"overview",    name:"Overview",       icon:"◈", label:"Monitor"},
    {id:"agent",       name:"Run Agent",      icon:"⚡", label:"Monitor"},
    {id:"inventory",   name:"Inventory",      icon:"◫", label:"Monitor"},
    {id:"inbounds",    name:"Stock Inbounds", icon:"📥",label:"Monitor",badge:inbounds.length>0?String(inbounds.length):undefined,badgeColor:"amber"},
    {id:"orders",      name:"Orders",         icon:"📦",label:"Monitor"},
    {id:"suppliers",   name:"Suppliers",      icon:"◉", label:"Manage"},
    {id:"history",     name:"Agent Orders",icon:"≡",label:"Manage",badge:auditRows.length>0?String(auditRows.length):undefined,badgeColor:"green"},
    {id:"notifications",name:"Notifications", icon:"🔔",label:"Manage"},
    {id:"settings",    name:"Settings",       icon:"◎", label:"Manage"},
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
            🏷 {brand?.label ?? "portland-optics-65ovalib"}
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
                    {item.name}
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
              <Toggle on={agentSettings.scheduleEnabled} onChange={v=>setAgentSettings(s=>({...s,scheduleEnabled:v}))}/>
            </div>
          </div>
          <div style={{marginTop:"auto",padding:12}}>
            <div style={{background:"var(--red-dim)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,padding:10,marginBottom:7}}>
              <div style={{...S.display,fontSize:20,fontWeight:800,color:"var(--red)",letterSpacing:"-0.02em"}}>{brand?.days ?? "—"}</div>
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
          {["overview","agent","inventory","inbounds","orders"].includes(section) && (
            liveSkus === null ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:320,gap:12}}>
                <span style={{display:"inline-block",animation:"spin 1s linear infinite",fontSize:22,color:"var(--accent)"}}>↻</span>
                <div style={{...S.mono,fontSize:12,color:"var(--muted)"}}>Loading inventory from Shopify…</div>
              </div>
            ) : liveSkus === "error" ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:320,gap:10}}>
                <div style={{fontSize:28}}>⚠</div>
                <div style={{...S.display,fontSize:16,fontWeight:700,color:"var(--red)"}}>Shopify unreachable</div>
                <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,maxWidth:340}}>Could not load inventory. Check Shopify credentials in Settings or retry.</div>
                <Btn onClick={handleResync} style={{marginTop:8}}>↻ Retry</Btn>
              </div>
            ) : brand === null ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:320,gap:10}}>
                <div style={{fontSize:28}}>📦</div>
                <div style={{...S.display,fontSize:16,fontWeight:700}}>No products found</div>
                <div style={{...S.mono,fontSize:11,color:"var(--muted)"}}>Add products to your Shopify store and resync.</div>
              </div>
            ) : (
              <>
                {section==="overview"  &&<OverviewSection brand={brand} orders={orders} onRunAgent={()=>{setSection("agent");setTimeout(handleRunAgent,200)}} onViewAllReorders={()=>setSection("history")}/>}
                {section==="agent"     &&(
                  suppliers.length===0?(
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:320,gap:12}}>
                      <div style={{fontSize:28}}>◉</div>
                      <div style={{...S.display,fontSize:16,fontWeight:700}}>Add a supplier first</div>
                      <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,maxWidth:320,lineHeight:1.7}}>
                        Add a supplier with their contact info in the Suppliers tab, then assign them to the critical SKU in Inventory.
                      </div>
                      <Btn variant="primary" onClick={()=>setSection("suppliers")}>Go to Suppliers →</Btn>
                    </div>
                  ):!agentSupplier?(
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:320,gap:12}}>
                      <div style={{fontSize:28}}>🔗</div>
                      <div style={{...S.display,fontSize:16,fontWeight:700}}>Assign a supplier to {critMapped?.name||"the critical SKU"}</div>
                      <div style={{...S.mono,fontSize:11,color:"var(--muted)",textAlign:"center" as const,maxWidth:340,lineHeight:1.7}}>
                        Open Inventory, find the SKU, and use the supplier dropdown to link it. The agent will use that supplier's contact for the email.
                      </div>
                      <Btn variant="primary" onClick={()=>setSection("inventory")}>Go to Inventory →</Btn>
                    </div>
                  ):<AgentSection brand={brand} supplierEmail={agentSupplierEmail} supplierName={agentSupplierName} reorderQty={agentReorderQty} agentRunning={agentRunning} trace={stream.trace} showEmail={showEmail} emailResult={emailResult} showReply={showReply} cdVal={fmt(cdSecs)} onRun={handleRunAgent} onReset={handleReset} onApprove={handleApprove} onCancel={handleCancel} emailContent={stream.emailContent}/>
                )}
                {section==="inventory" &&<InventorySection brand={brand} suppliers={suppliers} skuSupplierMap={skuSupplierMap} onAssign={(id,suppId)=>setSkuSupplierMap(m=>({...m,[id]:suppId}))}/>}
                {section==="inbounds"  &&<InboundsSection
                    inbounds={inbounds}
                    onSetInTransit={(id)=>{
                      const inbound = inbounds.find(i=>i.id===id)
                      setInbounds(prev=>prev.map(i=>i.id===id?{...i,status:"in-transit" as const}:i))
                      if(inbound?.poRef) setOrders(prev=>prev.map(p=>p.ref===inbound.poRef?{...p,status:"in-transit" as const}:p))
                    }}
                    onReceive={(id,poRef)=>{
                      setInbounds(prev=>prev.filter(i=>i.id!==id))
                      if(poRef) setOrders(prev=>prev.map(p=>p.ref===poRef?{...p,status:"received" as const}:p))
                      handleResync()
                    }}
                  />}
                {section==="orders"    &&<OrdersSection orders={shopifyOrders}/>}
              </>
            )
          )}
          {section==="suppliers" && (shopifyConnected===null?null:shopifyConnected===false?<ShopifyGate onSettings={()=>setSection("settings")}/>:<SuppliersSection suppliers={suppliers} onAdd={s=>setSuppliers(prev=>[...prev,s])} onUpdate={s=>setSuppliers(prev=>prev.map(p=>p.id===s.id?s:p))}/>)}
          {section==="history"   && <OrderHistorySection orders={orders} auditRows={auditRows} inbounds={inbounds} onUpdateOrder={(ref,status)=>setOrders(prev=>prev.map(p=>p.ref===ref?{...p,status}:p))}/>}
          {section==="notifications"&&<NotificationsSection/>}
          {section==="settings"    &&<SettingsSection agentSettings={agentSettings} onSaveSettings={setAgentSettings}/>}
        </main>
      </div>
    </>
  )
}
