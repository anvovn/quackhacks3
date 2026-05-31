import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch('http://localhost:8000/api-keys', { cache: 'no-store' })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({})
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const res = await fetch('http://localhost:8000/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
