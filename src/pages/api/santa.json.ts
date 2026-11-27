import type { APIRoute } from 'astro';
import { santaAt } from '../../lib/santa';

export const GET: APIRoute = ({ url }) => {
  const t = Number(url.searchParams.get('t'));
  const date = Number.isFinite(t) && t > 0 ? new Date(t) : new Date();
  return new Response(JSON.stringify(santaAt(date)), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
