import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

interface ShopifyVariant {
  id: number;
  sku: string;
  title: string;
  inventory_quantity: number;
}
interface ShopifyProduct {
  id: number;
  title: string;
  variants: ShopifyVariant[];
}
interface SkuSupp {
  velocity_per_day: number;
  lead_time_days: number;
  supplier_name: string;
  reorder_qty: number;
}

function localSkus() {
  const raw = readFileSync(join(process.cwd(), 'data', 'skus.json'), 'utf-8');
  return JSON.parse(raw);
}

function loadSupplement(): Record<string, SkuSupp> {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'sku-supplement.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function shopifyConfig(): { store: string; token: string } | null {
  // Prefer env vars; fall back to the config file written by the settings UI
  const envStore = process.env.SHOPIFY_STORE;
  const envToken = process.env.SHOPIFY_TOKEN;
  if (envStore && envToken) return { store: envStore, token: envToken };

  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'shopify-config.json'), 'utf-8');
    const cfg = JSON.parse(raw);
    if (cfg.store && cfg.token) return { store: cfg.store, token: cfg.token };
  } catch {}
  return null;
}

async function fetchShopifySkus(store: string, token: string) {
  const url = `https://${store}/admin/api/2024-01/products.json?fields=id,title,variants&limit=250`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token },
    // Next.js cache — revalidate every 60 s so hot-reloads don't hammer Shopify
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Shopify API ${res.status}`);
  const { products } = (await res.json()) as { products: ShopifyProduct[] };
  const supplement = loadSupplement();

  return products.flatMap(product =>
    product.variants.map(variant => {
      const supp: SkuSupp = supplement[variant.sku] ??
        supplement[product.title] ?? {
          velocity_per_day: 30,
          lead_time_days: 21,
          supplier_name: 'Shopify Store',
          reorder_qty: 500,
        };
      const variantLabel =
        product.variants.length > 1 && variant.title !== 'Default Title'
          ? ` ${variant.title}`
          : '';
      return {
        id: variant.sku || `shopify-${variant.id}`,
        name: `${product.title}${variantLabel}`,
        stock: variant.inventory_quantity,
        velocity_per_day: supp.velocity_per_day,
        lead_time_days: supp.lead_time_days,
        supplier_name: supp.supplier_name,
        reorder_qty: supp.reorder_qty,
      };
    })
  );
}

export async function GET() {
  const cfg = shopifyConfig();

  if (cfg) {
    try {
      const skus = await fetchShopifySkus(cfg.store, cfg.token);
      return NextResponse.json(skus);
    } catch (err) {
      console.error('Shopify fetch failed, falling back to local data:', err);
    }
  }

  // Fallback to local JSON
  try {
    return NextResponse.json(localSkus());
  } catch (err) {
    console.error('Failed to read skus.json:', err);
    return NextResponse.json({ error: 'Failed to load SKU data' }, { status: 500 });
  }
}
