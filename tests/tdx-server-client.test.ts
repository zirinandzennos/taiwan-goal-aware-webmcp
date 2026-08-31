import { describe, expect, it, vi } from "vitest";
import { TdxAuthorizationProvider } from "../src/providers/tdx/serverClient";

describe("TDX server authorization", () => {
  it("caches a client-credentials token until its refresh boundary", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "secret-token", token_type: "Bearer", expires_in: 300 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new TdxAuthorizationProvider({ clientId: "id", clientSecret: "secret" }, fetchMock as typeof fetch, () => 1_000);
    expect(await provider.getAuthorizationHeader()).toBe("Bearer secret-token");
    expect(await provider.getAuthorizationHeader()).toBe("Bearer secret-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when no server credential source exists", async () => {
    const provider = new TdxAuthorizationProvider({}, vi.fn() as unknown as typeof fetch);
    await expect(provider.getAuthorizationHeader()).rejects.toThrow("TDX credentials missing");
  });
});
