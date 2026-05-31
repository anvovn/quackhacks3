import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getShopifyConfig, shopifyFetch, NOT_CONFIGURED } from '@/lib/shopify';

interface ShopifyVariant {
  id: number; sku: string; title: string;
  inventory_quantity: number; price: string;
}
interface ShopifyProduct { id: number; title: string; variants: ShopifyVariant[] }
interface ShopifyLineItem { sku: string; quantity: number }
interface ShopifyOrder { line_items: ShopifyLineItem[] }
interface SkuSupp { velocity_per_day: number; lead_time_days: number; reorder_qty: number }

const VELOCITY_DAYS = 30

function loadSupplement(): Record<string, SkuSupp> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'data', 'sku-supplement.json'), 'utf-8'));
  } catch { return {}; }
}

async function fetchVelocity(cfg: Parameters<typeof shopifyFetch>[0]): Promise<Record<string, number>> {
  const since = new Date(Date.now() - VELOCITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { orders } = await shopifyFetch<{ orders: ShopifyOrder[] }>(
    cfg,
    `orders.json?status=any&created_at_min=${encodeURIComponent(since)}&fields=line_items&limit=250`
  );
  const units: Record<string, number> = {};
  orders.forEach(order =>
    order.line_items.forEach(item => {
      if (item.sku) units[item.sku] = (units[item.sku] ?? 0) + item.quantity;
    })
  );
  return Object.fromEntries(
    Object.entries(units).map(([sku, total]) => [sku, parseFloat((total / VELOCITY_DAYS).toFixed(1))])
  );
}

export async function GET() {
  const cfg = getShopifyConfig();
  if (!cfg) return NextResponse.json(NOT_CONFIGURED);

  try {
    const [{ products }, velocity] = await Promise.all([
      shopifyFetch<{ products: ShopifyProduct[] }>(cfg, 'products.json?fields=id,title,variants&limit=250'),
      fetchVelocity(cfg),
    ]);

    const supplement = loadSupplement();
    const defaultSupp: SkuSupp = { velocity_per_day: 1, lead_time_days: 21, reorder_qty: 500 };

    const skus = products.flatMap(product =>
      product.variants.map(variant => {
        const supp = supplement[variant.sku] ?? supplement[product.title] ?? defaultSupp;
        const variantLabel = product.variants.length > 1 && variant.title !== 'Default Title' ? ` ${variant.title}` : '';
        const vel = velocity[variant.sku] ?? supp.velocity_per_day;
        return {
          id: variant.sku || `shopify-${variant.id}`,
          name: `${product.title}${variantLabel}`,
          stock: variant.inventory_quantity,
          price: variant.price,
          velocity_per_day: vel > 0 ? vel : supp.velocity_per_day,
          lead_time_days: supp.lead_time_days,
          reorder_qty: supp.reorder_qty,
          velocity_source: velocity[variant.sku] != null ? 'shopify_orders' : 'supplement',
        };
      })
    );
    return NextResponse.json(skus);
  } catch (err) {
    console.error('Shopify SKU fetch failed:', err);
    return NextResponse.json({ error: 'shopify_unreachable' }, { status: 503 });
  }
}
