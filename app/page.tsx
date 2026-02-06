"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useStore, Player } from "../lib/store";
import { generateSchedule, regenerateSchedule, getSkillLabel, getUniquePlayerName, generateRoundMatchups } from "../lib/scheduler";

type Screen = "setup" | "session" | "leaderboard" | "schedule";

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
    <header className="sticky top-0 z-30 bg-gray-50 border-b border-slate-200/80 pb-4 sm:pb-6">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-600 mb-4 sm:mb-6 pt-4 sm:pt-6">
        gaspadel
      </h1>
      <nav className="flex gap-1 rounded-xl bg-slate-200/80 p-1 overflow-x-auto">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setScreen(id)}
            className={`flex-1 min-w-0 rounded-lg py-3 sm:py-2.5 text-sm font-medium transition shrink-0 touch-manipulation min-h-[44px] sm:min-h-0 ${
              screen === id ? "bg-emerald-600 text-white" : "text-slate-600 hover:text-slate-900"
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
  const [configCollapsed, setConfigCollapsed] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [regularsSelected, setRegularsSelected] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);

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

  // Calculate estimated session time (in minutes)
  // Assumes ~8-10 minutes per match on average
  const estimatedSessionTime = useMemo(() => {
    const matchesPerRound = config.courts;
    const totalMatches = matchesPerRound * config.rounds;
    const avgMatchTime = 8; // minutes per match
    const totalTime = totalMatches * avgMatchTime;
    return Math.round(totalTime);
  }, [config.courts, config.rounds]);

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

  // Preset configurations
  const applyPreset = useCallback((preset: "quick" | "standard" | "long") => {
    const presets = {
      quick: { rounds: 6, pointsPerMatch: 16 },
      standard: { rounds: 10, pointsPerMatch: 21 },
      long: { rounds: 14, pointsPerMatch: 32 },
    };
    
    const presetConfig = presets[preset];
    setConfig(presetConfig);
    
    if (sessionActive) {
      // Regenerate from NEXT round to preserve current round in progress
      const newSchedule = regenerateSchedule(players, { ...config, ...presetConfig }, schedule, currentRound + 1);
      setSchedule(newSchedule);
    }
  }, [config, sessionActive, players, schedule, currentRound, setConfig, setSchedule]);

  return (
    <div className="min-h-screen font-sans bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-lg px-3 sm:px-4 pb-20 sm:pb-24 safe-area-pb">
        <AppHeader screen={screen} setScreen={setScreen} />

        {/* --- Setup Screen --- */}
        {screen === "setup" && (
          <div className="space-y-6">
            {/* Session Status Banner */}
            {sessionActive && (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-300 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Session Active</p>
                    <p className="text-xs text-emerald-700 mt-1">
                      Round {currentRound} of {config.rounds}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={endSession}
                    className="px-4 py-2 rounded-lg bg-red-50 border border-red-300 text-red-700 text-sm font-medium hover:bg-red-100 touch-manipulation"
                  >
                    End Session
                  </button>
                </div>
              </div>
            )}

            {/* Preset Buttons */}
            {!sessionActive && (
              <section className="rounded-2xl bg-white border border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Quick Presets</h2>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => applyPreset("quick")}
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition touch-manipulation ${
                      config.rounds === 6 && config.pointsPerMatch === 16
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                    }`}
                  >
                    <div className="font-semibold">Quick</div>
                    <div className="text-xs opacity-80 mt-0.5">6 rounds, 16pts</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("standard")}
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition touch-manipulation ${
                      config.rounds === 10 && config.pointsPerMatch === 21
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                    }`}
                  >
                    <div className="font-semibold">Standard</div>
                    <div className="text-xs opacity-80 mt-0.5">10 rounds, 21pts</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("long")}
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition touch-manipulation ${
                      config.rounds === 14 && config.pointsPerMatch === 32
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                    }`}
                  >
                    <div className="font-semibold">Long</div>
                    <div className="text-xs opacity-80 mt-0.5">14 rounds, 32pts</div>
                  </button>
                </div>
              </section>
            )}

            {/* Estimated Session Time */}
            <section className="rounded-2xl bg-white border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Estimated Time</h2>
                  <p className="text-xs text-slate-600 mt-1">
                    ~{estimatedSessionTime} min with {activePlayers.length} player{activePlayers.length !== 1 ? "s" : ""} on {config.courts} court{config.courts > 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            </section>

            {/* Collapsible Config Section */}
            <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setConfigCollapsed(!configCollapsed)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors touch-manipulation"
              >
                <h2 className="text-sm font-semibold text-slate-800">Configuration</h2>
                <span className="text-slate-500 text-lg">
                  {configCollapsed ? "▼" : "▲"}
                </span>
              </button>
              
              {!configCollapsed && (
                <div className="px-4 pb-4 space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-600 mb-2">Max Courts</h3>
                    <p className="text-xs text-slate-600 mb-2">
                      Start with available players. Add more courts when enough players arrive.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfig({ courts: Math.max(1, config.courts - 1) })}
                        disabled={config.courts === 1}
                        className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-200 hover:bg-slate-300 active:bg-slate-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                        aria-label="Decrease max courts"
                      >
                        −
                      </button>
                      <div className="flex-1 min-w-0 rounded-xl bg-slate-100 px-4 py-3 text-center text-lg font-semibold text-slate-900 border border-slate-300">
                        {config.courts} court{config.courts > 1 ? "s" : ""}
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfig({ courts: Math.min(10, config.courts + 1) })}
                        disabled={config.courts === 10}
                        className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                        aria-label="Increase max courts"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-600 mb-2">Points per match</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfig({ pointsPerMatch: Math.max(1, config.pointsPerMatch - 1) })}
                        disabled={config.pointsPerMatch === 1}
                        className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-200 hover:bg-slate-300 active:bg-slate-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                        aria-label="Decrease points per match"
                      >
                        −
                      </button>
                      <div className="flex-1 min-w-0 rounded-xl bg-slate-100 px-4 py-3 text-center text-lg font-semibold text-slate-900 border border-slate-300">
                        {config.pointsPerMatch}
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfig({ pointsPerMatch: Math.min(64, config.pointsPerMatch + 1) })}
                        disabled={config.pointsPerMatch === 64}
                        className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                        aria-label="Increase points per match"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-600 mb-2">Number of rounds</h3>
                    {sessionActive && (
                      <p className="text-xs text-amber-600 mb-2">⚠️ Schedule will regenerate for remaining rounds.</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                    setConfig({ rounds: Math.max(1, config.rounds - 1) });
                    if (sessionActive) {
                      // Regenerate from NEXT round to preserve current round in progress
                      const newSchedule = regenerateSchedule(players, { ...config, rounds: Math.max(1, config.rounds - 1) }, schedule, currentRound + 1);
                      setSchedule(newSchedule);
                    }
                  }}
                        disabled={config.rounds === 1}
                        className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-slate-200 hover:bg-slate-300 active:bg-slate-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                        aria-label="Decrease number of rounds"
                      >
                        −
                      </button>
                      <div className="flex-1 min-w-0 rounded-xl bg-slate-100 px-4 py-3 text-center text-lg font-semibold text-slate-900 border border-slate-300">
                        {config.rounds}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                    setConfig({ rounds: Math.min(99, config.rounds + 1) });
                    if (sessionActive) {
                      // Regenerate from NEXT round to preserve current round in progress
                      const newSchedule = regenerateSchedule(players, { ...config, rounds: Math.min(99, config.rounds + 1) }, schedule, currentRound + 1);
                      setSchedule(newSchedule);
                    }
                        }}
                        disabled={config.rounds === 99}
                        className="flex-shrink-0 w-16 h-16 sm:w-14 sm:h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-2xl font-bold flex items-center justify-center select-none touch-manipulation"
                        aria-label="Increase number of rounds"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-600 mb-2">Matching Algorithm</h3>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => {
                    setConfig({ algorithm: "balanced" });
                    if (sessionActive) {
                      // Regenerate from NEXT round to preserve current round in progress
                      const newSchedule = regenerateSchedule(players, { ...config, algorithm: "balanced" }, schedule, currentRound + 1);
                      setSchedule(newSchedule);
                    }
                        }}
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm sm:text-base border ${
                          config.algorithm === "balanced"
                            ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                            : "border-slate-300 bg-slate-100 text-slate-800"
                        }`}
                      >
                        <div className="font-semibold">Balanced</div>
                        <p className="text-xs text-slate-600">
                          Balance skill levels across teams for fair matchups.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                    setConfig({ algorithm: "random" });
                    if (sessionActive) {
                      // Regenerate from NEXT round to preserve current round in progress
                      const newSchedule = regenerateSchedule(players, { ...config, algorithm: "random" }, schedule, currentRound + 1);
                      setSchedule(newSchedule);
                    }
                        }}
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm sm:text-base border ${
                          config.algorithm === "random"
                            ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                            : "border-slate-300 bg-slate-100 text-slate-800"
                        }`}
                      >
                        <div className="font-semibold">Random</div>
                        <p className="text-xs text-slate-600">
                          Fully randomized matchups, ignoring skill ratings.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                    setConfig({ algorithm: "king" });
                    if (sessionActive) {
                      // Regenerate from NEXT round to preserve current round in progress
                      const newSchedule = regenerateSchedule(players, { ...config, algorithm: "king" }, schedule, currentRound + 1);
                      setSchedule(newSchedule);
                    }
                        }}
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm sm:text-base border ${
                          config.algorithm === "king"
                            ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                            : "border-slate-300 bg-slate-100 text-slate-800"
                        }`}
                      >
                        <div className="font-semibold">King of the Court</div>
                        <p className="text-xs text-slate-600">
                          Winning team stays on court; losing team rotates off.
                        </p>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-800">Players</h2>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${activePlayers.length >= config.courts * 4 ? "text-emerald-600" : "text-slate-600"}`}>
                    {activePlayers.length}
                  </span>
                  <span className="text-xs text-slate-500">/ {config.courts * 4} min</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 mb-3">
                Need at least {config.courts * 4} to start ({config.courts} court{config.courts > 1 ? "s" : ""}). You can add more during the session.
              </p>

              {/* Your regulars — quick re-add from saved roster */}
              {savedRoster.length > 0 && (() => {
                const currentIds = new Set(players.filter((x) => x.status !== "removed").map((x) => x.id));
                const regularsNotInRoster = savedRoster.filter((sp) => !currentIds.has(sp.id));
                if (regularsNotInRoster.length === 0) return null;
                return (
                  <div className="mb-4 rounded-xl bg-slate-100 border border-slate-200 p-3">
                    <h3 className="text-xs font-semibold text-slate-600 mb-2">Your regulars</h3>
                    <div className="flex flex-wrap gap-2">
                      {regularsNotInRoster.map((sp) => (
                        <label
                          key={sp.id}
                          className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2 cursor-pointer touch-manipulation min-h-[44px]"
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
                            className="rounded border-slate-400 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-slate-800">{sp.name}</span>
                          {config.algorithm === "balanced" && (
                            <span className="text-[10px] text-emerald-600">{getSkillLabel(sp.skill)}</span>
                          )}
                        </label>
                      ))}
                    </div>
                    {regularsSelected.size > 0 && (
                      <button
                        type="button"
                        onClick={handleAddSelectedRegulars}
                        className="mt-2 w-full rounded-lg bg-emerald-600/80 py-2 text-sm font-medium text-white hover:bg-emerald-500 touch-manipulation min-h-[40px]"
                      >
                        Add selected ({regularsSelected.size})
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Add player */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                  className="flex-1 rounded-xl bg-white px-4 py-2.5 text-slate-900 placeholder-slate-500 border border-slate-300 focus:border-emerald-500 outline-none"
                />
                <button
                  type="button"
                  onClick={addPlayer}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-500 touch-manipulation min-h-[44px]"
                >
                  Add
                </button>
              </div>

              {/* Player roster */}
              <ul className="space-y-2">
                {players.filter((p) => p.status !== "removed").map((p) => {
                  const isEditing = editingPlayerId === p.id;
                  const isPaused = p.status === "paused";
                  const showDeleteConfirm = deleteConfirmId === p.id;
                  const status = getPlayerStatus(p);
                  const statusColors: Record<string, string> = {
                    Playing: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
                    Waiting: "bg-blue-500/20 text-blue-300 border-blue-500/50",
                    Paused: "bg-orange-500/20 text-orange-300 border-orange-500/50",
                    "Joining next round": "bg-amber-500/20 text-amber-300 border-amber-500/50",
                    "Sitting out": "bg-slate-200 text-slate-700 border-slate-300",
                  };
                  return (
                    <li
                      key={p.id}
                      className={`flex flex-col gap-2 rounded-xl px-4 py-3 transition-all border ${
                        isPaused ? "bg-slate-100 opacity-75 border-slate-200" : "bg-slate-50 border-slate-200"
                      } ${isEditing ? "ring-2 ring-emerald-500 bg-white" : ""}`}
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
                            className="w-full rounded-lg bg-white px-3 py-2 text-slate-900 border border-slate-300 focus:border-emerald-500 outline-none"
                            autoFocus
                          />
                          {config.algorithm === "balanced" && (
                            <select
                              value={editingPlayerSkill}
                              onChange={(e) => setEditingPlayerSkill(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                              className="w-full rounded-lg bg-white px-3 py-2 text-slate-900 border border-slate-300 focus:border-emerald-500 outline-none"
                            >
                              <option value={1}>1 - Newbie</option>
                              <option value={2}>2 - Beginner</option>
                              <option value={3}>3 - Intermediate</option>
                              <option value={4}>4 - Advanced</option>
                              <option value={5}>5 - Pro</option>
                            </select>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={saveEditedPlayer}
                              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 touch-manipulation"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingPlayer}
                              className="flex-1 rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300 touch-manipulation"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => startEditingPlayer(p)}
                                className={`text-left font-medium hover:text-emerald-600 transition-colors truncate ${isPaused ? "text-slate-500" : "text-slate-900"}`}
                              >
                                {p.name}
                              </button>
                              <span className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusColors[status] || statusColors.Waiting}`}>
                                {status}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {config.algorithm === "balanced" && !isPaused && (
                                <select
                                  value={p.skill}
                                  onChange={(e) => {
                                    const newSkill = Number(e.target.value) as 1 | 2 | 3 | 4 | 5;
                                    updatePlayerSkill(p.id, newSkill);
                                  }}
                                  className="rounded-lg bg-white border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none touch-manipulation min-h-[32px]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <option value={1}>1 - Newbie</option>
                                  <option value={2}>2 - Beginner</option>
                                  <option value={3}>3 - Intermediate</option>
                                  <option value={4}>4 - Advanced</option>
                                  <option value={5}>5 - Pro</option>
                                </select>
                              )}
                              {isPaused ? (
                                <button
                                  type="button"
                                  onClick={() => handleResumePlayer(p.id)}
                                  className="rounded-lg bg-emerald-600/80 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 touch-manipulation min-h-[36px]"
                                  aria-label={`Resume ${p.name}`}
                                >
                                  Resume
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handlePausePlayer(p.id)}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300 touch-manipulation"
                                  aria-label={`Pause ${p.name}`}
                                >
                                  <span className="text-lg leading-none" aria-hidden>⏸</span>
                                </button>
                              )}
                              {showDeleteConfirm ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-slate-600 whitespace-nowrap">Remove?</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePlayer(p.id)}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-500 touch-manipulation"
                                    aria-label={`Confirm remove ${p.name}`}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300 touch-manipulation"
                                    aria-label="Cancel"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmId(p.id)}
                                  className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-semibold touch-manipulation"
                                  aria-label={`Delete ${p.name} (keeps scores)`}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </div>
                          {sessionActive && (
                            <div className="flex items-center gap-4 text-xs text-slate-500 pt-1 border-t border-slate-600/50">
                              <span>GP: {p.gamesPlayed}</span>
                              <span>Pts: {p.totalPoints}</span>
                              <span>W: {p.wins}</span>
                              <span>L: {p.losses}</span>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              {players.filter((p) => p.status !== "removed").length === 0 && (
                <p className="text-center text-slate-500 text-sm py-4">
                  No players yet. Add above or select from Your regulars.
                </p>
              )}
            </section>

            {!sessionActive && (
              <>
                <button
                  type="button"
                  onClick={startSession}
                  disabled={!canStartSession}
                  className={`w-full rounded-xl py-4 sm:py-4 font-semibold touch-manipulation min-h-[52px] transition-all ${
                    canStartSession
                      ? "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700"
                      : "bg-slate-200 text-slate-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Start Session →
                </button>
                {!canStartSession && (
                  <p className="text-center text-sm text-slate-600 mt-2">
                    Add at least {config.courts * 4} player{config.courts * 4 > 1 ? "s" : ""} to start ({config.courts} court{config.courts > 1 ? "s" : ""}).
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* --- Session Screen --- */}
        {screen === "session" && (
          <div className="pt-4 sm:pt-6">
            {!sessionActive ? (
              <div className="rounded-2xl bg-gray-100 p-6 text-center text-gray-600">
                No active session. Start a session from Setup.
              </div>
            ) : !currentMatch ? (
              <div className="rounded-2xl bg-gray-100 p-6 text-center text-gray-600">
                No match found for Court {selectedCourt} in Round {currentRound}.
              </div>
            ) : (
              <>
                {/* Header Bar (sticky below shared AppHeader) */}
                <div className="sticky top-[8.5rem] z-10 bg-gray-50 border-b border-slate-200 px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-bold text-gray-900">Court {selectedCourt}</h2>
                      <span className="text-sm text-gray-600">
                        Round {currentRound} of {config.rounds}
                      </span>
                    </div>
                    {/* Undo Button */}
                    {undoStack.length > 0 && (
                      <button
                        type="button"
                        onClick={undoLastAction}
                        className="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-300 active:bg-gray-400 touch-manipulation min-h-[36px]"
                        aria-label="Undo last action"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-600 transition-all duration-300"
                      style={{ width: `${(currentRound / config.rounds) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Court Switcher Pills */}
                {config.courts > 1 && (
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {Array.from({ length: config.courts }, (_, i) => i + 1).map((courtId) => {
                        const match = currentRoundMatches.find((m) => m.court === courtId);
                        const isSelected = selectedCourt === courtId;
                        const isComplete = match?.status === "completed";
                        const score = match?.score;
                        return (
                          <button
                            key={courtId}
                            type="button"
                            onClick={() => setSelectedCourt(courtId)}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition-all touch-manipulation min-h-[44px] shrink-0 ${
                              isSelected
                                ? "bg-green-600 text-white shadow-md"
                                : "bg-white text-gray-700 border-2 border-gray-300"
                            }`}
                          >
                            Court {courtId}
                            {score && (
                              <span className={`ml-2 text-xs ${isSelected ? "text-white/90" : "text-gray-600"}`}>
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

                {/* Split-Screen Tap Zones */}
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

                  // Haptic feedback helper
                  const vibrate = () => {
                    if (typeof navigator !== "undefined" && navigator.vibrate) {
                      navigator.vibrate(50);
                    }
                  };

                  return (
                    <div className="flex flex-col h-[calc(100vh-180px)] min-h-[600px]">
                      {/* Team A Tap Zone - Top Half */}
                      <div
                        onClick={() => {
                          if (!canIncrease || !match) return;
                          vibrate();
                          const newScore = {
                            teamA: Math.min(config.pointsPerMatch, scoreA + 1),
                            teamB: scoreB,
                          };
                          updateMatchScore(currentRound, match.id, newScore);
                        }}
                        className={`relative flex-1 flex flex-col items-center justify-center p-6 transition-all touch-manipulation cursor-pointer ${
                          isMatchComplete && teamAWon
                            ? "bg-green-100 border-t-4 border-b-2 border-green-600"
                            : isMatchComplete
                            ? "bg-gray-100 border-t-4 border-b-2 border-gray-300"
                            : "bg-white hover:bg-gray-50 active:bg-green-50 border-t-4 border-b-2 border-gray-200"
                        } ${!canIncrease ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        {/* Small -1 button in top-right corner */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!match) return;
                            vibrate();
                            const newScore = { teamA: Math.max(0, scoreA - 1), teamB: scoreB };
                            updateMatchScore(currentRound, match.id, newScore);
                          }}
                          className="absolute top-3 right-3 w-10 h-10 rounded-lg bg-gray-300 hover:bg-gray-400 active:bg-gray-500 text-gray-700 text-lg font-bold flex items-center justify-center touch-manipulation shadow-sm z-10"
                          aria-label="Subtract 1 point for Team A"
                        >
                          −
                        </button>

                        <p className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-2">
                          Team A
                        </p>
                        <p className="text-base font-semibold text-gray-900 mb-6 text-center px-4">
                          {match.teamA.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                        </p>
                        <div className={`text-[72px] sm:text-[96px] font-bold ${isMatchComplete && teamAWon ? "text-green-600" : "text-gray-900"}`}>
                          {scoreA}
                        </div>
                        {isMatchComplete && teamAWon && (
                          <p className="mt-4 text-xl font-bold text-green-600">
                            🏆 Winner!
                          </p>
                        )}
                      </div>

                      {/* Divider */}
                      <div className="h-1 bg-gray-300"></div>

                      {/* Team B Tap Zone - Bottom Half */}
                      <div
                        onClick={() => {
                          if (!canIncrease || !match) return;
                          vibrate();
                          const newScore = {
                            teamA: scoreA,
                            teamB: Math.min(config.pointsPerMatch, scoreB + 1),
                          };
                          updateMatchScore(currentRound, match.id, newScore);
                        }}
                        className={`relative flex-1 flex flex-col items-center justify-center p-6 transition-all touch-manipulation cursor-pointer ${
                          isMatchComplete && !teamAWon
                            ? "bg-green-100 border-t-2 border-b-4 border-green-600"
                            : isMatchComplete
                            ? "bg-gray-100 border-t-2 border-b-4 border-gray-300"
                            : "bg-white hover:bg-gray-50 active:bg-green-50 border-t-2 border-b-4 border-gray-200"
                        } ${!canIncrease ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        {/* Small -1 button in bottom-right corner */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!match) return;
                            vibrate();
                            const newScore = { teamA: scoreA, teamB: Math.max(0, scoreB - 1) };
                            updateMatchScore(currentRound, match.id, newScore);
                          }}
                          className="absolute bottom-3 right-3 w-10 h-10 rounded-lg bg-gray-300 hover:bg-gray-400 active:bg-gray-500 text-gray-700 text-lg font-bold flex items-center justify-center touch-manipulation shadow-sm z-10"
                          aria-label="Subtract 1 point for Team B"
                        >
                          −
                        </button>

                        <p className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-2">
                          Team B
                        </p>
                        <p className="text-base font-semibold text-gray-900 mb-6 text-center px-4">
                          {match.teamB.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                        </p>
                        <div className={`text-[72px] sm:text-[96px] font-bold ${isMatchComplete && !teamAWon ? "text-green-600" : "text-gray-900"}`}>
                          {scoreB}
                        </div>
                        {isMatchComplete && !teamAWon && (
                          <p className="mt-4 text-xl font-bold text-green-600">
                            🏆 Winner!
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Bottom Controls Bar */}
                <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 space-y-2">
                  {/* Match Complete Banner */}
                  {(() => {
                    const match = currentMatch;
                    const score = match?.score || { teamA: 0, teamB: 0 };
                    const scoreA = score.teamA;
                    const scoreB = score.teamB;
                    const totalScore = scoreA + scoreB;
                    const isMatchComplete = totalScore === config.pointsPerMatch && totalScore > 0;
                    const teamAWon = scoreA > scoreB;
                    const canConfirm = scoreA > 0 || scoreB > 0;

                    return (
                      <>
                        {isMatchComplete && (
                          <div className="p-3 rounded-xl bg-green-100 border-2 border-green-600 mb-2">
                            <p className="text-base font-bold text-green-800 text-center">
                              🏆 {teamAWon ? "Team A wins!" : "Team B wins!"} ({scoreA}-{scoreB})
                            </p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!currentMatch || !currentRoundData) return;
                              const confirmed = window.confirm("Reshuffle with available players?");
                              if (!confirmed) return;
                              // Collect the 4 players on this court and randomize into new teams
                              const ids = [
                                ...currentMatch.teamA.playerIds,
                                ...currentMatch.teamB.playerIds,
                              ];
                              if (ids.length !== 4) return;
                              const shuffled = [...ids].sort(() => Math.random() - 0.5);
                              const newMatch = {
                                ...currentMatch,
                                teamA: { playerIds: [shuffled[0], shuffled[1]] },
                                teamB: { playerIds: [shuffled[2], shuffled[3]] },
                                status: "upcoming" as const,
                                score: undefined,
                              };
                              setSchedule(
                                schedule.map((round) =>
                                  round.roundNumber === currentRound
                                    ? {
                                        ...round,
                                        matches: round.matches.map((m) =>
                                          m.court === selectedCourt ? newMatch : m
                                        ),
                                      }
                                    : round
                                )
                              );
                            }}
                            className="flex-1 rounded-xl bg-gray-200 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-300 active:bg-gray-400 touch-manipulation min-h-[48px]"
                          >
                            Reshuffle match
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!currentMatch) return;
                              completeMatch(currentRound, currentMatch.id);
                              // Check if all matches in round are complete, then advance
                              const allComplete = currentRoundMatches.every(
                                (m) => m.status === "completed" || m.id === currentMatch.id
                              );
                              if (allComplete && currentRound < config.rounds) {
                                setCurrentRound(currentRound + 1);
                                setSelectedCourt(1);
                              }
                            }}
                            disabled={!canConfirm}
                            className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation min-h-[48px]"
                          >
                            {isMatchComplete
                              ? `Log Match`
                              : currentRound < config.rounds
                              ? `Confirm & Next`
                              : `Confirm (Final)`}
                          </button>
                        </div>

                        <p className="text-xs text-gray-500 text-center">
                          Total: {totalScore} / {config.pointsPerMatch} points
                        </p>
                      </>
                    );
                  })()}
                </div>

                {/* Sitting Out Section */}
                {allSittingOut.length > 0 && (
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-600 mb-1">Sitting out</h3>
                    <p className="text-sm text-gray-700">
                      {allSittingOut.map((id) => getPlayer(id)?.name).join(", ")}
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
            <p className="text-sm text-slate-600">
              Full cross-court rotation per round. Each round shows all courts; players move to different courts next round.
            </p>
            
            {/* Filter chips */}
            {config.courts > 1 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleFilterCourts(new Set())}
                  className={`rounded-full px-4 py-2 sm:py-1.5 text-sm font-medium transition touch-manipulation min-h-[44px] sm:min-h-0 ${
                    scheduleFilterCourts.size === 0
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  All
                </button>
                {Array.from({ length: config.courts }, (_, i) => i + 1).map((courtId) => (
                  <button
                    key={courtId}
                    type="button"
                    onClick={() => setScheduleFilterCourts(new Set([courtId]))}
                    className={`rounded-full px-4 py-2 sm:py-1.5 text-sm font-medium transition touch-manipulation min-h-[44px] sm:min-h-0 ${
                      scheduleFilterCourts.has(courtId)
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    Court {courtId}
                  </button>
                ))}
              </div>
            )}

            {schedule.length === 0 ? (
              <div className="rounded-2xl bg-slate-100 border border-slate-200 p-6 text-center text-slate-600">
                No schedule yet. Start a session from Setup.
              </div>
            ) : (
              <div className="space-y-4">
                {schedule.map((round) => {
                  const isCurrent = round.roundNumber === currentRound;
                  const isPast = round.roundNumber < currentRound;
                  // Full cross-court rotation: show all courts 1..N in order for this round
                  const matchesByCourt = new Map(round.matches.map((m) => [m.court, m]));
                  const courtsToShow = scheduleFilterCourts.size === 0
                    ? Array.from({ length: config.courts }, (_, i) => i + 1)
                    : Array.from({ length: config.courts }, (_, i) => i + 1).filter((c) => scheduleFilterCourts.has(c));

                  return (
                    <section
                      key={round.roundNumber}
                      className={`rounded-2xl border p-4 ${
                        isCurrent
                          ? "border-emerald-500 bg-emerald-50"
                          : isPast
                          ? "border-slate-200 bg-slate-50 opacity-90"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-slate-800">
                        Round {round.roundNumber} — Cross-court rotation
                        {isCurrent && <span className="text-xs font-normal text-emerald-600">(current)</span>}
                        {isPast && <span className="text-xs font-normal text-slate-500">(played)</span>}
                      </h3>
                      <div className="space-y-3">
                        {courtsToShow.map((courtId) => {
                          const match = matchesByCourt.get(courtId);
                          if (!match) return null;
                          const score = match.score;
                          const isComplete = match.status === "completed";
                          const teamAWon = score && score.teamA > score.teamB;
                          return (
                            <div key={match.id} className="text-sm space-y-1 pl-2 border-l-2 border-slate-300">
                              <div className="font-medium text-slate-500 text-xs">Court {courtId}</div>
                              <div className={`flex flex-wrap items-center gap-2 ${isComplete && teamAWon ? "text-emerald-600" : ""}`}>
                                <span className={`font-medium ${isComplete && teamAWon ? "text-emerald-600" : "text-slate-800"}`}>
                                  {match.teamA.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                                </span>
                                <span className="text-slate-500">vs</span>
                                <span className={`font-medium ${isComplete && !teamAWon ? "text-emerald-600" : "text-slate-800"}`}>
                                  {match.teamB.playerIds.map((id) => getPlayer(id)?.name).join(" & ")}
                                </span>
                              </div>
                              {score && (
                                <div className="pt-1">
                                  <p className="text-base font-semibold">
                                    <span className={teamAWon ? "text-emerald-600" : "text-slate-600"}>
                                      {score.teamA}
                                    </span>
                                    <span className="text-slate-400 mx-2">-</span>
                                    <span className={!teamAWon ? "text-emerald-600" : "text-slate-600"}>
                                      {score.teamB}
                                    </span>
                                    <span className="text-slate-500 ml-2 text-sm font-normal">
                                      ({teamAWon ? "Team A wins" : "Team B wins"})
                                    </span>
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {round.sittingOut.length > 0 && (
                        <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-200">
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
            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wider">
                    <th className="py-3 pl-4 font-semibold">#</th>
                    <th className="py-3 font-semibold">Name</th>
                    <th className="py-3 font-semibold text-center">Matches Played</th>
                    <th className="py-3 font-semibold text-right pr-4">Pts</th>
                    <th className="py-3 font-semibold text-center">W</th>
                    <th className="py-3 font-semibold text-center">L</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardSorted.map((p, i) => {
                    const medal = i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : "";
                    return (
                    <tr
                      key={p.id}
                      className={`border-t border-slate-200 ${i < 3 ? "bg-amber-50/60" : ""}`}
                    >
                      <td className="py-3 pl-4 font-bold text-slate-600 w-10">
                        {i + 1}
                      </td>
                      <td className="py-3 font-medium text-slate-900">
                        {medal}
                        {p.name}
                      </td>
                      <td className="py-3 text-center text-slate-700">{p.gamesPlayed}</td>
                      <td className="py-3 text-right pr-4 font-semibold text-emerald-600">
                        {p.totalPoints}
                      </td>
                      <td className="py-3 text-center text-green-600">{p.wins}</td>
                      <td className="py-3 text-center text-red-600">{p.losses}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {leaderboardSorted.length === 0 && (
              <p className="text-center text-slate-500 py-8">No players yet. Add players in Setup.</p>
            )}
            <p className="text-xs text-slate-500 text-center">
              Sorted by total Americano points, then wins.
            </p>
          </div>
        )}
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none w-[min(100%-2rem,24rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-lg bg-gray-900 text-white text-sm font-medium px-4 py-2.5 shadow-lg border border-gray-700"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
