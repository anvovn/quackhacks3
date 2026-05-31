import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getShopifyConfig, shopifyFetch, NOT_CONFIGURED } from '@/lib/shopify';

interface ShopifyVariant { id: number; sku: string; title: string; inventory_quantity: number }
interface ShopifyProduct { id: number; title: string; variants: ShopifyVariant[] }
interface SkuSupp { velocity_per_day: number; lead_time_days: number; supplier_name: string; reorder_qty: number }

function loadSupplement(): Record<string, SkuSupp> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'data', 'sku-supplement.json'), 'utf-8'));
  } catch { return {}; }
}

export async function GET() {
  const cfg = getShopifyConfig();
  if (!cfg) return NextResponse.json(NOT_CONFIGURED);

  try {
    const { products } = await shopifyFetch<{ products: ShopifyProduct[] }>(
      cfg, 'products.json?fields=id,title,variants&limit=250'
    );
    const supplement = loadSupplement();
    const defaultSupp: SkuSupp = { velocity_per_day: 30, lead_time_days: 21, supplier_name: 'Shopify Store', reorder_qty: 500 };

    const skus = products.flatMap(product =>
      product.variants.map(variant => {
        const supp = supplement[variant.sku] ?? supplement[product.title] ?? defaultSupp;
        const variantLabel = product.variants.length > 1 && variant.title !== 'Default Title' ? ` ${variant.title}` : '';
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
    return NextResponse.json(skus);
  } catch (err) {
    console.error('Shopify SKU fetch failed:', err);
    return NextResponse.json({ error: 'shopify_unreachable' }, { status: 503 });
  }
}
