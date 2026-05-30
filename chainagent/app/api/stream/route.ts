// app/api/stream/route.ts
export const dynamic = 'force-dynamic';

export async function GET() {
    const upstream = await fetch("http://localhost:8000/stream")
    return new Response(upstream.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache"
        }
    })
}