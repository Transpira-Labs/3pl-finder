/**
 * Store enrichment service — pulls data from multiple sources and uses
 * Claude AI to generate a sales-ready briefing for each store.
 *
 * Sources:
 * 1. Google Places reviews (already have API key)
 * 2. Store website content (if available)
 * 3. Apollo.io for owner contact info (optional, needs API key)
 * 4. OpenSOSData — Secretary of State business registry (optional)
 * 5. Openmart — owner phone/email lookup (optional)
 * 6. SalesHandy — owner phone/email via Lead Finder (optional)
 * 7. Claude AI to synthesize everything
 */

// ---------- Types ----------

export type EnrichmentResult = {
  // Owner info (merged from Apollo, OpenSOSData, Openmart)
  owner: {
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null; // MOST CRITICAL
    linkedin: string | null;
    source: string | null; // "OpenSOSData", "Openmart", "Apollo", etc.
  } | null;

  // AI-generated summary
  summary: {
    overview: string;
    productsCarried: string[];
    productsDetailed: { category: string; items: string[] }[]; // Grouped by category
    estimatedSize: string;
    estimatedRevenue: string;
    salesAngle: string;
    customerBase: string;
    ownerInsights: string | null; // Owner/manager mentions from reviews
  } | null;

  // Secretary of State data
  sosData: {
    officers: { name: string; title: string }[];
    registeredAgent: string | null;
    formationDate: string | null;
    entityType: string | null;
    status: string | null;
  } | null;

  // Raw data used for enrichment
  reviewSnippets: string[];
  websiteExcerpt: string | null;
  sources: string[];
};

// ---------- Google Reviews ----------

async function fetchGoogleReviews(
  placeId: string,
  apiKey: string,
): Promise<{ reviews: { text: string; rating: number; author: string }[]; editorialSummary: string | null }> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "reviews,editorialSummary",
      },
    },
  );
  if (!res.ok) return { reviews: [], editorialSummary: null };
  const data = await res.json();
  return {
    reviews: (data.reviews ?? []).map(
      (r: { text?: { text?: string }; rating?: number; authorAttribution?: { displayName?: string } }) => ({
        text: r.text?.text ?? "",
        rating: r.rating ?? 0,
        author: r.authorAttribution?.displayName ?? "Anonymous",
      }),
    ),
    editorialSummary: data.editorialSummary?.text ?? null,
  };
}

// ---------- Yelp Scrape ----------

interface YelpData {
  categories: string[];
  priceRange: string | null;
  about: string | null;
  highlights: string[];
  reviewSnippets: string[];
  yelpUrl: string | null;
}

async function fetchYelpData(
  storeName: string,
  storeAddress: string,
): Promise<YelpData | null> {
  try {
    // Extract city from address (e.g. "123 Main St, Atlanta, GA 30309" -> "Atlanta, GA")
    const cityMatch = storeAddress.match(/,\s*([^,]+,\s*[A-Z]{2})/);
    const city = cityMatch?.[1]?.trim() ?? "";
    if (!city) return null;

    // Search Yelp for the store
    const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(storeName)}&find_loc=${encodeURIComponent(city)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) return null;
    const searchHtml = await searchRes.text();

    // Find the first business link from search results
    const bizMatch = searchHtml.match(/href="(\/biz\/[^"?]+)/);
    if (!bizMatch) return null;
    const bizPath = bizMatch[1];
    const yelpUrl = `https://www.yelp.com${bizPath}`;

    // Fetch the business page
    const bizRes = await fetch(yelpUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!bizRes.ok) return null;
    const bizHtml = await bizRes.text();

    // Extract categories (e.g. "Latin American, Grocery, Bakery")
    const categories: string[] = [];
    const catMatches = bizHtml.match(/aria-label="[^"]*" href="\/search\?.*?">([^<]+)<\/a>/g);
    if (catMatches) {
      for (const m of catMatches.slice(0, 8)) {
        const text = m.match(/>([^<]+)<\/a>/)?.[1];
        if (text && text.length < 40 && !text.includes("Yelp") && !text.includes("search")) {
          categories.push(text.trim());
        }
      }
    }

    // Extract price range ($, $$, $$$)
    const priceMatch = bizHtml.match(/aria-label="Price range: ([^"]+)"/);
    const priceRange = priceMatch?.[1] ?? null;

    // Extract "About the Business" or description
    let about: string | null = null;
    const aboutMatch = bizHtml.match(/About the Business[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    if (aboutMatch) {
      about = aboutMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
    }

    // Extract highlights/amenities
    const highlights: string[] = [];
    const highlightMatches = bizHtml.match(/aria-label="[^"]*amenit[^"]*"[^>]*>([^<]+)/gi);
    if (highlightMatches) {
      for (const m of highlightMatches.slice(0, 5)) {
        const text = m.match(/>([^<]+)/)?.[1]?.trim();
        if (text) highlights.push(text);
      }
    }

    // Extract review snippets from the page
    const reviewSnippets: string[] = [];
    const reviewMatches = bizHtml.match(/<span[^>]*lang="en"[^>]*>([\s\S]*?)<\/span>/g);
    if (reviewMatches) {
      for (const m of reviewMatches.slice(0, 5)) {
        const text = m.replace(/<[^>]+>/g, "").trim();
        if (text.length > 30 && text.length < 500) {
          reviewSnippets.push(text);
        }
      }
    }

    return {
      categories: [...new Set(categories)],
      priceRange,
      about,
      highlights,
      reviewSnippets,
      yelpUrl,
    };
  } catch (err) {
    console.error("[enrichment] Yelp scrape error:", err);
    return null;
  }
}

