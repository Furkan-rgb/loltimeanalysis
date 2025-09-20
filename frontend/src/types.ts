export type State = {
  // The current status of the UI, representing our state machine
  status: "idle" | "loading" | "updating" | "success" | "error" | "cooldown";
  formData: FormData;
  matchHistory: MatchHistoryResponse | null;
  progress: number;
  error: string | null;
  cooldown: number;
};

// A discriminated union of all possible actions that can be dispatched
export type Action =
  | { type: "FORM_CHANGE"; payload: { field: keyof FormData; value: string } }
  | { type: "SEARCH"; payload: FormData }
  | { type: "UPDATE" }
  | { type: "FETCH_SUCCESS"; payload: MatchHistoryResponse }
  | { type: "STREAM_PROGRESS"; payload: { processed: number; total: number } }
  | { type: "STREAM_SUCCESS"; payload: MatchHistoryResponse }
  | { type: "STREAM_FAILURE"; payload: string }
  | { type: "SET_COOLDOWN"; payload: number }
  | { type: "DECREMENT_COOLDOWN" }
  | { type: "PLAYER_NOT_FOUND"; payload: string }
  | { type: "PLAYER_FOUND_NO_HISTORY" }
  | { type: "RESET" };

export type PlayerUrlParams = {
  region?: string;
  username?: string;
  tag?: string;
};

export type FormData = {
  region: string;
  username: string;
  tag: string;
};

export type PlayerHistoryFormProps = {
  onSearch: (data: FormData) => void;
  onUpdate: () => void;
  isLoading: boolean;
  progress: number;
  cooldown: number;
  formData: FormData;
  isDataLoaded: boolean;
  onFormChange: (field: keyof FormData, value: string) => void;
  urlParams: PlayerUrlParams;
  isUpdating: boolean;
  canUpdate?: boolean;
};

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
