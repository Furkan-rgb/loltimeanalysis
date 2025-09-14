export type FormData = {
  region: string;
  username: string;
  tag: string;
};

export interface MatchData {
  match_id: string;
  // Unix epoch in milliseconds
  timestamp: number;
  outcome: "Win" | "Loss";
  champion: string;
  role: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
}

export type MatchHistoryData = MatchData[];

export interface MatchHistoryResponse {
  status: string;
  data: MatchData[][]; // Array of arrays (chunks of 100)
}
