import { NextResponse } from 'next/server';
import { getShopifyConfig, shopifyFetch, NOT_CONFIGURED } from '@/lib/shopify';

interface ShopifyFulfillment { created_at: string }
interface ShopifyOrder {
  id: number;
  billing_address?: { country: string; country_code: string };
  created_at: string;
  fulfillments: ShopifyFulfillment[];
}

const COUNTRY_FLAGS: Record<string, string> = {
  US:'🇺🇸', GB:'🇬🇧', AU:'🇦🇺', DE:'🇩🇪', CA:'🇨🇦', NL:'🇳🇱',
  FR:'🇫🇷', JP:'🇯🇵', AE:'🇦🇪', SG:'🇸🇬', NZ:'🇳🇿', IE:'🇮🇪',
  SE:'🇸🇪', NO:'🇳🇴', DK:'🇩🇰', CH:'🇨🇭', AT:'🇦🇹', IT:'🇮🇹',
  ES:'🇪🇸', PT:'🇵🇹', BR:'🇧🇷', MX:'🇲🇽', KR:'🇰🇷', IN:'🇮🇳',
};

export async function GET() {
  const cfg = getShopifyConfig();
  if (!cfg) return NextResponse.json(NOT_CONFIGURED);

  try {
    const { orders } = await shopifyFetch<{ orders: ShopifyOrder[] }>(
      cfg,
      'orders.json?status=any&limit=250&fields=id,billing_address,created_at,fulfillments'
    );

    const map = new Map<string, { total: number; fulfilledDays: number[]; code: string }>();

    orders.forEach(order => {
      const country = order.billing_address?.country || 'Unknown';
      const code = order.billing_address?.country_code || '';
      if (!map.has(country)) map.set(country, { total: 0, fulfilledDays: [], code });
      const entry = map.get(country)!;
      entry.total++;
      if (order.fulfillments?.length > 0) {
        const days = (new Date(order.fulfillments[0].created_at).getTime() - new Date(order.created_at).getTime()) / 86400000;
        if (days >= 0 && days <= 60) entry.fulfilledDays.push(days);
      }
    });

    const result = Array.from(map.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 20)
      .map(([country, d]) => ({
        flag: COUNTRY_FLAGS[d.code] || '🌐',
        name: country,
        days: d.fulfilledDays.length > 0
          ? (d.fulfilledDays.reduce((s, v) => s + v, 0) / d.fulfilledDays.length).toFixed(1)
          : '—',
        pct: d.total > 0
          ? Math.round((d.fulfilledDays.filter(v => v <= 5).length / d.total) * 100)
          : 0,
        orders: d.total.toLocaleString(),
      }));

    return NextResponse.json(result);
  } catch (err) {
    console.error('Shopify delivery fetch failed:', err);
    return NextResponse.json({ error: 'shopify_unreachable' }, { status: 503 });
  }
}
