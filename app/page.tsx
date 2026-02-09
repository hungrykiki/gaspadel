"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useStore, Player } from "../lib/store";
import { generateSchedule, regenerateSchedule, getUniquePlayerName, generateRoundMatchups, generateMatchId } from "../lib/scheduler";

type Screen = "setup" | "session" | "leaderboard" | "schedule";

const SKILL_OPTIONS: { value: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { value: 1, label: "1 - Newbie" },
  { value: 2, label: "2 - Beginner" },
  { value: 3, label: "3 - Intermediate" },
  { value: 4, label: "4 - Advanced" },
  { value: 5, label: "5 - Pro" },
];

// Teal gradient for skill: 1=lightest, 5=darkest. Deep blue text on 1–2, white on 3–5.
const SKILL_HEX: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "#D0ECE7",
  2: "#A8DDD2",
  3: "#2DBDA8",
  4: "#238F7E",
  5: "#1E3A5F",
};

function skillPillStyle(skill: 1 | 2 | 3 | 4 | 5): { bg: string; textClass: string } {
  const deepBlueText = "text-[#1E3A5F]";
  const whiteText = "text-white";
  return {
    bg: SKILL_HEX[skill],
    textClass: skill >= 3 ? whiteText : deepBlueText,
  };
}

/** Shared header: logo + tab bar. Same on every tab; only the active pill changes. */
function AppHeader({
  screen,
  setScreen,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
}) {
  const tabs: { id: Screen; label: string }[] = [
    { id: "setup", label: "Setup" },
    { id: "session", label: "Session" },
    { id: "schedule", label: "Schedule" },
    { id: "leaderboard", label: "Leaderboard" },
  ];
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-[#E2E8F0] px-3 sm:px-4 pb-3">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#2DBDA8] pt-4 sm:pt-6 pb-3">
        gaspadel
      </h1>
      <nav className="flex gap-1 rounded-xl bg-[#F1F5F9] p-1.5 overflow-x-auto">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setScreen(id)}
            className={`flex-1 min-w-0 rounded-full py-3 sm:py-2.5 text-sm font-medium transition shrink-0 touch-manipulation min-h-[44px] sm:min-h-0 ${
              screen === id ? "bg-[#2DBDA8] text-white" : "text-[#1A1A1A] hover:opacity-80"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("setup");
  
  // Zustand store
  const {
    config,
    players,
    savedRoster,
    sessionActive,
    currentRound,
    schedule,
    setConfig,
    addPlayer: storeAddPlayer,
    removePlayer: storeRemovePlayer,
    pausePlayer: storePausePlayer,
    resumePlayer: storeResumePlayer,
    updatePlayer,
    loadFromSavedRoster,
    startSession: storeStartSession,
    endSession: storeEndSession,
    setCurrentRound,
    setSchedule,
    updateMatchScore,
    completeMatch,
    undoLastAction,
    undoStack,
  } = useStore();

  // Local UI state
  const [newName, setNewName] = useState("");
  const [newSkill, setNewSkill] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingPlayerName, setEditingPlayerName] = useState("");
  const [editingPlayerSkill, setEditingPlayerSkill] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [selectedCourt, setSelectedCourt] = useState<number>(1);
  const [scheduleFilterCourts, setScheduleFilterCourts] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [regularsSelected, setRegularsSelected] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);
  const [sessionDuration, setSessionDuration] = useState<number>(60);
  const [durationOptions, setDurationOptions] = useState<number[]>([60, 120, 180]);
  const [algorithmExpanded, setAlgorithmExpanded] = useState(false);

  const addToast = useCallback((message: string) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev.slice(-4), { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // Get active players
  const activePlayers = useMemo(
    () => players.filter((p) => p.status === "active"),
    [players]
  );

  // Get current round data
  const currentRoundData = useMemo(() => {
    return schedule.find((r) => r.roundNumber === currentRound);
  }, [schedule, currentRound]);

  // Get current match for selected court
  const currentMatch = useMemo(() => {
    return currentRoundData?.matches.find((m) => m.court === selectedCourt);
  }, [currentRoundData, selectedCourt]);

  // Get current round matches (for court switcher and completion check)
  const currentRoundMatches = useMemo(() => {
    return currentRoundData?.matches || [];
  }, [currentRoundData]);

  // Courts that have a match in the current round (for switcher pills only)
  const courtsWithMatchInCurrentRound = useMemo(() => {
    return [...new Set((currentRoundData?.matches ?? []).map((m) => m.court))].sort((a, b) => a - b);
  }, [currentRoundData]);

  // Keep selectedCourt valid when schedule changes (e.g. add/remove court)
  useEffect(() => {
    if (!sessionActive || courtsWithMatchInCurrentRound.length === 0) return;
    if (!courtsWithMatchInCurrentRound.includes(selectedCourt)) {
      setSelectedCourt(courtsWithMatchInCurrentRound[0]);
    }
  }, [sessionActive, courtsWithMatchInCurrentRound, selectedCourt]);

  const addPlayer = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const skillToUse = config.algorithm === "balanced" ? newSkill : (3 as 1 | 2 | 3 | 4 | 5);
    
    storeAddPlayer(name, skillToUse);
    
    if (sessionActive) {
      const updatedPlayers = useStore.getState().players;
      const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
      setSchedule(newSchedule);
      addToast(`${name} joined — will play next round`);
    }
    
    setNewName("");
    setNewSkill(3);
  }, [newName, newSkill, config, sessionActive, schedule, currentRound, storeAddPlayer, setSchedule, addToast]);

  const startEditingPlayer = useCallback((player: Player) => {
    setEditingPlayerId(player.id);
    setEditingPlayerName(player.name);
    setEditingPlayerSkill(player.skill);
  }, []);

  const cancelEditingPlayer = useCallback(() => {
    setEditingPlayerId(null);
    setEditingPlayerName("");
    setEditingPlayerSkill(3);
  }, []);

  const saveEditedPlayer = useCallback(() => {
    if (!editingPlayerId) return;
    const trimmedName = editingPlayerName.trim();
    if (!trimmedName) {
      cancelEditingPlayer();
      return;
    }

    const existingPlayer = players.find((p) => p.id === editingPlayerId);
    if (!existingPlayer) {
      cancelEditingPlayer();
      return;
    }

    const uniqueName = getUniquePlayerName(trimmedName, players.filter((p) => p.id !== editingPlayerId));
    updatePlayer(editingPlayerId, {
      name: uniqueName,
      skill: config.algorithm === "balanced" ? editingPlayerSkill : existingPlayer.skill,
    });

    // If session is active, regenerate schedule
    if (sessionActive) {
      const updatedPlayers = useStore.getState().players;
      // Regenerate from NEXT round to preserve current round in progress
      const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
      setSchedule(newSchedule);
    }

    cancelEditingPlayer();
  }, [editingPlayerId, editingPlayerName, editingPlayerSkill, config, players, sessionActive, schedule, currentRound, updatePlayer, setSchedule, cancelEditingPlayer]);

  const updatePlayerSkill = useCallback((playerId: string, newSkill: 1 | 2 | 3 | 4 | 5) => {
    if (config.algorithm !== "balanced") return;

    updatePlayer(playerId, { skill: newSkill });

    // If session is active, regenerate schedule
    if (sessionActive) {
      const updatedPlayers = useStore.getState().players;
      // Regenerate from NEXT round to preserve current round in progress
      const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
      setSchedule(newSchedule);
    }
  }, [config, sessionActive, schedule, currentRound, updatePlayer, setSchedule]);

  const handleRemovePlayer = useCallback(
    (id: string) => {
      storeRemovePlayer(id);
      setDeleteConfirmId(null);
      if (sessionActive) {
        const updatedPlayers = useStore.getState().players;
        const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
        setSchedule(newSchedule);
      }
    },
    [sessionActive, config, schedule, currentRound, storeRemovePlayer, setSchedule]
  );

  const handlePausePlayer = useCallback(
    (id: string) => {
      const name = players.find((p) => p.id === id)?.name;
      storePausePlayer(id);
      if (sessionActive) {
        const updatedPlayers = useStore.getState().players;
        const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
        setSchedule(newSchedule);
        if (name) addToast(`${name} paused`);
      }
    },
    [players, sessionActive, config, schedule, currentRound, storePausePlayer, setSchedule, addToast]
  );

  const handleResumePlayer = useCallback(
    (id: string) => {
      storeResumePlayer(id);
      if (sessionActive) {
        const updatedPlayers = useStore.getState().players;
        const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
        setSchedule(newSchedule);
      }
    },
    [sessionActive, config, schedule, currentRound, storeResumePlayer, setSchedule]
  );

  const handleAddSelectedRegulars = useCallback(() => {
    savedRoster.forEach((sp) => {
      if (regularsSelected.has(sp.id)) {
        loadFromSavedRoster(sp);
      }
    });
    setRegularsSelected(new Set());
    if (sessionActive) {
      const updatedPlayers = useStore.getState().players;
      const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
      setSchedule(newSchedule);
    }
  }, [savedRoster, regularsSelected, sessionActive, config, schedule, currentRound, loadFromSavedRoster, setSchedule]);

  const startSession = useCallback(() => {
    if (activePlayers.length < config.courts * 4) return;
    
    // Generate initial schedule
    const newSchedule = generateSchedule(activePlayers, config);
    setSchedule(newSchedule);
    storeStartSession();
    setScreen("session");
  }, [activePlayers, config, setSchedule, storeStartSession]);

  const getPlayer = useCallback(
    (id: string) => players.find((p) => p.id === id),
    [players]
  );

  const endSession = useCallback(() => {
    storeEndSession();
    setScreen("leaderboard");
  }, [storeEndSession]);

  const leaderboardSorted = useMemo(() => {
    return [...players]
      .filter((p) => p.status !== "removed")
      .sort((a, b) => {
        const aPts = a.totalPoints ?? 0;
        const bPts = b.totalPoints ?? 0;
        if (bPts !== aPts) return bPts - aPts;
        return (b.wins ?? 0) - (a.wins ?? 0);
      });
  }, [players]);

  const canStartSession = activePlayers.length >= config.courts * 4;

  // Get all players currently playing across all courts in current round
  const allPlayingThisRound = useMemo(() => {
    const playing = new Set<string>();
    if (currentRoundData) {
      currentRoundData.matches.forEach((match) => {
        match.teamA.playerIds.forEach((id) => playing.add(id));
        match.teamB.playerIds.forEach((id) => playing.add(id));
      });
    }
    return playing;
  }, [currentRoundData]);

  const allSittingOut = useMemo(() => {
    return currentRoundData?.sittingOut || [];
  }, [currentRoundData]);

  // Match duration in minutes: 8 (Short/16pts), 10 (Standard/21pts), 13 (Long/32pts) — for time-based round count
  const matchDurationMinutes = useMemo(() => {
    if (config.pointsPerMatch <= 16) return 8;
    if (config.pointsPerMatch <= 21) return 10;
    return 13;
  }, [config.pointsPerMatch]);

  function gcd(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);
    return b ? gcd(b, a % b) : a;
  }

  // Two constraints: (1) fill session duration, (2) equal matches per player (rounds so sit-outs distribute evenly)
  const balancedRoundParams = useMemo(() => {
    const N = Math.max(4, activePlayers.length);
    const C = config.courts;
    const timeBasedRounds = Math.round(sessionDuration / matchDurationMinutes);
    const step = N / gcd(4 * C, N) || 1;
    const balancedRounds = Math.max(
      1,
      Math.min(99, Math.ceil(Math.max(1, timeBasedRounds) / step) * step)
    );
    const matchesPerPlayer = N > 0 ? Math.floor((4 * balancedRounds * C) / N) : 0;
    return { balancedRounds, step, matchesPerPlayer };
  }, [activePlayers.length, config.courts, sessionDuration, matchDurationMinutes]);

  const effectivePoints = config.pointsPerMatch;

  // When session is active: offer adding X rounds so everyone plays Y more matches equally (X = balanced step). Shown even before all rounds complete.
  const timeLeftRecommendation = useMemo(() => {
    if (!sessionActive || activePlayers.length < 4) return null;
    const N = activePlayers.length;
    const C = config.courts;
    const step = balancedRoundParams.step;
    const extraMatchesPerPlayer = Math.floor((4 * step * C) / N);
    if (extraMatchesPerPlayer < 1) return null;
    return {
      addRounds: step,
      extraMatchesPerPlayer,
    };
  }, [sessionActive, activePlayers.length, config.courts, balancedRoundParams.step]);

  const hasTimeLeftRecommendation = timeLeftRecommendation !== null;

  // Set rounds and regenerate schedule from next round when session active and increasing
  const setRoundsWithSchedule = useCallback(
    (newRounds: number) => {
      const prevRounds = config.rounds;
      setConfig({ rounds: newRounds });
      if (sessionActive && newRounds > prevRounds) {
        const updatedPlayers = useStore.getState().players;
        const newSchedule = regenerateSchedule(updatedPlayers, { ...config, rounds: newRounds }, schedule, currentRound + 1);
        setSchedule(newSchedule);
      }
    },
    [config, schedule, currentRound, sessionActive, setConfig, setSchedule]
  );

  // Get player status for display
  const getPlayerStatus = useCallback((player: Player): "Playing" | "Waiting" | "Paused" | "Joining next round" | "Sitting out" => {
    // Check if player is paused
    if (player.status === "paused") {
      return "Paused";
    }
    
    if (!sessionActive) {
      return "Waiting";
    }
    
    // Check if player joined after current round started
    if (player.joinedAtRound > currentRound) {
      return "Joining next round";
    }
    
    // Check if player is in current round matches
    if (currentRoundData) {
      const isPlaying = currentRoundData.matches.some(
        (match) => 
          match.teamA.playerIds.includes(player.id) || 
          match.teamB.playerIds.includes(player.id)
      );
      if (isPlaying) {
        return "Playing";
      }
      
      // Check if sitting out
      if (currentRoundData.sittingOut.includes(player.id)) {
        return "Sitting out";
      }
    }
    
    return "Waiting";
  }, [sessionActive, currentRound, currentRoundData]);


  return (
    <div className="min-h-screen font-sans bg-[#FFFFFF] text-[#1A1A1A]">
      <div className="mx-auto max-w-lg min-w-0 w-full px-3 sm:px-4 pb-20 sm:pb-24 safe-area-pb box-border">
        <AppHeader screen={screen} setScreen={setScreen} />

        {/* --- Setup Screen --- */}
        {screen === "setup" && (
          <div className="space-y-6">
            {/* Session Status Banner */}
            {sessionActive && (
              <div className="rounded-2xl bg-white border border-[#E2E8F0] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-[#1E3A5F]">Session Active</p>
                    <p className="text-xs text-[#64748B] mt-1">
                      Round {currentRound} of {config.rounds}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={endSession}
                    className="px-4 py-2 rounded-lg bg-[#C0444E]/10 border border-[#C0444E]/40 text-[#C0444E] text-sm font-medium hover:bg-[#C0444E]/20 touch-manipulation"
                  >
                    End Session
                  </button>
                </div>
              </div>
            )}

            {/* Courts: always editable on Setup, including mid-session */}
            <section className="rounded-2xl bg-white border border-[#E2E8F0] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Courts</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const newCourts = Math.max(1, config.courts - 1);
                    setConfig({ courts: newCourts });
                    if (sessionActive) {
                      const updatedPlayers = useStore.getState().players;
                      const newSchedule = regenerateSchedule(
                        updatedPlayers,
                        { ...config, courts: newCourts },
                        schedule,
                        currentRound + 1
                      );
                      setSchedule(newSchedule);
                    }
                  }}
                  disabled={config.courts === 1}
                  className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] disabled:opacity-50 disabled:bg-[#B0BEC5] disabled:cursor-not-allowed text-[#1E3A5F] text-xl font-bold touch-manipulation"
                  aria-label="Decrease courts"
                >
                  −
                </button>
                <div className="flex-1 min-w-0 rounded-xl bg-[#F1F5F9] px-4 py-3 text-center text-lg font-semibold text-[#1E3A5F] border border-[#E2E8F0]">
                  {config.courts} court{config.courts !== 1 ? "s" : ""}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newCourts = Math.min(4, config.courts + 1);
                    setConfig({ courts: newCourts });
                    if (sessionActive) {
                      const updatedPlayers = useStore.getState().players;
                      const currentRoundData = schedule.find((r) => r.roundNumber === currentRound);
                      let scheduleToRegenerate = schedule;
                      // If we have 4+ sitting out, add a match on the new court for the current round
                      if (currentRoundData && currentRoundData.sittingOut.length >= 4) {
                        const sittingOut = [...currentRoundData.sittingOut];
                        const shuffled = sittingOut.sort(() => Math.random() - 0.5);
                        const four = shuffled.slice(0, 4);
                        const fourSet = new Set(four);
                        const newMatch = {
                          id: generateMatchId(),
                          court: newCourts,
                          teamA: { playerIds: [four[0], four[1]] },
                          teamB: { playerIds: [four[2], four[3]] },
                          status: "upcoming" as const,
                        };
                        const updatedRound = {
                          ...currentRoundData,
                          matches: [...currentRoundData.matches, newMatch],
                          sittingOut: sittingOut.filter((id) => !fourSet.has(id)),
                        };
                        scheduleToRegenerate = schedule.map((r) =>
                          r.roundNumber === currentRound ? updatedRound : r
                        );
                      }
                      const newSchedule = regenerateSchedule(
                        updatedPlayers,
                        { ...config, courts: newCourts },
                        scheduleToRegenerate,
                        currentRound + 1
                      );
                      setSchedule(newSchedule);
                    }
                  }}
                  disabled={config.courts === 4}
                  className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#2DBDA8] hover:bg-[#238F7E] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xl font-bold touch-manipulation"
                  aria-label="Increase courts"
                >
                  +
                </button>
              </div>
              {sessionActive && (
                <p className="text-xs text-[#64748B] mt-2">
                  Current round updated if 4+ sitting out; future rounds use {config.courts} court{config.courts !== 1 ? "s" : ""}.
                </p>
              )}
            </section>

            {/* When no session: 3 hero inputs (Courts above) + Duration + Match length, then small rounds line */}
            {!sessionActive && (
              <>
                <section className="rounded-2xl bg-white border border-[#E2E8F0] p-4 space-y-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                  <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Duration / Match length</h2>
                  <div>
                    <p className="text-xs text-[#64748B] mb-1.5">Duration</p>
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1">
                      {durationOptions.map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setSessionDuration(mins)}
                          className={`shrink-0 rounded-xl px-4 py-3 text-sm font-semibold transition-all touch-manipulation ${
                            sessionDuration === mins
                              ? "bg-[#2DBDA8] text-white shadow-[0_2px_6px_rgba(45,189,168,0.4)]"
                              : "bg-white text-[#1A1A1A] border-2 border-[#E2E8F0] hover:border-[#2DBDA8]/40"
                          }`}
                        >
                          {mins} min
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const next = durationOptions[durationOptions.length - 1] + 60;
                          setDurationOptions((prev) => [...prev, next]);
                          setSessionDuration(next);
                        }}
                        className="shrink-0 rounded-xl px-4 py-3 text-sm font-medium bg-white text-[#1A1A1A] border-2 border-[#E2E8F0] hover:border-[#2DBDA8]/40 transition touch-manipulation"
                        aria-label="Add 60 minutes"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-[#64748B] mb-1.5">Match length</p>
                    <div className="flex gap-2 flex-wrap">
                      {[16, 21, 32].map((pts) => (
                        <button
                          key={pts}
                          type="button"
                          onClick={() => setConfig({ pointsPerMatch: pts })}
                          className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-all touch-manipulation ${
                            config.pointsPerMatch === pts
                              ? "bg-[#2DBDA8] text-white shadow-[0_2px_6px_rgba(45,189,168,0.4)]"
                              : "bg-white text-[#1A1A1A] border-2 border-[#E2E8F0] hover:border-[#2DBDA8]/40"
                          }`}
                        >
                          {pts} pts
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl bg-white border border-[#E2E8F0] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                  <button
                    type="button"
                    onClick={() => setAlgorithmExpanded((e) => !e)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[#1A1A1A] bg-white hover:bg-[#F8FAFC] border-2 border-[#E2E8F0] hover:border-[#2DBDA8]/30 touch-manipulation"
                    aria-expanded={algorithmExpanded}
                  >
                    <span>Matching: {config.algorithm === "balanced" ? "Balanced" : config.algorithm === "random" ? "Random" : "King of the Court"} ▾</span>
                  </button>
                  {algorithmExpanded && (
                    <div className="flex flex-col gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfig({ algorithm: "balanced" });
                          if (sessionActive) {
                            const newSchedule = regenerateSchedule(players, { ...config, algorithm: "balanced" }, schedule, currentRound + 1);
                            setSchedule(newSchedule);
                          }
                        }}
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm border ${
                          config.algorithm === "balanced"
                            ? "border-[#2DBDA8] bg-[#2DBDA8]/10 text-[#1E3A5F]"
                            : "border-[#E2E8F0] bg-[#F1F5F9] text-[#1A1A1A]"
                        }`}
                      >
                        <div className="font-semibold">Balanced</div>
                        <p className="text-xs text-[#64748B]">Balance skill levels across teams for fair matchups.</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfig({ algorithm: "random" });
                          if (sessionActive) {
                            const newSchedule = regenerateSchedule(players, { ...config, algorithm: "random" }, schedule, currentRound + 1);
                            setSchedule(newSchedule);
                          }
                        }}
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm border ${
                          config.algorithm === "random"
                            ? "border-[#2DBDA8] bg-[#2DBDA8]/10 text-[#1E3A5F]"
                            : "border-[#E2E8F0] bg-[#F1F5F9] text-[#1A1A1A]"
                        }`}
                      >
                        <div className="font-semibold">Random</div>
                        <p className="text-xs text-[#64748B]">Fully randomized matchups, ignoring skill ratings.</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfig({ algorithm: "king" });
                          if (sessionActive) {
                            const newSchedule = regenerateSchedule(players, { ...config, algorithm: "king" }, schedule, currentRound + 1);
                            setSchedule(newSchedule);
                          }
                        }}
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm border ${
                          config.algorithm === "king"
                            ? "border-[#2DBDA8] bg-[#2DBDA8]/10 text-[#1E3A5F]"
                            : "border-[#E2E8F0] bg-[#F1F5F9] text-[#1A1A1A]"
                        }`}
                      >
                        <div className="font-semibold">King of the Court</div>
                        <p className="text-xs text-[#64748B]">Winning team stays on court; losing team rotates off.</p>
                      </button>
                    </div>
                  )}
                </section>
              </>
              )}

            <section className="rounded-2xl bg-white border border-[#E2E8F0] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-[#1A1A1A]">Players</h2>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${activePlayers.length >= config.courts * 4 ? "text-[#2DBDA8]" : "text-[#64748B]"}`}>
                    {activePlayers.length}
                  </span>
                  <span className="text-xs text-[#64748B]">/ {config.courts * 4} min</span>
                </div>
              </div>
              <p className="text-xs text-[#64748B] mb-3">
                Need at least {config.courts * 4} to start ({config.courts} court{config.courts > 1 ? "s" : ""}). You can add more during the session.
              </p>

              {/* Your regulars — quick re-add from saved roster */}
              {savedRoster.length > 0 && (() => {
                const currentIds = new Set(players.filter((x) => x.status !== "removed").map((x) => x.id));
                const regularsNotInRoster = savedRoster.filter((sp) => !currentIds.has(sp.id));
                if (regularsNotInRoster.length === 0) return null;
                return (
                  <div className="mb-4 rounded-2xl bg-white border-2 border-[#E2E8F0] p-3 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                    <h3 className="text-sm font-semibold text-[#1A1A1A] mb-2">Your regulars</h3>
                    <div className="flex flex-wrap gap-2">
                      {regularsNotInRoster.map((sp) => (
                        <label
                          key={sp.id}
                          className="flex items-center gap-2 rounded-lg bg-white border border-[#E2E8F0] px-3 py-2 cursor-pointer touch-manipulation min-h-[44px]"
                        >
                          <input
                            type="checkbox"
                            checked={regularsSelected.has(sp.id)}
                            onChange={(e) => {
                              setRegularsSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(sp.id);
                                else next.delete(sp.id);
                                return next;
                              });
                            }}
                            className="rounded border-[#E2E8F0] text-[#2DBDA8] focus:ring-[#2DBDA8]"
                          />
                          <span className="text-sm text-[#1E3A5F]">{sp.name}</span>
                          {config.algorithm === "balanced" && (
                            <span
                              className={`rounded-full px-1.5 h-5 flex items-center justify-center text-[10px] font-bold shrink-0 ${skillPillStyle(sp.skill).textClass}`}
                              style={{ backgroundColor: SKILL_HEX[sp.skill] }}
                            >
                              {sp.skill}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    {regularsSelected.size > 0 && (
                      <button
                        type="button"
                        onClick={handleAddSelectedRegulars}
                        className="mt-2 w-full rounded-lg bg-[#2DBDA8] py-2 text-sm font-medium text-white hover:bg-[#238F7E] touch-manipulation min-h-[40px]"
                      >
                        Add selected ({regularsSelected.size})
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Add player */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                  className="flex-1 min-w-0 rounded-xl bg-white px-4 py-2.5 text-[#1A1A1A] placeholder-[#B0BEC5] border border-[#E2E8F0] focus:border-[#2DBDA8] outline-none"
                />
                {config.algorithm === "balanced" && (
                  <div className="relative inline-flex shrink-0">
                    <span
                      className={`rounded-full pl-2.5 pr-1.5 h-7 flex items-center gap-0.5 text-sm font-bold ${skillPillStyle(newSkill).textClass}`}
                      style={{ backgroundColor: SKILL_HEX[newSkill] }}
                      aria-hidden
                    >
                      {newSkill} ▾
                    </span>
                    <select
                      value={newSkill}
                      onChange={(e) => setNewSkill(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-manipulation"
                      aria-label="Skill level"
                    >
                      {SKILL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  type="button"
                  onClick={addPlayer}
                  className="rounded-xl bg-[#2DBDA8] px-4 py-2.5 font-medium text-white hover:bg-[#238F7E] touch-manipulation min-h-[44px] shrink-0"
                >
                  Add
                </button>
              </div>

              {/* Player roster */}
              <ul className="space-y-1">
                {players.filter((p) => p.status !== "removed").map((p) => {
                  const isEditing = editingPlayerId === p.id;
                  const isPaused = p.status === "paused";
                  const showDeleteConfirm = deleteConfirmId === p.id;
                  return (
                    <li
                      key={p.id}
                      className={`flex flex-col rounded-xl border transition-all min-h-[48px] shadow-[0_1px_4px_rgba(0,0,0,0.05)] ${
                        isPaused ? "bg-[#E2E8F0]/40 opacity-80 border-[#E2E8F0]" : "bg-white border-[#E2E8F0] border-l-4 border-l-[#2DBDA8]"
                      } ${isEditing ? "ring-2 ring-[#2DBDA8] bg-white p-2" : "px-3 py-2"}`}
                    >
                      {isEditing ? (
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            value={editingPlayerName}
                            onChange={(e) => setEditingPlayerName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditedPlayer();
                              if (e.key === "Escape") cancelEditingPlayer();
                            }}
                            className="w-full rounded-lg bg-white px-3 py-2 text-[#1A1A1A] border border-[#E2E8F0] focus:border-[#2DBDA8] outline-none"
                            autoFocus
                          />
                          {config.algorithm === "balanced" && (
                            <select
                              value={editingPlayerSkill}
                              onChange={(e) => setEditingPlayerSkill(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                              className="w-full rounded-lg bg-white px-3 py-2 text-[#1A1A1A] border border-[#E2E8F0] focus:border-[#2DBDA8] outline-none"
                            >
                              {SKILL_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={saveEditedPlayer}
                              className="flex-1 rounded-lg bg-[#2DBDA8] px-3 py-2 text-sm font-medium text-white hover:bg-[#238F7E] touch-manipulation"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingPlayer}
                              className="flex-1 rounded-lg bg-[#E2E8F0] px-3 py-2 text-sm font-medium text-[#1E3A5F] hover:bg-[#E2E8F0]/80 touch-manipulation"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3 min-h-[36px]">
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => startEditingPlayer(p)}
                              className={`text-left text-sm font-medium hover:text-[#2DBDA8] transition-colors break-words w-full ${isPaused ? "text-[#B0BEC5]" : "text-[#1E3A5F]"}`}
                            >
                              {p.name}
                            </button>
                            {isPaused && (
                              <span className="text-xs text-[#64748B] block mt-0.5">Paused</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {config.algorithm === "balanced" && (
                              <div className="relative inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
                                <span
                                  className={`rounded-full pl-2 pr-1 h-6 flex items-center gap-0.5 text-xs font-bold ${skillPillStyle(p.skill).textClass}`}
                                  style={{ backgroundColor: SKILL_HEX[p.skill] }}
                                  aria-hidden
                                >
                                  {p.skill} ▾
                                </span>
                                <select
                                  value={p.skill}
                                  onChange={(e) => {
                                    const newSkill = Number(e.target.value) as 1 | 2 | 3 | 4 | 5;
                                    updatePlayerSkill(p.id, newSkill);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-manipulation"
                                  aria-label={`Skill level for ${p.name}`}
                                >
                                  {SKILL_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {isPaused ? (
                              <button
                                type="button"
                                onClick={() => handleResumePlayer(p.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2DBDA8] text-white hover:bg-[#238F7E] touch-manipulation"
                                aria-label={`Resume ${p.name}`}
                              >
                                <span className="text-sm leading-none" aria-hidden>▶</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handlePausePlayer(p.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E2E8F0] text-[#1E3A5F] hover:bg-[#E2E8F0]/80 touch-manipulation"
                                aria-label={`Pause ${p.name}`}
                              >
                                <span className="text-sm leading-none" aria-hidden>⏸</span>
                              </button>
                            )}
                            {showDeleteConfirm ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleRemovePlayer(p.id)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C0444E] text-white hover:bg-[#C0444E]/90 touch-manipulation"
                                  aria-label={`Confirm remove ${p.name}`}
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E2E8F0] text-[#1E3A5F] hover:bg-[#E2E8F0]/80 touch-manipulation"
                                  aria-label="Cancel"
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(p.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C0444E]/10 text-[#C0444E] hover:bg-[#C0444E]/20 text-sm font-semibold touch-manipulation"
                                aria-label={`Remove ${p.name}`}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {players.filter((p) => p.status !== "removed").length === 0 && (
                <p className="text-center text-[#64748B] text-sm py-4">
                  No players yet. Add above or select from Your regulars.
                </p>
              )}
            </section>

            {/* Rounds: after players — pre-session */}
            {!sessionActive && (
              <section className="rounded-2xl bg-white border border-[#E2E8F0] p-4 space-y-3 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Rounds</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfig({ rounds: Math.max(1, config.rounds - 1) })}
                    disabled={config.rounds === 1}
                    className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] disabled:opacity-50 disabled:bg-[#B0BEC5] text-[#1E3A5F] text-xl font-bold touch-manipulation"
                    aria-label="Decrease rounds"
                  >
                    −
                  </button>
                  <div className="flex-1 min-w-0 rounded-xl bg-[#F1F5F9] px-4 py-2.5 text-center text-lg font-semibold text-[#1E3A5F] border border-[#E2E8F0]">
                    {config.rounds}
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfig({ rounds: config.rounds + 1 })}
                    className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#2DBDA8] hover:bg-[#238F7E] text-white text-xl font-bold touch-manipulation"
                    aria-label="Increase rounds"
                  >
                    +
                  </button>
                </div>
                {activePlayers.length >= 4 && (
                  <button
                    type="button"
                    onClick={() => setConfig({ rounds: balancedRoundParams.balancedRounds })}
                    className="block w-full text-center text-[12px] sm:text-[13px] text-[#2DBDA8] hover:text-[#238F7E] hover:underline touch-manipulation mt-1"
                  >
                    Recommended: {balancedRoundParams.balancedRounds} (fills {sessionDuration} min)
                  </button>
                )}
              </section>
            )}

            {/* Rounds: after players — during session */}
            {sessionActive && (
              <section className="rounded-2xl bg-white border border-[#E2E8F0] p-4 space-y-3 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Rounds</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const newRounds = Math.max(currentRound, config.rounds - 1);
                      setConfig({ rounds: newRounds });
                    }}
                    disabled={config.rounds <= currentRound}
                    className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] disabled:opacity-50 disabled:bg-[#B0BEC5] disabled:cursor-not-allowed text-[#1E3A5F] text-xl font-bold touch-manipulation"
                    aria-label="Decrease rounds"
                  >
                    −
                  </button>
                  <div className="flex-1 min-w-0 rounded-xl bg-[#F1F5F9] px-4 py-2.5 text-center text-lg font-semibold text-[#1E3A5F] border border-[#E2E8F0]">
                    {config.rounds}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRoundsWithSchedule(config.rounds + 1)}
                    className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#2DBDA8] hover:bg-[#238F7E] text-white text-xl font-bold touch-manipulation"
                    aria-label="Increase rounds"
                  >
                    +
                  </button>
                </div>
                <p className="text-xs text-[#64748B] text-center">
                  {currentRound} completed · {Math.max(0, config.rounds - currentRound)} remaining
                </p>
                {activePlayers.length >= 4 && (
                  <button
                    type="button"
                    onClick={() => {
                      const recommended = balancedRoundParams.balancedRounds;
                      const newRounds = Math.max(currentRound, recommended);
                      setRoundsWithSchedule(newRounds);
                    }}
                    className="block w-full text-center text-[12px] sm:text-[13px] text-[#2DBDA8] hover:text-[#238F7E] hover:underline touch-manipulation mt-1"
                  >
                    Recommended: {balancedRoundParams.balancedRounds} (balanced play)
                  </button>
                )}
              </section>
            )}

            {!sessionActive && (
              <>
                <button
                  type="button"
                  onClick={startSession}
                  disabled={!canStartSession}
                  className={`w-full rounded-2xl py-5 text-lg font-bold touch-manipulation min-h-[56px] transition-all ${
                    canStartSession
                      ? "bg-[#2DBDA8] text-white hover:bg-[#238F7E] active:bg-[#238F7E] shadow-[0_4px_14px_rgba(45,189,168,0.45)] hover:shadow-[0_6px_20px_rgba(45,189,168,0.5)]"
                      : "bg-[#B0BEC5] text-[#64748B] cursor-not-allowed opacity-60"
                  }`}
                >
                  Start Session →
                </button>
                {!canStartSession && (
                  <p className="text-center text-sm text-[#64748B] mt-2">
                    Add at least {config.courts * 4} player{config.courts * 4 > 1 ? "s" : ""} to start ({config.courts} court{config.courts > 1 ? "s" : ""}).
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* --- Session Screen --- */}
        {screen === "session" && (
          <div className={`min-w-0 overflow-x-hidden w-full max-w-[100vw] ${sessionActive && currentMatch ? "flex flex-col h-[calc(100vh-7rem)]" : ""}`}>
            {!sessionActive ? (
              <div className="rounded-2xl bg-white border border-[#E2E8F0] p-6 text-center text-[#64748B] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                No active session. Start a session from Setup.
              </div>
            ) : !currentMatch ? (
              <div className="rounded-2xl bg-white border border-[#E2E8F0] p-6 text-center text-[#64748B] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                No match found for Court {selectedCourt} in Round {currentRound}.
              </div>
            ) : (
              <>
                {/* Add more rounds — tight under tab bar, no gap */}
                {hasTimeLeftRecommendation && currentRound >= config.rounds && (
                  <button
                    type="button"
                    onClick={() => setScreen("setup")}
                    className="w-full text-left px-3 py-2 bg-[#F1F5F9] border-b border-[#E2E8F0] text-[#1E3A5F] text-sm font-medium hover:bg-[#E2E8F0] active:bg-[#2DBDA8]/20 touch-manipulation shrink-0"
                  >
                    Add more rounds — tap Setup
                  </button>
                )}
                {/* Court header + progress — 8px padding, directly above score zones */}
                <div className="bg-[#FFFFFF] border-b border-[#E2E8F0] px-2 py-2 shrink-0">
                  <h2 className="text-base font-bold text-[#1E3A5F]">
                    Court {selectedCourt} · Round {currentRound} of {config.rounds}
                  </h2>
                  <div className="w-full h-1 bg-[#E2E8F0] rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-[#2DBDA8] transition-all duration-300"
                      style={{ width: `${(currentRound / config.rounds) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Court Switcher Pills — only courts with a match in the current round */}
                {courtsWithMatchInCurrentRound.length > 1 && (
                  <div className="px-2 py-1.5 bg-[#FFFFFF] border-b border-[#E2E8F0] shrink-0">
                    <div className="flex gap-1.5 overflow-x-auto">
                      {courtsWithMatchInCurrentRound.map((courtId) => {
                        const match = currentRoundMatches.find((m) => m.court === courtId);
                        const isSelected = selectedCourt === courtId;
                        const isComplete = match?.status === "completed";
                        const score = match?.score;
                        return (
                          <button
                            key={courtId}
                            type="button"
                            onClick={() => setSelectedCourt(courtId)}
                            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all touch-manipulation min-h-[44px] shrink-0 ${
                              isSelected
                                ? "bg-[#2DBDA8] text-white shadow-[0_2px_6px_rgba(45,189,168,0.4)]"
                                : "bg-white text-[#1A1A1A] border-2 border-[#E2E8F0] hover:border-[#2DBDA8]/30"
                            }`}
                          >
                            Court {courtId}
                            {score && (
                              <span className={`ml-2 text-xs ${isSelected ? "text-white/90" : "text-[#64748B]"}`}>
                                {score.teamA}-{score.teamB}
                              </span>
                            )}
                            {isComplete && <span className="ml-1.5">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Split-Screen Tap Zones — fill remaining height, 50/50 with 2px divider */}
                {(() => {
                  const match = currentMatch;
                  const score = match.score || { teamA: 0, teamB: 0 };
                  const scoreA = score.teamA;
                  const scoreB = score.teamB;
                  const totalScore = scoreA + scoreB;
                  const isMatchComplete = totalScore === config.pointsPerMatch && totalScore > 0;
                  const canIncrease = totalScore < config.pointsPerMatch;
                  const teamAWon = scoreA > scoreB;
                  const canConfirm = scoreA > 0 || scoreB > 0;

                  const vibrate = () => {
                    if (typeof navigator !== "undefined" && navigator.vibrate) {
                      navigator.vibrate(50);
                    }
                  };

                  return (
                    <div className="flex flex-col flex-1 min-h-0 min-w-0">
                      {/* Team A — soft sage/mint */}
                      <div
                        onClick={() => {
                          if (!canIncrease || !match) return;
                          vibrate();
                          updateMatchScore(currentRound, match.id, {
                            teamA: Math.min(config.pointsPerMatch, scoreA + 1),
                            teamB: scoreB,
                          });
                        }}
                        style={!isMatchComplete ? { backgroundColor: "#F1F5F9" } : undefined}
                        className={`relative flex-1 flex flex-col items-center justify-center p-3 min-h-0 touch-manipulation cursor-pointer ${
                          isMatchComplete && teamAWon
                            ? "bg-[#2DBDA8]/20"
                            : isMatchComplete
                            ? "bg-[#E2E8F0]/50"
                            : "hover:opacity-95 active:opacity-90 transition-opacity"
                        } ${!canIncrease ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <p className="text-base font-bold mb-2 text-center px-2 break-words min-w-0 w-full" style={{ color: "#1A1A1A" }}>
                          {match.teamA.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                        </p>
                        <div
                          className={`text-[56px] sm:text-[72px] font-bold leading-none ${isMatchComplete && teamAWon ? "text-[#2DBDA8]" : ""}`}
                          style={!isMatchComplete || !teamAWon ? { color: "#1A1A1A" } : undefined}
                        >
                          {scoreA}
                        </div>
                        {isMatchComplete && teamAWon && (
                          <p className="mt-2 text-base font-bold text-[#2DBDA8]">🏆 Winner!</p>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!match) return;
                            vibrate();
                            updateMatchScore(currentRound, match.id, { teamA: Math.max(0, scoreA - 1), teamB: scoreB });
                          }}
                          className="absolute bottom-2 right-2 w-8 h-8 rounded-md text-white text-sm font-bold flex items-center justify-center touch-manipulation z-10 hover:opacity-90 active:opacity-80 transition-opacity"
                          style={{ backgroundColor: "#1E3A5F" }}
                          aria-label="Subtract 1 point"
                        >
                          −1
                        </button>
                      </div>

                      {/* Subtle divider */}
                      <div className="h-0.5 shrink-0" style={{ backgroundColor: "#E2E8F0" }} />

                      {/* Team B — light blue tint */}
                      <div
                        onClick={() => {
                          if (!canIncrease || !match) return;
                          vibrate();
                          updateMatchScore(currentRound, match.id, {
                            teamA: scoreA,
                            teamB: Math.min(config.pointsPerMatch, scoreB + 1),
                          });
                        }}
                        style={!isMatchComplete ? { backgroundColor: "#F1F5F9" } : undefined}
                        className={`relative flex-1 flex flex-col items-center justify-center p-3 min-h-0 touch-manipulation cursor-pointer ${
                          isMatchComplete && !teamAWon
                            ? "bg-[#2DBDA8]/20"
                            : isMatchComplete
                            ? "bg-[#E2E8F0]/50"
                            : "hover:opacity-95 active:opacity-90 transition-opacity"
                        } ${!canIncrease ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <p className="text-base font-bold mb-2 text-center px-2 break-words min-w-0 w-full" style={{ color: "#1A1A1A" }}>
                          {match.teamB.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                        </p>
                        <div
                          className={`text-[56px] sm:text-[72px] font-bold leading-none ${isMatchComplete && !teamAWon ? "text-[#2DBDA8]" : ""}`}
                          style={!isMatchComplete || teamAWon ? { color: "#1A1A1A" } : undefined}
                        >
                          {scoreB}
                        </div>
                        {isMatchComplete && !teamAWon && (
                          <p className="mt-2 text-base font-bold text-[#2DBDA8]">🏆 Winner!</p>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!match) return;
                            vibrate();
                            updateMatchScore(currentRound, match.id, { teamA: scoreA, teamB: Math.max(0, scoreB - 1) });
                          }}
                          className="absolute bottom-2 right-2 w-8 h-8 rounded-md text-white text-sm font-bold flex items-center justify-center touch-manipulation z-10 hover:opacity-90 active:opacity-80 transition-opacity"
                          style={{ backgroundColor: "#1E3A5F" }}
                          aria-label="Subtract 1 point"
                        >
                          −1
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Bottom bar — Confirm, Reshuffle, Undo link, total */}
                <div className="shrink-0 bg-white border-t border-[#E2E8F0] px-2 py-2 space-y-1.5 min-w-0">
                  {(() => {
                    const match = currentMatch;
                    const score = match?.score || { teamA: 0, teamB: 0 };
                    const scoreA = score.teamA;
                    const scoreB = score.teamB;
                    const totalScore = scoreA + scoreB;
                    const isMatchComplete = totalScore === config.pointsPerMatch && totalScore > 0;
                    const teamAWon = scoreA > scoreB;
                    const canConfirm = scoreA > 0 || scoreB > 0;
                    const teamANames = match ? match.teamA.playerIds.map((id) => getPlayer(id)?.name).filter(Boolean).join(" & ") : "";
                    const teamBNames = match ? match.teamB.playerIds.map((id) => getPlayer(id)?.name).filter(Boolean).join(" & ") : "";

                    return (
                      <>
                        {isMatchComplete && (
                          <p className="text-sm font-bold text-[#1E3A5F] text-center break-words py-1">
                            🏆 {teamAWon ? teamANames : teamBNames} win! ({scoreA}-{scoreB})
                          </p>
                        )}

                        <div className="flex flex-col gap-1.5 min-w-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (!currentMatch) return;
                              completeMatch(currentRound, currentMatch.id);
                              const allComplete = currentRoundMatches.every(
                                (m) => m.status === "completed" || m.id === currentMatch.id
                              );
                              if (allComplete && currentRound < config.rounds) {
                                setCurrentRound(currentRound + 1);
                                setSelectedCourt(1);
                              }
                            }}
                            disabled={!canConfirm}
                            className="w-full rounded-xl bg-[#2DBDA8] py-3.5 text-base font-bold text-white hover:bg-[#238F7E] active:bg-[#238F7E] disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[52px] whitespace-nowrap shadow-[0_2px_8px_rgba(45,189,168,0.35)]"
                          >
                            {isMatchComplete ? "Log match" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!currentMatch || !currentRoundData) return;
                              const confirmed = window.confirm("Reshuffle with available players? (Paused players are excluded.)");
                              if (!confirmed) return;
                              // Pool = all active players except those playing on other courts this round (includes mid-session joiners)
                              const activePlayers = players.filter((p) => p.status === "active");
                              const playingOnOtherCourts = new Set(
                                currentRoundData.matches
                                  .filter((m) => m.court !== selectedCourt)
                                  .flatMap((m) => [...m.teamA.playerIds, ...m.teamB.playerIds])
                              );
                              const pool = activePlayers
                                .filter((p) => !playingOnOtherCourts.has(p.id))
                                .map((p) => p.id);
                              if (pool.length < 4) {
                                window.alert("Not enough active players to reshuffle (need 4). Unpause players or add more.");
                                return;
                              }
                              const shuffled = [...pool].sort(() => Math.random() - 0.5);
                              const four = shuffled.slice(0, 4);
                              const newMatch = {
                                ...currentMatch,
                                teamA: { playerIds: [four[0], four[1]] },
                                teamB: { playerIds: [four[2], four[3]] },
                                status: "upcoming" as const,
                                score: undefined,
                              };
                              const updatedMatches = currentRoundData.matches.map((m) =>
                                m.court === selectedCourt ? newMatch : m
                              );
                              const playingThisRound = new Set(
                                updatedMatches.flatMap((m) => [...m.teamA.playerIds, ...m.teamB.playerIds])
                              );
                              const newSittingOut = activePlayers.filter((p) => !playingThisRound.has(p.id)).map((p) => p.id);
                              setSchedule(
                                schedule.map((round) =>
                                  round.roundNumber === currentRound
                                    ? { ...round, matches: updatedMatches, sittingOut: newSittingOut }
                                    : round
                                )
                              );
                            }}
                            className="text-sm text-[#64748B] hover:text-[#1E3A5F] underline touch-manipulation text-center"
                          >
                            Reshuffle match
                          </button>
                        </div>
                        {undoStack.length > 0 && (
                          <button
                            type="button"
                            onClick={undoLastAction}
                            className="text-xs text-[#64748B] hover:text-[#1E3A5F] underline touch-manipulation"
                            aria-label="Undo last action"
                          >
                            Undo
                          </button>
                        )}
                        <p className="text-xs text-[#64748B] text-center">
                          Total: {totalScore} / {config.pointsPerMatch} points
                        </p>
                      </>
                    );
                  })()}
                </div>

                {/* Sitting Out — compact */}
                {allSittingOut.length > 0 && (
                  <div className="px-2 py-1.5 bg-[#FFFFFF] border-t border-[#E2E8F0] shrink-0">
                    <p className="text-xs text-[#64748B]">
                      Sitting out: {allSittingOut.map((id) => getPlayer(id)?.name).join(", ")}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* --- Schedule Screen --- */}
        {screen === "schedule" && (
          <div className="space-y-4">
            {/* Filter chips */}
            {config.courts > 1 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleFilterCourts(new Set())}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all touch-manipulation min-h-[44px] ${
                    scheduleFilterCourts.size === 0
                      ? "bg-[#2DBDA8] text-white shadow-[0_2px_6px_rgba(45,189,168,0.4)]"
                      : "bg-white text-[#1A1A1A] border-2 border-[#E2E8F0] hover:border-[#2DBDA8]/30"
                  }`}
                >
                  All
                </button>
                {Array.from({ length: config.courts }, (_, i) => i + 1).map((courtId) => (
                  <button
                    key={courtId}
                    type="button"
                    onClick={() => setScheduleFilterCourts(new Set([courtId]))}
                    className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all touch-manipulation min-h-[44px] ${
                      scheduleFilterCourts.has(courtId)
                        ? "bg-[#2DBDA8] text-white shadow-[0_2px_6px_rgba(45,189,168,0.4)]"
                        : "bg-white text-[#1A1A1A] border-2 border-[#E2E8F0] hover:border-[#2DBDA8]/30"
                    }`}
                  >
                    Court {courtId}
                  </button>
                ))}
              </div>
            )}

            {schedule.length === 0 ? (
              <div className="rounded-2xl bg-white border border-[#E2E8F0] p-6 text-center text-[#64748B] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                No schedule yet. Start a session from Setup.
              </div>
            ) : (
              <div className="space-y-4">
                {schedule.map((round) => {
                  const isCurrent = round.roundNumber === currentRound;
                  const isPast = round.roundNumber < currentRound;
                  const isFuture = round.roundNumber > currentRound;
                  const matchesByCourt = new Map(round.matches.map((m) => [m.court, m]));
                  const courtsToShow = scheduleFilterCourts.size === 0
                    ? Array.from({ length: config.courts }, (_, i) => i + 1)
                    : Array.from({ length: config.courts }, (_, i) => i + 1).filter((c) => scheduleFilterCourts.has(c));

                  return (
                    <section
                      key={round.roundNumber}
                      className={`rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${
                        isCurrent
                          ? "border-l-4 border-l-[#2DBDA8]"
                          : isFuture
                          ? "opacity-75"
                          : ""
                      }`}
                    >
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[#1E3A5F]">
                        Round {round.roundNumber}
                        {isCurrent && <span className="text-xs font-normal text-[#2DBDA8]">(current)</span>}
                        {isPast && <span className="text-xs font-normal text-[#94A3B8]">(played)</span>}
                      </h3>
                      <div className="space-y-3">
                        {courtsToShow.map((courtId) => {
                          const match = matchesByCourt.get(courtId);
                          if (!match) return null;
                          const score = match.score;
                          const isComplete = match.status === "completed";
                          const teamAWon = score && score.teamA > score.teamB;
                          return (
                            <div key={match.id} className="text-sm space-y-1 pl-2 border-l-2 border-[#E2E8F0]">
                              <div className="font-medium text-[#64748B] text-xs">Court {courtId}</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`flex items-center gap-1.5 ${isComplete && teamAWon ? "font-bold text-[#1E3A5F]" : "font-normal text-[#1E3A5F]"}`}>
                                  {match.teamA.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                                  {isComplete && teamAWon && (
                                    <span className="inline-flex items-center rounded-full bg-[#2DBDA8] text-white text-[10px] font-semibold px-1.5 py-0.5" aria-label="Winner">🏆</span>
                                  )}
                                </span>
                                <span className="text-[#64748B]">vs</span>
                                <span className={`flex items-center gap-1.5 ${isComplete && !teamAWon ? "font-bold text-[#1E3A5F]" : "font-normal text-[#1E3A5F]"}`}>
                                  {match.teamB.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                                  {isComplete && !teamAWon && (
                                    <span className="inline-flex items-center rounded-full bg-[#2DBDA8] text-white text-[10px] font-semibold px-1.5 py-0.5" aria-label="Winner">🏆</span>
                                  )}
                                </span>
                              </div>
                              {score && (
                                <div className="pt-1">
                                  <p className="text-base font-semibold">
                                    <span className={teamAWon ? "text-[#2DBDA8]" : "text-[#94A3B8]"}>
                                      {score.teamA}
                                    </span>
                                    <span className="text-[#94A3B8] mx-2">-</span>
                                    <span className={!teamAWon ? "text-[#2DBDA8]" : "text-[#94A3B8]"}>
                                      {score.teamB}
                                    </span>
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {round.sittingOut.length > 0 && (
                        <p className="text-xs text-[#64748B] mt-3 pt-2 border-t border-[#E2E8F0]">
                          Sit out: {round.sittingOut.map((id) => getPlayer(id)?.name).join(", ")}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* --- Leaderboard Screen --- */}
        {screen === "leaderboard" && (
          <div className="space-y-4">
            {!leaderboardSorted.some((p) => (p.gamesPlayed ?? 0) > 0) ? (
              <div className="rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <p className="text-[#64748B]">No matches played yet. Start a session to see rankings.</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden border border-[#E2E8F0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <table className="w-full text-left table-fixed">
                  <thead>
                    <tr className="bg-[#E2E8F0]/40 text-[#64748B] text-xs uppercase tracking-wider">
                      <th className="py-3 pl-4 font-semibold w-[40%]">Name</th>
                      <th className="py-3 font-semibold text-center w-[20%]">Matches Played</th>
                      <th className="py-3 font-semibold text-right pr-2 w-[15%]">PTS</th>
                      <th className="py-3 font-semibold text-center w-[12%]">W</th>
                      <th className="py-3 font-semibold text-center pr-4 w-[13%]">L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardSorted.map((p, i) => {
                      const hasPlayed = (p.gamesPlayed ?? 0) >= 1;
                      const medal =
                        hasPlayed && i === 0 ? "🥇 " : hasPlayed && i === 1 ? "🥈 " : hasPlayed && i === 2 ? "🥉 " : "";
                      return (
                        <tr
                          key={p.id}
                          className={`border-t border-[#E2E8F0] ${hasPlayed && i < 3 ? "bg-[#F1F5F9]" : ""}`}
                        >
                          <td className="py-3 pl-4 font-medium text-[#1E3A5F] truncate">
                            {medal}
                            {p.name}
                          </td>
                          <td className="py-3 text-center text-[#1A1A1A]">{p.gamesPlayed ?? 0}</td>
                          <td className="py-3 text-right pr-2 text-lg font-bold text-[#2DBDA8]">
                            {p.totalPoints ?? 0}
                          </td>
                          <td className="py-3 text-center text-lg font-bold text-[#2DBDA8]">{p.wins ?? 0}</td>
                          <td className="py-3 text-center pr-4 text-lg font-bold text-[#C0444E]">{p.losses ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {leaderboardSorted.length > 0 && (
              <p className="text-xs text-[#64748B] text-center">
                Sorted by total Americano points, then wins.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none w-[min(100%-2rem,24rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-lg bg-[#1E3A5F] text-white text-sm font-medium px-4 py-2.5 shadow-lg border border-[#1E3A5F]/80"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
