import { XMLParser } from "fast-xml-parser";
import he from "he";
import { prisma } from "./db";
import { detectCompetition } from "./leagues";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const SUBREDDIT_POSTS_RSS = "https://www.reddit.com/r/footballhighlights/new.rss";
const REDDIT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/xml, */*",
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
  const urlRegex = /(?:href=["'])?(https?:\/\/[^\s"'<>]+)/gi;
  const results: { url: string; domain: string; displayName: string; category: string }[] = [];

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(decoded)) !== null) {
    let rawUrl = match[1];
    rawUrl = rawUrl.replace(/[.,;:]+$/, "");

    if (
      rawUrl.includes("reddit.com") ||
      rawUrl.includes("redd.it") ||
      rawUrl.includes("preview.redd.it") ||
      rawUrl.includes("styles.redditmedia.com") ||
      rawUrl.includes("w3.org")
    ) {
      continue;
    }

    try {
      const parsed = new URL(rawUrl);
      const domain = parsed.hostname.replace(/^www\./, "");
      const index = match.index;
      const context = decoded.slice(Math.max(0, index - 80), Math.min(decoded.length, index + 80));
      const category = categorizeLink(context);

      results.push({
        url: rawUrl,
        domain,
        displayName: domain,
        category,
      });
    } catch {
      // Ignore invalid URLs
    }
  }

  return results;
}

export async function syncRedditHighlights() {
  // 1. Fetch recent match entries from RSS feed
  const postsRes = await fetch(SUBREDDIT_POSTS_RSS, { headers: REDDIT_HEADERS, cache: "no-store" });
  if (!postsRes.ok) throw new Error(`Posts RSS returned ${postsRes.status}`);

  const postsXml = await postsRes.text();
  const postsObj = parser.parse(postsXml);
  const postEntries = postsObj?.feed?.entry || [];
  const postList = Array.isArray(postEntries) ? postEntries : [postEntries];

  let processedCount = 0;
  const targetList = postList.slice(0, 15);

  for (const item of targetList) {
    if (!item.id || !item.title) continue;

    const redditId = String(item.id);
    const redditTitle = typeof item.title === "string" ? item.title : item.title["#text"] || "";
    const permalink = item.link?.["@_href"] || "";
    const publishedAt = item.published ? new Date(item.published) : new Date();
    const contentHtml = item.content?.["#text"] || item.content || "";

    const { title, homeTeam, awayTeam, competition } = cleanTitle(redditTitle);

    // Initial links from post selftext
    const foundLinks = extractAllUrls(contentHtml);

    // Fetch comments via Reddit JSON API instead of headless browser
    if (permalink) {
      try {
        const jsonUrl = permalink.replace(/\/$/, "") + ".json";
        const threadRes = await fetch(jsonUrl, { headers: REDDIT_HEADERS, cache: "no-store" });
        if (threadRes.ok) {
          const threadData = await threadRes.json();
          // threadData[1] contains the comment tree
          const comments = threadData[1]?.data?.children || [];
          for (const c of comments) {
            const bodyHtml = c.data?.body_html || "";
            const body = c.data?.body || "";
            if (bodyHtml) foundLinks.push(...extractAllUrls(bodyHtml));
            if (body) foundLinks.push(...extractAllUrls(body));
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch comments JSON for ${permalink}:`, err);
      }
    }

    // Deduplicate links
    const uniqueMap = new Map<string, (typeof foundLinks)[0]>();
    for (const link of foundLinks) {
      if (!uniqueMap.has(link.url)) {
        uniqueMap.set(link.url, link);
      }
    }
    const finalLinks = Array.from(uniqueMap.values());

    const existing = await prisma.matchPost.findUnique({
      where: { redditId },
      include: { links: true },
    });

    if (existing) {
      await prisma.matchPost.update({
        where: { id: existing.id },
        data: {
          cleanedTitle: title,
          competition,
          links: {
            deleteMany: {},
            create: finalLinks,
          },
        },
      });
    } else {
      await prisma.matchPost.create({
        data: {
          redditId,
          redditTitle,
          cleanedTitle: title,
          homeTeam,
          awayTeam,
          competition,
          permalink,
          selftextRaw: contentHtml,
          publishedAt,
          links: {
            create: finalLinks,
          },
        },
      });
    }

    processedCount++;
  }

  return { processedCount, totalChecked: targetList.length };
}
