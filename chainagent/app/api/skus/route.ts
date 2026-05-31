import { NextResponse } from 'next/server';
import { getShopifyConfig, shopifyFetch, NOT_CONFIGURED } from '@/lib/shopify';

interface ShopifyVariant {
  id: number; sku: string; title: string;
  inventory_quantity: number; price: string;
}
interface ShopifyProduct { id: number; title: string; variants: ShopifyVariant[] }
interface ShopifyLineItem { sku: string; quantity: number }
interface ShopifyOrder { line_items: ShopifyLineItem[] }

const VELOCITY_DAYS = 30

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

    const skus = products.flatMap(product =>
      product.variants.map(variant => {
        const variantLabel = product.variants.length > 1 && variant.title !== 'Default Title' ? ` ${variant.title}` : '';
        const vel = velocity[variant.sku] ?? null;
        return {
          id: variant.sku || `shopify-${variant.id}`,
          name: `${product.title}${variantLabel}`,
          stock: variant.inventory_quantity,
          price: variant.price,
          velocity_per_day: vel,
          velocity_source: vel != null ? 'shopify_orders' : 'no_data',
        };
      })
    );
    return NextResponse.json(skus);
  } catch (err) {
    console.error('Shopify SKU fetch failed:', err);
    return NextResponse.json({ error: 'shopify_unreachable' }, { status: 503 });
  }
}
