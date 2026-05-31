import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'data', 'suppliers.json');
    const raw = readFileSync(filePath, 'utf-8');
    return NextResponse.json(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to read suppliers.json:', error);
    return NextResponse.json({ error: 'Failed to load supplier data' }, { status: 500 });
  }
}
