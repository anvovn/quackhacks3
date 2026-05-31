import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const res = await fetch('http://localhost:8000/sms-test', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    });
    return NextResponse.json(await res.json(), { status: res.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ status: 'error', detail: String(e) }, { status: 500 });
  }
}
