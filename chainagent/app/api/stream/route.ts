// app/api/stream/route.ts
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';

export async function GET() {
    const upstream = await fetch(`${BACKEND_URL}/stream`)
    return new Response(upstream.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache"
        }
    })
}