import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
  return json({ items: [] });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  return json({ created: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
  return json({ deleted: true });
};
