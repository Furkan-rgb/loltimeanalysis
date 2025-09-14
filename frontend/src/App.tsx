import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import PlayerHistoryForm from "@/components/profile/PlayerHistoryForm";
import Dashboard from "@/components/analysis/Dashboard";
import { Toaster, toast } from "sonner";
import type { FormData } from "@/types";

function App() {
  const params = useParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [matchHistory, setMatchHistory] = useState(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [formState, setFormState] = useState<FormData>({
    region: params.region || "",
    username: params.username || "",
    tag: params.tag || "",
  });

  // This ref helps prevent double-fetches in React's StrictMode
  const initialLoadRef = useRef(true);
  const cooldownIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!params.region || !params.username || !params.tag) return;

    // Prevent this complex effect from running twice in development
    if (process.env.NODE_ENV === "development" && !initialLoadRef.current) {
      return;
    }
    initialLoadRef.current = false;

    const { region, username, tag } = params;
    const API_BASE_URL = "http://localhost:8000";

    // Reset state for the new player
    setIsLoading(true);
    setMatchHistory(null);
    setError(null);
    setProgress(0);

    // --- RESTRUCTURED FETCH LOGIC ---
    fetch(`${API_BASE_URL}/history/${username}/${tag}/${region}`)
      .then(async (res) => {
        // Case 1: Cache HIT! Data exists.
        if (res.ok) {
          const cachedData = await res.json();
          setMatchHistory(cachedData);
          console.log("Loaded from cache:", cachedData);
          toast.success("History loaded from cache!");

          // Now that data is loaded, "peek" to see if a newer version is being fetched.
          const peekEventSource = new EventSource(
            `${API_BASE_URL}/stream-status/${username}/${tag}/${region}`
          );
          peekEventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.status === "progress") {
              // A job is already running, so just start listening.
              setIsLoading(true);
              listenToUpdateStream(username, tag, region);
            } else {
              setIsLoading(false); // No job running, so we're done.
            }
            peekEventSource.close();
          };
          peekEventSource.onerror = () => {
            setIsLoading(false);
            peekEventSource.close();
          };
          return; // Stop execution since we handled this case
        }

        // Case 2: Cache MISS. Player not found in cache.
        if (res.status === 404) {
          setIsLoading(false);
          return;
        }

        // Case 3: Other server errors (5xx, etc.)
        throw new Error("An unexpected server error occurred.");
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, [params]);

  useEffect(() => {
    // Clear any existing interval when the component unmounts or cooldown changes
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }

    // If there is a cooldown, start a new interval
    if (cooldown > 0) {
      cooldownIntervalRef.current = window.setInterval(() => {
        setCooldown((prevCooldown) => prevCooldown - 1);
      }, 1000);
    }

    // Cleanup function to clear the interval
    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
    };
  }, [cooldown]);

  const listenToUpdateStream = (
    username: string,
    tag: string,
    region: string
  ) => {
    const API_BASE_URL = "http://localhost:8000";
    const eventSource = new EventSource(
      `${API_BASE_URL}/stream-status/${username}/${tag}/${region}`
    );

    eventSource.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.status === "error") {
        toast.error("Search Failed", {
          description: data.message,
        });
        eventSource.close();
        setIsLoading(false);
      }

      if (data.status === "idle_no_data") {
        toast.error("Search Failed", {
          description: "Player not found or they have no recent ranked games.",
        });
        eventSource.close();
        setIsLoading(false);
      }

      if (data.status === "progress" && data.total > 0) {
        const percentage = Math.round((data.processed / data.total) * 100);
        setProgress(percentage);
      }

      if (data.status === "ready") {
        eventSource.close();
        const finalHistoryResponse = await fetch(
          `${API_BASE_URL}/history/${username}/${tag}/${region}`
        );
        const historyData = await finalHistoryResponse.json();
        setMatchHistory(historyData);
        setIsLoading(false);
        setProgress(100);
        toast.success("History Updated!");
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setError("Connection to the server was lost.");
      setIsLoading(false);
    };
  };

  const triggerUpdate = () => {
    if (!params.region || !params.username || !params.tag) return;
    const { region, username, tag } = params;
    const API_BASE_URL = "http://localhost:8000";

    setIsLoading(true);
    setProgress(0);
    setError(null);
    setCooldown(0);

    fetch(`${API_BASE_URL}/update/${username}/${tag}/${region}`, {
      method: "POST",
    })
      .then(async (response) => {
        if (response.status === 429) {
          const errorData = await response.json(); // <-- Parse the JSON body
          const detail = errorData.detail || "";
          const match = detail.match(/(\d+)/); // <-- Extract numbers from the error string
          if (match) {
            setCooldown(parseInt(match[1], 10)); // <-- Set the cooldown timer
          }
          setIsLoading(false); // <-- Stop loading indicator
          throw new Error("Cooldown active"); // <-- Stop the promise chain
        }
        if (!response.ok) throw new Error("Failed to trigger update.");

        const eventSource = new EventSource(
          `${API_BASE_URL}/stream-status/${username}/${tag}/${region}`
        );

        eventSource.onmessage = async (event) => {
          const data = JSON.parse(event.data);

          if (data.status === "error") {
            toast.error("Search Failed", {
              description: data.message,
            });
            eventSource.close();
            setIsLoading(false);
          }

          if (data.status === "idle_no_data") {
            toast.error("Search Failed", {
              description:
                "Player not found or they have no recent ranked games.",
            });
            eventSource.close();
            setIsLoading(false);
          }

          if (data.status === "progress" && data.total > 0) {
            const percentage = Math.round((data.processed / data.total) * 100);
            setProgress(percentage);
          }

          if (data.status === "ready") {
            eventSource.close();
            const finalHistoryResponse = await fetch(
              `${API_BASE_URL}/history/${username}/${tag}/${region}`
            );
            const historyData = await finalHistoryResponse.json();
            setMatchHistory(historyData);
            setIsLoading(false);
            setProgress(100);
            toast.success("History Updated!");
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          setError("Connection to the server was lost.");
          setIsLoading(false);
        };
      })
      .catch((err) => {
        // Only set an error message if it's NOT a cooldown signal.
        if (err.message !== "Cooldown active") {
          setError("Failed to trigger an update: " + err.message);
        }
        // Always stop the loading indicator on any error.
        setIsLoading(false);
      });
  };

  const handleSearch = (data: {
    region: string;
    username: string;
    tag: string;
  }) => {
    // Reset the ref for the new navigation
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
