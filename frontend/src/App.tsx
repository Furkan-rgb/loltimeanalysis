import PlayerHistoryForm from "@/components/profile/PlayerHistoryForm";
import Dashboard from "@/components/analysis/Dashboard";
import { Toaster } from "sonner";
import { Footer } from "./components/Footer";
import { usePlayerHistory } from "@/hooks/usePlayerHistory";

function App() {
  const {
    state,
    params,
    isLoading,
    isUpdating,
    handleSearch,
    handleFormChange,
    triggerUpdate,
    resetApp,
  } = usePlayerHistory();

  const { status, formData, matchHistory, progress, cooldown } = state;

  return (
    <>
      <Toaster position="top-right" duration={3000} />
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
                canUpdate={
                  (params.region ?? "") === formData.region &&
                  (params.username ?? "") === formData.username &&
                  (params.tag ?? "") === formData.tag
                }
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
                <div className="flex flex-col items-center justify-center gap-4 rounded-lg border bg-card p-8 text-center shadow-sm">
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
