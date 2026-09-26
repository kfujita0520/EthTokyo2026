import { listInvoices } from "@/lib/multibaas";

export async function GET(request: Request) {
  const payer = new URL(request.url).searchParams.get("payer");
  try {
    const invoices = await listInvoices(payer);
    return Response.json({ invoices });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
