import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch('http://localhost:8000/snowflake-logs', { cache: 'no-store' })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ rows: [], error: 'Backend unavailable' })
  }
}
