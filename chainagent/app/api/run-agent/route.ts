import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function POST() {
  try {
    const response = await fetch(`${BACKEND_URL}/run-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error triggering agent:", error);
    return NextResponse.json({ error: 'Failed to run agent' }, { status: 500 });
  }
}
