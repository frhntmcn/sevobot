import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const isBot = searchParams.get('bot') === 'true';

  // 0 or 1
  const isHeads = Math.random() > 0.5;
  const result = isHeads ? "Yazı" : "Tura";

  if (isBot) {
    return new Response(`${result} geldi! 🪙`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  return NextResponse.json({
    result
  });
}
