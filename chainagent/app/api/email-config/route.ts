import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('http://localhost:8000/email-config', { signal: AbortSignal.timeout(3000) });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ enabled: false, email: '' });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch('http://localhost:8000/email-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  return NextResponse.json(await res.json(), { status: res.ok ? 200 : 500 });
}
