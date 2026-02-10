import { Player, Round, Match, Algorithm, Config } from "./store";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function generateMatchId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function getSkillLabel(skill: number): string {
  switch (skill) {
    case 1: return "Newbie";
    case 2: return "Beginner";
    case 3: return "Intermediate";
    case 4: return "Advanced";
    case 5: return "Pro";
    default: return "Intermediate";
  }
}

export function getUniquePlayerName(baseName: string, existingPlayers: { name: string }[]): string {
  const names = new Set(existingPlayers.map((p) => p.name));
  if (!names.has(baseName)) return baseName;
  let n = 2;
  while (names.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

/** Shuffle array in place using Fisher-Yates */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Make a pair key (order-independent) */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Make a matchup key for 4 players (order-independent) to detect repeat matchups */
function matchupKey(ids: string[]): string {
  return [...ids].sort().join("_");
}

// ─── History tracking ────────────────────────────────────────────────────────

interface HistoryMaps {
  partnerCount: Map<string, number>;   // pairKey -> count of times partnered
  opponentCount: Map<string, number>;  // pairKey -> count of times faced
  matchupSet: Set<string>;             // set of 4-player matchup keys already played
  sitOutCounts: Map<string, number>;   // playerId -> sit-out count
}

/** Build history maps from completed/scheduled rounds */
function buildHistory(players: Player[], rounds: Round[]): HistoryMaps {
  const partnerCount = new Map<string, number>();
  const opponentCount = new Map<string, number>();
  const matchupSet = new Set<string>();
  const sitOutCounts = new Map<string, number>();

  // Init sit-out counts from player data
  players.forEach((p) => sitOutCounts.set(p.id, p.sitOutCount || 0));

  rounds.forEach((round) => {
    round.matches.forEach((match) => {
      const aIds = match.teamA.playerIds;
      const bIds = match.teamB.playerIds;

      // Track partners within each team
      for (let i = 0; i < aIds.length; i++) {
        for (let j = i + 1; j < aIds.length; j++) {
          const k = pairKey(aIds[i], aIds[j]);
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }
      }
      for (let i = 0; i < bIds.length; i++) {
        for (let j = i + 1; j < bIds.length; j++) {
          const k = pairKey(bIds[i], bIds[j]);
          partnerCount.set(k, (partnerCount.get(k) || 0) + 1);
        }
      }

      // Track opponents (cross-team)
      for (const a of aIds) {
        for (const b of bIds) {
          const k = pairKey(a, b);
          opponentCount.set(k, (opponentCount.get(k) || 0) + 1);
        }
      }

      // Track exact matchups
      matchupSet.add(matchupKey([...aIds, ...bIds]));
    });

    // Track sit-outs
    round.sittingOut.forEach((id) => {
      sitOutCounts.set(id, (sitOutCounts.get(id) || 0) + 1);
    });
  });

  return { partnerCount, opponentCount, matchupSet, sitOutCounts };
}

// ─── Player selection (shared across all algorithms) ─────────────────────────

/**
 * Select which players play this round and who sits out.
 * Rules:
 * - Paused/removed players excluded
 * - Player with fewest gamesPlayed sits out (fair rotation)
 * - Late joiners get priority until their match count catches up
 */
function selectPlayersForRound(
  players: Player[],
  courts: number,
  history: HistoryMaps,
): { playing: Player[]; sittingOut: string[] } {
  const active = players.filter((p) => p.status === "active");
  const playersNeeded = courts * 4;

  if (active.length <= playersNeeded) {
    // Everyone plays (or not enough players — some courts may be empty)
    return { playing: active, sittingOut: [] };
  }

  // Sort by: lowest gamesPlayed first (late joiners naturally have fewer),
  // then by highest sitOutCount (sat out more = higher priority to play)
  const sorted = [...active].sort((a, b) => {
    const gDiff = a.gamesPlayed - b.gamesPlayed;
    if (gDiff !== 0) return gDiff;
    const sDiff = (history.sitOutCounts.get(b.id) || 0) - (history.sitOutCounts.get(a.id) || 0);
    if (sDiff !== 0) return sDiff;
    return Math.random() - 0.5; // Break ties randomly
  });

  const playing = sorted.slice(0, playersNeeded);
  const sittingOut = sorted.slice(playersNeeded).map((p) => p.id);
  return { playing, sittingOut };
}

// ─── Americano algorithm ─────────────────────────────────────────────────────

/**
 * Score a candidate pairing of 4 players into 2 teams.
 * Lower is better: minimizes max partner/opponent history, avoids repeat matchups.
 */
function scoreAmericanoPairing(
  teamA: [string, string],
  teamB: [string, string],
  history: HistoryMaps,
): number {
  let score = 0;

  // Partner penalty (team A pair)
  const pkA = pairKey(teamA[0], teamA[1]);
  score += (history.partnerCount.get(pkA) || 0) * 10;

  // Partner penalty (team B pair)
  const pkB = pairKey(teamB[0], teamB[1]);
  score += (history.partnerCount.get(pkB) || 0) * 10;

  // Opponent penalty (cross-team)
  for (const a of teamA) {
    for (const b of teamB) {
      score += (history.opponentCount.get(pairKey(a, b)) || 0) * 5;
    }
  }

  // Exact matchup repeat penalty
  if (history.matchupSet.has(matchupKey([...teamA, ...teamB]))) {
    score += 1000;
  }

  return score;
}

/**
 * Generate best pairing for 4 players using Americano diversity logic.
 * Tries all 3 possible 2v2 splits and picks the one with lowest score.
 */
function bestAmericanoPairing(
  fourIds: string[],
  history: HistoryMaps,
): { teamA: string[]; teamB: string[] } {
  const [a, b, c, d] = fourIds;
  // All 3 possible 2v2 splits
  const splits: [string, string, string, string][] = [
    [a, b, c, d], // AB vs CD
    [a, c, b, d], // AC vs BD
    [a, d, b, c], // AD vs BC
  ];

  let best = { teamA: [a, b], teamB: [c, d] };
  let bestScore = Infinity;

  for (const [x1, x2, y1, y2] of splits) {
    const s = scoreAmericanoPairing([x1, x2], [y1, y2], history);
    if (s < bestScore) {
      bestScore = s;
      best = { teamA: [x1, x2], teamB: [y1, y2] };
    }
  }

  return best;
}

/**
 * Assign players to courts for a round (Americano / generic).
 * Groups of 4 are assigned with diversity optimization.
 */
function generateAmericanoRound(
  playing: Player[],
  courts: number,
  history: HistoryMaps,
): Match[] {
  const matches: Match[] = [];
  const pool = shuffle(playing.map((p) => p.id));

  // Greedily assign groups of 4 to courts
  // Try multiple random shuffles and pick the one with lowest total diversity score
  let bestMatches: Match[] = [];
  let bestTotalScore = Infinity;
  const attempts = Math.min(20, Math.max(5, playing.length));

  for (let attempt = 0; attempt < attempts; attempt++) {
    const shuffled = attempt === 0 ? pool : shuffle(pool);
    const candidateMatches: Match[] = [];
    let totalScore = 0;

    for (let court = 1; court <= courts; court++) {
      const start = (court - 1) * 4;
      const group = shuffled.slice(start, start + 4);
      if (group.length < 4) break;

      const { teamA, teamB } = bestAmericanoPairing(group, history);
      totalScore += scoreAmericanoPairing(
        teamA as [string, string],
        teamB as [string, string],
        history,
      );

      candidateMatches.push({
        id: generateMatchId(),
        court,
        teamA: { playerIds: teamA },
        teamB: { playerIds: teamB },
        status: "upcoming",
      });
    }

    if (totalScore < bestTotalScore) {
      bestTotalScore = totalScore;
      bestMatches = candidateMatches;
    }
  }

  return bestMatches.length > 0 ? bestMatches : matches;
}

// ─── Mexicano algorithm ─────────────────────────────────────────────────────

/**
 * Generate a Mexicano round.
 * Round 1: random (like Americano).
 * Round 2+: sort by total points, pair #1 with #4 vs #2 with #3, etc.
 */
function generateMexicanoRound(
  playing: Player[],
  courts: number,
  history: HistoryMaps,
  isFirstRound: boolean,
): Match[] {
  if (isFirstRound) {
    // Round 1: random assignment, same as Americano
    return generateAmericanoRound(playing, courts, history);
  }

  // Sort by totalPoints descending
  const sorted = [...playing].sort((a, b) => {
    const ptsDiff = b.totalPoints - a.totalPoints;
    if (ptsDiff !== 0) return ptsDiff;
    return (b.wins || 0) - (a.wins || 0);
  });

  const matches: Match[] = [];
  for (let court = 1; court <= courts; court++) {
    const start = (court - 1) * 4;
    const group = sorted.slice(start, start + 4);
    if (group.length < 4) break;

    // #1 with #4 vs #2 with #3
    matches.push({
      id: generateMatchId(),
      court,
      teamA: { playerIds: [group[0].id, group[3].id] },
      teamB: { playerIds: [group[1].id, group[2].id] },
      status: "upcoming",
    });
  }

  return matches;
}

// ─── Mix Americano algorithm ─────────────────────────────────────────────────

/**
 * Score a Mix Americano pairing — same as Americano but each team must be 1M + 1F.
 */
function scoreMixPairing(
  teamA: [string, string],
  teamB: [string, string],
  history: HistoryMaps,
): number {
  return scoreAmericanoPairing(teamA, teamB, history);
}

/**
 * Generate a Mix Americano round.
 * Constraint: every team has exactly 1 M and 1 F.
 */
function generateMixAmericanoRound(
  playing: Player[],
  courts: number,
  history: HistoryMaps,
): Match[] {
  const males = shuffle(playing.filter((p) => p.gender === "M"));
  const females = shuffle(playing.filter((p) => p.gender === "F"));

  const matches: Match[] = [];

  // Assign 2M + 2F per court
  for (let court = 1; court <= courts; court++) {
    const mStart = (court - 1) * 2;
    const fStart = (court - 1) * 2;
    const courtMales = males.slice(mStart, mStart + 2);
    const courtFemales = females.slice(fStart, fStart + 2);

    if (courtMales.length < 2 || courtFemales.length < 2) {
      // Not enough of one gender — fall back to best effort
      const remaining = [
        ...males.slice(mStart),
        ...females.slice(fStart),
      ];
      if (remaining.length >= 4) {
        const group = remaining.slice(0, 4);
        const { teamA, teamB } = bestAmericanoPairing(
          group.map((p) => p.id),
          history,
        );
        matches.push({
          id: generateMatchId(),
          court,
          teamA: { playerIds: teamA },
          teamB: { playerIds: teamB },
          status: "upcoming",
        });
      }
      continue;
    }

    // Try all 2 ways to pair M+F into teams: (M0F0 vs M1F1) or (M0F1 vs M1F0)
    const m = courtMales.map((p) => p.id);
    const f = courtFemales.map((p) => p.id);

    const option1: { teamA: [string, string]; teamB: [string, string] } = {
      teamA: [m[0], f[0]],
      teamB: [m[1], f[1]],
    };
    const option2: { teamA: [string, string]; teamB: [string, string] } = {
      teamA: [m[0], f[1]],
      teamB: [m[1], f[0]],
    };

    const s1 = scoreMixPairing(option1.teamA, option1.teamB, history);
    const s2 = scoreMixPairing(option2.teamA, option2.teamB, history);

    const best = s1 <= s2 ? option1 : option2;

    matches.push({
      id: generateMatchId(),
      court,
      teamA: { playerIds: best.teamA },
      teamB: { playerIds: best.teamB },
      status: "upcoming",
    });
  }

  return matches;
}

// ─── Skill Americano algorithm ───────────────────────────────────────────────

/**
 * Score a Skill Americano pairing.
 * Partner diversity is primary; skill balance is secondary tiebreaker.
 */
function scoreSkillPairing(
  teamA: [string, string],
  teamB: [string, string],
  playerMap: Map<string, Player>,
  history: HistoryMaps,
): number {
  // Base diversity score (same as Americano)
  let score = scoreAmericanoPairing(teamA, teamB, history);

  // Skill balance penalty (secondary — multiplied by small factor)
  const skillA = (playerMap.get(teamA[0])?.skill || 3) + (playerMap.get(teamA[1])?.skill || 3);
  const skillB = (playerMap.get(teamB[0])?.skill || 3) + (playerMap.get(teamB[1])?.skill || 3);
  const gap = Math.abs(skillA - skillB);
  score += gap * 2; // Small weight: don't repeat partners just to balance

  return score;
}

/**
 * Generate a Skill Americano round.
 * Same diversity logic as Americano, but also minimizes skill gap between teams.
 */
function generateSkillAmericanoRound(
  playing: Player[],
  courts: number,
  history: HistoryMaps,
): Match[] {
  const playerMap = new Map(playing.map((p) => [p.id, p]));
  const matches: Match[] = [];
  const pool = shuffle(playing.map((p) => p.id));

  let bestMatches: Match[] = [];
  let bestTotalScore = Infinity;
  const attempts = Math.min(30, Math.max(10, playing.length * 2));

  for (let attempt = 0; attempt < attempts; attempt++) {
    const shuffled = attempt === 0 ? pool : shuffle(pool);
    const candidateMatches: Match[] = [];
    let totalScore = 0;

    for (let court = 1; court <= courts; court++) {
      const start = (court - 1) * 4;
      const group = shuffled.slice(start, start + 4);
      if (group.length < 4) break;

      // Try all 3 splits, pick best skill-balanced one
      const [a, b, c, d] = group;
      const splits: [string, string, string, string][] = [
        [a, b, c, d],
        [a, c, b, d],
        [a, d, b, c],
      ];

      let bestSplit = { teamA: [a, b], teamB: [c, d] };
      let bestSplitScore = Infinity;

      for (const [x1, x2, y1, y2] of splits) {
        const s = scoreSkillPairing([x1, x2], [y1, y2], playerMap, history);
        if (s < bestSplitScore) {
          bestSplitScore = s;
          bestSplit = { teamA: [x1, x2], teamB: [y1, y2] };
        }
      }

      totalScore += bestSplitScore;
      candidateMatches.push({
        id: generateMatchId(),
        court,
        teamA: { playerIds: bestSplit.teamA },
        teamB: { playerIds: bestSplit.teamB },
        status: "upcoming",
      });
    }

    if (totalScore < bestTotalScore) {
      bestTotalScore = totalScore;
      bestMatches = candidateMatches;
    }
  }

  return bestMatches.length > 0 ? bestMatches : matches;
}

// ─── Mix Americano player selection override ─────────────────────────────────

/**
 * For Mix Americano, select players respecting gender constraints:
 * each court needs 2M + 2F. Minority gender sits out less.
 */
function selectPlayersForMixRound(
  players: Player[],
  courts: number,
  history: HistoryMaps,
): { playing: Player[]; sittingOut: string[] } {
  const active = players.filter((p) => p.status === "active");
  const males = active.filter((p) => p.gender === "M");
  const females = active.filter((p) => p.gender === "F");

  const malesNeeded = courts * 2;
  const femalesNeeded = courts * 2;

  // Sort each gender group by fewest games first (fair rotation)
  const sortByPriority = (arr: Player[]) =>
    [...arr].sort((a, b) => {
      const gDiff = a.gamesPlayed - b.gamesPlayed;
      if (gDiff !== 0) return gDiff;
      return (history.sitOutCounts.get(b.id) || 0) - (history.sitOutCounts.get(a.id) || 0);
    });

  const sortedMales = sortByPriority(males);
  const sortedFemales = sortByPriority(females);

  const playingMales = sortedMales.slice(0, malesNeeded);
  const playingFemales = sortedFemales.slice(0, femalesNeeded);
  const playing = [...playingMales, ...playingFemales];

  const playingIds = new Set(playing.map((p) => p.id));
  const sittingOut = active.filter((p) => !playingIds.has(p.id)).map((p) => p.id);

  return { playing, sittingOut };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate matchups for a single round.
 */
export function generateRoundMatchups(
  players: Player[],
  courts: number,
  algorithm: Algorithm,
  previousRounds: Round[] = [],
  currentRound: number = 1,
): { matches: Match[]; sittingOut: string[] } {
  const active = players.filter((p) => p.status === "active");

  if (active.length < 4) {
    return { matches: [], sittingOut: active.map((p) => p.id) };
  }

  const history = buildHistory(players, previousRounds);

  // Select who plays and who sits out
  let playing: Player[];
  let sittingOut: string[];

  if (algorithm === "mix_americano") {
    ({ playing, sittingOut } = selectPlayersForMixRound(players, courts, history));
  } else {
    ({ playing, sittingOut } = selectPlayersForRound(players, courts, history));
  }

  if (playing.length < 4) {
    return { matches: [], sittingOut: active.map((p) => p.id) };
  }

  // Generate matches based on algorithm
  let matches: Match[];
  const isFirstRound = previousRounds.length === 0;

  switch (algorithm) {
    case "americano":
      matches = generateAmericanoRound(playing, courts, history);
      break;
    case "mexicano":
      matches = generateMexicanoRound(playing, courts, history, isFirstRound);
      break;
    case "mix_americano":
      matches = generateMixAmericanoRound(playing, courts, history);
      break;
    case "skill_americano":
      matches = generateSkillAmericanoRound(playing, courts, history);
      break;
    default:
      matches = generateAmericanoRound(playing, courts, history);
  }

  // Recompute sittingOut based on who actually got assigned a match
  const inMatch = new Set(matches.flatMap((m) => [...m.teamA.playerIds, ...m.teamB.playerIds]));
  const finalSittingOut = active.filter((p) => !inMatch.has(p.id)).map((p) => p.id);

  return { matches, sittingOut: finalSittingOut };
}

/**
 * Check if a round is completed (all matches are completed)
 */
function isRoundCompleted(round: Round): boolean {
  return round.matches.length > 0 && round.matches.every((m) => m.status === "completed");
}

/**
 * Generate full schedule for all rounds.
 * For Mexicano, only round 1 can be pre-generated; future rounds are placeholders.
 */
export function generateSchedule(
  players: Player[],
  config: { courts: number; rounds: number; algorithm: Algorithm },
  existingSchedule: Round[] = [],
  fromRound: number = 1,
): Round[] {
  const preservedRounds: Round[] = [];

  // Preserve rounds before fromRound or already completed
  existingSchedule.forEach((round) => {
    if (round.roundNumber < fromRound || isRoundCompleted(round)) {
      preservedRounds.push(round);
    }
  });

  preservedRounds.sort((a, b) => a.roundNumber - b.roundNumber);

  const schedule: Round[] = [];

  for (let roundNum = fromRound; roundNum <= config.rounds; roundNum++) {
    // Skip if already preserved (completed)
    if (preservedRounds.some((r) => r.roundNumber === roundNum)) {
      continue;
    }

    // For Mexicano round 2+: only generate if previous round is completed
    // (during schedule generation we can generate all upfront since we have the data)
    // But for future rounds that haven't been played yet, generate using current standings
    const allPrior = preservedRounds.concat(schedule);

    const { matches, sittingOut } = generateRoundMatchups(
      players,
      config.courts,
      config.algorithm,
      allPrior,
      roundNum,
    );

    schedule.push({ roundNumber: roundNum, matches, sittingOut });
  }

  return [...preservedRounds, ...schedule].sort((a, b) => a.roundNumber - b.roundNumber);
}

/**
 * Regenerate schedule when players change mid-session.
 * Only regenerates from currentRound onward, preserving completed rounds.
 */
export function regenerateSchedule(
  players: Player[],
  config: { courts: number; rounds: number; algorithm: Algorithm },
  existingSchedule: Round[],
  currentRound: number,
): Round[] {
  return generateSchedule(players, config, existingSchedule, currentRound);
}

/**
 * Reshuffle a single court's match using the active algorithm.
 * Returns a new match for the given court, using the algorithm's pairing logic.
 */
export function reshuffleMatch(
  players: Player[],
  algorithm: Algorithm,
  pool: Player[],
  court: number,
  previousRounds: Round[],
): Match | null {
  if (pool.length < 4) return null;

  const history = buildHistory(players, previousRounds);
  const fourPlayers = pool.slice(0, 4);

  let teamA: string[];
  let teamB: string[];

  switch (algorithm) {
    case "americano": {
      const pairing = bestAmericanoPairing(fourPlayers.map((p) => p.id), history);
      teamA = pairing.teamA;
      teamB = pairing.teamB;
      break;
    }
    case "mexicano": {
      // Mexicano reshuffle: use standings-based pairing
      const sorted = [...fourPlayers].sort((a, b) => b.totalPoints - a.totalPoints);
      teamA = [sorted[0].id, sorted[3].id];
      teamB = [sorted[1].id, sorted[2].id];
      break;
    }
    case "mix_americano": {
      const males = fourPlayers.filter((p) => p.gender === "M");
      const females = fourPlayers.filter((p) => p.gender === "F");
      if (males.length >= 2 && females.length >= 2) {
        // Proper mix pairing
        const option1 = { teamA: [males[0].id, females[0].id] as [string, string], teamB: [males[1].id, females[1].id] as [string, string] };
        const option2 = { teamA: [males[0].id, females[1].id] as [string, string], teamB: [males[1].id, females[0].id] as [string, string] };
        const s1 = scoreMixPairing(option1.teamA, option1.teamB, history);
        const s2 = scoreMixPairing(option2.teamA, option2.teamB, history);
        const best = s1 <= s2 ? option1 : option2;
        teamA = best.teamA;
        teamB = best.teamB;
      } else {
        // Fallback: best americano pairing
        const pairing = bestAmericanoPairing(fourPlayers.map((p) => p.id), history);
        teamA = pairing.teamA;
        teamB = pairing.teamB;
      }
      break;
    }
    case "skill_americano": {
      const playerMap = new Map(fourPlayers.map((p) => [p.id, p]));
      const ids = fourPlayers.map((p) => p.id);
      const [a, b, c, d] = ids;
      const splits: [string, string, string, string][] = [
        [a, b, c, d], [a, c, b, d], [a, d, b, c],
      ];
      let best = { teamA: [a, b], teamB: [c, d] };
      let bestScore = Infinity;
      for (const [x1, x2, y1, y2] of splits) {
        const s = scoreSkillPairing([x1, x2], [y1, y2], playerMap, history);
        if (s < bestScore) {
          bestScore = s;
          best = { teamA: [x1, x2], teamB: [y1, y2] };
        }
      }
      teamA = best.teamA;
      teamB = best.teamB;
      break;
    }
    default: {
      const pairing = bestAmericanoPairing(fourPlayers.map((p) => p.id), history);
      teamA = pairing.teamA;
      teamB = pairing.teamB;
    }
  }

  return {
    id: generateMatchId(),
    court,
    teamA: { playerIds: teamA },
    teamB: { playerIds: teamB },
    status: "upcoming",
  };
}

/**
 * Validate Mix Americano requirements.
 * Returns null if valid, or an error string if not.
 */
export function validateMixAmericano(players: Player[]): string | null {
  const active = players.filter((p) => p.status === "active");
  const males = active.filter((p) => p.gender === "M");
  const females = active.filter((p) => p.gender === "F");

  if (males.length < 2) return `Need at least 2 male players (have ${males.length})`;
  if (females.length < 2) return `Need at least 2 female players (have ${females.length})`;
  return null;
}

/**
 * For Mexicano: check if a future round should show placeholder text.
 * Returns true if the round can't be pre-generated because previous results aren't in.
 */
export function isMexicanoFutureRound(algorithm: Algorithm, roundNumber: number, completedRounds: Round[]): boolean {
  if (algorithm !== "mexicano") return false;
  if (roundNumber <= 1) return false;
  // Check if the previous round is completed
  const prevRound = completedRounds.find((r) => r.roundNumber === roundNumber - 1);
  return !prevRound || !isRoundCompleted(prevRound);
}
