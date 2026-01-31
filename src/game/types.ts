export type MatchId = string;
export type PlayerId = string;

export type LobsterAction =
  | { type: 'FISH_INSHORE' }
  | { type: 'FISH_OFFSHORE' }
  | { type: 'BUY'; item: 'bait' | 'fuel' | 'ice'; qty: number }
  | { type: 'UPGRADE'; qty: number }
  | { type: 'INSURE' };

export type PlayerState = {
  id: PlayerId;
  name: string;
  cash: number;
  bait: number;
  fuel: number;
  ice: number;
  capacity: number;
  catch: number;
  insured: boolean;
  score: number;
};

export type PublicState = {
  turn: number;
  turnsTotal: number;
  marketPricePerLobster: number;
  weather: 'calm' | 'breezy' | 'storm';
  leaderboard: Array<{ playerId: PlayerId; name: string; score: number }>;
};

export type MatchState = {
  id: MatchId;
  createdAt: string;
  seed: number;
  turnsTotal: number;
  maxPlayers: number;
  status: 'lobby' | 'running' | 'finished';
  turn: number;
  players: Record<PlayerId, PlayerState>;
  // actions submitted for current turn
  pendingActions: Record<PlayerId, LobsterAction | null>;
  public: PublicState;
  replay: ReplayEvent[];
};

export type ReplayEvent =
  | { t: string; kind: 'MATCH_CREATED'; seed: number; turnsTotal: number; maxPlayers: number }
  | { t: string; kind: 'PLAYER_JOINED'; playerId: PlayerId; name: string }
  | { t: string; kind: 'TURN_STARTED'; turn: number; marketPrice: number; weather: PublicState['weather'] }
  | { t: string; kind: 'ACTION'; turn: number; playerId: PlayerId; action: LobsterAction }
  | { t: string; kind: 'TURN_RESOLVED'; turn: number; notes: string[] }
  | { t: string; kind: 'MATCH_FINISHED'; leaderboard: PublicState['leaderboard'] };
