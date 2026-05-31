import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'data', 'skus.json');
    const raw = readFileSync(filePath, 'utf-8');
    const skus = JSON.parse(raw);
    return NextResponse.json(skus);
  } catch (error) {
    console.error('Failed to read skus.json:', error);
    return NextResponse.json({ error: 'Failed to load SKU data' }, { status: 500 });
  }
}
