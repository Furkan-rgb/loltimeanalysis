// This defines the state when the job is running
export interface ProgressState {
  status: "progress";
  processed: number;
  total: number;
}

// This defines the state on successful completion
export interface CompletedState {
  status: "completed";
}

// This defines the state on failure
export interface FailedState {
  status: "failed";
  error: string;
}

// This defines the state when no matches were found
export interface NoMatchesState {
  status: "no_matches";
}

// This Union type represents any possible object we can get from the stream
export type WorkflowStatus =
  | ProgressState
  | CompletedState
  | FailedState
  | NoMatchesState;

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
