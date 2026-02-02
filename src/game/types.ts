export type RunId = string;

export type LobsterAction =
  | { type: 'FISH_INSHORE' }
  | { type: 'FISH_OFFSHORE' }
  | { type: 'SELL'; qty: number }
  | { type: 'SELL_ALL' }
  | { type: 'BUY'; item: 'bait' | 'fuel' | 'ice'; qty: number }
  | { type: 'UPGRADE'; qty: number }
  | { type: 'INSURE' };

export type RunPlayer = {
  name: string;
  cash: number;
  bait: number;
  fuel: number;
  ice: number;
  capacity: number;
  lobsters: number; // inventory carried turn-to-turn
  insured: boolean;
  score: number;
};

export type PublicState = {
  turn: number;
  turnsTotal: number;
  marketPricePerLobster: number;
  weather: 'calm' | 'breezy' | 'storm';
};

export type RunState = {
  id: RunId;
  createdAt: string;
  seed: number;
  mode: 'daily' | 'free';
  turnsTotal: number;
  status: 'running' | 'finished';
  turn: number;
  player: RunPlayer;
  pendingAction: LobsterAction | null;
  public: PublicState;
  replay: ReplayEvent[];
};

export type ReplayEvent =
  | { t: string; kind: 'RUN_CREATED'; seed: number; turnsTotal: number; mode: RunState['mode'] }
  | { t: string; kind: 'TURN_STARTED'; turn: number; marketPrice: number; weather: PublicState['weather'] }
  | { t: string; kind: 'ACTION'; turn: number; action: LobsterAction }
  | {
      t: string;
      kind: 'TURN_RESOLVED';
      turn: number;
      notes: string[];
      score: number;
      snapshot: {
        cash: number;
        bait: number;
        fuel: number;
        ice: number;
        capacity: number;
        lobsters: number;
        marketPrice: number;
        weather: PublicState['weather'];
      };
    }
  | { t: string; kind: 'RUN_FINISHED'; score: number };

export type LeaderboardEntry = {
  runId: RunId;
  name: string;
  score: number;
  seed: number;
  mode: RunState['mode'];
  createdAt: string;
};
