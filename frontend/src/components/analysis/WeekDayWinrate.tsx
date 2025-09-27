import React, { useMemo } from "react";
import type { MatchHistoryData } from "@/types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function aggregatePerWeekdayHour(data?: MatchHistoryData) {
  const grid = Array.from({ length: 7 }).map(() =>
    Array.from({ length: 24 }).map((_, h) => ({ hour: h, wins: 0, games: 0 }))
  );
  if (!data || data.length === 0) {
    return grid.map((row, d) =>
      row.map((cell) => ({
        hour: cell.hour,
        games: 0,
        winrate: 45 + Math.sin((cell.hour / 24) * Math.PI * 2 + d) * 10,
      }))
    );
  }

  for (const g of data) {
    const dt = new Date(g.timestamp);
    const dow = (dt.getDay() + 6) % 7; // convert Sun(0) -> 6 to make Mon=0
    const h = dt.getHours();
    const cell = grid[dow][h];
    cell.games += 1;
    if (g.outcome === "Win") cell.wins += 1;
  }

  return grid.map((row) =>
    row.map((cell) => ({
      hour: cell.hour,
      games: cell.games,
      winrate: cell.games ? (cell.wins / cell.games) * 100 : 0,
    }))
  );
}

export const WeekDayWinrate: React.FC<{ data?: MatchHistoryData }> = ({
  data,
}) => {
  const perWeek = useMemo(() => aggregatePerWeekdayHour(data), [data]);

  const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div
        style={{
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          padding: 8,
          borderRadius: 8,
          fontSize: 12,
          boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
          minWidth: 96,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.9 }}>Hour: {label}:00</div>
        {payload.map((p: any) => (
          <div
            key={p.dataKey}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginTop: 6,
            }}
          >
            <div style={{ textTransform: "capitalize", opacity: 0.9 }}>
              {p.name}
            </div>
            <div style={{ fontWeight: 600 }}>
              {p.name === "winrate"
                ? `${Number(p.value).toFixed(1)}%`
                : p.value}
            </div>
          </div>
        ))}
        {/* show games count if present on the first payload item (series point) */}
        {payload &&
          payload[0] &&
          payload[0].payload &&
          typeof payload[0].payload.games !== "undefined" && (
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.9 }}>
              Games:{" "}
              <span style={{ fontWeight: 600 }}>
                {payload[0].payload.games}
              </span>
            </div>
          )}
      </div>
    );
  };

  function dayStats(
    dayData: { hour: number; games: number; winrate: number }[]
  ) {
    const totalGames = dayData.reduce((s, c) => s + (c.games || 0), 0);
    const weightedWinSum = dayData.reduce(
      (s, c) => s + (c.games ? c.winrate * c.games : 0),
      0
    );
    const avg = totalGames ? weightedWinSum / totalGames : 0;
    return { totalGames, avg };
  }

  return (
    <div className="mt-2">
      <div className="grid grid-cols-7 gap-2">
        {weekdayLabels.map((label, i) => {
          const stats = dayStats(perWeek[i]);
          const noData = stats.totalGames === 0;
          return (
            <div
              key={label}
              className="flex flex-col items-center text-xs"
              role="group"
              aria-label={`${label} winrate chart`}
            >
              <div
                className="w-full h-20"
                role="img"
                aria-label={`Winrate by hour for ${label}, average ${stats.avg.toFixed(
                  0
                )}% based on ${stats.totalGames} games`}
              >
                <ChartContainer
                  config={{ winrate: { label: "Winrate" } }}
                  className="h-full"
                >
                  {noData ? (
                    <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground">
                      <div className="text-center">
                        <div className="font-medium">No games</div>
                        <div className="mt-1">
                          Play some matches to see this chart
                        </div>
                      </div>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={perWeek[i]}
                        margin={{ top: 2, right: 4, left: 4, bottom: 2 }}
                      >
                        <XAxis dataKey="hour" hide />
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip
                          content={<CustomTooltip />}
                          formatter={(value: any, name: any) => {
                            if (name === "winrate")
                              return [
                                `${Number(value).toFixed(1)}%`,
                                "Winrate",
                              ];
                            return [value, name];
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="winrate"
                          stroke="var(--chart-2)"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </ChartContainer>
              </div>
              <div className="mt-1 text-muted-foreground">
                <div className="leading-none">{label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {noData ? "—" : `${stats.avg.toFixed(0)}% avg`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WeekDayWinrate;
