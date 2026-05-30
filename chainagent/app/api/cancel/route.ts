import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const response = await fetch("http://localhost:8000/cancel", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error cancelling agent:", error);
    return NextResponse.json({ error: 'Failed to cancel agent' }, { status: 500 });
  }
}
