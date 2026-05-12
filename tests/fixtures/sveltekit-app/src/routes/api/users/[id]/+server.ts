export async function GET({ params }) {
  return new Response(JSON.stringify({ id: params.id }));
}

export async function PUT({ params, request }) {
  return new Response(JSON.stringify({ updated: true }));
}
