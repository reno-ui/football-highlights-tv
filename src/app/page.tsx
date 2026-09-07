"use client";
export const dynamic = "force-dynamic";


import { useEffect, useState, useRef, useCallback } from "react";

interface LinkItem {
  id: string;
  url: string;
  domain: string;
  category: string;
}

interface MatchPost {
  id: string;
  redditId: string;
  redditTitle: string;
  cleanedTitle: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  thumbnailUrl: string | null;
  permalink: string;
  links: LinkItem[];
}

const CATEGORIES = [
  "All",
  "Premier League",
  "UCL",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Other",
];

function matchesCategory(competition: string | null | undefined, selected: string): boolean {
  if (selected === "All") return true;
  const comp = (competition || "").toLowerCase();
  const target = selected.toLowerCase();

  if (target === "premier league") {
    return comp.includes("premier") || comp.includes("epl");
  }
  if (target === "ucl") {
    return comp.includes("champions") || comp.includes("ucl");
  }
  if (target === "la liga") {
    return comp.includes("la liga") || comp.includes("laliga");
  }
  if (target === "serie a") {
    return comp.includes("serie");
  }
  if (target === "bundesliga") {
    return comp.includes("bundesliga");
  }
  if (target === "other") {
    return !["premier", "epl", "champions", "ucl", "la liga", "laliga", "serie", "bundesliga"].some((k) =>
      comp.includes(k)
    );
  }
  return comp.includes(target);
}

