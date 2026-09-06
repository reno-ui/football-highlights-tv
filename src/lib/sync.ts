import { XMLParser } from "fast-xml-parser";
import puppeteer from "puppeteer-core";
import he from "he";
import { prisma } from "./db";
import { detectCompetition } from "./leagues";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const SUBREDDIT_POSTS_RSS = "https://www.reddit.com/r/footballhighlights/new.rss";
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const RSS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/atom+xml,application/xml,text/xml",
};

function categorizeLink(surroundingText: string): string {
  const lower = surroundingText.toLowerCase();
  if (
    lower.includes("full match") ||
    lower.includes("full game") ||
    lower.includes("1st half") ||
    lower.includes("2nd half") ||
    lower.includes("first half") ||
    lower.includes("second half")
  ) {
    return "FULL_MATCH";
  }
  if (lower.includes("extended")) {
    return "EXTENDED_HIGHLIGHTS";
  }
  if (
    lower.includes("highlight") ||
    lower.includes("goals") ||
    lower.includes("replay")
  ) {
    return "HIGHLIGHTS";
  }
  return "OTHER";
}

function cleanTitle(rawTitle: string): {
  title: string;
  homeTeam?: string;
  awayTeam?: string;
  competition: string;
} {
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

function extractAllUrls(rawText: string): { url: string; domain: string; displayName: string; category: string }[] {
  if (!rawText) return [];

  const decoded = he.decode(rawText);
  const urlRegex = /(?:href=["'])?(https?:\/\/[^\s"'<>)]+)/gi;
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
  const postsRes = await fetch(SUBREDDIT_POSTS_RSS, { headers: RSS_HEADERS, cache: "no-store" });
  if (!postsRes.ok) throw new Error(`Posts RSS returned ${postsRes.status}`);

  const postsXml = await postsRes.text();
  const postsObj = parser.parse(postsXml);
  const postEntries = postsObj?.feed?.entry || [];
  const postList = Array.isArray(postEntries) ? postEntries : [postEntries];

  // 2. Launch headless Chrome instance
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
  );

  let processedCount = 0;

  // Process the top 15 most recent fixtures
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

    // 3. Render post in headless Chrome to grab comments
    if (permalink) {
      try {
        await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 12000 });
        const renderedHtml = await page.content();
        const commentLinks = extractAllUrls(renderedHtml);
        foundLinks.push(...commentLinks);
      } catch (err) {
        console.warn(`Headless browser render timeout on ${permalink}`);
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

  await browser.close();
  return { processedCount, totalChecked: targetList.length };
}
