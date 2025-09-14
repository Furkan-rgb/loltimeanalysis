/**
 * Calculates a Bayesian-averaged win rate to provide a more realistic performance metric for small sample sizes.
 * It pulls the win rate towards the overall average, with the effect diminishing as more games are played.
 * @param {number} wins - Number of wins for the specific segment.
 * @param {number} totalGames - Total games played in the segment.
 *
 * @param {number} overallWinRate - The player's overall average win rate (0 to 1).
 * @param {number} k - The "strength" of the prior. Represents how many "average" games to add to the calculation.
 * @returns {number} The adjusted win rate as a percentage.
 */
export const calculateAdjustedWinRate = (
  wins: number,
  totalGames: number,
  overallWinRate: number,
  k: number = 5
): number => {
  if (totalGames === 0) return overallWinRate * 100;
  const numerator = wins + k * overallWinRate;
  const denominator = totalGames + k;
  return (numerator / denominator) * 100;
};

/**
 * Returns a Tailwind CSS background color class based on win rate.
 * @param {number} winRate - The win rate percentage.
 * @param {number} totalGames - The total number of games played.
 * @returns {string} A Tailwind CSS class string.
 */
export const getHeatmapColor = (
  winRate: number,
  totalGames: number
): string => {
  if (totalGames === 0) return "bg-gray-100";
  if (winRate > 65) return "bg-green-500";
  if (winRate > 55) return "bg-green-400";
  if (winRate > 45) return "bg-yellow-300";
  if (winRate > 35) return "bg-red-400";
  return "bg-red-500";
};
