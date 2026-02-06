import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SkillLevel = 1 | 2 | 3 | 4 | 5;
export type PlayerStatus = "active" | "paused" | "sitting_out" | "removed";
export type Algorithm = "balanced" | "random" | "king";
export type MatchStatus = "upcoming" | "in_progress" | "completed";

export interface SavedPlayer {
  id: string;
  name: string;
  skill: SkillLevel;
}

export interface Player {
  id: string;
  name: string;
  skill: SkillLevel;
  status: PlayerStatus;
  joinedAtRound: number; // which round they entered
  pausedAt?: number; // which round they were paused (if paused)
  sitOutCount: number;
  // Stats (computed from matches)
  gamesPlayed: number;
  totalPoints: number;
  wins: number;
  losses: number;
}

export interface Match {
  id: string;
  court: number; // which physical court this match is on
  teamA: { playerIds: string[] };
  teamB: { playerIds: string[] };
  status: MatchStatus;
  score?: { teamA: number; teamB: number };
}

export interface Round {
  roundNumber: number;
  matches: Match[];
  sittingOut: string[]; // player IDs sitting out this entire round
}

export interface Config {
  courts: number;
  pointsPerMatch: number;
  rounds: number;
  algorithm: Algorithm;
}

export interface UndoAction {
  action: string;
  payload: any;
  timestamp: number;
}

export interface AppState {
  // Config
  config: Config;

  // Players — living roster, mutable throughout session
  players: Player[];

  // Saved roster — persists across sessions for returning users
  savedRoster: SavedPlayer[];

  // Session
  sessionActive: boolean;
  currentRound: number;

  // Schedule — each round assigns player pairs to courts; players rotate every round
  schedule: Round[];

  // Undo stack
  undoStack: UndoAction[];

  // Actions
  setConfig: (config: Partial<Config>) => void;
  addPlayer: (name: string, skill: SkillLevel) => void;
  removePlayer: (id: string) => void;
  pausePlayer: (id: string) => void;
  resumePlayer: (id: string) => void;
  updatePlayer: (id: string, updates: Partial<Player>) => void;
  addToSavedRoster: (player: SavedPlayer) => void;
  removeFromSavedRoster: (id: string) => void;
  loadFromSavedRoster: (savedPlayer: SavedPlayer) => void;
  startSession: () => void;
  endSession: () => void;
  setCurrentRound: (round: number) => void;
  setSchedule: (schedule: Round[]) => void;
  updateMatchScore: (roundNumber: number, matchId: string, score: { teamA: number; teamB: number }) => void;
  completeMatch: (roundNumber: number, matchId: string) => void;
  addUndoAction: (action: string, payload: any) => void;
  clearUndoStack: () => void;
  regenerateSchedule: () => void;
  undoLastAction: () => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      config: {
        courts: 1,
        pointsPerMatch: 21,
        rounds: 10,
        algorithm: "balanced",
      },
      players: [],
      savedRoster: [],
      sessionActive: false,
      currentRound: 1,
      schedule: [],
      undoStack: [],

      // Actions
      setConfig: (updates) =>
        set((state) => ({
          config: { ...state.config, ...updates },
        })),

      addPlayer: (name, skill) => {
        const state = get();
        const currentRound = state.sessionActive ? state.currentRound : 0;
        const trimmedName = name.trim();
        // If same name exists as a removed player, reactivate them instead of creating duplicate
        const removedMatch = state.players.find(
          (p) => p.status === "removed" && p.name === trimmedName
        );
        if (removedMatch) {
          set((state) => ({
            players: state.players.map((p) =>
              p.id === removedMatch.id
                ? {
                    ...p,
                    status: "active" as PlayerStatus,
                    skill,
                    joinedAtRound: currentRound,
                  }
                : p
            ),
          }));
          return;
        }
        // Check for duplicates among active players and add suffix if needed
        const activeNames = state.players
          .filter((p) => p.status !== "removed")
          .map((p) => p.name);
        let finalName = trimmedName;
        if (activeNames.includes(finalName)) {
          let n = 2;
          while (activeNames.includes(`${finalName} (${n})`)) n++;
          finalName = `${finalName} (${n})`;
        }
        const newPlayer: Player = {
          id: generateId(),
          name: finalName,
          skill,
          status: "active",
          joinedAtRound: currentRound,
          sitOutCount: 0,
          gamesPlayed: 0,
          totalPoints: 0,
          wins: 0,
          losses: 0,
        };
        set((state) => ({
          players: [...state.players, newPlayer],
          // Automatically add to saved roster for returning users
          savedRoster: state.savedRoster.some((sp) => sp.id === newPlayer.id)
            ? state.savedRoster
            : [...state.savedRoster, { id: newPlayer.id, name: newPlayer.name, skill: newPlayer.skill }],
        }));
      },

