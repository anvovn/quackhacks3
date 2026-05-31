import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const response = await fetch("http://localhost:8000/run-agent", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("Error triggering agent:", error);
    return NextResponse.json({ error: 'Failed to run agent' }, { status: 500 });
  }
}
