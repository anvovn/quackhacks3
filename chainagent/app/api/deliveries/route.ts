import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'data', 'deliveries.json');
    const raw = readFileSync(filePath, 'utf-8');
    return NextResponse.json(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to read deliveries.json:', error);
    return NextResponse.json({ error: 'Failed to load delivery data' }, { status: 500 });
  }
}
