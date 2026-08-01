import { jest } from "@jest/globals";
import { HostexApiError, HostexClient, HostexUncertainSendError } from "./hostex.client.js";

describe("HostexClient", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HOSTEX_ACCESS_TOKEN = "hostex-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("authenticates reservation reads and accepts Hostex error_code 200", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error_code: 200,
          request_id: "request-1",
          data: { reservations: [] }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    global.fetch = fetchMock;

    await expect(
      new HostexClient().listReservations({
        propertyId: 12684960,
        status: "accepted",
        startCheckIn: "2026-08-01",
        endCheckIn: "2026-08-02"
      })
    ).resolves.toEqual([]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(requestUrl(url)).toContain("property_id=12684960");
    expect(new Headers(options?.headers).get("Hostex-Access-Token")).toBe("hostex-secret");
    expect(new Headers(options?.headers).get("User-Agent")).toContain("cozy-d-714");
  });

  it("uses the response body error code even when HTTP is 200", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error_code: 429, error_msg: "Too Many Attempts." }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Retry-After": "60" }
      })
    );

    await expect(
      new HostexClient().listReservations({
        propertyId: 12684960,
        startCheckIn: "2026-08-01",
        endCheckIn: "2026-08-02"
      })
    ).rejects.toMatchObject<Partial<HostexApiError>>({ code: 429, retryAfterSeconds: 60 });
  });

  it("marks an interrupted message request as uncertain instead of retrying it", async () => {
    global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error("socket timed out"));

    await expect(new HostexClient().sendMessage("conversation-1", "Hello")).rejects.toBeInstanceOf(
      HostexUncertainSendError
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends the exact conversation message and returns the request id", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error_code: 200, request_id: "request-2" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    global.fetch = fetchMock;

    await expect(new HostexClient().sendMessage("conversation/1", "Guest form URL")).resolves.toEqual({
      requestId: "request-2"
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(requestUrl(url)).toBe("https://api.hostex.io/v3/conversations/conversation%2F1");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(JSON.stringify({ message: "Guest form URL" }));
  });
});

function requestUrl(value: string | URL | Request) {
  if (typeof value === "string") return value;
  return value instanceof URL ? value.href : value.url;
}