      removePlayer: (id) =>
        set((state) => ({
          players: state.players.map((p) =>
            p.id === id ? { ...p, status: "removed" as PlayerStatus } : p
          ),
        })),

      pausePlayer: (id) =>
        set((state) => {
          const currentRound = state.sessionActive ? state.currentRound : 0;
          return {
            players: state.players.map((p) =>
              p.id === id
                ? { ...p, status: "paused" as PlayerStatus, pausedAt: currentRound }
                : p
            ),
          };
        }),

      resumePlayer: (id) =>
        set((state) => {
          const currentRound = state.sessionActive ? state.currentRound : 0;
          return {
            players: state.players.map((p) =>
              p.id === id
                ? { ...p, status: "active" as PlayerStatus, pausedAt: undefined, joinedAtRound: currentRound }
                : p
            ),
          };
        }),

      updatePlayer: (id, updates) =>
        set((state) => ({
          players: state.players.map((p) => (p.id === id ? { ...p, ...updates } : p)),
          // Update saved roster if name or skill changed
          savedRoster: state.savedRoster.map((sp) =>
            sp.id === id && (updates.name || updates.skill)
              ? { ...sp, name: updates.name ?? sp.name, skill: updates.skill ?? sp.skill }
              : sp
          ),
        })),

      addToSavedRoster: (player) =>
        set((state) => ({
          savedRoster: state.savedRoster.some((sp) => sp.id === player.id)
            ? state.savedRoster
            : [...state.savedRoster, player],
        })),

      removeFromSavedRoster: (id) =>
        set((state) => ({
          savedRoster: state.savedRoster.filter((sp) => sp.id !== id),
        })),

      loadFromSavedRoster: (savedPlayer) => {
        const state = get();
        const currentRound = state.sessionActive ? state.currentRound : 0;
        // Check if player already exists
        const existingPlayer = state.players.find((p) => p.id === savedPlayer.id);
        if (existingPlayer) {
          // Reactivate if removed or paused
          if (existingPlayer.status === "removed" || existingPlayer.status === "paused") {
            set((state) => ({
              players: state.players.map((p) =>
                p.id === savedPlayer.id
                  ? {
                      ...p,
                      status: "active" as PlayerStatus,
                      skill: savedPlayer.skill,
                      joinedAtRound: currentRound,
                      pausedAt: undefined,
                    }
                  : p
              ),
            }));
          }
          return;
        }
        // Create new player from saved roster
        const newPlayer: Player = {
          id: savedPlayer.id,
          name: savedPlayer.name,
          skill: savedPlayer.skill,
          status: "active",
          joinedAtRound: currentRound,
          sitOutCount: 0,
          gamesPlayed: 0,
          totalPoints: 0,
          wins: 0,
          losses: 0,
        };
        set((state) => ({
          players: [...state.players, newPlayer],
        }));
      },

      startSession: () =>
        set({
          sessionActive: true,
          currentRound: 1,
          // Reset leaderboard stats for every new session; roster stays, scores don’t carry over
          players: (get().players || [])
            .filter((p) => p.status !== "removed")
            .map((p) => ({
              ...p,
              status: p.status === "paused" ? ("paused" as PlayerStatus) : ("active" as PlayerStatus),
              sitOutCount: 0,
              gamesPlayed: 0,
              totalPoints: 0,
              wins: 0,
              losses: 0,
            })),
        }),

      endSession: () =>
        set({
          sessionActive: false,
          currentRound: 1,
        }),

      setCurrentRound: (round) =>
        set({
          currentRound: round,
        }),

      setSchedule: (schedule) =>
        set({
          schedule,
        }),

