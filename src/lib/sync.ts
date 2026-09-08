import he from "he";
import { prisma } from "./db";
import { detectCompetition } from "./leagues";

const SUBREDDIT_JSON = "https://old.reddit.com/r/footballhighlights/new.json?limit=25";
const REDDIT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
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
  const res = await fetch(SUBREDDIT_JSON, { headers: REDDIT_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`Reddit JSON returned ${res.status}`);

  const data = await res.json();
  const children = data?.data?.children || [];

  let processedCount = 0;

  for (const child of children) {
    const post = child.data;
    if (!post || !post.id || !post.title) continue;

    const redditId = post.name || `t3_${post.id}`;
    const redditTitle = post.title;
    const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : "";
    const publishedAt = new Date(post.created_utc * 1000);
    const selftext = post.selftext || "";

    const { title, homeTeam, awayTeam, competition } = cleanTitle(redditTitle);

    // Links from post selftext
    const foundLinks = extractAllUrls(selftext);

    // Fetch comments via thread JSON
    if (permalink) {
      try {
        const jsonUrl = `https://www.reddit.com${post.permalink.replace(/\/$/, "")}.json`;
        const threadRes = await fetch(jsonUrl, { headers: REDDIT_HEADERS, cache: "no-store" });
        if (threadRes.ok) {
          const threadData = await threadRes.json();
          const comments = threadData[1]?.data?.children || [];
          for (const c of comments) {
            const body = c.data?.body || "";
            if (body) foundLinks.push(...extractAllUrls(body));
          }
        }
      } catch (err) {
        console.warn(`Comment fetch failed for ${redditId}:`, err);
      }
    }

    // Deduplicate
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
          selftextRaw: selftext,
          publishedAt,
          links: {
            create: finalLinks,
          },
        },
      });
    }

    processedCount++;
  }

  return { processedCount, totalChecked: children.length };
}
