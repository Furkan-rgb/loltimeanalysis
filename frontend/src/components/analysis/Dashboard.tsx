import React, { useMemo, useState } from "react";
import type { MatchHistoryResponse, MatchHistoryData } from "@/types";
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
    return (
      <div className="bg-white/80 backdrop-blur-sm p-2 border border-gray-200 rounded-md shadow-lg text-sm">
        <p className="font-bold text-gray-800">{label}</p>
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

const WinLossDoughnutChart: React.FC<{ data: MatchHistoryData }> = ({
  data,
}) => {
  const chartData = useMemo(() => {
    const stats = data.reduce(
      (acc, game) => {
        game.outcome === "Win" ? acc.wins++ : acc.losses++;
        return acc;
      },
      { wins: 0, losses: 0 }
    );
    return [
      { name: "Wins", value: stats.wins },
      { name: "Losses", value: stats.losses },
    ];
  }, [data]);

  const COLORS = ["hsl(var(--primary))", "hsl(var(--muted-foreground) / 0.5)"];

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={80}
          paddingAngle={5}
        >
          {chartData.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              stroke={COLORS[index % COLORS.length]}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        {/* <Legend iconSize={10} verticalAlign="bottom" /> */}
      </PieChart>
    </ResponsiveContainer>
  );
};

const WinLossRoleDistributionChart: React.FC<{ data: MatchHistoryData }> = ({
  data,
}) => {
  const chartConfig = {
    wins: { label: "Wins", color: "hsl(var(--chart-2))" },
    losses: { label: "Losses", color: "hsl(var(--chart-5))" },
    TOP: { label: "Top", color: "hsl(var(--chart-1))" },
    JUNGLE: { label: "Jungle", color: "hsl(var(--chart-2))" },
    MIDDLE: { label: "Mid", color: "hsl(var(--chart-3))" },
    BOTTOM: { label: "Bot", color: "hsl(var(--chart-4))" },
    UTILITY: { label: "Support", color: "hsl(var(--chart-5))" },
    UNKNOWN: { label: "Unknown", color: "hsl(var(--muted))" },
  } satisfies ChartConfig;

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
          <Label
            content={({ viewBox }) => {
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
        />
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
    // Note: The week starts on Sunday here. You can re-order if you prefer Monday first.
    const dayOrder = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const stats = dayOrder.map((day) => ({ day, wins: 0, total: 0 }));

    data.forEach((game) => {
      const dayIndex = new Date(game.timestamp * 1000).getDay();
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
      const date = new Date(game.timestamp * 1000);
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
      const dayIndex = new Date(g.timestamp * 1000).getDay();
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
      rollingData.push({
        game: `Game ${i + windowSize}`,
        winRate: (wins / windowSize) * 100,
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

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart key={windowSize} data={trendData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="game"
          tick={false}
          label={{
            value: `Most Recent ${trendData.length} Games`,
            position: "insideBottom",
            offset: -5,
          }}
        />
        <YAxis domain={[0, 100]} unit="%" />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine
          y={50}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
        />
        <Line
          type="monotone"
          dataKey="winRate"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
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
      const date = new Date(game.timestamp * 1000);
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

export default function Dashboard({ data }: DashboardProps) {
  const matches: MatchHistoryData = useMemo(
    () => (data.data ? data.data.flat() : []),
    [data]
  );

  const [roleFilter, setRoleFilter] = useState("ALL");
  const [championFilter, setChampionFilter] = useState("ALL");
  const [smoothingMethod, setSmoothingMethod] =
    useState<SmoothingMethods>("none");
  const [kValue, setKValue] = useState(5);
  const [rollingWindow, setRollingWindow] = useState(15);

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
    return matches.filter(
      (game) =>
        (roleFilter === "ALL" || game.role === roleFilter) &&
        (championFilter === "ALL" || game.champion === championFilter)
    );
  }, [matches, roleFilter, championFilter]);

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
        <header className="lg:col-span-4">
          <h1 className="text-3xl font-bold">Performance Analysis</h1>
          <p className="text-muted-foreground">
            An analytical look at your recent performance.
          </p>
        </header>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Analysis Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-4 items-start">
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
            <div className="relative w-full md:w-auto">
              {smoothingMethod === "bayesian" && (
                <div className="absolute bottom-full mb-2 w-full md:w-[200px] space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="k-slider">Adjustment Strength (k)</Label>
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
                  <Label htmlFor="window-slider" className="text-xs">
                    Window Size
                  </Label>
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
