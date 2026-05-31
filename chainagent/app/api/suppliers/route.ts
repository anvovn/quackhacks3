import { NextResponse } from 'next/server';
import { getShopifyConfig, shopifyFetch, NOT_CONFIGURED } from '@/lib/shopify';

interface ShopifyProduct { id: number; vendor: string; title: string }

export async function GET() {
  const cfg = getShopifyConfig();
  if (!cfg) return NextResponse.json(NOT_CONFIGURED);

  try {
    const { products } = await shopifyFetch<{ products: ShopifyProduct[] }>(
      cfg, 'products.json?fields=id,vendor,title&limit=250'
    );

    const vendorMap = new Map<string, number>();
    products.forEach(p => {
      const v = p.vendor?.trim();
      if (v) vendorMap.set(v, (vendorMap.get(v) || 0) + 1);
    });

    const suppliers = Array.from(vendorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, skuCount], i) => ({
        id: `VEN-${i + 1}`,
        name,
        skuCount,
        active: true,
        source: 'shopify' as const,
      }));

    return NextResponse.json(suppliers);
  } catch (err) {
    console.error('Shopify suppliers fetch failed:', err);
    return NextResponse.json({ error: 'shopify_unreachable' }, { status: 503 });
  }
}
