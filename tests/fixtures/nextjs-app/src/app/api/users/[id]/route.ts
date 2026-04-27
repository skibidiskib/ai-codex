export async function GET(request: Request) {
  return Response.json({ id: 1 });
}

export async function PUT(request: Request) {
  return Response.json({ updated: true });
}