// ---------- Website Scrape ----------

async function fetchWebsiteContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; 3PLFinderBot/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract text content — strip tags, scripts, styles
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000); // limit to ~3000 chars for AI context

    return cleaned || null;
  } catch {
    return null;
  }
}

// ---------- Apollo.io ----------

async function fetchApolloContact(
  companyName: string,
  location: string,
  apiKey: string,
): Promise<EnrichmentResult["owner"]> {
  try {
    const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        q_organization_name: companyName,
        organization_locations: [location],
        person_titles: ["owner", "manager", "president", "founder", "CEO", "proprietor"],
        page: 1,
        per_page: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const person = data.people?.[0];
    if (!person) return null;

    return {
      name: person.name ?? null,
      title: person.title ?? null,
      email: person.email ?? null,
      phone: person.phone_numbers?.[0]?.sanitized_number ?? null,
      linkedin: person.linkedin_url ?? null,
      source: "Apollo.io",
    };
  } catch {
    return null;
  }
}

// ---------- OpenSOSData (Secretary of State) ----------

async function fetchSOSData(
  businessName: string,
  storeAddress: string,
  apiKey: string,
): Promise<{ sosData: EnrichmentResult["sosData"]; owner: EnrichmentResult["owner"] }> {
  try {
    // Extract state abbreviation from address (e.g., "Atlanta, GA 30309" -> "GA")
    const stateMatch = storeAddress.match(/\b([A-Z]{2})\b\s*\d{5}/);
    const state = stateMatch?.[1];
    if (!state) return { sosData: null, owner: null };

    const res = await fetch(
      `https://api.opensosdata.com/v1/search?state=${encodeURIComponent(state)}&q=${encodeURIComponent(businessName)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return { sosData: null, owner: null };

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entity = data.results?.[0] ?? data.entities?.[0] ?? data[0];
    if (!entity) return { sosData: null, owner: null };

    const officers: { name: string; title: string }[] = (entity.officers ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (o: any) => ({
        name: o.name ?? "Unknown",
        title: o.title ?? "Officer",
      }),
    );

    const sosData: EnrichmentResult["sosData"] = {
      officers,
      registeredAgent: entity.registered_agent ?? entity.registeredAgent ?? null,
      formationDate: entity.formation_date ?? entity.formationDate ?? null,
      entityType: entity.entity_type ?? entity.entityType ?? null,
      status: entity.status ?? entity.entity_status ?? null,
    };

    // Extract owner from officers if available
    let owner: EnrichmentResult["owner"] = null;
    if (officers.length > 0) {
      const ownerOfficer = officers.find((o) =>
        /owner|president|ceo|founder|manager|member|organizer/i.test(o.title),
      ) ?? officers[0];

      owner = {
        name: ownerOfficer.name,
        title: ownerOfficer.title,
        email: null,
        phone: null,
        linkedin: null,
        source: "OpenSOSData",
      };
    }

    return { sosData, owner };
  } catch (err) {
    console.error("[enrichment] OpenSOSData error:", err);
    return { sosData: null, owner: null };
  }
}

// ---------- Openmart (Owner phone/email) ----------

async function fetchOpenmartData(
  storeName: string,
  storeAddress: string,
  apiKey: string,
): Promise<EnrichmentResult["owner"]> {
  try {
    const res = await fetch("https://api.openmart.ai/v2/enrich", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: storeName,
        address: storeAddress,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data) return null;

    return {
      name: data.owner_name ?? null,
      title: "Owner",
      email: data.owner_email ?? null,
      phone: data.owner_phone ?? null,
      linkedin: data.social_profiles?.linkedin ?? null,
      source: "Openmart",
    };
  } catch (err) {
    console.error("[enrichment] Openmart error:", err);
    return null;
  }
}

// ---------- SalesHandy Lead Finder ----------

async function fetchSalesHandyContact(
  companyName: string,
  storeAddress: string,
  apiKey: string,
): Promise<EnrichmentResult["owner"]> {
  try {
    // Extract location from address (e.g. "Atlanta, GA")
    const locationMatch = storeAddress.match(/,\s*([^,]+,\s*[A-Z]{2})/);
    const location = locationMatch?.[1]?.trim() ?? "";

    const res = await fetch("https://open-api.saleshandy.com/v1/search/people", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        company_name: { includes: [companyName] },
        management_level: { includes: ["Owner", "Founder", "C-Suite", "VP"] },
        ...(location ? { company_hq_location: { includes: [location] } } : {}),
        page: 1,
        limitPerCompany: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error("[enrichment] SalesHandy API error:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const people = data.payload?.data ?? data.payload?.leads ?? data.data ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const person = Array.isArray(people) ? people[0] : null;
    if (!person) return null;

    // Extract phone — SalesHandy may return it in various fields
    const phone =
      person.phone_number ??
      person.phone ??
      person.direct_phone ??
      person.mobile_phone ??
      (Array.isArray(person.phone_numbers) ? person.phone_numbers[0]?.number : null) ??
      null;

    const email =
      person.email ??
      person.work_email ??
      person.primary_email ??
      null;

    return {
      name: person.full_name ?? person.name ?? person.first_name
        ? `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim()
        : null,
      title: person.job_title ?? person.title ?? person.designation ?? null,
      email,
      phone,
      linkedin: person.linkedin_url ?? person.linkedin ?? null,
      source: "SalesHandy",
    };
  } catch (err) {
    console.error("[enrichment] SalesHandy error:", err);
    return null;
  }
}

