import { assignEligibleLeads } from "@/lib/campaigns/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/** Pull unassigned dial-eligible leads into this campaign. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const assigned = await assignEligibleLeads(id);
  return Response.json({ assigned });
}
