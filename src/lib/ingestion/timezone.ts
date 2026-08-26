/**
 * NANP area-code → IANA timezone derivation.
 *
 * Used when a lead row has no explicit timezone so the calling-hours gate (8:00–
 * 21:00 called-party local, spec §6) can still function. This is a best-effort
 * map of US/Canada area codes; area codes not listed return null (the row is
 * still importable, but the later calling-hours gate must treat unknown-tz
 * conservatively). Area codes that straddle timezones are assigned their
 * predominant zone.
 */

const ZONE_AREA_CODES: Record<string, string[]> = {
  "America/New_York": [
    // Eastern
    "201","202","203","207","212","215","216","220","223","234","239","240","272",
    "276","301","302","304","305","315","321","326","330","332","339","347","351",
    "352","364","386","401","404","407","410","412","413","419","434","440","443",
    "445","470","475","478","484","508","513","516","517","518","540","551","561",
    "567","570","571","585","607","609","610","614","617","631","646","660","667",
    "678","680","681","689","703","704","706","716","717","718","724","727","732",
    "740","743","754","757","762","770","772","774","781","786","802","803","804",
    "810","813","814","828","835","843","845","848","856","857","860","862","863",
    "864","865","878","904","908","910","912","914","917","919","929","937","941",
    "947","954","959","978","980","984",
  ],
  "America/Chicago": [
    // Central
    "205","210","214","217","224","225","228","251","254","256","262","270","281",
    "309","312","314","316","318","319","320","331","334","337","346","361","363",
    "402","405","409","414","417","430","432","447","469","479","501","502","504",
    "507","512","515","531","539","563","573","580","601","608","612","615","618",
    "620","630","636","641","651","659","662","682","708","713","715","737",
    "769","773","779","785","806","815","816","817","830","832","847","870","872",
    "901","903","913","918","920","931","936","940","952","956","972","979",
  ],
  "America/Denver": [
    // Mountain
    "208","303","307","385","406","435","505","575","719","720","801","915","970","986",
  ],
  "America/Phoenix": [
    // Arizona (no DST)
    "480","520","602","623","928",
  ],
  "America/Los_Angeles": [
    // Pacific (CA, NV, OR, WA)
    "206","209","213","253","279","310","323","341","350","360","408","415","424",
    "425","442","458","503","509","510","530","541","559","562","564","619","626",
    "628","650","657","661","669","702","707","714","725","747","760","775","805",
    "818","820","831","840","858","909","916","925","949","951","971",
  ],
  "America/Anchorage": ["907"],
  "Pacific/Honolulu": ["808"],
};

// Build a flat lookup once at module load.
const AREA_CODE_TO_ZONE: Record<string, string> = {};
for (const [zone, codes] of Object.entries(ZONE_AREA_CODES)) {
  for (const code of codes) {
    // First assignment wins; a handful of codes appear in two lists due to
    // splits/overlays — the earlier (predominant) zone is kept intentionally.
    if (!AREA_CODE_TO_ZONE[code]) AREA_CODE_TO_ZONE[code] = zone;
  }
}

/** Returns an IANA timezone for a 3-digit NANP area code, or null if unknown. */
export function timezoneForAreaCode(areaCode: string): string | null {
  return AREA_CODE_TO_ZONE[areaCode] ?? null;
}
