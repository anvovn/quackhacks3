import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const response = await fetch(`${BACKEND_URL}/run-agent`, {
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
