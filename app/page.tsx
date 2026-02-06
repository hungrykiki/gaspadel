"use client";

import { useState, useCallback, useMemo } from "react";

// --- Types ---
type Player = {
  id: string;
  name: string;
  skill: number; // 1-5
  gamesPlayed: number;
  totalPoints: number;
  wins: number;
  losses: number;
};

type CourtMatchup = {
  courtId: number;
  teamA: [string, string]; // player ids
  teamB: [string, string];
};

type RoundSchedule = {
  matchup: CourtMatchup | null; // Single court matchup for this round
  sittingOut: string[];
};

type MatchResult = {
  scoreA: number;
  scoreB: number;
  teamAWon: boolean;
};

type Screen = "setup" | "session" | "leaderboard" | "schedule";

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// If name already exists, return "Name (2)", "Name (3)", etc.
function getUniquePlayerName(baseName: string, existingPlayers: { name: string }[]): string {
  const names = new Set(existingPlayers.map((p) => p.name));
  if (!names.has(baseName)) return baseName;
  let n = 2;
  while (names.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

// Generate matchup for a single court
function generateCourtMatchup(
  players: Player[],
  courtId: number,
  lastCourtMatchup: CourtMatchup | null,
  mustSitOut: Set<string> = new Set(),
  availablePlayers: Set<string> | null = null // If provided, only use these players
): { matchup: CourtMatchup | null; sittingOut: string[] } {
  // Filter to available players if specified
  const candidatePlayers = availablePlayers
    ? players.filter((p) => availablePlayers.has(p.id))
    : players;

  // Sort by games played ascending so late arrivals (0 games) get priority
  const sorted = [...candidatePlayers].sort((a, b) => a.gamesPlayed - b.gamesPlayed);
  
  // Players who must rest cannot be in "playing"; take first 4 who are not in mustSitOut
  const playing: Player[] = [];
  for (const p of sorted) {
    if (playing.length >= 4) break;
    if (mustSitOut.has(p.id)) continue;
    playing.push(p);
  }
  
  // If not enough, fill from mustSitOut so we have a full court
  if (playing.length < 4) {
    const rest = sorted.filter((p) => !playing.includes(p));
    for (const p of rest) {
      if (playing.length >= 4) break;
      playing.push(p);
    }
  }

  if (playing.length < 4) {
    return { matchup: null, sittingOut: sorted.map((p) => p.id) };
  }

  const sittingOut = sorted.filter((p) => !playing.includes(p)).map((p) => p.id);

  // Sort by skill desc: [high, mid2, mid1, low]
  const bySkill = [...playing].sort((a, b) => b.skill - a.skill);
  const [a, b, c1, d] = bySkill;
  // Team1: high+low, Team2: mid+mid (balanced totals)
  let teamA: [string, string] = [a.id, d.id];
  let teamB: [string, string] = [b.id, c1.id];

  // Soft partner rotation: if we have last round, try to swap so same pairs don't repeat
  if (lastCourtMatchup) {
    const prevPairs = [
      new Set(lastCourtMatchup.teamA),
      new Set(lastCourtMatchup.teamB),
    ];
    const samePartners = (t: [string, string]) =>
      prevPairs.some((s) => t.every((id) => s.has(id)));
    if (samePartners(teamA) || samePartners(teamB)) {
      teamA = [a.id, c1.id];
      teamB = [b.id, d.id];
    }
  }

  return {
    matchup: { courtId, teamA, teamB },
    sittingOut,
  };
}

// Get set of player ids who played in a matchup
function getPlayingIds(matchup: CourtMatchup | null): Set<string> {
  if (!matchup) return new Set<string>();
  return new Set([...matchup.teamA, ...matchup.teamB]);
}

// Generate schedule for a single court
function generateCourtSchedule(
  players: Player[],
  courtId: number,
  totalRounds: number,
  fromRoundIndex: number = 0,
  previousRounds: RoundSchedule[] = [],
  availablePlayers: Set<string> | null = null
): RoundSchedule[] {
  const schedule: RoundSchedule[] = [];
  let lastCourtMatchup: CourtMatchup | null =
    previousRounds.length > 0 ? previousRounds[previousRounds.length - 1].matchup : null;
  let playedLastRound = previousRounds.length >= 1
    ? getPlayingIds(previousRounds[previousRounds.length - 1].matchup)
    : new Set<string>();
  let playedTwoRoundsAgo = previousRounds.length >= 2
    ? getPlayingIds(previousRounds[previousRounds.length - 2].matchup)
    : new Set<string>();
  const simPlayers = players.map((p) => ({ ...p }));

  for (let r = fromRoundIndex; r < totalRounds; r++) {
    const mustSitOut = new Set<string>();
    playedLastRound.forEach((id) => {
      if (playedTwoRoundsAgo.has(id)) mustSitOut.add(id);
    });
    const { matchup, sittingOut } = generateCourtMatchup(
      simPlayers,
      courtId,
      lastCourtMatchup,
      mustSitOut,
      availablePlayers
    );
    schedule.push({ matchup, sittingOut });
    const playedThisRound = getPlayingIds(matchup);
    playedThisRound.forEach((id) => {
      const p = simPlayers.find((x) => x.id === id);
      if (p) p.gamesPlayed += 1;
    });
    playedTwoRoundsAgo = playedLastRound;
    playedLastRound = playedThisRound;
    lastCourtMatchup = matchup;
  }
  return schedule;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [numCourts, setNumCourts] = useState<number>(2); // Max courts configured (1-10)
  const [pointsPerMatch, setPointsPerMatch] = useState(21);
  const [totalRounds, setTotalRounds] = useState(10);
  const [players, setPlayers] = useState<Player[]>([]);
  const [activeCourts, setActiveCourts] = useState<number[]>([]); // Which courts are active (e.g. [1] or [1, 2])
  const [currentRoundPerCourt, setCurrentRoundPerCourt] = useState<Record<number, number>>({});
  const [schedulePerCourt, setSchedulePerCourt] = useState<Record<number, RoundSchedule[]>>({});

  // New player form (setup + late arrival)
  const [newName, setNewName] = useState("");
  const [newSkill, setNewSkill] = useState(3);

  // Score entry per court per round: courtId -> roundIndex -> { scoreA, scoreB }
  const [roundScoresPerCourt, setRoundScoresPerCourt] = useState<
    Record<number, Record<number, { scoreA: number; scoreB: number }>>
  >({});

  // Match results: courtId -> roundIndex -> MatchResult
  const [matchResults, setMatchResults] = useState<
    Record<number, Record<number, MatchResult>>
  >({});

  // Schedule filter
  const [scheduleFilterCourts, setScheduleFilterCourts] = useState<Set<number>>(new Set());

  const addPlayer = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    setPlayers((prev) => {
      const uniqueName = getUniquePlayerName(name, prev);
      return [
        ...prev,
        {
          id: generateId(),
          name: uniqueName,
          skill: Math.min(5, Math.max(1, newSkill)),
          gamesPlayed: 0,
          totalPoints: 0,
          wins: 0,
          losses: 0,
        },
      ];
    });
    setNewName("");
    setNewSkill(3);
  }, [newName, newSkill]);

  const removePlayer = useCallback((id: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const startSession = useCallback(() => {
    const maxPossibleCourts = Math.floor(players.length / 4);
    if (maxPossibleCourts < 1) return;
    
    const startingCourts = Math.min(maxPossibleCourts, numCourts);
    const courtsToStart = Array.from({ length: startingCourts }, (_, i) => i + 1);
    setActiveCourts(courtsToStart);
    
    const newSchedulePerCourt: Record<number, RoundSchedule[]> = {};
    const newCurrentRoundPerCourt: Record<number, number> = {};
    
    // Track which players are assigned to which courts
    const playersPerCourt: Record<number, Set<string>> = {};
    const allAssignedPlayers = new Set<string>();
    
    // Assign players to courts (simple round-robin for now)
    courtsToStart.forEach((courtId) => {
      playersPerCourt[courtId] = new Set<string>();
    });
    
    let courtIndex = 0;
    players.forEach((p) => {
      const courtId = courtsToStart[courtIndex % courtsToStart.length];
      playersPerCourt[courtId].add(p.id);
      allAssignedPlayers.add(p.id);
      courtIndex++;
    });
    
    // Generate schedule for each court
    courtsToStart.forEach((courtId) => {
      newSchedulePerCourt[courtId] = generateCourtSchedule(
        players,
        courtId,
        totalRounds,
        0,
        [],
        playersPerCourt[courtId]
      );
      newCurrentRoundPerCourt[courtId] = 1;
    });
    
    setSchedulePerCourt(newSchedulePerCourt);
    setCurrentRoundPerCourt(newCurrentRoundPerCourt);
    setRoundScoresPerCourt({});
    setScreen("session");
  }, [players, numCourts, totalRounds]);

  const getPlayer = useCallback(
    (id: string) => players.find((p) => p.id === id),
    [players]
  );

  // Check if we can add another court
  const canAddCourt = useMemo(() => {
    const totalPlayersNeeded = (activeCourts.length + 1) * 4;
    return players.length >= totalPlayersNeeded && activeCourts.length < numCourts;
  }, [players.length, activeCourts.length, numCourts]);

  const addCourt = useCallback(() => {
    if (!canAddCourt) return;
    const newCourtId = activeCourts.length + 1;
    const newActiveCourts = [...activeCourts, newCourtId];
    setActiveCourts(newActiveCourts);
    
    // Reassign players to all courts including new one
    const playersPerCourt: Record<number, Set<string>> = {};
    newActiveCourts.forEach((courtId) => {
      playersPerCourt[courtId] = new Set<string>();
    });
    
    let courtIndex = 0;
    players.forEach((p) => {
      const courtId = newActiveCourts[courtIndex % newActiveCourts.length];
      playersPerCourt[courtId].add(p.id);
      courtIndex++;
    });
    
    // Generate schedule for new court
    const newSchedule = generateCourtSchedule(
      players,
      newCourtId,
      totalRounds,
      0,
      [],
      playersPerCourt[newCourtId]
    );
    
    setSchedulePerCourt((prev) => ({
      ...prev,
      [newCourtId]: newSchedule,
    }));
    
    setCurrentRoundPerCourt((prev) => ({
      ...prev,
      [newCourtId]: 1,
    }));
  }, [canAddCourt, activeCourts, players, totalRounds]);

  const handleConfirmCourtScore = useCallback((courtId: number) => {
    const roundIndex = (currentRoundPerCourt[courtId] ?? 1) - 1;
    const roundData = schedulePerCourt[courtId]?.[roundIndex];
    if (!roundData?.matchup) return;
    
    const scores = roundScoresPerCourt[courtId]?.[roundIndex];
    if (!scores || (scores.scoreA === 0 && scores.scoreB === 0)) return;

    const mu = roundData.matchup;
    const scoreA = scores.scoreA;
    const scoreB = scores.scoreB;
    const teamAWon = scoreA > scoreB;
    const winScore = teamAWon ? scoreA : scoreB;
    const loseScore = teamAWon ? scoreB : scoreA;

    // Store match result
    setMatchResults((prev) => ({
      ...prev,
      [courtId]: {
        ...prev[courtId],
        [roundIndex]: { scoreA, scoreB, teamAWon },
      },
    }));

    setPlayers((prev) => {
      const updated = prev.map((p) => ({ ...p }));
      [...mu.teamA, ...mu.teamB].forEach((pid) => {
        const pl = updated.find((x) => x.id === pid);
        if (!pl) return;
        pl.gamesPlayed += 1;
        const isWinner = (teamAWon && mu.teamA.includes(pid)) || (!teamAWon && mu.teamB.includes(pid));
        pl.totalPoints += isWinner ? winScore : loseScore;
        if (isWinner) pl.wins += 1;
        else pl.losses += 1;
      });
      return updated;
    });

    setCurrentRoundPerCourt((prev) => ({
      ...prev,
      [courtId]: (prev[courtId] ?? 1) + 1,
    }));

    setRoundScoresPerCourt((prev) => {
      const courtScores = prev[courtId] ?? {};
      const { [roundIndex]: _, ...rest } = courtScores;
      return { ...prev, [courtId]: rest };
    });
  }, [currentRoundPerCourt, schedulePerCourt, roundScoresPerCourt]);

  const addLateArrival = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const uniqueName = getUniquePlayerName(name, players);
    const newPlayer: Player = {
      id: generateId(),
      name: uniqueName,
      skill: Math.min(5, Math.max(1, newSkill)),
      gamesPlayed: 0,
      totalPoints: 0,
      wins: 0,
      losses: 0,
    };
    const updatedPlayers = [...players, newPlayer];
    setPlayers(updatedPlayers);
    setNewName("");
    setNewSkill(3);

    // Regenerate future rounds for all active courts
    setSchedulePerCourt((prev) => {
      const updated: Record<number, RoundSchedule[]> = {};
      activeCourts.forEach((courtId) => {
        const currentRound = currentRoundPerCourt[courtId] ?? 1;
        const fromIndex = currentRound; // Regenerate from next round
        const previousRounds = prev[courtId]?.slice(0, fromIndex) ?? [];
        
        // Reassign players to courts
        const playersPerCourt: Record<number, Set<string>> = {};
        activeCourts.forEach((cId) => {
          playersPerCourt[cId] = new Set<string>();
        });
        let courtIndex = 0;
        updatedPlayers.forEach((p) => {
          const cId = activeCourts[courtIndex % activeCourts.length];
          playersPerCourt[cId].add(p.id);
          courtIndex++;
        });
        
        const newFutureRounds = generateCourtSchedule(
          updatedPlayers,
          courtId,
          Math.max(prev[courtId]?.length ?? 0, totalRounds),
          fromIndex,
          previousRounds,
          playersPerCourt[courtId]
        );
        updated[courtId] = [...previousRounds, ...newFutureRounds];
      });
      return { ...prev, ...updated };
    });
  }, [newName, newSkill, players, activeCourts, currentRoundPerCourt, totalRounds]);

  const skipMatchAndRegenerate = useCallback((courtId: number) => {
    // Skip current round by advancing to next round, then regenerate from there
    const currentRound = currentRoundPerCourt[courtId] ?? 1;
    const nextRound = currentRound + 1;
    
    // Advance to next round
    setCurrentRoundPerCourt((prev) => ({
      ...prev,
      [courtId]: nextRound,
    }));
    
    // Clear any scores for the skipped round
    setRoundScoresPerCourt((prev) => {
      const courtScores = prev[courtId] ?? {};
      const skippedRoundIndex = currentRound - 1;
      const { [skippedRoundIndex]: _, ...rest } = courtScores;
      return { ...prev, [courtId]: rest };
    });
    
    // Regenerate schedule from next round
    const fromIndex = nextRound;
    
    // Reassign players
    const playersPerCourt: Record<number, Set<string>> = {};
    activeCourts.forEach((cId) => {
      playersPerCourt[cId] = new Set<string>();
    });
    let courtIndex = 0;
    players.forEach((p) => {
      const cId = activeCourts[courtIndex % activeCourts.length];
      playersPerCourt[cId].add(p.id);
      courtIndex++;
    });
    
    setSchedulePerCourt((prev) => {
      const previousRounds = prev[courtId]?.slice(0, fromIndex) ?? [];
      const targetRounds = Math.max(prev[courtId]?.length ?? 0, totalRounds);
      const newFutureRounds = generateCourtSchedule(
        players,
        courtId,
        targetRounds,
        fromIndex,
        previousRounds,
        playersPerCourt[courtId]
      );
      return {
        ...prev,
        [courtId]: [...previousRounds, ...newFutureRounds],
      };
    });
  }, [players, activeCourts, currentRoundPerCourt, totalRounds]);

  const leaderboardSorted = [...players].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return b.wins - a.wins;
  });

  const canStartSession = players.length >= 4;

  // Get all players currently playing across all courts
  const allPlayingThisRound = useMemo(() => {
    const playing = new Set<string>();
    activeCourts.forEach((courtId) => {
      const roundIndex = (currentRoundPerCourt[courtId] ?? 1) - 1;
      const roundData = schedulePerCourt[courtId]?.[roundIndex];
      if (roundData?.matchup) {
        roundData.matchup.teamA.forEach((id) => playing.add(id));
        roundData.matchup.teamB.forEach((id) => playing.add(id));
      }
    });
    return playing;
  }, [activeCourts, currentRoundPerCourt, schedulePerCourt]);

  const allSittingOut = useMemo(() => {
    return players.filter((p) => !allPlayingThisRound.has(p.id)).map((p) => p.id);
  }, [players, allPlayingThisRound]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <div className="mx-auto max-w-lg px-3 sm:px-4 py-4 sm:py-6 pb-20 sm:pb-24 safe-area-pb">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-400 mb-4 sm:mb-6">
          gaspadel
        </h1>

        {/* Tab nav */}
        <nav className="flex gap-1 mb-4 sm:mb-6 rounded-xl bg-slate-800/60 p-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setScreen("setup")}
            className={`flex-1 min-w-0 rounded-lg py-3 sm:py-2.5 text-sm font-medium transition shrink-0 touch-manipulation min-h-[44px] sm:min-h-0 ${screen === "setup" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            Setup
          </button>
          <button
            type="button"
            onClick={() => setScreen("session")}
            className={`flex-1 min-w-0 rounded-lg py-2.5 text-sm font-medium transition shrink-0 ${screen === "session" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            Session
          </button>
          <button
            type="button"
            onClick={() => setScreen("schedule")}
            className={`flex-1 min-w-0 rounded-lg py-2.5 text-sm font-medium transition shrink-0 ${screen === "schedule" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            Schedule
          </button>
          <button
            type="button"
            onClick={() => setScreen("leaderboard")}
            className={`flex-1 min-w-0 rounded-lg py-2.5 text-sm font-medium transition shrink-0 ${screen === "leaderboard" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            Leaderboard
          </button>
        </nav>

        {/* --- Setup Screen --- */}
        {screen === "setup" && (
          <div className="space-y-6">
            <section className="rounded-2xl bg-slate-800/50 p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Max Courts</h2>
              <p className="text-xs text-slate-400 mb-3">
                Start with available players. Add more courts when enough players arrive.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNumCourts(Math.max(1, numCourts - 1))}
                  disabled={numCourts === 1}
                  className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-600 hover:bg-slate-500 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                  aria-label="Decrease max courts"
                >
                  −
                </button>
                <div className="flex-1 min-w-0 rounded-xl bg-slate-700 px-4 py-3 text-center text-lg font-semibold text-white border border-slate-600">
                  {numCourts} court{numCourts > 1 ? "s" : ""}
                </div>
                <button
                  type="button"
                  onClick={() => setNumCourts(Math.min(10, numCourts + 1))}
                  disabled={numCourts === 10}
                  className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                  aria-label="Increase max courts"
                >
                  +
                </button>
              </div>
            </section>

            <section className="rounded-2xl bg-slate-800/50 p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Points per match</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPointsPerMatch(Math.max(1, pointsPerMatch - 1))}
                  disabled={pointsPerMatch === 1}
                  className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-600 hover:bg-slate-500 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                  aria-label="Decrease points per match"
                >
                  −
                </button>
                <div className="flex-1 min-w-0 rounded-xl bg-slate-700 px-4 py-3 text-center text-lg font-semibold text-white border border-slate-600">
                  {pointsPerMatch}
                </div>
                <button
                  type="button"
                  onClick={() => setPointsPerMatch(Math.min(64, pointsPerMatch + 1))}
                  disabled={pointsPerMatch === 64}
                  className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                  aria-label="Increase points per match"
                >
                  +
                </button>
              </div>
            </section>

            <section className="rounded-2xl bg-slate-800/50 p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Number of rounds</h2>
              <p className="text-xs text-slate-400 mb-2">Full schedule is generated at start. You can change this during session.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTotalRounds(Math.max(1, totalRounds - 1))}
                  disabled={totalRounds === 1}
                  className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-600 hover:bg-slate-500 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                  aria-label="Decrease number of rounds"
                >
                  −
                </button>
                <div className="flex-1 min-w-0 rounded-xl bg-slate-700 px-4 py-3 text-center text-lg font-semibold text-white border border-slate-600">
                  {totalRounds}
                </div>
                <button
                  type="button"
                  onClick={() => setTotalRounds(Math.min(99, totalRounds + 1))}
                  disabled={totalRounds === 99}
                  className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                  aria-label="Increase number of rounds"
                >
                  +
                </button>
              </div>
            </section>

            <section className="rounded-2xl bg-slate-800/50 p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Players</h2>
              <p className="text-xs text-slate-400 mb-3">
                Need at least 4 to start. You can add more during the session.
              </p>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                  className="flex-1 rounded-xl bg-slate-700 px-4 py-2.5 text-white placeholder-slate-500 border border-slate-600 focus:border-emerald-500 outline-none"
                />
                <select
                  value={newSkill}
                  onChange={(e) => setNewSkill(Number(e.target.value))}
                  className="rounded-xl bg-slate-700 px-3 py-2.5 text-white border border-slate-600 focus:border-emerald-500 outline-none"
                  title="Skill 1-5"
                >
                  {[1, 2, 3, 4, 5].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addPlayer}
                  className="rounded-xl bg-emerald-600 px-4 py-3 sm:py-2.5 font-medium text-white hover:bg-emerald-500 touch-manipulation min-h-[44px] sm:min-h-0"
                >
                  Add
                </button>
              </div>
              <ul className="space-y-2">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-xl bg-slate-700/80 px-4 py-2.5"
                  >
                    <span className="font-medium">{p.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Skill {p.skill}</span>
                      <button
                        type="button"
                        onClick={() => removePlayer(p.id)}
                        className="text-slate-400 hover:text-red-400 text-sm"
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <button
              type="button"
              onClick={startSession}
              disabled={!canStartSession}
              className="w-full rounded-xl bg-emerald-600 py-4 sm:py-4 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[52px]"
            >
              Start session
            </button>
            {!canStartSession && (
              <p className="text-center text-sm text-slate-400">
                Add at least 4 players to start.
              </p>
            )}
          </div>
        )}

        {/* --- Session Screen --- */}
        {screen === "session" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Pts/match</label>
                  <button
                    type="button"
                    onClick={() => setPointsPerMatch(Math.max(1, pointsPerMatch - 1))}
                    disabled={pointsPerMatch === 1}
                    className="flex-shrink-0 w-12 h-12 sm:w-10 sm:h-10 rounded-lg bg-slate-600 hover:bg-slate-500 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-xl font-bold flex items-center justify-center select-none touch-manipulation"
                    aria-label="Decrease points per match"
                  >
                    −
                  </button>
                  <div className="w-12 rounded-lg bg-slate-700 px-2 py-1 text-center text-sm font-semibold text-white border border-slate-600">
                    {pointsPerMatch}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPointsPerMatch(Math.min(64, pointsPerMatch + 1))}
                    disabled={pointsPerMatch === 64}
                    className="flex-shrink-0 w-12 h-12 sm:w-10 sm:h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xl font-bold flex items-center justify-center select-none touch-manipulation"
                    aria-label="Increase points per match"
                  >
                    +
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500">Rounds</label>
                  <button
                    type="button"
                    onClick={() => setTotalRounds(Math.max(1, totalRounds - 1))}
                    disabled={totalRounds === 1}
                    className="flex-shrink-0 w-12 h-12 sm:w-10 sm:h-10 rounded-lg bg-slate-600 hover:bg-slate-500 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-xl font-bold flex items-center justify-center select-none touch-manipulation"
                    aria-label="Decrease number of rounds"
                  >
                    −
                  </button>
                  <div className="w-12 rounded-lg bg-slate-700 px-2 py-1 text-center text-sm font-semibold text-white border border-slate-600">
                    {totalRounds}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTotalRounds(Math.min(99, totalRounds + 1))}
                    disabled={totalRounds === 99}
                    className="flex-shrink-0 w-12 h-12 sm:w-10 sm:h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xl font-bold flex items-center justify-center select-none touch-manipulation"
                    aria-label="Increase number of rounds"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScreen("schedule")}
                  className="text-sm text-emerald-400 hover:underline"
                >
                  Schedule
                </button>
                <button
                  type="button"
                  onClick={() => setScreen("leaderboard")}
                  className="text-sm text-emerald-400 hover:underline"
                >
                  Leaderboard
                </button>
              </div>
            </div>

            {activeCourts.length === 0 ? (
              <div className="rounded-2xl bg-slate-800/50 p-6 text-center text-slate-400">
                No active courts. Start a session from Setup.
              </div>
            ) : (
              <>
                {activeCourts.map((courtId) => {
                  const roundIndex = (currentRoundPerCourt[courtId] ?? 1) - 1;
                  const roundData = schedulePerCourt[courtId]?.[roundIndex];
                  const matchup = roundData?.matchup;
                  const scores = roundScoresPerCourt[courtId]?.[roundIndex];
                  const hasMoreRounds = (currentRoundPerCourt[courtId] ?? 1) <= (schedulePerCourt[courtId]?.length ?? 0);

                  if (!matchup) {
                    return (
                      <section key={courtId} className="rounded-2xl bg-slate-800/50 p-4 border border-slate-700/50">
                        <h3 className="text-sm font-semibold text-emerald-400/90 mb-2">Court {courtId}</h3>
                        <p className="text-slate-400 text-sm">Not enough players for this court.</p>
                      </section>
                    );
                  }

                  const scoreA = scores?.scoreA ?? 0;
                  const scoreB = scores?.scoreB ?? 0;
                  const totalScore = scoreA + scoreB;
                  const isMatchComplete = totalScore === pointsPerMatch && totalScore > 0;
                  const teamAWon = scoreA > scoreB;
                  const canConfirm = scores && (scoreA > 0 || scoreB > 0);

                  return (
                    <section key={courtId} className="rounded-2xl bg-slate-800/50 p-4 sm:p-5 border border-slate-700/50">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                        <h3 className="text-base sm:text-sm font-semibold text-emerald-400/90">Court {courtId}</h3>
                        <span className="text-sm sm:text-xs text-slate-500">
                          Round {currentRoundPerCourt[courtId] ?? 1}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-4 items-start mb-4">
                        <div className={`flex flex-col gap-2 p-3 rounded-xl transition ${isMatchComplete && teamAWon ? "bg-emerald-950/40 border-2 border-emerald-500" : ""}`}>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Team A</p>
                          <p className="font-medium text-slate-100 text-sm leading-tight">
                            {matchup.teamA.map((id) => getPlayer(id)?.name).join(" & ")}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setRoundScoresPerCourt((prev) => {
                                  const courtScores = prev[courtId] ?? {};
                                  const roundScores = courtScores[roundIndex] ?? { scoreA: 0, scoreB: 0 };
                                  return {
                                    ...prev,
                                    [courtId]: {
                                      ...courtScores,
                                      [roundIndex]: {
                                        ...roundScores,
                                        scoreA: Math.max(0, roundScores.scoreA - 1),
                                      },
                                    },
                                  };
                                })
                              }
                              disabled={isMatchComplete}
                              className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-600 hover:bg-slate-500 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                              aria-label="Subtract 1 point for Team A"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={pointsPerMatch}
                              placeholder="0"
                              value={scores?.scoreA ?? ""}
                              disabled={isMatchComplete}
                              onChange={(e) =>
                                setRoundScoresPerCourt((prev) => {
                                  const courtScores = prev[courtId] ?? {};
                                  return {
                                    ...prev,
                                    [courtId]: {
                                      ...courtScores,
                                      [roundIndex]: {
                                        ...courtScores[roundIndex],
                                        scoreA: Math.max(0, Math.min(pointsPerMatch, Number(e.target.value) || 0)),
                                        scoreB: courtScores[roundIndex]?.scoreB ?? 0,
                                      },
                                    },
                                  };
                                })
                              }
                              className="flex-1 min-w-0 rounded-xl bg-slate-700 px-4 py-3 text-center text-lg font-semibold text-white border border-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setRoundScoresPerCourt((prev) => {
                                  const courtScores = prev[courtId] ?? {};
                                  const roundScores = courtScores[roundIndex] ?? { scoreA: 0, scoreB: 0 };
                                  return {
                                    ...prev,
                                    [courtId]: {
                                      ...courtScores,
                                      [roundIndex]: {
                                        ...roundScores,
                                        scoreA: Math.min(pointsPerMatch, roundScores.scoreA + 1),
                                      },
                                    },
                                  };
                                })
                              }
                              disabled={isMatchComplete}
                              className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                              aria-label="Add 1 point for Team A"
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <div className={`flex flex-col gap-2 p-3 rounded-xl transition ${isMatchComplete && !teamAWon ? "bg-emerald-950/40 border-2 border-emerald-500" : ""}`}>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Team B</p>
                          <p className="font-medium text-slate-100 text-sm leading-tight">
                            {matchup.teamB.map((id) => getPlayer(id)?.name).join(" & ")}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setRoundScoresPerCourt((prev) => {
                                  const courtScores = prev[courtId] ?? {};
                                  const roundScores = courtScores[roundIndex] ?? { scoreA: 0, scoreB: 0 };
                                  return {
                                    ...prev,
                                    [courtId]: {
                                      ...courtScores,
                                      [roundIndex]: {
                                        ...roundScores,
                                        scoreB: Math.max(0, roundScores.scoreB - 1),
                                      },
                                    },
                                  };
                                })
                              }
                              disabled={isMatchComplete}
                              className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-600 hover:bg-slate-500 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                              aria-label="Subtract 1 point for Team B"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={pointsPerMatch}
                              placeholder="0"
                              value={scores?.scoreB ?? ""}
                              disabled={isMatchComplete}
                              onChange={(e) =>
                                setRoundScoresPerCourt((prev) => {
                                  const courtScores = prev[courtId] ?? {};
                                  return {
                                    ...prev,
                                    [courtId]: {
                                      ...courtScores,
                                      [roundIndex]: {
                                        ...courtScores[roundIndex],
                                        scoreA: courtScores[roundIndex]?.scoreA ?? 0,
                                        scoreB: Math.max(0, Math.min(pointsPerMatch, Number(e.target.value) || 0)),
                                      },
                                    },
                                  };
                                })
                              }
                              className="flex-1 min-w-0 rounded-xl bg-slate-700 px-4 py-3 text-center text-lg font-semibold text-white border border-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setRoundScoresPerCourt((prev) => {
                                  const courtScores = prev[courtId] ?? {};
                                  const roundScores = courtScores[roundIndex] ?? { scoreA: 0, scoreB: 0 };
                                  return {
                                    ...prev,
                                    [courtId]: {
                                      ...courtScores,
                                      [roundIndex]: {
                                        ...roundScores,
                                        scoreB: Math.min(pointsPerMatch, roundScores.scoreB + 1),
                                      },
                                    },
                                  };
                                })
                              }
                              disabled={isMatchComplete}
                              className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                              aria-label="Add 1 point for Team B"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 mb-3">Max {pointsPerMatch} points per team</p>
                      {isMatchComplete && (
                        <div className="mb-3 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/50">
                          <p className="text-sm font-semibold text-emerald-400 text-center">
                            🏆 {teamAWon ? "Team A wins!" : "Team B wins!"} ({scoreA}-{scoreB})
                          </p>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleConfirmCourtScore(courtId)}
                        disabled={!canConfirm}
                        className="w-full rounded-xl bg-emerald-600 py-3.5 sm:py-2.5 text-base sm:text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[48px]"
                      >
                        {isMatchComplete
                          ? `Log Match (Court ${courtId})`
                          : hasMoreRounds
                          ? `Confirm & next round (Court ${courtId})`
                          : `Confirm (Court ${courtId} - final round)`}
                      </button>
                      <button
                        type="button"
                        onClick={() => skipMatchAndRegenerate(courtId)}
                        className="w-full rounded-xl bg-slate-700 py-3 sm:py-2 text-sm text-slate-300 hover:bg-slate-600 mt-2 touch-manipulation min-h-[44px]"
                      >
                        Skip match & regenerate (Court {courtId})
                      </button>
                    </section>
                  );
                })}

                {canAddCourt && (
                  <section className="rounded-2xl bg-slate-800/50 p-4 border border-emerald-500/50">
                    <p className="text-sm text-slate-300 mb-3">
                      Enough players for another court! ({players.length} players, need {(activeCourts.length + 1) * 4})
                    </p>
                    <button
                      type="button"
                      onClick={addCourt}
                      className="w-full rounded-xl bg-emerald-600 py-3 sm:py-2.5 font-semibold text-white hover:bg-emerald-500 touch-manipulation min-h-[48px] sm:min-h-0"
                    >
                      Add Court {activeCourts.length + 1}
                    </button>
                  </section>
                )}

                {allSittingOut.length > 0 && (
                  <section className="rounded-2xl bg-slate-800/30 p-4">
                    <h3 className="text-sm font-semibold text-slate-400 mb-2">Sitting out</h3>
                    <p className="text-slate-300">
                      {allSittingOut.map((id) => getPlayer(id)?.name).join(", ")}
                    </p>
                  </section>
                )}

            <section className="rounded-2xl bg-slate-800/50 p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Add late arrival</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addLateArrival()}
                  className="flex-1 rounded-xl bg-slate-700 px-4 py-2.5 text-white placeholder-slate-500 border border-slate-600"
                />
                <select
                  value={newSkill}
                  onChange={(e) => setNewSkill(Number(e.target.value))}
                  className="rounded-xl bg-slate-700 px-3 py-2.5 text-white border border-slate-600"
                >
                  {[1, 2, 3, 4, 5].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addLateArrival}
                  className="rounded-xl bg-emerald-600 px-4 py-3 sm:py-2.5 font-medium text-white hover:bg-emerald-500 touch-manipulation min-h-[44px] sm:min-h-0"
                >
                  Add
                </button>
              </div>
            </section>

            <p className="text-xs text-slate-500 text-center">
              Americano: each player gets their team&apos;s score as individual points.
            </p>
              </>
            )}
          </div>
        )}

        {/* --- Schedule Screen --- */}
        {screen === "schedule" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Full session schedule per court. Each court progresses independently.
            </p>
            
            {/* Filter chips */}
            {activeCourts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setScheduleFilterCourts(new Set());
                  }}
                    className={`rounded-full px-4 py-2 sm:py-1.5 text-sm font-medium transition touch-manipulation min-h-[44px] sm:min-h-0 ${
                      scheduleFilterCourts.size === 0
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-700 text-slate-300"
                    }`}
                >
                  All
                </button>
                {activeCourts.map((courtId) => (
                  <button
                    key={courtId}
                    type="button"
                    onClick={() => {
                      // Clicking a court chip shows only that court
                      setScheduleFilterCourts(new Set([courtId]));
                    }}
                    className={`rounded-full px-4 py-2 sm:py-1.5 text-sm font-medium transition touch-manipulation min-h-[44px] sm:min-h-0 ${
                      scheduleFilterCourts.has(courtId)
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-700 text-slate-300 opacity-50"
                    }`}
                  >
                    Court {courtId}
                  </button>
                ))}
              </div>
            )}

            {activeCourts.length === 0 ? (
              <div className="rounded-2xl bg-slate-800/50 p-6 text-center text-slate-400">
                No schedule yet. Start a session from Setup.
              </div>
            ) : (
              <div className="space-y-6">
                {activeCourts
                  .filter((courtId) => scheduleFilterCourts.size === 0 || scheduleFilterCourts.has(courtId))
                  .map((courtId) => {
                    const schedule = schedulePerCourt[courtId] ?? [];
                    const currentRound = currentRoundPerCourt[courtId] ?? 1;
                    
                    return (
                      <div key={courtId} className="space-y-3">
                        <h2 className="text-lg font-semibold text-emerald-400">Court {courtId}</h2>
                        {schedule.length === 0 ? (
                          <div className="rounded-2xl bg-slate-800/50 p-4 text-center text-slate-400 text-sm">
                            No schedule for this court.
                          </div>
                        ) : (
                          schedule.map((roundData, index) => {
                            const roundNum = index + 1;
                            const isCurrent = roundNum === currentRound;
                            const isPast = roundNum < currentRound;
                            
                            if (!roundData.matchup) {
                              return (
                                <section
                                  key={roundNum}
                                  className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 opacity-60"
                                >
                                  <h3 className="text-sm font-semibold mb-2">
                                    Round {roundNum} <span className="text-xs font-normal text-slate-500">(not enough players)</span>
                                  </h3>
                                </section>
                              );
                            }
                            
                            const matchResult = matchResults[courtId]?.[index];
                            
                            return (
                              <section
                                key={roundNum}
                                className={`rounded-2xl border p-4 ${
                                  isCurrent
                                    ? "border-emerald-500 bg-emerald-950/30"
                                    : isPast
                                    ? "border-slate-700/50 bg-slate-800/30 opacity-80"
                                    : "border-slate-700/50 bg-slate-800/50"
                                }`}
                              >
                                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                  Round {roundNum}
                                  {isCurrent && <span className="text-xs font-normal text-emerald-400">(current)</span>}
                                  {isPast && <span className="text-xs font-normal text-slate-500">(played)</span>}
                                </h3>
                                <div className="text-sm space-y-2">
                                  <div className={`flex flex-wrap items-center gap-2 ${matchResult && matchResult.teamAWon ? "text-emerald-400" : ""}`}>
                                    <span className={`font-medium ${matchResult && matchResult.teamAWon ? "text-emerald-400" : "text-slate-300"}`}>
                                      {roundData.matchup!.teamA.map((id) => getPlayer(id)?.name).join(" & ")}
                                    </span>
                                    <span className="text-slate-500">vs</span>
                                    <span className={`font-medium ${matchResult && !matchResult.teamAWon ? "text-emerald-400" : "text-slate-300"}`}>
                                      {roundData.matchup!.teamB.map((id) => getPlayer(id)?.name).join(" & ")}
                                    </span>
                                  </div>
                                  {matchResult && (
                                    <div className="pt-2 border-t border-slate-700/50">
                                      <p className="text-base font-semibold">
                                        <span className={matchResult.teamAWon ? "text-emerald-400" : "text-slate-400"}>
                                          {matchResult.scoreA}
                                        </span>
                                        <span className="text-slate-500 mx-2">-</span>
                                        <span className={!matchResult.teamAWon ? "text-emerald-400" : "text-slate-400"}>
                                          {matchResult.scoreB}
                                        </span>
                                        <span className="text-slate-500 ml-2 text-sm font-normal">
                                          ({matchResult.teamAWon ? "Team A wins" : "Team B wins"})
                                        </span>
                                      </p>
                                    </div>
                                  )}
                                </div>
                                {roundData.sittingOut.length > 0 && (
                                  <p className="text-xs text-slate-500 mt-2">
                                    Sit out: {roundData.sittingOut.map((id) => getPlayer(id)?.name).join(", ")}
                                  </p>
                                )}
                              </section>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* --- Leaderboard Screen --- */}
        {screen === "leaderboard" && (
          <div className="space-y-4">
            <div className="rounded-2xl overflow-hidden border border-slate-700/50">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                    <th className="py-3 pl-4 font-semibold">#</th>
                    <th className="py-3 font-semibold">Name</th>
                    <th className="py-3 font-semibold text-center">GP</th>
                    <th className="py-3 font-semibold text-right pr-4">Pts</th>
                    <th className="py-3 font-semibold text-center">W</th>
                    <th className="py-3 font-semibold text-center">L</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardSorted.map((p, i) => (
                    <tr
                      key={p.id}
                      className={`border-t border-slate-700/50 ${i < 3 ? "bg-slate-800/40" : ""}`}
                    >
                      <td className="py-3 pl-4 font-bold text-slate-400 w-10">
                        {i + 1}
                      </td>
                      <td className="py-3 font-medium text-white">{p.name}</td>
                      <td className="py-3 text-center text-slate-300">{p.gamesPlayed}</td>
                      <td className="py-3 text-right pr-4 font-semibold text-emerald-400">
                        {p.totalPoints}
                      </td>
                      <td className="py-3 text-center text-green-400/90">{p.wins}</td>
                      <td className="py-3 text-center text-red-400/80">{p.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leaderboardSorted.length === 0 && (
              <p className="text-center text-slate-500 py-8">No players yet. Add players in Setup.</p>
            )}
            <p className="text-xs text-slate-500 text-center">
              Sorted by total Americano points, then wins. GP = games played.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