export default function TVDashboard() {
  const [matches, setMatches] = useState<MatchPost[]>([]);
  const [activeZone, setActiveZone] = useState<"categories" | "matches" | "drawer">("matches");
  const [categoryIndex, setCategoryIndex] = useState(0); // CATEGORIES.length = "Sync" button
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeMatch, setActiveMatch] = useState<MatchPost | null>(null);
  const [focusedLinkIndex, setFocusedLinkIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const catRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const syncBtnRef = useRef<HTMLButtonElement | null>(null);

  const fetchMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/matches", { cache: "no-store" });
      const data = await res.json();
      setMatches(Array.isArray(data) ? data : data?.matches || []);
    } catch {
      // Ignore network errors
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await fetch("/api/sync", { cache: "no-store" });
      await fetchMatches();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }, [syncing, fetchMatches]);

  // Initial load: Fetch fixtures + trigger background auto-sync so TV always has latest data
  useEffect(() => {
    fetchMatches();
    // Auto-sync in background on open
    fetch("/api/sync", { cache: "no-store" })
      .then(() => fetchMatches())
      .catch(() => {});
  }, [fetchMatches]);

  const selectedCategory = CATEGORIES[categoryIndex] || "All";
  const filteredMatches = matches.filter((m) => matchesCategory(m.competition, selectedCategory));

  // Focus and scroll categories / sync button
  useEffect(() => {
    if (activeZone === "categories") {
      if (categoryIndex === CATEGORIES.length) {
        syncBtnRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        syncBtnRef.current?.focus();
      } else {
        const btn = catRefs.current[categoryIndex];
        if (btn) {
          btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          btn.focus();
        }
      }
    }
  }, [categoryIndex, activeZone]);

  // Focus and scroll match cards
  useEffect(() => {
    if (activeZone === "matches") {
      const el = cardRefs.current[focusedIndex];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        el.focus();
      }
    }
  }, [focusedIndex, activeZone, categoryIndex]);

  // Focus and scroll drawer links
  useEffect(() => {
    if (activeZone === "drawer" && activeMatch) {
      const linkEl = linkRefs.current[focusedLinkIndex];
      if (linkEl) {
        linkEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        linkEl.focus();
      }
    }
  }, [focusedLinkIndex, activeZone, activeMatch]);

  // Unified Remote D-Pad Navigation Controller
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. In Drawer Mode
      if (activeZone === "drawer") {
        const totalLinks = activeMatch?.links?.length || 0;
        if (e.key === "ArrowDown" || e.key === "s") {
          e.preventDefault();
          setFocusedLinkIndex((prev) => Math.min(prev + 1, totalLinks - 1));
        } else if (e.key === "ArrowUp" || e.key === "w") {
          e.preventDefault();
          setFocusedLinkIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const target = activeMatch?.links?.[focusedLinkIndex];
          if (target?.url) window.open(target.url, "_blank");
        } else if (e.key === "Escape" || e.key === "Backspace" || e.key === "ArrowLeft") {
          e.preventDefault();
          setActiveZone("matches");
        }
        return;
      }

      // 2. In Category / Action Bar Mode
      if (activeZone === "categories") {
        const maxIndex = CATEGORIES.length; // CATEGORIES.length = "Sync" button
        if (e.key === "ArrowRight" || e.key === "d") {
          e.preventDefault();
          setCategoryIndex((prev) => Math.min(prev + 1, maxIndex));
          setFocusedIndex(0);
        } else if (e.key === "ArrowLeft" || e.key === "a") {
          e.preventDefault();
          setCategoryIndex((prev) => Math.max(prev - 1, 0));
          setFocusedIndex(0);
        } else if (e.key === "ArrowDown" || e.key === "s") {
          e.preventDefault();
          setActiveZone("matches");
        } else if (e.key === "Enter") {
          if (categoryIndex === CATEGORIES.length) {
            e.preventDefault();
            handleSync();
          }
        }
        return;
      }

      // 3. In Match List Mode
      if (activeZone === "matches") {
        if (e.key === "ArrowDown" || e.key === "s") {
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, filteredMatches.length - 1));
        } else if (e.key === "ArrowUp" || e.key === "w") {
          if (focusedIndex === 0) {
            e.preventDefault();
            setActiveZone("categories");
          } else {
            e.preventDefault();
            setFocusedIndex((prev) => Math.max(prev - 1, 0));
          }
        } else if (e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          if (filteredMatches[focusedIndex]) {
            setActiveMatch(filteredMatches[focusedIndex]);
            setFocusedLinkIndex(0);
            setActiveZone("drawer");
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeZone, categoryIndex, focusedIndex, focusedLinkIndex, filteredMatches, activeMatch, syncing, handleSync]);

  return (
    <main className="h-screen w-screen bg-neutral-950 text-neutral-100 flex flex-col p-6 select-none overflow-hidden font-sans">
      {/* Top Header & Navigation Bar */}
      <header className="mb-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-3.5 rounded-full bg-emerald-500 animate-pulse" />
          <h1 className="text-xl font-black tracking-tight text-white">FOOTBALL TV</h1>
        </div>

        {/* Categories + Sync Button */}
        <div className="flex items-center gap-2">
          {CATEGORIES.map((cat, idx) => {
            const isCatActive = categoryIndex === idx;
            const isCatFocused = activeZone === "categories" && isCatActive;
            return (
              <button
                key={cat}
                ref={(el) => {
                  catRefs.current[idx] = el;
                }}
                onClick={() => {
                  setCategoryIndex(idx);
                  setFocusedIndex(0);
                  setActiveZone("matches");
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all outline-none ${
                  isCatFocused
                    ? "bg-emerald-400 text-black ring-2 ring-white scale-105"
                    : isCatActive
                    ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
                    : "bg-neutral-900 text-neutral-400 border border-neutral-800 hover:text-white"
                }`}
              >
                {cat}
              </button>
            );
          })}

          {/* Prominent Dedicated Refresh Button */}
          <button
            ref={syncBtnRef}
            onClick={handleSync}
            disabled={syncing}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all outline-none flex items-center gap-1.5 ${
              activeZone === "categories" && categoryIndex === CATEGORIES.length
                ? "bg-amber-400 text-black ring-2 ring-white scale-105"
                : "bg-neutral-800 text-amber-300 border border-neutral-700 hover:bg-neutral-700"
            } ${syncing ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <span className={syncing ? "animate-spin inline-block" : ""}>🔄</span>
            {syncing ? "Syncing..." : "Sync"}
          </button>
        </div>
      </header>

      {/* Main Grid View */}
      <div className="flex-1 flex gap-6 min-h-0 overflow-hidden">
        {/* Match Feed */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-2.5 h-full">
          {loading ? (
            <div className="flex h-64 items-center justify-center text-neutral-600 text-sm">
              Loading fixtures...
            </div>
          ) : filteredMatches.length === 0 ? (
            <div className="text-neutral-500 p-8">No matches found for {selectedCategory}.</div>
          ) : (
            filteredMatches.map((match, idx) => {
              const isFocused = activeZone === "matches" && focusedIndex === idx;
              const isSelected = activeMatch?.id === match.id;
              return (
                <div
                  key={match.id}
                  ref={(el) => {
                    cardRefs.current[idx] = el;
                  }}
                  tabIndex={0}
                  onClick={() => {
                    setFocusedIndex(idx);
                    setActiveMatch(match);
                    setFocusedLinkIndex(0);
                    setActiveZone("drawer");
                  }}
                  className={`p-4 rounded-xl border transition-all duration-150 flex items-center justify-between cursor-pointer outline-none ${
                    isSelected
                      ? "bg-neutral-900 border-emerald-400 ring-2 ring-emerald-400/40"
                      : isFocused
                      ? "bg-emerald-950/40 border-emerald-400 shadow-xl shadow-emerald-900/40 translate-x-2"
                      : "bg-neutral-900 border-neutral-800 hover:border-neutral-700 opacity-85"
                  }`}
                >
                  <div>
                    <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded bg-neutral-800 text-emerald-400 mb-1">
                      {match.competition || "Match"}
                    </span>
                    <h2 className="text-lg font-bold text-white">{match.cleanedTitle}</h2>
                  </div>
                  <div className="text-xs font-semibold px-2.5 py-1 rounded bg-neutral-800 text-neutral-300">
                    {match.links.length} {match.links.length === 1 ? "source" : "sources"}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Match Drawer / Mirror Sources */}
        <div className="w-80 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex flex-col justify-between h-full min-h-0 overflow-hidden flex-shrink-0">
          {activeMatch ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="mb-4 flex-shrink-0">
                <span className="text-xs font-bold text-emerald-400 uppercase">{activeMatch.competition}</span>
                <h3 className="text-lg font-bold mt-1 leading-snug">{activeMatch.cleanedTitle}</h3>
              </div>

              <div className="border-t border-neutral-800 pt-3 flex-1 flex flex-col min-h-0">
                <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2 flex-shrink-0">
                  Streams & Highlights
                </p>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                  {activeMatch.links.map((link, idx) => {
                    const isLinkFocused = activeZone === "drawer" && focusedLinkIndex === idx;
                    return (
                      <a
                        key={link.id}
                        ref={(el) => {
                          linkRefs.current[idx] = el;
                        }}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        tabIndex={0}
                        className={`block p-3 rounded-lg transition-all font-semibold text-sm border outline-none ${
                          isLinkFocused
                            ? "bg-emerald-500 text-black border-emerald-400 scale-[1.02] shadow-lg shadow-emerald-500/30"
                            : "bg-neutral-800 text-neutral-200 border-neutral-700 hover:bg-neutral-700"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span>{link.domain}</span>
                          <span className={`text-xs ${isLinkFocused ? "text-neutral-900" : "text-neutral-400"}`}>
                            {link.category.replace("_", " ")}
                          </span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-neutral-500 p-4">
              <p className="text-sm font-medium">Select any fixture to view available full match streams & highlights</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
