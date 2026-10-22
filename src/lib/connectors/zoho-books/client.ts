import "server-only";

export type ZohoConfig = {
  dc: string; // "com" | "eu" | "in" | ...
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  organizationId: string;
};

export class ZohoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/**
 * Access tokens per refresh token: one Zoho login serves every organization,
 * and refreshing is rate limited, so clients for different orgs share it.
 */
const tokens = new Map<string, { accessToken: string; expiresAt: number }>();

export function clearZohoTokens() {
  tokens.clear();
}

/**
 * Minimal Zoho Books v3 REST client with refresh-token based OAuth.
 * Access tokens live ~1h; we refresh a minute early.
 */
export class ZohoClient {
  constructor(private readonly config: ZohoConfig) {}

  get apiBase() {
    return `https://www.zohoapis.${this.config.dc}/books/v3`;
  }

  get appBase() {
    return `https://books.zoho.${this.config.dc}/app/${this.config.organizationId}`;
  }

  private async token(): Promise<string> {
    const cached = tokens.get(this.config.refreshToken);
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.accessToken;

    const params = new URLSearchParams({
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
    });
    const res = await fetch(`https://accounts.zoho.${this.config.dc}/oauth/v2/token`, {
      method: "POST",
      body: params,
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      throw new ZohoApiError(`Zoho token refresh failed: ${body.error ?? res.status}`, res.status, body);
    }
    tokens.set(this.config.refreshToken, {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    });
    return body.access_token;
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { query?: Record<string, string>; json?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const url = new URL(`${this.apiBase}${path}`);
    url.searchParams.set("organization_id", this.config.organizationId);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${await this.token()}`,
    };
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }

    const res = await fetch(url, { method, headers, body });
    const data = (await res.json()) as { code: number; message: string } & T;
    // Zoho signals errors with a non-zero `code` even on some 200 responses.
    if (!res.ok || data.code !== 0) {
      throw new ZohoApiError(`Zoho ${method} ${path}: ${data.message}`, res.status, data);
    }
    return data;
  }
}
