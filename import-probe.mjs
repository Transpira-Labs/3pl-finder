import { config } from "dotenv";
config({ path: ".env.local" }); config();
const { importSheetLeads } = await import("./src/lib/ingestion/sheet-source.ts");
const { getLeadSheetConfig } = await import("./src/lib/settings.ts");
const cfg = await getLeadSheetConfig();
console.log("config:", cfg);
try {
  const res = await importSheetLeads({ sheetUrl: cfg.sheetUrl, tab: cfg.tab ?? undefined, campaignId: cfg.campaignId ?? undefined, uploadedBy: "probe" });
  console.log("RESULT:", res);
} catch (e) {
  console.log("STACK:\n", e?.stack ?? e);
}
