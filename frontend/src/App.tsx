import { useEffect, useRef, useCallback, useReducer } from "react";
import { useParams, useNavigate } from "react-router-dom";
import PlayerHistoryForm from "@/components/profile/PlayerHistoryForm";
import Dashboard from "@/components/analysis/Dashboard";
import { Toaster, toast } from "sonner";
import type { FormData, MatchHistoryResponse, State, Action } from "@/types";
import { Footer } from "./components/Footer";

// The initial state of our application
const initialState: State = {
  status: "idle",
  formData: { region: "", username: "", tag: "" },
  matchHistory: null,
  progress: 0,
  error: null,
  cooldown: 0,
};

// The reducer function: the heart of our state machine
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "FORM_CHANGE":
      return {
        ...state,
        formData: {
          ...state.formData,
          [action.payload.field]: action.payload.value,
        },
      };
    case "SEARCH":
      return {
        ...initialState, // Start fresh
        status: "loading",
        formData: action.payload,
      };
    case "UPDATE":
      return {
        ...state,
        status: "updating",
        error: null,
        progress: 0,
        cooldown: 0,
      };
    case "FETCH_SUCCESS":
      return {
        ...state,
        status: state.status === "updating" ? "updating" : "success",
        matchHistory: action.payload,
      };
    case "STREAM_PROGRESS":
      const { processed, total } = action.payload;
      const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
      return { ...state, status: "updating", progress: percentage };
    case "STREAM_SUCCESS":
      toast.success("History Updated!");
      return {
        ...state,
        status: "success",
        matchHistory: action.payload,
        progress: 100,
        error: null,
      };
    case "STREAM_FAILURE":
      toast.error("Search Failed", { description: action.payload });
      return { ...state, status: "error", error: action.payload, progress: 0 };
    case "SET_COOLDOWN":
      toast.error("Cooldown Active", {
        description: `Please wait ${action.payload} seconds.`,
      });
      return { ...state, status: "cooldown", cooldown: action.payload };
    case "DECREMENT_COOLDOWN":
      const newCooldown = state.cooldown - 1;
      return {
        ...state,
        cooldown: newCooldown,
        status: newCooldown > 0 ? "cooldown" : "success", // Revert to success when cooldown ends
      };
    case "PLAYER_NOT_FOUND":
      toast.error("Player Not Found", { description: action.payload });
      return {
        ...state,
        status: "error",
        error: action.payload,
        matchHistory: null, // Ensure no old data is shown
      };
    case "RESET":
      return { ...initialState };
    default:
      return state;
  }
}

