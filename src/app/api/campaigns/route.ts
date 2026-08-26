import { z } from "zod";
import { createCampaign, listCampaigns } from "@/lib/campaigns/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;
  return Response.json({ campaigns: await listCampaigns() });
}

const createSchema = z.object({
  name: z.string().min(1),
  overdialRatio: z.string().optional(),
  callingHoursStart: z.number().int().min(0).max(23).optional(),
  callingHoursEnd: z.number().int().min(1).max(24).optional(),
});

export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const campaign = await createCampaign({
    ...parsed.data,
    status: "active",
  });
  return Response.json({ campaign });
}
