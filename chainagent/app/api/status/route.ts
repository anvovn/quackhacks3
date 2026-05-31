import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      // Short timeout so we fail fast instead of hanging
      signal: AbortSignal.timeout(2000),
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    // Backend is not reachable — return a graceful offline response
    return NextResponse.json({
      status: "offline",
      agent_running: false,
      awaiting_approval: false,
    });
  }
}
