// hooks/usePlayerHistory.ts
import { useEffect, useRef, useCallback, useReducer } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { FormData, State, Action } from "@/types"; // Assuming types are in a types file

// --- All State Logic is Now Here ---
const initialState: State = {
  status: "idle",
  formData: { region: "", username: "", tag: "" },
  matchHistory: null,
  progress: 0,
  error: null,
  cooldown: 0,
};

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
        ...initialState,
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
    case "STREAM_PROGRESS": {
      const { processed, total } = action.payload;
      const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
      return { ...state, status: "updating", progress: percentage };
    }
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
    case "DECREMENT_COOLDOWN": {
      const newCooldown = state.cooldown - 1;
      return {
        ...state,
        cooldown: newCooldown,
        status: newCooldown > 0 ? "cooldown" : "success",
      };
    }
    case "PLAYER_NOT_FOUND":
      toast.error("Player Not Found", { description: action.payload });
      return {
        ...state,
        status: "error",
        error: action.payload,
        matchHistory: null,
      };
    case "PLAYER_FOUND_NO_HISTORY":
      toast(
        "Player found but no cached history. You can click Update to fetch recent matches.",
        { description: "No cached data was found for this player." }
      );
      return {
        ...state,
        status: "success",
        matchHistory: null,
        error: null,
      };
    case "RESET":
      return { ...initialState };
    default:
      return state;
  }
}

// --- The Custom Hook ---
export function usePlayerHistory() {
  const params = useParams();
  const navigate = useNavigate();
  // Seed initial state from URL params so the form shows the region/username/tag
  // immediately on mount instead of starting empty and being reset.
  const [state, dispatch] = useReducer(reducer, params, (p) => {
    const { region, username, tag } = (p as any) || {};
    return {
      ...initialState,
      formData: {
        region: region ?? "",
        username: username ?? "",
        tag: tag ?? "",
      },
    };
  });

  const activeEventSourceRef = useRef<EventSource | null>(null);
  const API_BASE_URL =
    (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:8000";

  // --- All API and Side Effect Logic is Now Here ---
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

  const triggerUpdate = useCallback(() => {
    if (!params.region || !params.username || !params.tag) return;
    const { region, username, tag } = params;

    dispatch({ type: "UPDATE" });

    fetch(`${API_BASE_URL}/update/${username}/${tag}/${region}`, {
      method: "POST",
    })
      .then(async (response) => {
        if (response.status === 429) {
          try {
            const errorData = await response.json();

            const detail =
              errorData &&
              typeof errorData === "object" &&
              "detail" in errorData
                ? errorData.detail
                : null;

            let cooldownTime = 30;
            if (typeof errorData.cooldown_seconds === "number") {
              cooldownTime = errorData.cooldown_seconds;
            } else if (detail && typeof detail.cooldown_seconds === "number") {
              cooldownTime = detail.cooldown_seconds;
            } else if (typeof detail === "string") {
              const numericMatch = detail.match(/(\d+)/);
              if (numericMatch) cooldownTime = parseInt(numericMatch[1], 10);
            }

            dispatch({ type: "SET_COOLDOWN", payload: cooldownTime });

            const inProgressFlag =
              typeof errorData.in_progress === "boolean"
                ? errorData.in_progress
                : detail && typeof detail.in_progress === "boolean"
                ? detail.in_progress
                : false;

            if (inProgressFlag) {
              createAndListenToEventSource(username, tag, region);
            }
            return;
          } catch (e) {
            const text = await response.text();
            const match = text.match(/(\d+)/);
            const cooldownTime = match ? parseInt(match[1], 10) : 30;
            dispatch({ type: "SET_COOLDOWN", payload: cooldownTime });
            return;
          }
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
  }, [API_BASE_URL, params, createAndListenToEventSource]);

  useEffect(() => {
    const { region, username, tag } = params as any;

    // If no params at all, do nothing and keep the seeded/initial state.
    if (!region && !username && !tag) return;

    // If we have all three params, perform the SEARCH + fetch flow.
    if (region && username && tag) {
      dispatch({ type: "SEARCH", payload: { region, username, tag } });

      fetch(`${API_BASE_URL}/history/${username}/${tag}/${region}`)
        .then(async (res) => {
          if (res.status === 404) {
            const errorDetail = (await res.json()).detail;
            dispatch({ type: "PLAYER_NOT_FOUND", payload: errorDetail });
            return;
          }

          if (res.status === 204) {
            dispatch({ type: "PLAYER_FOUND_NO_HISTORY" });
            createAndListenToEventSource(username, tag, region);
            return;
          }

          if (res.ok) {
            const responseJson = await res.json();
            dispatch({ type: "FETCH_SUCCESS", payload: responseJson });
            toast.success("Match history loaded!");

            if (responseJson.cooldown && responseJson.cooldown > 0) {
              dispatch({
                type: "SET_COOLDOWN",
                payload: responseJson.cooldown,
              });
            }

            if (responseJson.in_progress) {
              createAndListenToEventSource(username, tag, region);
            }
          } else {
            throw new Error(`Server responded with status: ${res.status}`);
          }
        })
        .catch((err) => {
          if (err.name !== "SyntaxError") {
            dispatch({ type: "STREAM_FAILURE", payload: err.message });
          }
        });
    } else {
      // Partial params: seed/update form fields individually so the select
      // and inputs show values without triggering a search/reset.
      if (region)
        dispatch({
          type: "FORM_CHANGE",
          payload: { field: "region", value: region },
        });
      if (username)
        dispatch({
          type: "FORM_CHANGE",
          payload: { field: "username", value: username },
        });
      if (tag)
        dispatch({
          type: "FORM_CHANGE",
          payload: { field: "tag", value: tag },
        });
    }

    return () => {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
        activeEventSourceRef.current = null;
      }
    };
  }, [params, createAndListenToEventSource, API_BASE_URL]);

  useEffect(() => {
    if (state.cooldown > 0) {
      const timer = setTimeout(() => {
        dispatch({ type: "DECREMENT_COOLDOWN" });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state.cooldown]);

  const handleSearch = (data: FormData) =>
    navigate(`/player/${data.region}/${data.username}/${data.tag}`);
  const handleFormChange = (field: keyof FormData, value: string) =>
    dispatch({ type: "FORM_CHANGE", payload: { field, value } });
  const resetApp = useCallback(() => navigate("/"), [navigate]);

  // The hook returns everything the component needs
  return {
    state,
    params, // Pass params through for component logic
    isLoading: state.status === "loading",
    isUpdating: state.status === "updating",
    handleSearch,
    handleFormChange,
    triggerUpdate,
    resetApp,
  };
}
