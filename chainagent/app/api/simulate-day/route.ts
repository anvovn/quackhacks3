import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const res = await fetch('http://localhost:8000/simulate-day', { method: 'POST' })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ status: 'error', message: 'Backend unavailable' }, { status: 503 })
  }
}
