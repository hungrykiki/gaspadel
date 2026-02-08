import { Player, Round, Match, Algorithm } from "./store";

/**
 * Generate a unique match ID (exported for creating matches when adding courts mid-session)
 */
export function generateMatchId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/**
 * Get skill label for display
 */
export function getSkillLabel(skill: number): string {
  switch (skill) {
    case 1:
      return "Newbie";
    case 2:
      return "Beginner";
    case 3:
      return "Intermediate";
    case 4:
      return "Advanced";
    case 5:
      return "Pro";
    default:
      return "Intermediate";
  }
}

/**
 * Get unique player name (adds number suffix if duplicate)
 */
export function getUniquePlayerName(
  baseName: string,
  existingPlayers: { name: string }[]
): string {
  const names = new Set(existingPlayers.map((p) => p.name));
  if (!names.has(baseName)) return baseName;
  let n = 2;
  while (names.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

/**
 * Calculate diversity score for a pairing
 * Lower score = better diversity (fewer repeat partners/opponents)
 */
function calculatePairingScore(
  teamA: string[],
  teamB: string[],
  partnerHistory: Map<string, Set<string>>,
  opponentHistory: Map<string, Set<string>>,
  courtHistory: Map<string, number>,
  targetCourt: number
): number {
  let score = 0;
  
  // Penalize repeat partners within teamA
  for (let i = 0; i < teamA.length; i++) {
    for (let j = i + 1; j < teamA.length; j++) {
      const partners = partnerHistory.get(teamA[i]);
      if (partners?.has(teamA[j])) {
        score += 10; // Heavy penalty for repeat partners
      }
    }
  }
  
  // Penalize repeat partners within teamB
  for (let i = 0; i < teamB.length; i++) {
    for (let j = i + 1; j < teamB.length; j++) {
      const partners = partnerHistory.get(teamB[i]);
      if (partners?.has(teamB[j])) {
        score += 10; // Heavy penalty for repeat partners
      }
    }
  }
  
  // Penalize repeat opponents
  for (const idA of teamA) {
    for (const idB of teamB) {
      const opponents = opponentHistory.get(idA);
      if (opponents?.has(idB)) {
        score += 5; // Moderate penalty for repeat opponents
      }
    }
  }
  
  // Penalize staying on same court
  for (const id of [...teamA, ...teamB]) {
    const lastCourt = courtHistory.get(id);
    if (lastCourt === targetCourt) {
      score += 8; // Heavy penalty for same court
    }
  }
  
  return score;
}

/**
 * Generate optimal pairing for 4 players considering diversity
 */
function generateOptimalPairing(
  players: Player[],
  algorithm: Algorithm,
  partnerHistory: Map<string, Set<string>>,
  opponentHistory: Map<string, Set<string>>,
  courtHistory: Map<string, number>,
  targetCourt: number
): { teamA: string[]; teamB: string[] } {
  const playerIds = players.map((p) => p.id);
  
  if (algorithm === "random") {
    // Random pairing but still try to avoid repeats
    const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
    return {
      teamA: [shuffled[0], shuffled[1]],
      teamB: [shuffled[2], shuffled[3]],
    };
  }
  
  if (algorithm === "king") {
    // King of the Court: prioritize players with fewer games
    const sorted = [...players].sort((a, b) => a.gamesPlayed - b.gamesPlayed);
    return {
      teamA: [sorted[0].id, sorted[1].id],
      teamB: [sorted[2].id, sorted[3].id],
    };
  }
  
  // Balanced: try multiple pairings and pick the best one
  const sorted = [...players].sort((a, b) => b.skill - a.skill);
  
  // Try different pairings
  const candidates: { teamA: string[]; teamB: string[]; score: number }[] = [];
  
  // Option 1: High+Low vs Mid+Mid (default balanced)
  const option1 = {
    teamA: [sorted[0].id, sorted[3].id],
    teamB: [sorted[1].id, sorted[2].id],
  };
  candidates.push({
    ...option1,
    score: calculatePairingScore(option1.teamA, option1.teamB, partnerHistory, opponentHistory, courtHistory, targetCourt),
  });
  
  // Option 2: High+Mid vs Low+Mid (alternative balanced)
  const option2 = {
    teamA: [sorted[0].id, sorted[2].id],
    teamB: [sorted[1].id, sorted[3].id],
  };
  candidates.push({
    ...option2,
    score: calculatePairingScore(option2.teamA, option2.teamB, partnerHistory, opponentHistory, courtHistory, targetCourt),
  });
  
  // Option 3: High+Mid vs Low+Mid (swapped)
  const option3 = {
    teamA: [sorted[0].id, sorted[1].id],
    teamB: [sorted[2].id, sorted[3].id],
  };
  candidates.push({
    ...option3,
    score: calculatePairingScore(option3.teamA, option3.teamB, partnerHistory, opponentHistory, courtHistory, targetCourt),
  });
  
  // Pick the pairing with the lowest score (best diversity)
  candidates.sort((a, b) => a.score - b.score);
  return { teamA: candidates[0].teamA, teamB: candidates[0].teamB };
}

/**
 * Generate matchups for a single round
 * Players rotate across ALL courts - no player stays on the same court consecutive rounds
 * Maximizes partner diversity, opponent diversity, and court rotation
 */
export function generateRoundMatchups(
  players: Player[],
  courts: number,
  algorithm: Algorithm,
  previousRounds: Round[] = [],
  currentRound: number = 1
): { matches: Match[]; sittingOut: string[] } {
  // Filter to active players only (exclude paused, removed, and sitting_out)
  const activePlayers = players.filter((p) => p.status === "active");

  if (activePlayers.length < 4) {
    return {
      matches: [],
      sittingOut: activePlayers.map((p) => p.id),
    };
  }

  const matches: Match[] = [];
  const playersNeeded = courts * 4;
  const playersToUse = [...activePlayers];

  // Track partner/opponent/court history from previous rounds
  const partnerHistory = new Map<string, Set<string>>();
  const opponentHistory = new Map<string, Set<string>>();
  const courtHistory = new Map<string, number>(); // Last court each player was on
  const sitOutCounts = new Map<string, number>(); // How many times each player sat out

  // Initialize history maps
  activePlayers.forEach((p) => {
    partnerHistory.set(p.id, new Set());
    opponentHistory.set(p.id, new Set());
    sitOutCounts.set(p.id, p.sitOutCount || 0);
  });

  // Build history from previous rounds
  previousRounds.forEach((round) => {
    round.matches.forEach((match) => {
      const court = match.court;
      
      // Track partners
      match.teamA.playerIds.forEach((id1) => {
        match.teamA.playerIds.forEach((id2) => {
          if (id1 !== id2) {
            partnerHistory.get(id1)?.add(id2);
          }
        });
        courtHistory.set(id1, court);
      });
      
      match.teamB.playerIds.forEach((id1) => {
        match.teamB.playerIds.forEach((id2) => {
          if (id1 !== id2) {
            partnerHistory.get(id1)?.add(id2);
          }
        });
        courtHistory.set(id1, court);
      });

      // Track opponents
      match.teamA.playerIds.forEach((id1) => {
        match.teamB.playerIds.forEach((id2) => {
          opponentHistory.get(id1)?.add(id2);
          opponentHistory.get(id2)?.add(id1);
        });
      });
    });
    
    // Track sit-outs
    round.sittingOut.forEach((id) => {
      sitOutCounts.set(id, (sitOutCounts.get(id) || 0) + 1);
    });
  });

  // Track who played in recent rounds for rest rules
  const playedLastRound = new Set<string>();
  const playedTwoRoundsAgo = new Set<string>();

  if (previousRounds.length > 0) {
    const lastRound = previousRounds[previousRounds.length - 1];
    lastRound.matches.forEach((match) => {
      match.teamA.playerIds.forEach((id) => playedLastRound.add(id));
      match.teamB.playerIds.forEach((id) => playedLastRound.add(id));
    });
  }

  if (previousRounds.length > 1) {
    const twoRoundsAgo = previousRounds[previousRounds.length - 2];
    twoRoundsAgo.matches.forEach((match) => {
      match.teamA.playerIds.forEach((id) => playedTwoRoundsAgo.add(id));
      match.teamB.playerIds.forEach((id) => playedTwoRoundsAgo.add(id));
    });
  }

  // Determine who must sit out (rest rule: no more than 2 consecutive rounds)
  const mustSitOut = new Set<string>();
  playedLastRound.forEach((id) => {
    if (playedTwoRoundsAgo.has(id)) mustSitOut.add(id);
  });

  // Score players for selection (lower = higher priority)
  // Prioritize: players who sat out more, haven't played recently, have fewer games
  const playerScores = playersToUse.map((p) => {
    let score = 0;
    score -= (sitOutCounts.get(p.id) || 0) * 100; // Prioritize those who sat out more
    score -= p.gamesPlayed * 10; // Prioritize those with fewer games
    if (playedLastRound.has(p.id)) score += 50; // Deprioritize those who played last round
    if (mustSitOut.has(p.id)) score += 200; // Heavy penalty for must-sit-out
    return { player: p, score };
  });

  // Sort by score (lower = higher priority)
  playerScores.sort((a, b) => a.score - b.score);

  // Select players for this round
  const selectedPlayers: Player[] = [];
  const remainingPlayers = [...playerScores];

  // First pass: select players not in mustSitOut
  for (const { player } of remainingPlayers) {
    if (selectedPlayers.length >= playersNeeded) break;
    if (!mustSitOut.has(player.id)) {
      selectedPlayers.push(player);
    }
  }

  // Second pass: if not enough, fill from mustSitOut (but still prioritize by score)
  if (selectedPlayers.length < playersNeeded) {
    for (const { player } of remainingPlayers) {
      if (selectedPlayers.length >= playersNeeded) break;
      if (!selectedPlayers.includes(player)) {
        selectedPlayers.push(player);
      }
    }
  }

  // Determine who sits out
  const sittingOut = playersToUse
    .filter((p) => !selectedPlayers.includes(p))
    .map((p) => p.id);

  // Generate matches for each court with optimal pairings
  const availablePlayers = [...selectedPlayers];
  
  for (let court = 1; court <= courts && availablePlayers.length >= 4; court++) {
    // Select 4 players for this court, trying to maximize diversity
    const courtPlayers: Player[] = [];
    const used = new Set<string>();
    
    // Greedy selection: pick players that maximize diversity
    while (courtPlayers.length < 4 && availablePlayers.length > 0) {
      let bestPlayer: Player | null = null;
      let bestScore = Infinity;
      
      for (const player of availablePlayers) {
        if (used.has(player.id)) continue;
        
        // Calculate score: prefer players who haven't been on this court
        let score = 0;
        const lastCourt = courtHistory.get(player.id);
        if (lastCourt === court) score += 100; // Heavy penalty for same court
        
        // Prefer players who haven't partnered with already selected players
        for (const selected of courtPlayers) {
          const partners = partnerHistory.get(player.id);
          if (partners?.has(selected.id)) {
            score += 50; // Penalty for repeat partner
          }
        }
        
        if (score < bestScore) {
          bestScore = score;
          bestPlayer = player;
        }
      }
      
      if (bestPlayer) {
        courtPlayers.push(bestPlayer);
        used.add(bestPlayer.id);
      } else {
        // Fallback: just take next available
        const next = availablePlayers.find((p) => !used.has(p.id));
        if (next) {
          courtPlayers.push(next);
          used.add(next.id);
        } else {
          break;
        }
      }
    }
    
    // Remove selected players from available pool
    courtPlayers.forEach((p) => {
      const index = availablePlayers.findIndex((ap) => ap.id === p.id);
      if (index >= 0) availablePlayers.splice(index, 1);
    });
    
    // Generate optimal pairing
    const { teamA, teamB } = generateOptimalPairing(
      courtPlayers,
      algorithm,
      partnerHistory,
      opponentHistory,
      courtHistory,
      court
    );

    matches.push({
      id: generateMatchId(),
      court,
      teamA: { playerIds: teamA },
      teamB: { playerIds: teamB },
      status: "upcoming",
    });
  }

  return { matches, sittingOut };
}

/**
 * Check if a round is completed (all matches are completed)
 */
function isRoundCompleted(round: Round): boolean {
  return round.matches.length > 0 && round.matches.every((m) => m.status === "completed");
}

/**
 * Generate full schedule for all rounds
 * Only regenerates FUTURE rounds, preserving completed rounds
 * Never mutates completed rounds - they are immutable
 */
export function generateSchedule(
  players: Player[],
  config: { courts: number; rounds: number; algorithm: Algorithm },
  existingSchedule: Round[] = [],
  fromRound: number = 1
): Round[] {
  const schedule: Round[] = [];
  const preservedRounds: Round[] = [];

  // Preserve rounds before fromRound (definitely past/completed)
  // Also preserve rounds >= fromRound that are fully completed
  existingSchedule.forEach((round) => {
    if (round.roundNumber < fromRound || isRoundCompleted(round)) {
      preservedRounds.push(round);
    }
  });

  // Sort preserved rounds for context
  preservedRounds.sort((a, b) => a.roundNumber - b.roundNumber);

  // Determine which rounds need to be generated
  const existingRoundNumbers = new Set(existingSchedule.map((r) => r.roundNumber));
  
  // Generate rounds from fromRound to config.rounds
  for (let roundNum = fromRound; roundNum <= config.rounds; roundNum++) {
    // Skip if this round is already preserved (completed)
    if (preservedRounds.some((r) => r.roundNumber === roundNum)) {
      continue;
    }

    // Generate this round using all previous rounds (preserved + newly generated) as context
    const { matches, sittingOut } = generateRoundMatchups(
      players,
      config.courts,
      config.algorithm,
      preservedRounds.concat(schedule),
      roundNum
    );

    schedule.push({
      roundNumber: roundNum,
      matches,
      sittingOut,
    });
  }

  // Merge: preserved rounds + newly generated rounds, sorted by round number
  const allRounds = [...preservedRounds, ...schedule].sort((a, b) => a.roundNumber - b.roundNumber);
  return allRounds;
}

/**
 * Regenerate schedule when players are added/removed mid-session
 * Only regenerates FUTURE rounds
 */
export function regenerateSchedule(
  players: Player[],
  config: { courts: number; rounds: number; algorithm: Algorithm },
  existingSchedule: Round[],
  currentRound: number
): Round[] {
  return generateSchedule(players, config, existingSchedule, currentRound);
}
