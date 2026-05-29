export class MonzoReauthError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Monzo authorization has expired (90-day re-auth or revoked token). Re-open the Connectors widget and run Connect again with fresh credentials from the Monzo developer playground.",
    );
    this.name = "MonzoReauthError";
  }
}

export class MonzoRateLimitError extends Error {
  retryAfter: string | null;
  constructor(retryAfter: string | null) {
    super(
      `Monzo API rate limit hit. Wait and run the sync again${retryAfter ? ` (after ${retryAfter} seconds)` : ""}.`,
    );
    this.name = "MonzoRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class MonzoApiError extends Error {
  status: number;
  constructor(status: number, bodySnippet: string) {
    super(`Monzo API returned ${status}: ${bodySnippet}`);
    this.name = "MonzoApiError";
    this.status = status;
  }
}
