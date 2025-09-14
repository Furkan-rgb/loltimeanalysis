import React, { useMemo, useState } from "react";
import type { MatchHistoryResponse, MatchHistoryData } from "@/types";
import { ChevronDownIcon } from "lucide-react";
import { type DateRange } from "react-day-picker";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Bar,
  LabelList,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  Treemap,
  Label as RechartsLabel,
} from "recharts";

// UI Components from your project
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "../ui/slider";
import { Label } from "../ui/label";
import "katex/dist/katex.min.css";
import { InlineMath } from "react-katex";

// --- Analytics Utilities ---
type SmoothingMethods = "none" | "bayesian" | "laplace" | "wilson";

const calculateSmoothedWinRate = (
  wins: number,
  totalGames: number,
  overallWinRate: number,
  method: SmoothingMethods,
  k: number = 5
): number => {
  if (totalGames === 0) return method === "none" ? 0 : overallWinRate * 100;
  if (method === "none") {
    return (wins / totalGames) * 100;
  }

  switch (method) {
    case "laplace": {
      const alpha = 1; // "Add-one" smoothing
      return ((wins + alpha) / (totalGames + 2 * alpha)) * 100;
    }
    case "wilson": {
      const p_hat = wins / totalGames;
      const n = totalGames;
      const z = 1.96; // Corresponds to 95% confidence
      const numerator =
        p_hat +
        (z * z) / (2 * n) -
        z * Math.sqrt((p_hat * (1 - p_hat) + (z * z) / (4 * n)) / n);
      const denominator = 1 + (z * z) / n;
      return (numerator / denominator) * 100;
    }
    case "bayesian":
    default: {
      const numerator = wins + k * overallWinRate;
      const denominator = totalGames + k;
      return (numerator / denominator) * 100;
    }
  }
};

const getHeatmapColor = (winRate: number, totalGames: number): string => {
  if (totalGames === 0) return "bg-gray-100";
  if (winRate > 65) return "bg-green-500";
  if (winRate > 55) return "bg-green-400";
  if (winRate > 45) return "bg-yellow-300";
  if (winRate > 35) return "bg-red-400";
  return "bg-red-500";
};

