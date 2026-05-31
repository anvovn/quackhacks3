import { NextResponse } from 'next/server';
import { getShopifyConfig, shopifyFetch, NOT_CONFIGURED } from '@/lib/shopify';

interface ShopifyLineItem { title: string; quantity: number; sku: string }
interface ShopifyOrder {
  id: number; name: string; email: string;
  customer?: { first_name: string; last_name: string };
  line_items: ShopifyLineItem[];
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
  shipping_address?: { city: string; country: string; country_code: string };
  total_price: string; currency: string;
}

export async function GET() {
  const cfg = getShopifyConfig();
  if (!cfg) return NextResponse.json(NOT_CONFIGURED);

  try {
    const { orders } = await shopifyFetch<{ orders: ShopifyOrder[] }>(
      cfg,
      'orders.json?status=any&limit=50&order=created_at+desc&fields=id,name,email,customer,line_items,financial_status,fulfillment_status,created_at,shipping_address,total_price,currency'
    );

    const formatted = orders.map(order => ({
      id: order.name,
      customer: order.customer
        ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
        : order.email || 'Guest',
      email: order.email || '',
      sku: order.line_items[0]?.title || '—',
      skuCode: order.line_items[0]?.sku || '—',
      qty: order.line_items.reduce((s, i) => s + i.quantity, 0),
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      date: new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      dest: order.shipping_address?.city || order.shipping_address?.country || '—',
      total: `${order.currency} ${parseFloat(order.total_price).toFixed(2)}`,
    }));

    return NextResponse.json(formatted);
  } catch (err) {
    console.error('Shopify orders fetch failed:', err);
    return NextResponse.json({ error: 'shopify_unreachable' }, { status: 503 });
  }
}
