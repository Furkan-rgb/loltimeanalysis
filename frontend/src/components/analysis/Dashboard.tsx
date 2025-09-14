import React, { useMemo, useState } from "react";
import type { MatchHistoryResponse, MatchHistoryData } from "@/types";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Bar,
  LabelList,
} from "recharts";

// UI Components from your project
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { InlineMath, BlockMath } from "react-katex";

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
          {chartData.map((entry, index) => (
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

const DailyWinRateChart: React.FC<{
  data: MatchHistoryData;
  overallWinRate: number;
  smoothingMethod: SmoothingMethods;
  kValue: number;
}> = ({ data, overallWinRate, smoothingMethod, kValue }) => {
  const dailyData = useMemo(() => {
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

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={dailyData}>
        <CartesianGrid strokeDasharray="3 3" />
        {/* <XAxis dataKey="day" fontSize={12} />
        <YAxis domain={[0, 100]} fontSize={12} tickFormatter={(v) => `${v}%`} /> */}
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
        />
        <Bar
          dataKey="winRate"
          fill="hsl(var(--primary))"
          radius={[4, 4, 0, 0]}
          unit="%"
        >
          <LabelList
            dataKey="total"
            position="top"
            fontSize={10}
            formatter={(v: number) => (v > 0 ? `${v}g` : "")}
          />
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

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col text-xs">
        <div className="flex">
          <div className="w-10 shrink-0"></div>
          {heatmapData.hours.map((h) => (
            <div
              key={h}
              className="w-8 text-center text-muted-foreground font-medium shrink-0"
            >
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {heatmapData.days.map((day, dayIndex) => (
          <div key={day} className="flex items-center">
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
                <div key={`${day}-${hour}`} className="w-8 h-8 p-0.5 shrink-0">
                  <div
                    className={`w-full h-full rounded ${getHeatmapColor(
                      adjustedWinRate,
                      block.total
                    )} transition-all duration-200 hover:scale-125 hover:shadow-lg`}
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
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Win/Loss Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <WinLossDoughnutChart data={filteredData} />
          </CardContent>
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
      </div>
    </TooltipProvider>
  );
}
