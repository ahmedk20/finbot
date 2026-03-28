export interface AnalysisJobData {
  asset:           string;  // "BTC", "NVDA"
  date:            string;  // YYYY-MM-DD — the trade date to analyse
  userId:          string;  // who submitted (for audit)
  output_language: string;  // language for analyst reports e.g. "English", "Arabic"
}

export interface AnalysisReports {
  market?:          string | null;
  sentiment?:       string | null;
  news?:            string | null;
  fundamentals?:    string | null;
  investment_plan?: string | null;
}

export interface AnalysisResultRecord {
  id:        string;
  jobId:     string;
  asset:     string;
  assetType: string;
  date:      string;
  decision:  string;
  reasoning: string;
  reports:   AnalysisReports;
  createdAt: Date;
}

export interface JobStatusResponse {
  jobId:   string;
  status:  'waiting' | 'active' | 'completed' | 'failed' | 'unknown';
  result?: AnalysisResultRecord;
  error?:  string;
}
