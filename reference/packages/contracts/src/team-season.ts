export type DivisionStandings = {
  season: number;
  division: string;
  checkedAt: string;
  teams: {
    id: string;
    name: string;
    abbr: string;
    logo: string;
    wins: string;
    losses: string;
    ties: string;
    pct: string;
    divisionRecord: string;
    streak: string;
  }[];
};
export type TeamSchedule = {
  season: number;
  checkedAt: string;
  games: {
    id: string;
    week: number;
    date: string;
    timeValid: boolean;
    opponent: string;
    logo: string;
    home: boolean;
    status: string;
    completed: boolean;
    result: 'W' | 'L' | 'T' | null;
    score: string | null;
  }[];
};

export type TeamSeasonStats = {
  season: number;
  checkedAt: string;
  pointsPerGame: number | null;
  yardsPerGame: number | null;
  passingPerGame: number | null;
  rushingPerGame: number | null;
  firstDownsPerGame: number | null;
};
