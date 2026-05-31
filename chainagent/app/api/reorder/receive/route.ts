import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();
  try {
    const res = await fetch('http://localhost:8000/reorder/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
