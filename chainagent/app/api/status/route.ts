import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch("http://localhost:8000/status", {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching status:", error);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
