import { readFileSync } from 'fs';
import { join } from 'path';

export interface ShopifyConfig { store: string; token: string }

export function getShopifyConfig(): ShopifyConfig | null {
  if (process.env.SHOPIFY_STORE && process.env.SHOPIFY_TOKEN)
    return { store: process.env.SHOPIFY_STORE, token: process.env.SHOPIFY_TOKEN };
  try {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'data', 'shopify-config.json'), 'utf-8'));
    if (cfg.store && cfg.token) return cfg;
  } catch {}
  return null;
}

export async function shopifyFetch<T>(cfg: ShopifyConfig, path: string): Promise<T> {
  const res = await fetch(`https://${cfg.store}/admin/api/2024-01/${path}`, {
    headers: { 'X-Shopify-Access-Token': cfg.token },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const NOT_CONFIGURED = { configured: false } as const;