      updateMatchScore: (roundNumber, matchId, score) =>
        set((state) => {
          // Get previous score for undo
          const round = state.schedule.find((r) => r.roundNumber === roundNumber);
          const match = round?.matches.find((m) => m.id === matchId);
          const previousScore = match?.score || { teamA: 0, teamB: 0 };
          
          // Ensure total doesn't exceed max points
          const maxPoints = state.config.pointsPerMatch;
          const total = score.teamA + score.teamB;
          let adjustedScore = { ...score };
          if (total > maxPoints) {
            const excess = total - maxPoints;
            // Reduce the higher score first
            if (score.teamA >= score.teamB) {
              adjustedScore.teamA = Math.max(0, score.teamA - excess);
            } else {
              adjustedScore.teamB = Math.max(0, score.teamB - excess);
            }
          }
          
          return {
            undoStack: [
              ...state.undoStack.slice(-19), // Keep last 20
              {
                action: "updateMatchScore",
                payload: { roundNumber, matchId, previousScore },
                timestamp: Date.now(),
              },
            ],
            schedule: state.schedule.map((round) =>
              round.roundNumber === roundNumber
                ? {
                    ...round,
                    matches: round.matches.map((match) =>
                      match.id === matchId
                        ? { ...match, score: adjustedScore, status: "in_progress" as MatchStatus }
                        : match
                    ),
                  }
                : round
            ),
          };
        }),

      completeMatch: (roundNumber, matchId) =>
        set((state) => {
          const round = state.schedule.find((r) => r.roundNumber === roundNumber);
          const match = round?.matches.find((m) => m.id === matchId);
          if (!match || !match.score) return state;

          const teamAWon = match.score.teamA > match.score.teamB;
          const winScore = teamAWon ? match.score.teamA : match.score.teamB;
          const loseScore = teamAWon ? match.score.teamB : match.score.teamA;

          // Update player stats
          const updatedPlayers = state.players.map((p) => {
            const isInMatch =
              match.teamA.playerIds.includes(p.id) || match.teamB.playerIds.includes(p.id);
            if (!isInMatch) return p;

            const isWinner =
              (teamAWon && match.teamA.playerIds.includes(p.id)) ||
              (!teamAWon && match.teamB.playerIds.includes(p.id));

            return {
              ...p,
              gamesPlayed: p.gamesPlayed + 1,
              totalPoints: p.totalPoints + (isWinner ? winScore : loseScore),
              wins: isWinner ? p.wins + 1 : p.wins,
              losses: isWinner ? p.losses : p.losses + 1,
            };
          });

          return {
            players: updatedPlayers,
            schedule: state.schedule.map((r) =>
              r.roundNumber === roundNumber
                ? {
                    ...r,
                    matches: r.matches.map((m) =>
                      m.id === matchId ? { ...m, status: "completed" as MatchStatus } : m
                    ),
                  }
                : r
            ),
          };
        }),

      addUndoAction: (action, payload) =>
        set((state) => ({
          undoStack: [
            ...state.undoStack.slice(-19), // Keep last 20
            { action, payload, timestamp: Date.now() },
          ],
        })),

      clearUndoStack: () =>
        set({
          undoStack: [],
        }),

      undoLastAction: () => {
        const state = get();
        if (state.undoStack.length === 0) return;
        
        const lastAction = state.undoStack[state.undoStack.length - 1];
        const newStack = state.undoStack.slice(0, -1);
        
        // Handle undo based on action type
        if (lastAction.action === "updateMatchScore") {
          const { roundNumber, matchId, previousScore } = lastAction.payload;
          set((state) => ({
            undoStack: newStack,
            schedule: state.schedule.map((round) =>
              round.roundNumber === roundNumber
                ? {
                    ...round,
                    matches: round.matches.map((match) =>
                      match.id === matchId
                        ? { ...match, score: previousScore }
                        : match
                    ),
                  }
                : round
            ),
          }));
        }
      },
    }),
    {
      name: "gaspadel-storage",
      partialize: (state) => ({
        config: state.config,
        savedRoster: state.savedRoster,
        // Don't persist: players (participants), leaderboard scores, session state
      }),
    }
  )
);
