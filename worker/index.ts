/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** When set, every request must present it via HTTP Basic auth. */
  DEMO_PASSWORD?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

/** Length-independent comparison, so a wrong guess leaks nothing through timing. */
function secretsMatch(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/**
 * The app has no user accounts, and a deployed copy drives a real Airwallex
 * sandbox and a metered model. This keeps a shared link from being an open
 * door. It is a demo gate, not an authentication system: everyone who gets in
 * is still the same unauthenticated operator in the audit trail.
 */
function passwordGate(request: Request, env: Env): Response | null {
  const expected = env.DEMO_PASSWORD;
  if (!expected) return null;

  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const supplied = decoded.slice(decoded.indexOf(":") + 1);
      if (secretsMatch(supplied, expected)) return null;
    } catch {
      // Malformed header: fall through and challenge again.
    }
  }

  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="AP Desk demo", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

const worker = {
  /**
   * A shared demo link drifts: reviewers resolve exceptions, withdraw bills, and
   * leave half-finished cases behind. A scheduled reset puts the scenarios back so
   * the next person to open the link sees the demo as intended. It also warms the
   * worker, which takes the cold start off someone's first visit.
   *
   * Configure the schedule at deploy time; remove the trigger entirely while you
   * are presenting, so a reset cannot land mid-demo.
   */
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    const request = new Request("https://ap-desk.internal/api/ap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset_demo" }),
    });
    // Calls the app handler directly, so the password gate does not apply to a
    // request that never leaves the worker.
    ctx.waitUntil(handler.fetch(request, env, ctx).then(
      (response) => { console.log(`scheduled reset: ${response.status}`); },
      (error) => { console.error("scheduled reset failed", error); },
    ));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const challenge = passwordGate(request, env);
    if (challenge) return challenge;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
