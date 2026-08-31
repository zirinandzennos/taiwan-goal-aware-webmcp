export const TDX_TOKEN_ENDPOINT = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

export interface TdxServerCredentials {
  clientId?: string;
  clientSecret?: string;
  authorization?: string;
  apiKey?: string;
}

interface CachedToken {
  authorization: string;
  refreshAtMs: number;
}

export function tdxCredentialsFromEnvironment(environment: NodeJS.ProcessEnv = process.env): TdxServerCredentials {
  return {
    authorization: environment.TDX_AUTHORIZATION?.trim(),
    apiKey: environment.TDX_API_KEY?.trim(),
    clientId: environment.TDX_CLIENT_ID?.trim(),
    clientSecret: environment.TDX_CLIENT_SECRET?.trim(),
  };
}

/** Server/import-only client. Never import this module into browser entry points. */
export class TdxAuthorizationProvider {
  #cachedToken: CachedToken | null = null;
  readonly #credentials: TdxServerCredentials;
  readonly #fetchImplementation: typeof fetch;
  readonly #now: () => number;

  constructor(
    credentials: TdxServerCredentials,
    fetchImplementation: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.#credentials = credentials;
    this.#fetchImplementation = fetchImplementation;
    this.#now = now;
  }

  async getAuthorizationHeader(): Promise<string> {
    if (this.#credentials.authorization) return this.#credentials.authorization;
    if (this.#credentials.apiKey) return this.#credentials.apiKey.startsWith("Bearer ")
      ? this.#credentials.apiKey : `Bearer ${this.#credentials.apiKey}`;
    if (this.#cachedToken && this.#cachedToken.refreshAtMs > this.#now()) return this.#cachedToken.authorization;
    if (!this.#credentials.clientId || !this.#credentials.clientSecret) {
      throw new Error("TDX credentials missing. Configure server-side TDX_CLIENT_ID and TDX_CLIENT_SECRET.");
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
    });
    const response = await this.#fetchImplementation(TDX_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`TDX token request failed: HTTP ${response.status}`);
    const value = await response.json() as { access_token?: unknown; token_type?: unknown; expires_in?: unknown };
    if (typeof value.access_token !== "string" || value.access_token.length === 0) {
      throw new Error("TDX token response is missing access_token");
    }
    const tokenType = typeof value.token_type === "string" && value.token_type.length > 0 ? value.token_type : "Bearer";
    const expiresInSec = typeof value.expires_in === "number" && Number.isFinite(value.expires_in) ? value.expires_in : 300;
    const refreshInSec = Math.max(1, expiresInSec - Math.min(60, Math.floor(expiresInSec / 5)));
    this.#cachedToken = {
      authorization: `${tokenType} ${value.access_token}`,
      refreshAtMs: this.#now() + refreshInSec * 1000,
    };
    return this.#cachedToken.authorization;
  }
}
