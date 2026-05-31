import { useState, useRef, useCallback, useEffect } from "react"

export interface TraceLine {
  tag: string
  msg: string
  time: string
}

export interface PendingReorder {
  id: string
  variant_id: number
  name: string
  qty: number
  supplier: string
  created_at: number
}

export interface AgentStatus {
  online: boolean
  agentRunning: boolean
  awaitingApproval: boolean
}

export interface UseAgentStreamResult {
  trace: TraceLine[]
  agentRunning: boolean
  awaitingApproval: boolean
  backendOnline: boolean | null
  emailContent: string
  showEmail: boolean
  emailResult: string
  showReply: boolean
  pendingReorders: PendingReorder[]
  stagedReorder: Omit<PendingReorder,"created_at"> | null
  runAgent: (supplier?: { name: string; email: string }) => Promise<void>
  approve: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
  removeReorder: (id: string) => void
}

export function useAgentStream(): UseAgentStreamResult {
  const [trace, setTrace]               = useState<TraceLine[]>([])
  const [agentRunning, setAgentRunning] = useState(false)
  const [awaitingApproval, setAwaitingApproval] = useState(false)
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [emailContent, setEmailContent] = useState("")
  const [showEmail, setShowEmail]       = useState(false)
  const [emailResult, setEmailResult]   = useState("")
  const [showReply, setShowReply]       = useState(false)
  const [pendingReorders, setPendingReorders] = useState<PendingReorder[]>([])
  const [stagedReorder, setStagedReorder] = useState<Omit<PendingReorder,"created_at"> | null>(null)

  const esRef        = useRef<EventSource | null>(null)
  const statusTimer  = useRef<ReturnType<typeof setInterval> | null>(null)
  const replyTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stagedReorderRef = useRef<Omit<PendingReorder,"created_at"> | null>(null)
  const approvedRef  = useRef(false)

  // ── status polling ──────────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" })
      if (!res.ok) throw new Error("not ok")
      const data: { status: string; agent_running: boolean; awaiting_approval: boolean } = await res.json()
      if (data.status === "offline") {
        setBackendOnline(false)
        setAgentRunning(false)
      } else {
        setBackendOnline(true)
        setAgentRunning(data.agent_running)
        setAwaitingApproval(data.awaiting_approval)
      }
    } catch {
      setBackendOnline(false)
      setAgentRunning(false)
    }
  }, [])

  useEffect(() => {
    pollStatus()
    // Poll every 2s when online, 5s when offline to reduce noise
    const interval = backendOnline === false ? 5000 : 2000
    statusTimer.current = setInterval(pollStatus, interval)
    return () => {
      if (statusTimer.current) clearInterval(statusTimer.current)
    }
  }, [pollStatus, backendOnline])

  // ── SSE stream ──────────────────────────────────────────────────────────
  const openStream = useCallback(() => {
    if (esRef.current) esRef.current.close()

    const es = new EventSource("/api/stream")
    esRef.current = es

    es.onmessage = (event) => {
      try {
        const data: { tag: string; msg: string } = JSON.parse(event.data)
        const now = new Date().toLocaleTimeString("en-US", { hour12: false })
        const line: TraceLine = { tag: data.tag, msg: data.msg, time: now }

        setTrace((prev) => [...prev, line])

        if (data.tag === "EMAIL") {
          setEmailContent(data.msg)
          setShowEmail(true)
        }

        if (data.tag === "REORDER") {
          try {
            const parsed = JSON.parse(data.msg)
            console.log("[ChainAgent] REORDER received:", parsed)
            stagedReorderRef.current = parsed
            setStagedReorder(parsed)
            // if user already approved before REORDER arrived, add immediately
            if (approvedRef.current) {
              setPendingReorders(prev => [...prev, { ...parsed, created_at: Date.now() }])
              approvedRef.current = false
            }
          } catch {}
        }

        if (data.tag === "STATUS" && data.msg === "Agent finished") {
          setAgentRunning(false)
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      // SSE will auto-retry; don't close it
    }
  }, [])

  const closeStream = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
  }, [])

  // ── public actions ──────────────────────────────────────────────────────
  const runAgent = useCallback(async (supplier?: { name: string; email: string }) => {
    if (agentRunning) return

    setTrace([])
    setShowEmail(false)
    setEmailContent("")
    setEmailResult("")
    setShowReply(false)
    setAgentRunning(true)
    setPendingReorders([])
    setStagedReorder(null)
    stagedReorderRef.current = null
    approvedRef.current = false

    openStream()

    try {
      const res = await fetch("/api/run-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier: supplier ?? {} }),
      })
      const data: { status: string } = await res.json()
      if (data.status === "already_running") {
        // stream is already open, that's fine
      }
    } catch {
      setAgentRunning(false)
      closeStream()
    }
  }, [agentRunning, openStream, closeStream])

  const approve = useCallback(async () => {
    try {
      await fetch("/api/approve", { method: "POST" })
      if (stagedReorderRef.current) {
        setPendingReorders(prev => [...prev, { ...stagedReorderRef.current!, created_at: Date.now() }])
        // keep stagedReorder in state so qty shows correctly in the reply message
      } else {
        // REORDER event hasn't arrived yet — flag so it gets added when it does
        approvedRef.current = true
      }
      setEmailResult("✓ Email sent to supplier · Logged to Snowflake · Inbound auto-created")
      setAwaitingApproval(false)
      const now = new Date().toLocaleTimeString("en-US", { hour12: false })
      setTrace((prev) => [...prev, { tag: "REPLY", msg: "Supplier confirmed · ships Monday ✓", time: now }])
      replyTimer.current = setTimeout(() => setShowReply(true), 2500)
    } catch {
      setEmailResult("✗ Failed to reach backend")
    }
  }, [])

  const cancel = useCallback(async () => {
    try {
      await fetch("/api/cancel", { method: "POST" })
      setEmailResult("✗ Action cancelled by founder")
      setAwaitingApproval(false)
    } catch {
      setEmailResult("✗ Failed to reach backend")
    }
  }, [])

  const removeReorder = useCallback((id: string) => {
    setPendingReorders(prev => prev.filter(r => r.id !== id))
  }, [])

  const reset = useCallback(() => {
    closeStream()
    setAgentRunning(false)
    setTrace([])
    setShowEmail(false)
    setEmailContent("")
    setEmailResult("")
    setShowReply(false)
    setAwaitingApproval(false)
    setPendingReorders([])
    stagedReorderRef.current = null
    setStagedReorder(null)
    approvedRef.current = false
    if (replyTimer.current) clearTimeout(replyTimer.current)
  }, [closeStream])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      closeStream()
      if (replyTimer.current) clearTimeout(replyTimer.current)
    }
  }, [closeStream])

  return {
    trace,
    agentRunning,
    awaitingApproval,
    backendOnline,
    emailContent,
    showEmail,
    emailResult,
    showReply,
    pendingReorders,
    stagedReorder,
    runAgent,
    approve,
    cancel,
    reset,
    removeReorder,
  }
}
