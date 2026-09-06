export const COMPETITION_RULES: { name: string; keywords: string[] }[] = [
  {
    name: "Premier League",
    keywords: [
      "premier league", "epl", "arsenal", "aston villa", "bournemouth", "brentford",
      "brighton", "chelsea", "crystal palace", "everton", "fulham", "ipswich",
      "leicester", "liverpool", "manchester city", "man city", "manchester united",
      "man utd", "newcastle", "nottingham forest", "southampton", "tottenham",
      "spurs", "west ham", "wolves", "wolverhampton"
    ],
  },
  {
    name: "Champions League",
    keywords: ["champions league", "ucl"],
  },
  {
    name: "Europa League",
    keywords: ["europa league", "uel", "conference league", "uecl"],
  },
  {
    name: "La Liga",
    keywords: [
      "la liga", "laliga", "real madrid", "barcelona", "atletico madrid",
      "athletic club", "athletic bilbao", "sevilla", "valencia", "villarreal",
      "real sociedad", "betis", "girona"
    ],
  },
  {
    name: "Serie A",
    keywords: [
      "serie a", "juventus", "inter milan", "ac milan", "napoli", "roma",
      "lazio", "atalanta", "fiorentina", "bologna", "torino"
    ],
  },
  {
    name: "Bundesliga",
    keywords: [
      "bundesliga", "bayern munich", "dortmund", "borussia dortmund",
      "leverkusen", "bayer leverkusen", "rb leipzig", "stuttgart", "eintracht frankfurt"
    ],
  },
  {
    name: "International Football",
    keywords: [
      "nations league", "world cup", "euro 202", "copa america", "afcon",
      "international friendly", "qualifier"
    ],
  },
];

export function detectCompetition(title: string): string {
  const lower = title.toLowerCase();

  for (const comp of COMPETITION_RULES) {
    for (const kw of comp.keywords) {
      // Look for whole word or boundary match
      const regex = new RegExp(`\\b${kw}\\b`, "i");
      if (regex.test(lower)) {
        return comp.name;
      }
    }
  }

  return "Other Football";
}