// --- Reusable Chart Tooltip ---
// Helper not needed if timestamps are guaranteed ms; keeping in case of future inputs
const normalizeToMs = (ts: number | undefined | null): number | undefined =>
  typeof ts === "number" && !Number.isNaN(ts) ? ts : undefined;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    if (payload[0].payload.champion) {
      const { champion, wins, losses, total } = payload[0].payload;
      const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
      return (
        <div className="bg-white/80 backdrop-blur-sm p-2 border border-gray-200 rounded-md shadow-lg text-sm">
          <p className="font-bold text-gray-800">{champion}</p>
          <p style={{ color: "hsl(221.2 83.2% 53.3%)" }}>Wins: {wins}</p>
          <p style={{ color: "hsl(0, 63%, 45%)" }}>Losses: {losses}</p>
          <p className="text-gray-600">Total Games: {total}</p>
          <p className="text-gray-600">Win Rate: {winRate}%</p>
        </div>
      );
    }
    // Prefer a point-level date if present; avoid interpreting numeric index labels as timestamps
    let displayLabel: React.ReactNode = label;
    try {
      const tsRaw = payload?.[0]?.payload?.date as number | undefined;
      const tsMs = normalizeToMs(tsRaw);
      if (typeof tsMs === "number") {
        displayLabel = new Date(tsMs).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    } catch {}
    return (
      <div className="bg-white/80 backdrop-blur-sm p-2 border border-gray-200 rounded-md shadow-lg text-sm">
        <p className="font-bold text-gray-800">{displayLabel}</p>
        {payload.map((pld: any, index: number) => (
          <p key={index} style={{ color: pld.color }}>
            {`${pld.name}: ${pld.value.toFixed(1)}`}
            {pld.unit || ""}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// --- Embedded Chart & UI Components (Moved to top-level) ---

const StatCard: React.FC<{
  title: string;
  value: string | number;
  description: string;
  valueColor?: string;
}> = ({ title, value, description, valueColor }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent>
      <p className={`text-4xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </CardContent>
  </Card>
);

// Removed unused WinLossDoughnutChart component

const WinLossRoleDistributionChart: React.FC<{ data: MatchHistoryData }> = ({
  data,
}) => {
  const chartConfig = {
    wins: { label: "Wins", color: "var(--chart-2)" },
    losses: { label: "Losses", color: "var(--chart-5)" },
    TOP: { label: "Top", color: "var(--chart-1)" },
    JUNGLE: { label: "Jungle", color: "var(--chart-2)" },
    MIDDLE: { label: "Mid", color: "var(--chart-3)" },
    BOTTOM: { label: "Bot", color: "var(--chart-4)" },
    UTILITY: { label: "Support", color: "var(--chart-5)" },
    UNKNOWN: { label: "Unknown", color: "var(--muted)" },
  } satisfies ChartConfig;

  // Map data "name" to configured color (fallback to muted)
  const getColor = (name: string) =>
    (chartConfig as Record<string, { label: string; color: string }>)[name]
      ?.color ?? "var(--muted)";

  const { winLossData, roleData, totalGames } = useMemo(() => {
    const stats = data.reduce(
      (acc, game) => {
        game.outcome === "Win" ? acc.wins++ : acc.losses++;
        const role = game.role || "UNKNOWN";
        acc.roles[role] = (acc.roles[role] || 0) + 1;
        return acc;
      },
      { wins: 0, losses: 0, roles: {} as { [key: string]: number } }
    );

    // FIX: Removed the manual "fill" property from these data objects
    const winLoss = [
      { name: "wins", value: stats.wins },
      { name: "losses", value: stats.losses },
    ];

    // FIX: Removed the manual "fill" property from these data objects
    const roles = Object.entries(stats.roles).map(([role, count]) => ({
      name: role,
      value: count,
    }));

    return {
      winLossData: winLoss,
      roleData: roles,
      totalGames: data.length,
    };
  }, [data]);

  // Legend removed per request; keep chart simple

  return (
    <ChartContainer
      config={chartConfig}
      className="mx-auto aspect-square max-h-[250px]"
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel />}
        />
        <Pie
          data={winLossData}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={70}
        >
          {winLossData.map((d, i) => (
            <Cell key={`winloss-${i}`} fill={getColor(d.name)} />
          ))}
          <RechartsLabel
            content={({ viewBox }: { viewBox?: any }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text
                    x={viewBox.cx}
                    y={viewBox.cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground text-3xl font-bold"
                    >
                      {totalGames.toLocaleString()}
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy || 0) + 20}
                      className="fill-muted-foreground"
                    >
                      Games
                    </tspan>
                  </text>
                );
              }
            }}
          />
        </Pie>
        <Pie
          data={roleData}
          dataKey="value"
          nameKey="name"
          innerRadius={80}
          outerRadius={100}
        >
          {roleData.map((d, i) => (
            <Cell key={`role-${i}`} fill={getColor(d.name)} />
          ))}
        </Pie>
        {/* Legend removed */}
      </PieChart>
    </ChartContainer>
  );
};
const DailyWinRateChart: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
}> = ({ data, overallWinRate, smoothingMethod, kValue }) => {
  const dailyData = useMemo(() => {
    const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const stats = dayOrder.map((day) => ({ day, wins: 0, total: 0 }));

    data.forEach((game) => {
      const dayIndex = new Date(game.timestamp).getDay();
      stats[dayIndex].total++;
      if (game.outcome === "Win") stats[dayIndex].wins++;
    });

    return stats.map((s) => ({
      ...s,
      winRate: calculateSmoothedWinRate(
        s.wins,
        s.total,
        overallWinRate,
        smoothingMethod,
        kValue
      ),
    }));
  }, [data, overallWinRate, smoothingMethod, kValue]);

  // Function to get color based on win rate
  const getBarColor = (winRate: number): string => {
    if (winRate > 65) return "hsl(142.1 76.2% 42.2%)"; // Strong Green
    if (winRate > 55) return "hsl(142.1 70.6% 50.6%)"; // Green
    if (winRate > 45) return "hsl(47.9 95.8% 53.1%)"; // Yellow
    if (winRate > 35) return "hsl(0 84.2% 60.2%)"; // Red
    return "hsl(0 72.2% 50.6%)"; // Strong Red
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={dailyData} margin={{ top: 25 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        {/* FIX 1: Axes are now enabled */}
        <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis
          domain={[0, 100]}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}%`}
        />
        <Tooltip content={<CustomTooltip />} cursor={false} />
        <Bar dataKey="winRate" radius={[4, 4, 0, 0]} unit="%">
          <LabelList
            dataKey="total"
            position="top"
            fontSize={10}
            formatter={(label: number) => (label > 0 ? `${label}g` : "")}
          />
          {/* FIX 2: Dynamic colors for each bar */}
          {dailyData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getBarColor(entry.winRate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const HourlyWinRateHeatmap: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
}> = ({ data, overallWinRate, smoothingMethod, kValue }) => {
  const heatmapData = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const stats = Array(7)
      .fill(0)
      .map(() =>
        Array(24)
          .fill(0)
          .map(() => ({ wins: 0, total: 0 }))
      );

    data.forEach((game) => {
      const date = new Date(game.timestamp);
      stats[date.getDay()][date.getHours()].total++;
      if (game.outcome === "Win") stats[date.getDay()][date.getHours()].wins++;
    });
    return { days, hours, stats };
  }, [data]);

  // Each hour column takes an equal share of the remaining width after the day label (w-10 = 2.5rem)
  const hourColWidth = "max(20px, calc((100% - 2.5rem) / 24))";

  return (
    <div className="w-full">
      <div className="flex flex-col text-xs w-full">
        <div className="flex w-full">
          <div className="w-10 shrink-0"></div>
          {heatmapData.hours.map((h) => (
            <div
              key={h}
              className="text-center text-muted-foreground font-medium"
              style={{ width: hourColWidth }}
            >
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {heatmapData.days.map((day, dayIndex) => (
          <div key={day} className="flex items-center w-full">
            <div className="w-10 text-card-foreground font-bold text-right pr-2 shrink-0">
              {day}
            </div>
            {heatmapData.hours.map((hour) => {
              const block = heatmapData.stats[dayIndex][hour];
              const adjustedWinRate = calculateSmoothedWinRate(
                block.wins,
                block.total,
                overallWinRate,
                smoothingMethod,
                kValue
              );
              const tooltipText =
                block.total > 0
                  ? `${adjustedWinRate.toFixed(0)}% WR (${block.wins}W / ${
                      block.total - block.wins
                    }L)`
                  : "No games";
              return (
                <div
                  key={`${day}-${hour}`}
                  className="h-8 p-0.5"
                  style={{ width: hourColWidth }}
                >
                  <div
                    className={`w-full h-full rounded ${getHeatmapColor(
                      adjustedWinRate,
                      block.total
                    )}`}
                    title={tooltipText}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const KeyInsights: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
}> = ({ data, overallWinRate, smoothingMethod, kValue }) => {
  const insights = useMemo(() => {
    // --- 1. Increased Statistical Rigor ---
    const MIN_GAMES_CHAMPION = 5; // Raised from 3 for better confidence
    const MIN_GAMES_DAY = 5;

    if (data.length < 10) {
      return ["Play more games to unlock in-depth performance insights."];
    }

    let generatedInsights: string[] = [];

    // --- 2. Champion Quadrant Analysis (Play Rate vs. Win Rate) ---
    const champStats: { [key: string]: { wins: number; total: number } } = {};
    data.forEach((g) => {
      if (!champStats[g.champion])
        champStats[g.champion] = { wins: 0, total: 0 };
      champStats[g.champion].total++;
      if (g.outcome === "Win") champStats[g.champion].wins++;
    });

    const validChamps = Object.entries(champStats)
      .filter(([, s]) => s.total >= MIN_GAMES_CHAMPION)
      .map(([name, stats]) => ({
        name,
        ...stats,
        wr: calculateSmoothedWinRate(
          stats.wins,
          stats.total,
          overallWinRate,
          smoothingMethod,
          kValue
        ),
      }));

    if (validChamps.length > 1) {
      const avgPlayRate =
        validChamps.reduce((acc, c) => acc + c.total, 0) / validChamps.length;

      const comfortPicks = validChamps.filter(
        (c) => c.total >= avgPlayRate && c.wr >= 52
      );
      const hiddenGems = validChamps.filter(
        (c) => c.total < avgPlayRate && c.wr >= 55
      );
      const theGrind = validChamps.filter(
        (c) => c.total >= avgPlayRate && c.wr < 48
      );

      // Prioritize the most actionable insights
      if (theGrind.length > 0) {
        const champ = theGrind.sort((a, b) => a.wr - b.wr)[0];
        generatedInsights.push(
          `You play **${champ.name}** frequently (${
            champ.total
          } games), but your **${champ.wr.toFixed(
            0
          )}% win rate** is low. This might be a key area for improvement or review.`
        );
      }
      if (comfortPicks.length > 0) {
        const champ = comfortPicks.sort((a, b) => b.wr - a.wr)[0];
        generatedInsights.push(
          `**${
            champ.name
          }** is a reliable comfort pick, securing a **${champ.wr.toFixed(
            0
          )}% win rate** over **${
            champ.total
          } games**. A solid choice for climbing.`
        );
      }
      if (hiddenGems.length > 0) {
        const champ = hiddenGems.sort((a, b) => b.wr - a.wr)[0];
        generatedInsights.push(
          `You have an impressive **${champ.wr.toFixed(0)}% win rate** on **${
            champ.name
          }** across ${
            champ.total
          } games. Consider playing this hidden gem more often.`
        );
      }
    }

    // --- 3. Strengths vs. Weaknesses (Day of the Week) ---
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayStats = days.map((day) => ({ name: day, wins: 0, total: 0 }));
    data.forEach((g) => {
      const dayIndex = new Date(g.timestamp).getDay();
      dayStats[dayIndex].total++;
      if (g.outcome === "Win") dayStats[dayIndex].wins++;
    });

    const validDays = dayStats
      .filter((d) => d.total >= MIN_GAMES_DAY)
      .map((d) => ({
        ...d,
        wr: calculateSmoothedWinRate(
          d.wins,
          d.total,
          overallWinRate,
          smoothingMethod,
          kValue
        ),
      }));

    if (validDays.length > 1) {
      const bestDay = [...validDays].sort((a, b) => b.wr - a.wr)[0];
      const worstDay = [...validDays].sort((a, b) => a.wr - b.wr)[0];

      if (bestDay && bestDay.wr > overallWinRate * 100 + 5) {
        // Only show if significantly better
        generatedInsights.push(
          `Your performance seems to peak on **${
            bestDay.name
          }s**, with an adjusted win rate of **${bestDay.wr.toFixed(
            0
          )}%** over ${bestDay.total} games.`
        );
      }
      if (
        worstDay &&
        bestDay.name !== worstDay.name &&
        worstDay.wr < overallWinRate * 100 - 5
      ) {
        // Only show if significantly worse
        generatedInsights.push(
          `Conversely, you appear to struggle most on **${
            worstDay.name
          }s**, where your win rate drops to **${worstDay.wr.toFixed(
            0
          )}%** over ${worstDay.total} games.`
        );
      }
    }

    return generatedInsights.length > 0
      ? generatedInsights
      : ["Keep playing to gather more data for insights!"];
  }, [data, overallWinRate, smoothingMethod, kValue]);

  return (
    <ul className="space-y-3 text-sm">
      {" "}
      {/* Adjusted spacing for better balance */}
      {insights.map((insight, i) => (
        // --- MODIFIED HERE ---
        <li key={i} className="flex items-center gap-3">
          {" "}
          {/* Changed items-start to items-center */}
          <span className="text-primary">&#9679;</span>{" "}
          {/* Reverted to original dot */}
          <span
            dangerouslySetInnerHTML={{
              __html: insight.replace(
                /\*\*(.*?)\*\*/g,
                '<strong class="font-semibold text-card-foreground">$1</strong>'
              ),
            }}
          />
        </li>
      ))}
    </ul>
  );
};

const RollingWinRateTrend: React.FC<{
  data: MatchHistoryData;
  windowSize: number;
}> = ({ data, windowSize }) => {
  const trendData = useMemo(() => {
    if (data.length < windowSize) return [];
    const sortedGames = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const rollingData = [];
    for (let i = 0; i <= sortedGames.length - windowSize; i++) {
      const window = sortedGames.slice(i, i + windowSize);
      const wins = window.filter((g) => g.outcome === "Win").length;
      const endTsMs = sortedGames[i + windowSize - 1].timestamp; // already ms
      rollingData.push({
        game: `Game ${i + windowSize}`,
        winRate: (wins / windowSize) * 100,
        date: endTsMs,
        index: i,
      });
    }
    return rollingData;
  }, [data, windowSize]);

  if (trendData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          Not enough games for a rolling trend of {windowSize}.
        </p>
      </div>
    );
  }

  // Ensure a visible line when only one data point exists
  const plottedData = useMemo(() => {
    if (trendData.length === 1) {
      // Duplicate the single point with adjacent indices for a visible line
      return [
        { ...trendData[0], index: 0 },
        { ...trendData[0], index: 1 },
      ];
    }
    return trendData;
  }, [trendData]);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart key={windowSize} data={plottedData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="index"
          interval={Math.max(0, Math.ceil(plottedData.length / 8) - 1)}
          tickFormatter={(value: number) => {
            const i = Math.max(
              0,
              Math.min(plottedData.length - 1, Number(value))
            );
            const d = plottedData[i]?.date;
            return d
              ? new Date(d).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : String(value);
          }}
          tickLine={false}
          axisLine={false}
          label={{ value: "Date", position: "insideBottom", offset: -5 }}
        />
        <YAxis domain={[0, 100]} unit="%" />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine
          y={50}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
        />
        {trendData.length === 1 && (
          <ReferenceLine
            y={trendData[0].winRate}
            stroke="hsl(var(--primary))"
            strokeWidth={2}
          />
        )}
        {/* Use a strong fixed color to avoid theme visibility issues */}
        <Line
          type="monotone"
          dataKey="winRate"
          stroke="#2563eb"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          dot={{ r: 2 }}
          activeDot={{ r: 4 }}
          name="Rolling Win Rate"
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

const ChampionPerformanceQuadrant: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
}> = ({ data, overallWinRate, smoothingMethod, kValue }) => {
  const MIN_GAMES = 3;
  const quadrantData = useMemo(() => {
    const stats: { [key: string]: { wins: number; total: number } } = {};
    data.forEach((g) => {
      if (!stats[g.champion]) stats[g.champion] = { wins: 0, total: 0 };
      stats[g.champion].total++;
      if (g.outcome === "Win") stats[g.champion].wins++;
    });
    return Object.entries(stats)
      .filter(([, s]) => s.total >= MIN_GAMES)
      .map(([name, s]) => ({
        name,
        playRate: s.total,
        winRate: calculateSmoothedWinRate(
          s.wins,
          s.total,
          overallWinRate,
          smoothingMethod,
          kValue
        ),
      }));
  }, [data, overallWinRate, smoothingMethod, kValue]);

  if (quadrantData.length < 2) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          Play at least two champions {MIN_GAMES} times each to see this chart.
        </p>
      </div>
    );
  }

  const avgPlayRate =
    quadrantData.reduce((acc, d) => acc + d.playRate, 0) / quadrantData.length;

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 20 }}>
        <CartesianGrid />
        <XAxis
          type="number"
          dataKey="playRate"
          name="Games Played"
          unit="g"
          label={{
            value: "Games Played",
            position: "insideBottom",
            offset: -15,
          }}
        />
        <YAxis
          type="number"
          dataKey="winRate"
          name="Win Rate"
          unit="%"
          domain={[0, 100]}
          label={{
            value: "Win Rate",
            angle: -90,
            position: "insideLeft",
            offset: 10,
          }}
        />
        <ZAxis type="number" dataKey="playRate" range={[50, 500]} />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        <ReferenceLine
          y={50}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
        />
        <ReferenceLine
          x={avgPlayRate}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
        >
          <RechartsLabel
            value="Avg Play Rate"
            position="insideTop"
            offset={10}
            fill="hsl(var(--muted-foreground))"
            fontSize={12}
          />
        </ReferenceLine>
        <Scatter name="Champions" data={quadrantData}>
          {quadrantData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={getHeatmapColor(entry.winRate, entry.playRate)}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
};

const CustomTreemapContent = (props: any) => {
  const { depth, x, y, width, height, name, value, winRate } = props;
  const isParent = depth === 1;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: isParent
            ? "hsl(var(--muted))"
            : getHeatmapColor(winRate, value),
          stroke: "hsl(var(--background))",
          strokeWidth: 2 / (depth + 1e-10),
        }}
      />
      {width > 80 && height > 25 && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 7}
          textAnchor="middle"
          fill="#fff"
          fontSize={14}
          stroke="hsl(var(--card-foreground))"
          strokeOpacity={0.6}
        >
          {name}
        </text>
      )}
      {!isParent && width > 80 && height > 40 && (
        <text x={x + 4} y={y + 18} fill="#fff" fontSize={12} fillOpacity={0.9}>
          {value} games
        </text>
      )}
    </g>
  );
};

const RoleChampionTreemap: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
}> = ({ data, overallWinRate, smoothingMethod, kValue }) => {
  const treemapData = useMemo(() => {
    const roleMap: {
      [role: string]: { [champion: string]: { wins: number; total: number } };
    } = {};
    data.forEach((g) => {
      if (!g.role || !g.champion) return;
      if (!roleMap[g.role]) roleMap[g.role] = {};
      if (!roleMap[g.role][g.champion])
        roleMap[g.role][g.champion] = { wins: 0, total: 0 };
      roleMap[g.role][g.champion].total++;
      if (g.outcome === "Win") roleMap[g.role][g.champion].wins++;
    });

    return Object.entries(roleMap).map(([roleName, champions]) => ({
      name: roleName,
      children: Object.entries(champions).map(([champName, stats]) => ({
        name: champName,
        size: stats.total,
        winRate: calculateSmoothedWinRate(
          stats.wins,
          stats.total,
          overallWinRate,
          smoothingMethod,
          kValue
        ),
      })),
    }));
  }, [data, overallWinRate, smoothingMethod, kValue]);

  if (treemapData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          No data available for the treemap.
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <Treemap
        data={treemapData}
        dataKey="size"
        stroke="#fff"
        content={<CustomTreemapContent />}
      />
    </ResponsiveContainer>
  );
};

// New: Time-of-day heatmap grouped into blocks (Early Morning, Morning, Afternoon, Evening, Night)
const TimeOfDayHeatmap: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
}> = ({ data, overallWinRate, smoothingMethod, kValue }) => {
  const heatmapData = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const timeBlocks = [
      { name: "Early Morning", hours: [0, 1, 2, 3, 4, 5] },
      { name: "Morning", hours: [6, 7, 8, 9, 10, 11] },
      { name: "Afternoon", hours: [12, 13, 14, 15, 16] },
      { name: "Evening", hours: [17, 18, 19, 20] },
      { name: "Night", hours: [21, 22, 23] },
    ];

    const stats = Array(7)
      .fill(0)
      .map(() =>
        Array(timeBlocks.length)
          .fill(0)
          .map(() => ({ wins: 0, total: 0 }))
      );

    data.forEach((game) => {
      const date = new Date(game.timestamp);
      const dayIndex = date.getDay();
      const hour = date.getHours();
      const timeBlockIndex = timeBlocks.findIndex((block) =>
        block.hours.includes(hour)
      );

      if (timeBlockIndex !== -1) {
        stats[dayIndex][timeBlockIndex].total++;
        if (game.outcome === "Win") {
          stats[dayIndex][timeBlockIndex].wins++;
        }
      }
    });

    return { days, timeBlocks, stats };
  }, [data]);

  // Helper to format tooltip time range for each block
  const formatBlockRange = (hours: number[]) => {
    if (!hours.length) return "";
    const min = Math.min(...hours);
    const max = Math.max(...hours);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const start = `${pad(min)}:00`;
    const end = max === 23 ? "23:59" : `${pad(max)}:59`;
    return `${start} – ${end}`;
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col text-xs">
        {/* Header Row */}
        <div className="flex">
          <div className="w-12 shrink-0"></div>
          {heatmapData.timeBlocks.map((block) => (
            <ShadcnTooltip key={block.name} delayDuration={100}>
              <TooltipTrigger asChild>
                <div className="flex-1 text-center text-muted-foreground font-medium p-1 cursor-help">
                  {block.name}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="center">
                <span className="font-medium">
                  {formatBlockRange(block.hours)}
                </span>
              </TooltipContent>
            </ShadcnTooltip>
          ))}
        </div>
        {/* Data Rows */}
        {heatmapData.days.map((day, dayIndex) => (
          <div key={day} className="flex items-center">
            <div className="w-12 text-card-foreground font-bold text-right pr-2 shrink-0">
              {day}
            </div>
            {heatmapData.timeBlocks.map((block, blockIndex) => {
              const cellStats = heatmapData.stats[dayIndex][blockIndex];
              const adjustedWinRate = calculateSmoothedWinRate(
                cellStats.wins,
                cellStats.total,
                overallWinRate,
                smoothingMethod,
                kValue
              );
              const tooltipText =
                cellStats.total > 0
                  ? `${adjustedWinRate.toFixed(0)}% WR (${cellStats.wins}W / ${
                      cellStats.total - cellStats.wins
                    }L)`
                  : "No games";
              return (
                <div key={`${day}-${block.name}`} className="flex-1 h-10 p-0.5">
                  <div
                    className={`w-full h-full rounded flex items-center justify-center text-white font-bold ${getHeatmapColor(
                      adjustedWinRate,
                      cellStats.total
                    )}`}
                    title={tooltipText}
                  >
                    {cellStats.total > 0 && `${adjustedWinRate.toFixed(0)}%`}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Time-of-day K-means clustering scatter ---
type ClusterPoint = {
  dayIdx: number; // 0-6 (Sun-Sat)
  hour: number; // 0-23
  wr: number; // 0-100
  total: number; // games
  // feature vector cached for clustering
  f: [number, number, number, number, number];
};

const dayShortLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildFeatures(
  dayIdx: number,
  hour: number,
  wr: number,
  wrWeight = 1
): [number, number, number, number, number] {
  const dayAngle = (2 * Math.PI * dayIdx) / 7;
  const hourAngle = (2 * Math.PI * hour) / 24;
  return [
    Math.sin(dayAngle),
    Math.cos(dayAngle),
    Math.sin(hourAngle),
    Math.cos(hourAngle),
    (wr / 100) * wrWeight,
  ];
}

function kmeans(
  points: ClusterPoint[],
  k: number,
  maxIter = 50
): { assignments: number[]; centroids: number[][]; inertia: number } {
  if (points.length === 0)
    return { assignments: [], centroids: [], inertia: 0 };
  const n = points.length;
  // Initialize centroids by picking k well-spaced points by hour order
  const sortedByHour = [...points].sort((a, b) => a.hour - b.hour);
  const step = Math.max(1, Math.floor(n / k));
  const centroids: number[][] = [];
  for (let i = 0; i < k; i++) {
    const p = sortedByHour[Math.min(i * step, n - 1)];
    centroids.push([...p.f]);
  }

  let assignments = new Array(n).fill(0);
  let changed = true;
  let iter = 0;
  while (changed && iter < maxIter) {
    changed = false;
    // Assign
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < k; c++) {
        const d =
          (points[i].f[0] - centroids[c][0]) ** 2 +
          (points[i].f[1] - centroids[c][1]) ** 2 +
          (points[i].f[2] - centroids[c][2]) ** 2 +
          (points[i].f[3] - centroids[c][3]) ** 2 +
          (points[i].f[4] - centroids[c][4]) ** 2;
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }
    if (!changed) break;

    // Update with weights favoring more-played cells
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0, 0]);
    const weights = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      const w = Math.max(1, points[i].total);
      for (let j = 0; j < 5; j++) sums[c][j] += points[i].f[j] * w;
      weights[c] += w;
    }
    for (let c = 0; c < k; c++) {
      if (weights[c] > 0) {
        for (let j = 0; j < 5; j++) centroids[c][j] = sums[c][j] / weights[c];
      }
    }
    iter++;
  }
  // Inertia (sum of squared distances)
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    const c = assignments[i];
    const d =
      (points[i].f[0] - centroids[c][0]) ** 2 +
      (points[i].f[1] - centroids[c][1]) ** 2 +
      (points[i].f[2] - centroids[c][2]) ** 2 +
      (points[i].f[3] - centroids[c][3]) ** 2 +
      (points[i].f[4] - centroids[c][4]) ** 2;
    inertia += d;
  }
  return { assignments, centroids, inertia };
}

const ClusterLegend = ({
  centroidInfo,
  colors,
}: {
  centroidInfo: any[];
  colors: string[];
}) => {
  const getDayPeriod = (hour: number) => {
    if (hour >= 0 && hour < 6) return "Early Morning";
    if (hour >= 6 && hour < 12) return "Morning";
    if (hour >= 12 && hour < 17) return "Afternoon";
    if (hour >= 17 && hour < 21) return "Evening";
    return "Night";
  };

  const getDayType = (dayIdx: number) => {
    return dayIdx === 0 || dayIdx === 6 ? "Weekend" : "Weekday";
  };

  return (
    <div className="mt-4 space-y-2">
      <h4 className="font-semibold text-sm text-card-foreground">
        Cluster Summary
      </h4>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-xs">
        {centroidInfo.map((c) => (
          <li key={c.cluster} className="flex items-start gap-3">
            <div
              className="w-3 h-3 rounded-full mt-1 shrink-0"
              style={{ backgroundColor: colors[c.cluster % colors.length] }}
            />
            <div>
              <span className="font-semibold text-card-foreground">
                {c.label} ({getDayType(c.dayIdx)}{" "}
                {getDayPeriod(c.hour).toLowerCase()})
              </span>
              <p className="text-muted-foreground">
                Avg. Adj. WR:{" "}
                <span
                  className={c.meanWr >= 50 ? "text-green-600" : "text-red-600"}
                >
                  {c.meanWr.toFixed(1)}%
                </span>{" "}
                over ~{Math.round(c.total)} games.
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

const TimeOfDayClusteringChart: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
  clusters: number;
  minGames: number;
  wrWeight: number;
}> = ({
  data,
  overallWinRate,
  smoothingMethod,
  kValue,
  clusters,
  minGames,
  wrWeight,
}) => {
  const cellStats = useMemo(() => {
    // Aggregate wins/total per day-hour
    const stats = Array(7)
      .fill(0)
      .map(() =>
        Array(24)
          .fill(0)
          .map(() => ({ wins: 0, total: 0 }))
      );
    data.forEach((g) => {
      const d = new Date(g.timestamp);
      const day = d.getDay();
      const h = d.getHours();
      stats[day][h].total++;
      if (g.outcome === "Win") stats[day][h].wins++;
    });
    const points: ClusterPoint[] = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const { wins, total } = stats[day][hour];
        if (total === 0 || total < minGames) continue;
        const wr = calculateSmoothedWinRate(
          wins,
          total,
          overallWinRate,
          smoothingMethod,
          kValue
        );
        points.push({
          dayIdx: day,
          hour,
          wr,
          total,
          f: buildFeatures(day, hour, wr, wrWeight),
        });
      }
    }
    return points;
  }, [data, overallWinRate, smoothingMethod, kValue, minGames, wrWeight]);

  const clustered = useMemo(() => {
    if (cellStats.length === 0 || clusters < 1)
      return {
        points: [] as Array<ClusterPoint & { cluster: number }>,
        centroids: [] as number[][],
        inertia: 0,
        silhouette: 0,
      };
    const K = Math.max(1, Math.min(clusters, Math.min(8, cellStats.length)));
    const { assignments, centroids, inertia } = kmeans(cellStats, K);
    const pointsWithCluster = cellStats.map((p, i) => ({
      ...p,
      cluster: assignments[i] ?? 0,
    }));

    // Silhouette score (approx, Euclidean in feature space)
    const byCluster: Record<number, ClusterPoint[]> = {};
    pointsWithCluster.forEach((p) => {
      (byCluster[p.cluster] ||= []).push(p);
    });
    const dist = (a: ClusterPoint, b: ClusterPoint) =>
      (a.f[0] - b.f[0]) ** 2 +
      (a.f[1] - b.f[1]) ** 2 +
      (a.f[2] - b.f[2]) ** 2 +
      (a.f[3] - b.f[3]) ** 2 +
      (a.f[4] - b.f[4]) ** 2;
    let sSum = 0;
    for (const p of pointsWithCluster) {
      const same = byCluster[p.cluster];
      // a: mean distance to same cluster (exclude self)
      let a = 0;
      if (same.length <= 1) {
        a = 0;
      } else {
        let acc = 0;
        for (const q of same) {
          if (q === p) continue;
          acc += dist(p, q);
        }
        a = acc / (same.length - 1);
      }
      // b: min mean distance to other clusters
      let b = Number.POSITIVE_INFINITY;
      for (const [cidStr, arr] of Object.entries(byCluster)) {
        const cid = Number(cidStr);
        if (cid === p.cluster) continue;
        if (arr.length === 0) continue;
        let acc = 0;
        for (const q of arr) acc += dist(p, q);
        const mean = acc / arr.length;
        if (mean < b) b = mean;
      }
      const s = b === a ? 0 : (b - a) / Math.max(a, b);
      sSum += s;
    }
    const silhouette = pointsWithCluster.length
      ? sSum / pointsWithCluster.length
      : 0;

    return { points: pointsWithCluster, centroids, inertia, silhouette };
  }, [cellStats, clusters]);

  const colors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
    "hsl(var(--primary))",
    "hsl(var(--muted-foreground))",
    "hsl(var(--accent))",
  ];

  const chartConfig: ChartConfig = {
    C1: { label: "Cluster 1", color: colors[0] },
    C2: { label: "Cluster 2", color: colors[1] },
    C3: { label: "Cluster 3", color: colors[2] },
    C4: { label: "Cluster 4", color: colors[3] },
    C5: { label: "Cluster 5", color: colors[4] },
    C6: { label: "Cluster 6", color: colors[5] },
    C7: { label: "Cluster 7", color: colors[6] },
    C8: { label: "Cluster 8", color: colors[7] },
  };

  if (clustered.points.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          Not enough data to build clusters.
        </p>
      </div>
    );
  }

  const series = Array.from(
    { length: Math.min(clusters, colors.length) },
    (_, c) => clustered.points.filter((p) => p.cluster === c)
  );

  // Compute human-readable centroids in time space using circular means
  const centroidInfo = series.map((arr, idx) => {
    let sDay = 0,
      cDay = 0,
      sHour = 0,
      cHour = 0,
      totalGames = 0,
      wrSum = 0;
    for (const p of arr) {
      const w = Math.max(1, p.total);
      const dayAng = (2 * Math.PI * p.dayIdx) / 7;
      const hourAng = (2 * Math.PI * p.hour) / 24;
      sDay += Math.sin(dayAng) * w;
      cDay += Math.cos(dayAng) * w;
      sHour += Math.sin(hourAng) * w;
      cHour += Math.cos(hourAng) * w;
      wrSum += p.wr * w;
      totalGames += w;
    }
    const dayAng = Math.atan2(sDay, cDay);
    const hourAng = Math.atan2(sHour, cHour);
    const dayIdx =
      ((Math.round(
        (7 * (dayAng < 0 ? dayAng + 2 * Math.PI : dayAng)) / (2 * Math.PI)
      ) %
        7) +
        7) %
      7;
    const hourFloat =
      (24 * (hourAng < 0 ? hourAng + 2 * Math.PI : hourAng)) / (2 * Math.PI);
    const hour = Math.round(hourFloat) % 24;
    const meanWr = totalGames > 0 ? wrSum / totalGames : 0;
    return {
      cluster: idx,
      dayIdx,
      hour,
      meanWr,
      total: totalGames,
      label: `C${idx + 1}`,
    };
  });

  const yTicks = [0, 1, 2, 3, 4, 5, 6];

  const ClusteringTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const payloadItem = payload[0].payload as any;
    if (payloadItem.label) {
      // centroid
      return (
        <div className="bg-white/80 backdrop-blur-sm p-2 border border-gray-200 rounded-md shadow-lg text-sm">
          <p className="font-bold text-gray-800">
            Centroid {payloadItem.label}
          </p>
          <p>
            {dayShortLabels[payloadItem.dayIdx]} @ {payloadItem.hour}:00
          </p>
          <p>Mean Adj. WR: {payloadItem.meanWr.toFixed(1)}%</p>
          <p>Weighted Games: {Math.round(payloadItem.total)}</p>
        </div>
      );
    }
    const p = payloadItem as ClusterPoint & { cluster: number };
    return (
      <div className="bg-white/80 backdrop-blur-sm p-2 border border-gray-200 rounded-md shadow-lg text-sm">
        <p className="font-bold text-gray-800">
          {dayShortLabels[p.dayIdx]} @ {p.hour}:00
        </p>
        <p>Adj. Win Rate: {p.wr.toFixed(1)}%</p>
        <p>Games: {p.total}</p>
        <p>Cluster: {p.cluster + 1}</p>
      </div>
    );
  };

  return (
    <div>
      <ChartContainer config={chartConfig} className="w-full">
        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart margin={{ top: 48, right: 20, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="hour"
              name="Hour"
              domain={[-0.5, 23.5]}
              ticks={[0, 3, 6, 9, 12, 15, 18, 21, 23]}
              label={{
                value: "Hour of Day",
                position: "insideBottom",
                offset: -10,
              }}
            />
            <YAxis
              type="number"
              dataKey="dayIdx"
              name="Day"
              domain={[-0.3, 6.3]}
              ticks={yTicks}
              tickFormatter={(v) => dayShortLabels[v]}
              label={{
                value: "Day of Week",
                angle: -90,
                position: "insideLeft",
              }}
            />
            <ZAxis
              type="number"
              dataKey="total"
              range={[60, 400]}
              name="Games"
            />
            <Tooltip
              content={<ClusteringTooltip />}
              cursor={{ strokeDasharray: "3 3" }}
            />
            {series.map((s, idx) => (
              <Scatter
                key={idx}
                name={`Cluster ${idx + 1}`}
                data={s}
                // MODIFICATION: No longer need the modulo fallback since ChartContainer provides colors
                fill={colors[idx]}
              />
            ))}
            <Scatter
              name="Centroids"
              data={centroidInfo}
              // MODIFICATION: Use a direct color that stands out
              fill="black"
              stroke="white"
            >
              <LabelList dataKey="label" position="top" offset={8} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </ChartContainer>

      {/* MODIFICATION: Add the new legend and metrics footer */}
      <div className="mt-2 px-4">
        <ClusterLegend centroidInfo={centroidInfo} colors={colors} />
        <div className="text-xs text-muted-foreground mt-4 border-t pt-2">
          <span>Avg silhouette: {clustered.silhouette.toFixed(2)}</span>
          <span className="mx-2">•</span>
          <span>Inertia: {clustered.inertia.toFixed(1)}</span>
          <span className="mx-2">•</span>
          <span>Points: {clustered.points.length}</span>
        </div>
      </div>
    </div>
  );
};

const smoothingMethodInfo: Record<
  SmoothingMethods,
  { label: string; description: string; formula: string }
> = {
  none: {
    label: "None",
    description:
      "No adjustment. Displays the raw, unadjusted win rate. This can be misleading for small sample sizes.",
    formula: "\\frac{wins}{total}",
  },
  bayesian: {
    label: "Bayesian Average",
    description:
      "A Bayesian average that pulls the win rate towards the overall average. Good for small sample sizes. The 'k' value determines the strength of the pull.",
    formula: "\\frac{wins + k \\cdot avg}{total + k}",
  },
  laplace: {
    label: "Laplace Smoothing",
    description:
      "Laplace smoothing (or Additive smoothing) adds a pseudo-count to each outcome. It's simple and prevents win rates of 0% or 100% for small sample sizes.",
    formula: "\\frac{wins + 1}{total + 2}",
  },
  wilson: {
    label: "Wilson Score",
    description:
      "The Wilson score interval is a more sophisticated method that calculates a confidence interval for the win rate. It provides a lower bound, which is a conservative and reliable estimate.",
    formula:
      "\\frac{\\hat{p} + \\frac{z^2}{2n} - z \\sqrt{\\frac{\\hat{p}(1-\\hat{p}) + \\frac{z^2}{4n}}{n}}}{1 + \\frac{z^2}{n}}",
  },
};

// --- Main Dashboard Component ---

interface DashboardProps {
  data: MatchHistoryResponse;
}

function Dashboard({ data }: DashboardProps) {
  const matches: MatchHistoryData = useMemo(
    () => (data.data ? data.data.flat() : []),
    [data]
  );

  const [roleFilter, setRoleFilter] = useState("ALL");
  const [championFilter, setChampionFilter] = useState("ALL");
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(
    undefined
  );
  const [smoothingMethod, setSmoothingMethod] =
    useState<SmoothingMethods>("none");
  const [kValue, setKValue] = useState(5);
  const [rollingWindow, setRollingWindow] = useState(15);
  const [clusterCount, setClusterCount] = useState(4);
  const [minClusterGames, setMinClusterGames] = useState(2);
  const [wrInfluence, setWrInfluence] = useState(1);

  const championOptions = useMemo(
    () => [
      { value: "ALL", label: "All Champions" },
      ...[...new Set(matches.map((g) => g.champion))]
        .filter(Boolean) // Removes any empty strings from the list
        .sort()
        .map((c) => ({ value: c, label: c })),
    ],
    [matches]
  );

  const roleOptions = useMemo(
    () => [
      { value: "ALL", label: "All Roles" },
      ...[...new Set(matches.map((g) => g.role))]
        .filter(Boolean) // Removes any empty strings from the list
        .sort()
        .map((r) => ({ value: r, label: r })),
    ],
    [matches]
  );

  const filteredData = useMemo(() => {
    return matches.filter((game) => {
      const roleMatch = roleFilter === "ALL" || game.role === roleFilter;
      const championMatch =
        championFilter === "ALL" || game.champion === championFilter;

      if (!dateRange?.from) {
        // No date filter applied
        return roleMatch && championMatch;
      }

      // At least a 'from' date is selected
      const gameTime = game.timestamp;

      // Adjust to start of the 'from' day
      const fromTime = new Date(dateRange.from).setHours(0, 0, 0, 0);

      // If 'to' is not selected, use the end of the 'from' day for a single-day range
      const toTime = (
        dateRange.to ? new Date(dateRange.to) : new Date(dateRange.from)
      ).setHours(23, 59, 59, 999);

      const dateMatch = gameTime >= fromTime && gameTime <= toTime;

      return roleMatch && championMatch && dateMatch;
    });
  }, [matches, roleFilter, championFilter, dateRange]);

  const { totalGames, winRate, overallWinRateDecimal } = useMemo(() => {
    if (!filteredData.length)
      return { totalGames: 0, winRate: "0.0", overallWinRateDecimal: 0.5 };
    const wins = filteredData.filter((g) => g.outcome === "Win").length;
    const total = filteredData.length;
    return {
      totalGames: total,
      winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0",
      overallWinRateDecimal: total > 0 ? wins / total : 0.5,
    };
  }, [filteredData]);

  return (
    <TooltipProvider>
      <div className="w-full max-w-6xl mx-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Analysis Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-4 items-end">
            {/* Role Filter */}
            <div className="w-full md:w-auto flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select onValueChange={setRoleFilter} defaultValue="ALL">
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Filter by Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Roles</SelectLabel>
                    {roleOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {/* Champion Filter */}
            <div className="w-full md:w-auto flex flex-col gap-1.5">
              <Label>Champion</Label>
              <Select onValueChange={setChampionFilter} defaultValue="ALL">
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Filter by Champion" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Champions</SelectLabel>
                    {championOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {/* Smoothing Method Filter */}
            <div className="w-full md:w-auto flex flex-col gap-1.5 relative">
              {smoothingMethod === "bayesian" && (
                <div className="absolute bottom-full mb-2 w-full md:w-[200px] space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="k-slider">Adjustment Strength (k)</Label>
                      <ShadcnTooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-muted-foreground cursor-help">
                            i
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-xs"
                        >
                          Higher k pulls small-sample win rates toward your
                          overall average more strongly. Use larger k for more
                          conservative estimates.
                        </TooltipContent>
                      </ShadcnTooltip>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {kValue}
                    </span>
                  </div>
                  <Slider
                    id="k-slider"
                    min={0}
                    max={20}
                    step={1}
                    value={[kValue]}
                    onValueChange={(value) => setKValue(value[0])}
                  />
                </div>
              )}
              <Label>Adjustment Formula</Label>
              <Select
                onValueChange={(value: SmoothingMethods) =>
                  setSmoothingMethod(value)
                }
                defaultValue="none"
              >
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Select Method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Adjustment Formula</SelectLabel>
                    {Object.entries(smoothingMethodInfo).map(
                      ([key, { label, description, formula }]) => (
                        <ShadcnTooltip key={key} delayDuration={100}>
                          <TooltipTrigger asChild>
                            <SelectItem value={key}>{label}</SelectItem>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="max-w-xs"
                            align="start"
                          >
                            <p className="font-bold">{label}</p>
                            <p>{description}</p>
                            <div className="mt-2">
                              <InlineMath math={formula} />
                            </div>
                          </TooltipContent>
                        </ShadcnTooltip>
                      )
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {/* Date Range Picker */}
            <div className="w-full md:w-auto flex flex-col gap-1.5">
              <Label htmlFor="dates">Date Range</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    id="dates"
                    className="w-full md:w-[240px] justify-between text-left font-normal"
                  >
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {dateRange.from.toLocaleDateString()} -{" "}
                          {dateRange.to.toLocaleDateString()}
                        </>
                      ) : (
                        dateRange.from.toLocaleDateString()
                      )
                    ) : (
                      "Select date range"
                    )}
                    <ChevronDownIcon className="ml-2 h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto overflow-hidden p-0"
                  align="start"
                >
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={setDateRange}
                    captionLayout="dropdown"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        {/* Stack stat cards vertically in a single grid column */}
        <div className="lg:col-span-1 md:col-span-1 col-span-1 flex flex-col gap-6">
          <StatCard
            title="Games Analyzed"
            value={totalGames}
            description="Based on current filters."
            valueColor="text-card-foreground"
          />
          <StatCard
            title="Win Rate"
            value={`${winRate}%`}
            description="Based on current filters."
            valueColor={
              parseFloat(winRate) >= 50 ? "text-green-600" : "text-red-600"
            }
          />
        </div>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Win/Loss & Role Breakdown</CardTitle>
            <CardDescription>
              Inner ring: Win/Loss. Outer ring: Role distribution.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <WinLossRoleDistributionChart data={filteredData} />
          </CardContent>
          {/* You can add a CardFooter here if desired */}
          <CardFooter className="flex-col gap-2 text-sm pt-4">
            <div className="text-muted-foreground leading-none">
              Hover over a segment to see details.
            </div>
          </CardFooter>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Key Insights</CardTitle>
            <CardDescription>
              Automated analysis, adjusted for statistical confidence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KeyInsights
              data={filteredData}
              overallWinRate={overallWinRateDecimal}
              smoothingMethod={smoothingMethod as SmoothingMethods}
              kValue={kValue}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Adjusted Daily Win Rate</CardTitle>
            <CardDescription>
              Your win rate by day of the week, adjusted for confidence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DailyWinRateChart
              data={filteredData}
              overallWinRate={overallWinRateDecimal}
              smoothingMethod={smoothingMethod as SmoothingMethods}
              kValue={kValue}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Hourly Performance Breakdown</CardTitle>
            <CardDescription>
              A detailed heatmap of win rates by day and hour, adjusted for
              confidence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HourlyWinRateHeatmap
              data={filteredData}
              overallWinRate={overallWinRateDecimal}
              smoothingMethod={smoothingMethod as SmoothingMethods}
              kValue={kValue}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Time of Day Performance</CardTitle>
            <CardDescription>
              Win rates grouped by time blocks across the week, adjusted for
              confidence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimeOfDayHeatmap
              data={filteredData}
              overallWinRate={overallWinRateDecimal}
              smoothingMethod={smoothingMethod as SmoothingMethods}
              kValue={kValue}
            />
          </CardContent>
        </Card>

        {/* Clustering visualization card */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Time-of-Day Clusters</CardTitle>
                  <ShadcnTooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-muted-foreground cursor-help">
                        i
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="start"
                      className="max-w-sm"
                    >
                      <div className="space-y-1 text-xs">
                        <p>
                          Each dot is a (day × hour) time slot. X = hour, Y =
                          day. Size = games played. Color = cluster group.
                        </p>
                        <p>
                          Clusters are learned using cyclical features for time
                          and your adjusted win rate (scaled by the Win rate
                          influence control).
                        </p>
                        <p>
                          Centroids (C1, C2, …) summarize the typical day/hour
                          and mean adjusted WR for each cluster.
                        </p>
                        <p>
                          Use the controls to tune granularity (k), filter noise
                          (min games), and emphasize performance (WR influence).
                          Metrics show quality (silhouette) and tightness
                          (inertia).
                        </p>
                      </div>
                    </TooltipContent>
                  </ShadcnTooltip>
                </div>
                <CardDescription>
                  K-means clusters over day/hour cells sized by games and
                  colored by cluster.
                </CardDescription>
              </div>
              <div className="flex gap-6 flex-wrap">
                <div className="w-48 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="cluster-slider" className="text-xs">
                        Clusters (k)
                      </Label>
                      <ShadcnTooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] text-muted-foreground cursor-help">
                            i
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-xs"
                        >
                          How many groups K-means should find. Lower k = broader
                          patterns; higher k = finer, smaller clusters.
                        </TooltipContent>
                      </ShadcnTooltip>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {clusterCount}
                    </span>
                  </div>
                  <Slider
                    id="cluster-slider"
                    min={2}
                    max={8}
                    step={1}
                    value={[clusterCount]}
                    onValueChange={(v) => setClusterCount(v[0])}
                  />
                </div>
                <div className="w-56 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="min-games-slider" className="text-xs">
                        Min games per cell
                      </Label>
                      <ShadcnTooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] text-muted-foreground cursor-help">
                            i
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-xs"
                        >
                          Filters out time slots with fewer than this many games
                          before clustering to reduce small-sample noise.
                        </TooltipContent>
                      </ShadcnTooltip>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {minClusterGames}
                    </span>
                  </div>
                  <Slider
                    id="min-games-slider"
                    min={1}
                    max={10}
                    step={1}
                    value={[minClusterGames]}
                    onValueChange={(v) => setMinClusterGames(v[0])}
                  />
                </div>
                <div className="w-56 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="wr-weight-slider" className="text-xs">
                        Win rate influence
                      </Label>
                      <ShadcnTooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] text-muted-foreground cursor-help">
                            i
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-xs"
                        >
                          Scales the adjusted win rate feature in clustering. 0×
                          uses only time patterns; higher values emphasize
                          performance differences.
                        </TooltipContent>
                      </ShadcnTooltip>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {wrInfluence.toFixed(1)}x
                    </span>
                  </div>
                  <Slider
                    id="wr-weight-slider"
                    min={0}
                    max={3}
                    step={0.5}
                    value={[wrInfluence]}
                    onValueChange={(v) => setWrInfluence(v[0])}
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <TimeOfDayClusteringChart
              data={filteredData}
              overallWinRate={overallWinRateDecimal}
              smoothingMethod={smoothingMethod}
              kValue={kValue}
              clusters={clusterCount}
              minGames={minClusterGames}
              wrWeight={wrInfluence}
            />
          </CardContent>
        </Card>

        {/* This card is for the Rolling Trend */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <CardTitle>Performance Trend</CardTitle>
                <CardDescription>
                  Your rolling win rate over the last games.
                </CardDescription>
              </div>
              <div className="w-48 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="window-slider" className="text-xs">
                      Window Size
                    </Label>
                    <ShadcnTooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] text-muted-foreground cursor-help">
                          i
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        align="start"
                        className="max-w-xs"
                      >
                        Number of games per rolling window when computing the
                        trend. Larger windows smooth noise but react more
                        slowly.
                      </TooltipContent>
                    </ShadcnTooltip>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    {rollingWindow}
                  </span>
                </div>
                <Slider
                  id="window-slider"
                  min={5}
                  max={30}
                  step={1}
                  value={[rollingWindow]}
                  onValueChange={(v) => setRollingWindow(v[0])}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Note: This chart uses all matches, not filtered data, to show the true historical trend */}
            <RollingWinRateTrend data={matches} windowSize={rollingWindow} />
          </CardContent>
        </Card>

        {/* These two cards will sit side-by-side */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Champion Performance Quadrant</CardTitle>
            <CardDescription>
              Win rate vs. play rate for your champion pool.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChampionPerformanceQuadrant
              data={filteredData}
              overallWinRate={overallWinRateDecimal}
              smoothingMethod={smoothingMethod}
              kValue={kValue}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Role & Champion Pool</CardTitle>
            <CardDescription>
              A treemap of your most played roles and champions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RoleChampionTreemap
              data={filteredData}
              overallWinRate={overallWinRateDecimal}
              smoothingMethod={smoothingMethod}
              kValue={kValue}
            />
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

export default React.memo(Dashboard);