// ---------- Claude AI Summary ----------

async function generateAISummary(opts: {
  storeName: string;
  storeAddress: string;
  storePhone: string | null;
  rating: number | null;
  ratingCount: number | null;
  reviews: { text: string; rating: number }[];
  websiteContent: string | null;
  ownerName: string | null;
  hours: string[] | null;
  editorialSummary: string | null;
  yelpData: YelpData | null;
  apiKey: string;
  locale?: string;
}): Promise<EnrichmentResult["summary"]> {
  const {
    storeName, storeAddress, storePhone, rating, ratingCount,
    reviews, websiteContent, ownerName, hours, editorialSummary,
    yelpData, apiKey, locale,
  } = opts;

  const isSpanish = locale === "es";

  const reviewText = reviews
    .map((r) => `[${r.rating}/5] "${r.text}"`)
    .join("\n");

  const langInstruction = isSpanish
    ? "IMPORTANT: Respond entirely in Spanish. All values in the JSON must be in Spanish."
    : "";

  const prompt = `You are a logistics intelligence analyst helping a company evaluate potential 3PL (third-party logistics) partners in the Atlanta area. Analyze the following company data and provide a structured briefing.

${langInstruction}

COMPANY DATA:
- Name: ${storeName}
- Address: ${storeAddress}
- Phone: ${storePhone ?? "Unknown"}
- Rating: ${rating ?? "N/A"}/5 (${ratingCount ?? 0} reviews)
- Contact: ${ownerName ?? "Unknown"}
- Hours: ${hours?.join(", ") ?? "Unknown"}

GOOGLE EDITORIAL SUMMARY:
${editorialSummary ?? "None available"}

GOOGLE REVIEWS:
${reviewText || "No reviews available"}

YELP DATA:
${yelpData ? `Categories: ${yelpData.categories.join(", ") || "N/A"}
Price Range: ${yelpData.priceRange ?? "N/A"}
About: ${yelpData.about ?? "N/A"}
Highlights: ${yelpData.highlights.join(", ") || "N/A"}
Yelp Reviews: ${yelpData.reviewSnippets.map((s) => `"${s}"`).join("\n") || "N/A"}` : "No Yelp data available"}

WEBSITE CONTENT:
${websiteContent ?? "No website found"}

Respond in this exact JSON format (no markdown, no code blocks):
{
  "overview": "2-3 sentence description of the 3PL — what services they offer, what size companies they serve, their specialties",
  "productsCarried": ["list of services they offer e.g. warehousing, fulfillment, freight, cold storage, etc."],
  "productsDetailed": [
    { "category": "Category Name", "items": ["specific services/capabilities"] }
  ],
  "estimatedSize": "Small/Medium/Large — based on reviews, location, online presence",
  "estimatedRevenue": "Rough annual revenue estimate based on size and signals",
  "salesAngle": "1-2 sentence summary of what makes this 3PL a good or bad fit — specialties, industries served, capacity, pricing model if mentioned",
  "customerBase": "Who uses this 3PL — what industries, company sizes, types of products they handle",
  "ownerInsights": "Any mentions of owners, managers, or key contacts in reviews. If none found, null"
}

IMPORTANT for productsDetailed: List specific services and capabilities. Group into categories like Warehousing, Fulfillment, Transportation, Cold Storage, Packaging, Returns/Reverse Logistics, Technology/WMS, Value-Added Services, etc.

IMPORTANT for ownerInsights: Look carefully through the reviews for ANY mention of an owner, manager, or specific employee by name. Include exact quotes where possible.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[enrichment] Claude API error:", res.status, errText);
      return null;
    }
    const data = await res.json();
    const text = data.content?.[0]?.text;
    if (!text) {
      console.error("[enrichment] No text in Claude response:", JSON.stringify(data));
      return null;
    }

    // Try to extract JSON from the response (may be wrapped in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[enrichment] No JSON found in Claude response:", text);
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);

    // Ensure productsDetailed exists and is properly structured
    if (!parsed.productsDetailed || !Array.isArray(parsed.productsDetailed)) {
      parsed.productsDetailed = [];
    }

    // Ensure ownerInsights is null if empty string
    if (parsed.ownerInsights === "" || parsed.ownerInsights === "null") {
      parsed.ownerInsights = null;
    }

    return parsed;
  } catch (err) {
    console.error("[enrichment] AI summary error:", err);
    return null;
  }
}

// ---------- Owner Merging ----------

/**
 * Merge owner data from multiple sources, preferring the one with the most
 * useful data (especially phone number).
 */
function mergeOwnerData(
  ...sources: (EnrichmentResult["owner"] | null)[]
): EnrichmentResult["owner"] {
  const filtered = sources.filter(Boolean) as NonNullable<EnrichmentResult["owner"]>[];
  if (filtered.length === 0) return null;

  // Prefer the source that has a phone number
  const withPhone = filtered.find((o) => o.phone);
  const base = withPhone ?? filtered[0];

  // Merge in missing fields from other sources
  const merged = { ...base };
  for (const src of filtered) {
    if (!merged.name && src.name) merged.name = src.name;
    if (!merged.title && src.title) merged.title = src.title;
    if (!merged.email && src.email) merged.email = src.email;
    if (!merged.phone && src.phone) {
      merged.phone = src.phone;
      merged.source = src.source; // Update source to the one providing the phone
    }
    if (!merged.linkedin && src.linkedin) merged.linkedin = src.linkedin;
  }

  // Build combined source string
  const sourceNames = [...new Set(filtered.map((s) => s.source).filter(Boolean))];
  if (sourceNames.length > 1) {
    merged.source = sourceNames.join(", ");
  }

  return merged;
}

// ---------- Main Enrichment Function ----------

export async function enrichStore(opts: {
  placeId: string;
  storeName: string;
  storeAddress: string;
  storePhone: string | null;
  rating: number | null;
  ratingCount: number | null;
  websiteUrl: string | null;
  hours: string[] | null;
  googleApiKey: string;
  apolloApiKey?: string;
  anthropicApiKey?: string;
  opensosApiKey?: string;
  openmartApiKey?: string;
  saleshandyApiKey?: string;
  locale?: string;
}): Promise<EnrichmentResult> {
  const sources: string[] = [];

  // 1. Google Reviews + Editorial Summary
  const googleData = await fetchGoogleReviews(opts.placeId, opts.googleApiKey);
  const reviews = googleData.reviews;
  const editorialSummary = googleData.editorialSummary;
  const reviewSnippets = reviews.map((r) => r.text).filter(Boolean);
  if (reviews.length > 0) sources.push("Google Reviews");
  if (editorialSummary) sources.push("Google Editorial");

  // 2. Yelp scrape (free, no API key needed)
  const yelpData = await fetchYelpData(opts.storeName, opts.storeAddress);
  if (yelpData && (yelpData.categories.length > 0 || yelpData.about || yelpData.reviewSnippets.length > 0)) {
    sources.push("Yelp");
    // Add Yelp review snippets to the main review list
    reviewSnippets.push(...yelpData.reviewSnippets);
  }

  // 3. Website content
  let websiteExcerpt: string | null = null;
  if (opts.websiteUrl) {
    websiteExcerpt = await fetchWebsiteContent(opts.websiteUrl);
    if (websiteExcerpt) sources.push("Website");
  }

  // 3. Apollo.io owner lookup (optional)
  let apolloOwner: EnrichmentResult["owner"] = null;
  if (opts.apolloApiKey) {
    const locationMatch = opts.storeAddress?.match(/,\s*([^,]+,\s*[A-Z]{2})/);
    const location = locationMatch?.[1] ?? "Georgia, US";
    apolloOwner = await fetchApolloContact(opts.storeName, location, opts.apolloApiKey);
    if (apolloOwner) sources.push("Apollo.io");
  }

  // 4. OpenSOSData — Secretary of State registry (optional)
  let sosData: EnrichmentResult["sosData"] = null;
  let sosOwner: EnrichmentResult["owner"] = null;
  if (opts.opensosApiKey) {
    const sosResult = await fetchSOSData(opts.storeName, opts.storeAddress, opts.opensosApiKey);
    sosData = sosResult.sosData;
    sosOwner = sosResult.owner;
    if (sosData) sources.push("OpenSOSData");
  }

  // 5. Openmart — owner phone/email (optional)
  let openmartOwner: EnrichmentResult["owner"] = null;
  if (opts.openmartApiKey) {
    openmartOwner = await fetchOpenmartData(opts.storeName, opts.storeAddress, opts.openmartApiKey);
    if (openmartOwner) sources.push("Openmart");
  }

  // 6. SalesHandy — owner phone/email via Lead Finder (optional)
  let saleshandyOwner: EnrichmentResult["owner"] = null;
  if (opts.saleshandyApiKey) {
    saleshandyOwner = await fetchSalesHandyContact(opts.storeName, opts.storeAddress, opts.saleshandyApiKey);
    if (saleshandyOwner) sources.push("SalesHandy");
  }

  // 7. Merge owner data — prioritize phone number
  const owner = mergeOwnerData(saleshandyOwner, openmartOwner, apolloOwner, sosOwner);

  // 7. AI Summary (needs Anthropic key)
  let summary: EnrichmentResult["summary"] = null;
  if (opts.anthropicApiKey) {
    summary = await generateAISummary({
      storeName: opts.storeName,
      storeAddress: opts.storeAddress,
      storePhone: opts.storePhone,
      rating: opts.rating,
      ratingCount: opts.ratingCount,
      reviews,
      websiteContent: websiteExcerpt,
      ownerName: owner?.name ?? null,
      hours: opts.hours,
      editorialSummary,
      yelpData,
      apiKey: opts.anthropicApiKey,
      locale: opts.locale,
    });
    if (summary) sources.push("AI Analysis");
  }

  return {
    owner,
    summary,
    sosData,
    reviewSnippets,
    websiteExcerpt,
    sources,
  };
}
