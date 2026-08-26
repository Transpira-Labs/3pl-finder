import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * Twilio cost/usage snapshot for the dashboard. Pulls the account balance and
 * all-time usage records (per category) straight from Twilio's REST API using
 * the server-held credentials. Note: Twilio usage aggregation can lag a few
 * minutes behind live calls; the account balance updates faster.
 */
export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  if (!SID || !TOKEN) {
    return Response.json({ configured: false });
  }

  const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  const base = `https://api.twilio.com/2010-04-01/Accounts/${SID}`;
  const num = (s: string | null | undefined) => Math.abs(parseFloat(s ?? "0")) || 0;

  try {
    const [balRes, usageRes, callsRes] = await Promise.all([
      fetch(`${base}/Balance.json`, { headers: { Authorization: auth } }),
      fetch(`${base}/Usage/Records/AllTime.json?PageSize=100`, { headers: { Authorization: auth } }),
      fetch(`${base}/Calls.json?PageSize=15`, { headers: { Authorization: auth } }),
    ]);
    const bal = (await balRes.json()) as { balance?: string; currency?: string };
    const usage = (await usageRes.json()) as {
      usage_records?: { category: string; price: string; count: string; price_unit: string }[];
    };
    const callsData = (await callsRes.json()) as {
      calls?: { to: string; status: string; duration: string; price: string | null; price_unit: string | null; start_time: string }[];
    };

    const records = usage.usage_records ?? [];
    const pick = (cat: string) => records.find((r) => r.category === cat);
    const voice = pick("calls");
    // Rep-initiated calls are dialed from the browser softphone, so the client
    // (WebRTC) leg is billed separately from the outbound PSTN leg.
    const client = pick("calls-client");
    const totalSpent = records.reduce((s, r) => s + num(r.price), 0);
    const currency = bal.currency ?? voice?.price_unit ?? "USD";

    const calls = (callsData.calls ?? []).map((c) => ({
      to: c.to,
      status: c.status,
      duration: c.duration ? parseInt(c.duration) : 0,
      price: c.price != null ? num(c.price) : null,
      startTime: c.start_time,
    }));

    return Response.json({
      configured: true,
      currency,
      balance: bal.balance != null ? parseFloat(bal.balance) : null,
      totalSpent,
      voiceSpent: num(voice?.price),
      voiceCount: voice ? parseInt(voice.count) : 0,
      clientSpent: num(client?.price),
      clientCount: client ? parseInt(client.count) : 0,
      calls,
    });
  } catch {
    return Response.json({ configured: true, error: "Could not reach Twilio for cost data." }, { status: 502 });
  }
}
