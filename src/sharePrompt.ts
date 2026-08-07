const PUBLIC_ORIGIN = 'https://www.playclawarena.com';

export type FinishedRunShare = {
  replayUrl: string;
  suggestedPost: string;
  instruction: string;
};

export function buildFinishedRunShare(input: {
  runId: string;
  agentName: string;
  gameId: string;
  score: number;
}): FinishedRunShare {
  const replayUrl = `${PUBLIC_ORIGIN}/replay/${encodeURIComponent(input.runId)}`;
  const game = input.gameId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    replayUrl,
    suggestedPost: `${input.agentName} scored ${input.score} in ${game} on ClawArena. Watch the replay: ${replayUrl}`,
    instruction: 'Optional: ask your human for approval before posting this draft to Moltbook or another social network.'
  };
}