function App() {
  const params = useParams();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    formData: {
      region: params.region || "",
      username: params.username || "",
      tag: params.tag || "",
    },
  });
  const { status, formData, matchHistory, progress, error, cooldown } = state;
  const isLoading = status === "loading";
  const isUpdating = status === "updating";
  const activeEventSourceRef = useRef<EventSource | null>(null);
  const API_BASE_URL =
    (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:8000";
  const handleSearch = (data: FormData) =>
    navigate(`/player/${data.region}/${data.username}/${data.tag}`);
  const handleFormChange = (field: keyof FormData, value: string) =>
    dispatch({ type: "FORM_CHANGE", payload: { field, value } });
  const resetApp = useCallback(() => navigate("/"), [navigate]);

  const createAndListenToEventSource = useCallback(
    (username: string, tag: string, region: string) => {
      if (activeEventSourceRef.current) activeEventSourceRef.current.close();
      const eventSource = new EventSource(
        `${API_BASE_URL}/stream-status/${username}/${tag}/${region}`
      );
      activeEventSourceRef.current = eventSource;

      eventSource.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.status === "progress") {
          dispatch({ type: "STREAM_PROGRESS", payload: data });
        }
        const isTerminalStatus = ["completed", "failed", "no_matches"].includes(
          data.status
        );
        if (isTerminalStatus) {
          eventSource.close();
          activeEventSourceRef.current = null;
          if (data.status === "completed") {
            const finalHistory = await fetch(
              `${API_BASE_URL}/history/${username}/${tag}/${region}`
            );
            const responseJson = await finalHistory.json();
            dispatch({ type: "STREAM_SUCCESS", payload: responseJson });
          } else {
            const detailedError =
              data.error ||
              "Player not found or they have no recent ranked games.";
            dispatch({ type: "STREAM_FAILURE", payload: detailedError });
          }
        }
      };
      eventSource.onerror = () => {
        eventSource.close();
        activeEventSourceRef.current = null;
        dispatch({
          type: "STREAM_FAILURE",
          payload: "Connection to the server was lost.",
        });
      };
    },
    [API_BASE_URL]
  );

  const triggerUpdate = () => {
    if (!params.region || !params.username || !params.tag) return;
    const { region, username, tag } = params;

    dispatch({ type: "UPDATE" });

    fetch(`${API_BASE_URL}/update/${username}/${tag}/${region}`, {
      method: "POST",
    })
      .then(async (response) => {
        if (response.status === 429) {
          const errorData = await response.json();
          const detail = errorData.detail || "";
          const match = detail.match(/(\d+)/);
          const cooldownTime = match ? parseInt(match[1], 10) : 30;
          dispatch({ type: "SET_COOLDOWN", payload: cooldownTime });
          return;
        }
        if (!response.ok) throw new Error("Failed to trigger update.");
        createAndListenToEventSource(username, tag, region);
      })
      .catch((err) => {
        if (err.message !== "Cooldown active") {
          dispatch({
            type: "STREAM_FAILURE",
            payload: `Failed to trigger an update: ${err.message}`,
          });
        }
      });
  };

  useEffect(() => {
    const { region, username, tag } = params;
    if (!region || !username || !tag) {
      dispatch({ type: "RESET" });
      return;
    }

    dispatch({ type: "SEARCH", payload: { region, username, tag } });

    // Start the initial validation and cache check
    fetch(`${API_BASE_URL}/history/${username}/${tag}/${region}`)
      .then(async (res) => {
        if (res.status === 404) {
          const errorDetail = (await res.json()).detail;
          dispatch({ type: "PLAYER_NOT_FOUND", payload: errorDetail });
          return;
        }

        // THIS IS THE FIX: Only start the listener after confirming an update is happening.
        if (res.status === 204) {
          createAndListenToEventSource(username, tag, region);
          return;
        }

        if (res.ok) {
          const responseJson = await res.json();
          dispatch({ type: "FETCH_SUCCESS", payload: responseJson });
          toast.success("Match history loaded!");
        } else {
          throw new Error(`Server responded with status: ${res.status}`);
        }
      })
      .catch((err) => {
        // Avoids dispatching an error for empty 204 responses
        if (err.name !== "SyntaxError") {
          dispatch({ type: "STREAM_FAILURE", payload: err.message });
        }
      });

    // Cleanup function remains the same
    return () => {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
        activeEventSourceRef.current = null;
      }
    };
  }, [params, createAndListenToEventSource, API_BASE_URL]);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => {
        dispatch({ type: "DECREMENT_COOLDOWN" });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  return (
    <>
      <Toaster position="top-right" duration={3000} />
      {/* Make the app a full-height flex column so the footer can stick to the bottom */}
      <div className="min-h-screen flex flex-col">
        <header>
          <div className="container mx-auto p-4 pt-8">
            <div className="mx-auto max-w-3xl">
              <header className="lg:col-span-4 text-center pb-2">
                <h1
                  className="text-3xl font-bold cursor-pointer hover:underline"
                  onClick={resetApp}
                >
                  League of Legends Performance Analysis
                </h1>
                <p className="text-muted-foreground">
                  An analytical look at your recent performance.
                </p>
              </header>
              <PlayerHistoryForm
                onSearch={handleSearch}
                onUpdate={triggerUpdate}
                isLoading={isLoading || isUpdating || status === "cooldown"}
                isUpdating={isUpdating}
                progress={progress}
                isDataLoaded={!!matchHistory}
                cooldown={cooldown}
                formData={formData}
                onFormChange={handleFormChange}
                urlParams={params}
              />
            </div>
          </div>
        </header>
        <main className="flex-1">
          {matchHistory ? (
            <Dashboard data={matchHistory} />
          ) : (
            <div className="container mx-auto p-8">
              <div className="mx-auto max-w-2xl">
                <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-gray-200 bg-white/50 p-8 text-center shadow-sm">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 w-12 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 3v18h18"
                    />
                    <rect
                      x="6"
                      y="10"
                      width="2.5"
                      height="8"
                      rx="0.5"
                      fill="currentColor"
                      className="text-gray-300"
                    />
                    <rect
                      x="11"
                      y="6"
                      width="2.5"
                      height="12"
                      rx="0.5"
                      fill="currentColor"
                      className="text-gray-400"
                    />
                    <rect
                      x="16"
                      y="2"
                      width="2.5"
                      height="16"
                      rx="0.5"
                      fill="currentColor"
                      className="text-gray-500"
                    />
                  </svg>

                  <h2 className="text-lg font-semibold">
                    No performance data yet
                  </h2>
                  <p className="text-muted-foreground max-w-prose">
                    Performance analysis will appear here after you search for a
                    player or trigger an update.
                  </p>

                  <p className="text-xs text-gray-400">
                    Tip: Use the form above to load cached history or fetch
                    recent matches with Update.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
        <Footer />
      </div>
    </>
  );
}

export default App;
