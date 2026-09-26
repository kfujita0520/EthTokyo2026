import { listAcceptedTokenAddresses } from "@/lib/multibaas";

export async function GET() {
  try {
    const tokens = await listAcceptedTokenAddresses();
    return Response.json({ tokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
