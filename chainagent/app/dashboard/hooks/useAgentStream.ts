import { useState, useRef, useCallback, useEffect } from "react"

export interface TraceLine {
  tag: string
  msg: string
  time: string
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
  backendOnline: boolean | null   // null = still checking
  emailContent: string
  showEmail: boolean
  emailResult: string
  showReply: boolean
  runAgent: () => Promise<void>
  approve: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
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

  const esRef        = useRef<EventSource | null>(null)
  const statusTimer  = useRef<ReturnType<typeof setInterval> | null>(null)
  const replyTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── status polling ──────────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" })
      if (!res.ok) throw new Error("not ok")
      const data: { status: string; agent_running: boolean; awaiting_approval: boolean } = await res.json()
      setBackendOnline(true)
      setAgentRunning(data.agent_running)
      setAwaitingApproval(data.awaiting_approval)
    } catch {
      setBackendOnline(false)
      setAgentRunning(false)
    }
  }, [])

  useEffect(() => {
    pollStatus()
    statusTimer.current = setInterval(pollStatus, 2000)
    return () => {
      if (statusTimer.current) clearInterval(statusTimer.current)
    }
  }, [pollStatus])

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
  const runAgent = useCallback(async () => {
    if (agentRunning) return

    // Reset UI state
    setTrace([])
    setShowEmail(false)
    setEmailContent("")
    setEmailResult("")
    setShowReply(false)
    setAgentRunning(true)

    // Open the SSE stream first so we don't miss early events
    openStream()

    try {
      const res = await fetch("/api/run-agent", { method: "POST" })
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

  const reset = useCallback(() => {
    closeStream()
    setAgentRunning(false)
    setTrace([])
    setShowEmail(false)
    setEmailContent("")
    setEmailResult("")
    setShowReply(false)
    setAwaitingApproval(false)
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
    runAgent,
    approve,
    cancel,
    reset,
  }
}
