import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import PlayerHistoryForm from "@/components/profile/PlayerHistoryForm";
import Dashboard from "@/components/analysis/Dashboard";
import { Toaster, toast } from "sonner";
import type { FormData, MatchHistoryResponse } from "@/types";

function App() {
  const params = useParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [formState, setFormState] = useState<FormData>({
    region: params.region || "",
    username: params.username || "",
    tag: params.tag || "",
  });

  const initialLoadRef = useRef(true);
  const cooldownIntervalRef = useRef<number | null>(null);
  const activeEventSourceRef = useRef<EventSource | null>(null);

  const createAndListenToEventSource = useCallback(
    (username: string, tag: string, region: string, isInitialLoad: boolean) => {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
      }

      const API_BASE_URL = "http://localhost:8000";
      const eventSource = new EventSource(
        `${API_BASE_URL}/stream-status/${username}/${tag}/${region}`
      );
      activeEventSourceRef.current = eventSource;

      let hasUpdateStarted = !isInitialLoad;

      eventSource.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        if (data.status === "progress") {
          if (!hasUpdateStarted) {
            setIsLoading(true);
            hasUpdateStarted = true;
          }
          if (data.total > 0) {
            const percentage = Math.round((data.processed / data.total) * 100);
            setProgress(percentage);
          }
        }

        const isTerminalStatus = ["completed", "failed", "no_matches"].includes(
          data.status
        );

        if (isTerminalStatus) {
          eventSource.close();
          activeEventSourceRef.current = null;
          setIsLoading(false);

          if (data.status === "completed") {
            const finalHistoryResponse = await fetch(
              `${API_BASE_URL}/history/${username}/${tag}/${region}`
            );
            const responseJson = await finalHistoryResponse.json();
            setMatchHistory(responseJson);
            setProgress(100);
            if (hasUpdateStarted) {
              toast.success("History Updated!");
            }
          } else {
            const detailedError =
              data.error ||
              "Player not found or they have no recent ranked games.";
            if (hasUpdateStarted) {
              toast.error("Search Failed", { description: detailedError });
              setError(detailedError);
            }
          }
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        activeEventSourceRef.current = null;
        if (hasUpdateStarted) {
          setError("Connection to the server was lost.");
          setIsLoading(false);
        }
      };
    },
    []
  );

  useEffect(() => {
    if (!params.region || !params.username || !params.tag) return;

    if (process.env.NODE_ENV === "development" && !initialLoadRef.current) {
      return;
    }
    initialLoadRef.current = false;

    const { region, username, tag } = params;
    const API_BASE_URL = "http://localhost:8000";

    setIsLoading(true);
    setMatchHistory(null);
    setError(null);
    setProgress(0);

    fetch(`${API_BASE_URL}/history/${username}/${tag}/${region}`)
      .then(async (res) => {
        if (res.ok) {
          const responseJson = await res.json();
          console.log("Fetched history:", responseJson);
          setMatchHistory(responseJson);
          setIsLoading(false);
          toast.success("History loaded from cache!");
          return;
        }

        // --- MODIFICATION START ---
        if (res.status === 404) {
          setIsLoading(false);
          // Instead of auto-updating, we now show a message to the user.
          setError("Player data not found in cache. Click 'Update' to begin.");
          return;
        }
        // --- MODIFICATION END ---

        throw new Error("An unexpected server error occurred.");
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });

    return () => {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
      }
    };
  }, [params, createAndListenToEventSource]);

  useEffect(() => {
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }
    if (cooldown > 0) {
      cooldownIntervalRef.current = window.setInterval(() => {
        setCooldown((prevCooldown) => prevCooldown - 1);
      }, 1000);
    }
    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
    };
  }, [cooldown]);

  const triggerUpdate = () => {
    if (!params.region || !params.username || !params.tag) return;
    const { region, username, tag } = params;
    const API_BASE_URL = "http://localhost:8000";

    toast.info("Starting update...");
    setIsLoading(true);
    setProgress(0);
    setError(null);
    setCooldown(0);

    fetch(`${API_BASE_URL}/update/${username}/${tag}/${region}`, {
      method: "POST",
    })
      .then(async (response) => {
        if (response.status === 429) {
          const errorData = await response.json();
          const detail = errorData.detail || "";
          const match = detail.match(/(\d+)/);
          if (match) {
            setCooldown(parseInt(match[1], 10));
          }
          setIsLoading(false);
          throw new Error("Cooldown active");
        }
        if (!response.ok) throw new Error("Failed to trigger update.");

        createAndListenToEventSource(username, tag, region, false);
      })
      .catch((err) => {
        if (err.message !== "Cooldown active") {
          setError("Failed to trigger an update: " + err.message);
        }
        setIsLoading(false);
      });
  };

  const handleSearch = (data: {
    region: string;
    username: string;
    tag: string;
  }) => {
    initialLoadRef.current = true;
    navigate(`/player/${data.region}/${data.username}/${data.tag}`);
  };

  const handleFormChange = (field: keyof FormData, value: string) => {
    setFormState((prevState) => ({
      ...prevState,
      [field]: value,
    }));
  };

  return (
    <>
      <Toaster position="top-right" duration={2000} />
      <header>
        <div className="container mx-auto p-4 pt-8">
          <div className="mx-auto max-w-3xl">
            <header className="lg:col-span-4 text-center pb-2">
              <h1 className="text-3xl font-bold">Performance Analysis</h1>
              <p className="text-muted-foreground">
                An analytical look at your recent performance.
              </p>
            </header>
            <PlayerHistoryForm
              onSearch={handleSearch}
              onUpdate={triggerUpdate}
              isLoading={isLoading}
              isDataLoaded={!!matchHistory}
              progress={progress}
              cooldown={cooldown}
              formData={formState}
              onFormChange={handleFormChange}
              urlParams={params}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto min-h-screen p-4 md:p-8">
        <div className="flex h-full min-h-[400px] items-center justify-center rounded-lg p-4">
          {error ? (
            <div className="text-center text-destructive">
              <h3 className="text-lg font-semibold">An Error Occurred</h3>
              <p>{error}</p>
            </div>
          ) : matchHistory ? (
            <Dashboard data={matchHistory} />
          ) : !isLoading ? (
            <p className="text-muted-foreground">
              Performance analysis will appear here...
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}

export default App;
