import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CONFIG_PATH = join(process.cwd(), 'data', 'shopify-config.json');

function readConfig(): { store: string; token: string } {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { store: '', token: '' };
  }
}

export async function GET() {
  const config = readConfig();
  return NextResponse.json({
    store: config.store || '',
    connected: !!(config.store && config.token),
  });
}

export async function POST(req: Request) {
  const { store, token } = await req.json();

  if (!store || !token) {
    return NextResponse.json({ error: 'Store domain and token are required' }, { status: 400 });
  }

  const normalizedStore = store.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // Test the credentials against Shopify
  try {
    const res = await fetch(`https://${normalizedStore}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Shopify rejected the credentials (${res.status}). Check your store domain and token.` },
        { status: 400 }
      );
    }
    const { shop } = await res.json();
    writeFileSync(CONFIG_PATH, JSON.stringify({ store: normalizedStore, token }, null, 2));
    return NextResponse.json({ success: true, shopName: shop.name });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach Shopify — check the store domain and your internet connection.' },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  writeFileSync(CONFIG_PATH, JSON.stringify({ store: '', token: '' }, null, 2));
  return NextResponse.json({ success: true });
}
