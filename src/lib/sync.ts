import { XMLParser } from "fast-xml-parser";
import he from "he";
import { prisma } from "./db";
import { detectCompetition } from "./leagues";

const RSS_URL = "https://www.reddit.com/r/footballhighlights/new/.rss";
const REDDIT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function cleanTitle(rawTitle: string) {
  const competition = detectCompetition(rawTitle);
  let cleaned = rawTitle.replace(/\[.*?\]|\(.*?\)/g, "").trim();

  const vsMatch = cleaned.match(/(.+?)\s+(?:vs\.?|v|-)\s+(.+)/i);
  if (vsMatch) {
    const homeTeam = vsMatch[1].trim();
    const awayParts = vsMatch[2].split(/\s+-\s+|\s{2,}/);
    const awayTeam = awayParts[0].trim();

    return {
      title: `${homeTeam} vs ${awayTeam}`,
      homeTeam,
      awayTeam,
      competition,
    };
  }

  return { title: cleaned, competition };
}

function categorizeLink(surroundingText: string): string {
  const lower = surroundingText.toLowerCase();
  if (
    lower.includes("full match") ||
    lower.includes("full game") ||
    lower.includes("1st half") ||
    lower.includes("first half") ||
    lower.includes("2nd half") ||
    lower.includes("second half")
  ) {
    return "FULL_MATCH";
  }
  return "HIGHLIGHTS";
}

function extractAllUrls(rawText: string): { url: string; domain: string; displayName: string; category: string }[] {
  if (!rawText) return [];

  const decoded = he.decode(rawText);
  const results: { url: string; domain: string; displayName: string; category: string }[] = [];
  const seen = new Set<string>();

  // Extract from HTML anchor tags: <a href="url">text</a>
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(decoded)) !== null) {
    const url = match[1].trim();
    const anchorText = match[2].replace(/<[^>]+>/g, "").trim();

    if (!url.startsWith("http")) continue;
    if (url.includes("reddit.com") || url.includes("redd.it")) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    let domain = "";
    try {
      domain = new URL(url).hostname.replace("www.", "");
    } catch {
      continue;
    }

    const category = categorizeLink(anchorText + " " + decoded.substring(Math.max(0, match.index - 50), match.index));
    results.push({
      url,
      domain,
      displayName: anchorText || domain,
      category,
    });
  }

  // Fallback for raw URLs
  const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
  while ((match = urlRegex.exec(decoded)) !== null) {
    const url = match[1].trim();
    if (url.includes("reddit.com") || url.includes("redd.it")) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    let domain = "";
    try {
      domain = new URL(url).hostname.replace("www.", "");
    } catch {
      continue;
    }

    const context = decoded.substring(Math.max(0, match.index - 40), match.index + url.length + 40);
    results.push({
      url,
      domain,
      displayName: domain,
      category: categorizeLink(context),
    });
  }

  return results;
}

export async function syncRedditHighlights() {
  const res = await fetch(RSS_URL, {
    headers: REDDIT_HEADERS,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Reddit RSS returned status ${res.status}`);
  }

  const xmlData = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xmlData);

  const entries = parsed?.feed?.entry;
  if (!entries || !Array.isArray(entries)) {
    return { syncedCount: 0, message: "No entries found in RSS feed" };
  }

  let count = 0;

  for (const entry of entries) {
    const redditId = entry.id || "";
    const rawTitle = entry.title || "";
    const rawContent = typeof entry.content === "object" ? entry.content["#text"] : entry.content || "";
    const permalink = Array.isArray(entry.link) ? entry.link[0]?.["@_href"] : entry.link?.["@_href"] || "";

    if (!redditId || !rawTitle) continue;
    if (rawTitle.toLowerCase().startsWith("request")) continue; // Skip request posts

    const { title: cleanedTitle, homeTeam, awayTeam, competition } = cleanTitle(rawTitle);
    const links = extractAllUrls(rawContent);

    const post = await prisma.matchPost.upsert({
      where: { redditId },
      create: {
        redditId,
        redditTitle: rawTitle,
        cleanedTitle,
        homeTeam,
        awayTeam,
        competition: competition || "Other",
        permalink,
      },
      update: {
        cleanedTitle,
        homeTeam,
        awayTeam,
        competition: competition || "Other",
        permalink,
      },
    });

    // Delete existing links and recreate
    await prisma.linkItem.deleteMany({ where: { matchPostId: post.id } });

    for (const link of links) {
      await prisma.linkItem.create({
        data: {
          url: link.url,
          domain: link.domain,
          displayName: link.displayName,
          category: link.category,
          matchPostId: post.id,
        },
      });
    }

    count++;
  }

  return { syncedCount: count };
}
