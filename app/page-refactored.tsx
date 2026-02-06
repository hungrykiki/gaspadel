"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useStore } from "../lib/store";
import { generateSchedule, regenerateSchedule, getSkillLabel, getUniquePlayerName } from "../lib/scheduler";

type Screen = "setup" | "session" | "leaderboard" | "schedule";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("setup");
  
  // Zustand store
  const {
    config,
    players,
    sessionActive,
    currentRound,
    schedule,
    setConfig,
    addPlayer: storeAddPlayer,
    removePlayer: storeRemovePlayer,
    updatePlayer,
    startSession: storeStartSession,
    endSession: storeEndSession,
    setCurrentRound,
    setSchedule,
    updateMatchScore,
    completeMatch,
  } = useStore();

  // Local UI state
  const [newName, setNewName] = useState("");
  const [newSkill, setNewSkill] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingPlayerName, setEditingPlayerName] = useState("");
  const [editingPlayerSkill, setEditingPlayerSkill] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [selectedCourt, setSelectedCourt] = useState<number>(1);
  const [scheduleFilterCourts, setScheduleFilterCourts] = useState<Set<number>>(new Set());

  // Get active players
  const activePlayers = useMemo(
    () => players.filter((p) => p.status === "active"),
    [players]
  );

  // Get current round matches
  const currentRoundMatches = useMemo(() => {
    const round = schedule.find((r) => r.roundNumber === currentRound);
    return round?.matches || [];
  }, [schedule, currentRound]);

  // Get current match for selected court
  const currentMatch = useMemo(() => {
    return currentRoundMatches.find((m) => m.court === selectedCourt);
  }, [currentRoundMatches, selectedCourt]);

  // Add player handler
  const addPlayer = useCallback(() => {
    const name = newName.trim();
    if (!name) return;

    const uniqueName = getUniquePlayerName(
      name,
      players.map((p) => ({ name: p.name }))
    );

    const skillToUse =
      config.algorithm === "balanced" ? newSkill : (3 as 1 | 2 | 3 | 4 | 5);

    storeAddPlayer(uniqueName, skillToUse);

    // If session is active, regenerate schedule (use store's updated players so new player has correct id and status)
    if (sessionActive) {
      const updatedPlayers = useStore.getState().players;
      const newSchedule = regenerateSchedule(updatedPlayers, config, schedule, currentRound + 1);
      setSchedule(newSchedule);
    }

    setNewName("");
    setNewSkill(3);
  }, [newName, newSkill, config, players, sessionActive, currentRound, schedule, storeAddPlayer, setSchedule]);

  // Remove player handler
  const handleRemovePlayer = useCallback(
    (id: string) => {
      storeRemovePlayer(id);

      // If session is active, regenerate schedule
      if (sessionActive) {
        const updatedPlayers = players.map((p) =>
          p.id === id ? { ...p, status: "removed" as const } : p
        );
        const newSchedule = regenerateSchedule(
          updatedPlayers,
          config,
          schedule,
          currentRound
        );
        setSchedule(newSchedule);
      }
    },
    [players, sessionActive, config, schedule, currentRound, storeRemovePlayer, setSchedule]
  );

  // Start session
  const startSession = useCallback(() => {
    if (activePlayers.length < 4) return;

    // Generate initial schedule
    const newSchedule = generateSchedule(activePlayers, config);
    setSchedule(newSchedule);
    storeStartSession();
    setScreen("session");
  }, [activePlayers, config, setSchedule, storeStartSession]);

  // End session
  const endSession = useCallback(() => {
    storeEndSession();
    setScreen("leaderboard");
  }, [storeEndSession]);

  // Update match score
  const handleScoreUpdate = useCallback(
    (matchId: string, team: "teamA" | "teamB", delta: number) => {
      const match = currentMatch;
      if (!match) return;

      const currentScore = match.score || { teamA: 0, teamB: 0 };
      const newScore = {
        ...currentScore,
        [team]: Math.max(0, currentScore[team] + delta),
      };

      // Ensure total doesn't exceed max points
      const total = newScore.teamA + newScore.teamB;
      if (total > config.pointsPerMatch) {
        const excess = total - config.pointsPerMatch;
        if (team === "teamA") {
          newScore.teamA = Math.max(0, newScore.teamA - excess);
        } else {
          newScore.teamB = Math.max(0, newScore.teamB - excess);
        }
      }

      updateMatchScore(currentRound, matchId, newScore);
    },
    [currentMatch, currentRound, config.pointsPerMatch, updateMatchScore]
  );

  // Complete match
  const handleCompleteMatch = useCallback(() => {
    if (!currentMatch || !currentMatch.score) return;

    completeMatch(currentRound, currentMatch.id);

    // Advance to next round if all matches in current round are complete
    const allComplete = currentRoundMatches.every(
      (m) => m.status === "completed" || m.id === currentMatch.id
    );

    if (allComplete && currentRound < config.rounds) {
      setCurrentRound(currentRound + 1);
      setSelectedCourt(1); // Reset to first court
    }
  }, [currentMatch, currentRound, currentRoundMatches, config.rounds, completeMatch, setCurrentRound]);

  // Check if match is complete
  const isMatchComplete = useMemo(() => {
    if (!currentMatch || !currentMatch.score) return false;
    const total = currentMatch.score.teamA + currentMatch.score.teamB;
    return total === config.pointsPerMatch && total > 0;
  }, [currentMatch, config.pointsPerMatch]);

  // Get player by ID
  const getPlayer = useCallback(
    (id: string) => players.find((p) => p.id === id),
    [players]
  );

  // Can start session
  const canStartSession = activePlayers.length >= config.courts * 4;

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
            className={`flex-1 min-w-0 rounded-lg py-3 sm:py-2.5 text-sm font-medium transition shrink-0 touch-manipulation min-h-[44px] sm:min-h-0 ${
              screen === "setup"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Setup
          </button>
          <button
            type="button"
            onClick={() => setScreen("session")}
            className={`flex-1 min-w-0 rounded-lg py-2.5 text-sm font-medium transition shrink-0 ${
              screen === "session"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Session
          </button>
          <button
            type="button"
            onClick={() => setScreen("schedule")}
            className={`flex-1 min-w-0 rounded-lg py-2.5 text-sm font-medium transition shrink-0 ${
              screen === "schedule"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Schedule
          </button>
          <button
            type="button"
            onClick={() => setScreen("leaderboard")}
            className={`flex-1 min-w-0 rounded-lg py-2.5 text-sm font-medium transition shrink-0 ${
              screen === "leaderboard"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Leaderboard
          </button>
        </nav>

        {/* Setup Screen - TODO: Implement full UI */}
        {screen === "setup" && (
          <div className="space-y-6">
            <p className="text-slate-400">Setup screen - implementing...</p>
            <button
              type="button"
              onClick={startSession}
              disabled={!canStartSession}
              className="w-full rounded-xl bg-emerald-600 py-4 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {sessionActive ? "Update session" : "Start session"}
            </button>
          </div>
        )}

        {/* Session Screen - TODO: Implement full UI */}
        {screen === "session" && (
          <div className="space-y-6">
            {!sessionActive ? (
              <div className="rounded-2xl bg-slate-800/50 p-6 text-center text-slate-400">
                No active session. Start a session from Setup.
              </div>
            ) : (
              <div>
                <p className="text-slate-400">Session screen - implementing...</p>
                {currentMatch && (
                  <div>
                    <p>Round {currentRound} of {config.rounds}</p>
                    <p>Court {selectedCourt}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Schedule Screen - TODO: Implement full UI */}
        {screen === "schedule" && (
          <div className="space-y-4">
            <p className="text-slate-400">Schedule screen - implementing...</p>
          </div>
        )}

        {/* Leaderboard Screen - TODO: Implement full UI */}
        {screen === "leaderboard" && (
          <div className="space-y-4">
            <p className="text-slate-400">Leaderboard screen - implementing...</p>
          </div>
        )}
      </div>
    </div>
  );
}
