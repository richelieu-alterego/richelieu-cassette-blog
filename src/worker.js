/**
 * Cloudflare Worker entrypoint for Richelieu's Cassette Futurism Blog.
 * Serves static assets, GitHub OAuth + reserved Email OTP auth,
 * D1-backed authenticated comments, geolocation/weather, and payment stubs.
 */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createSessionToken(secret, payload) {
  const body = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

async function verifySessionToken(secret, token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = await hmacSign(secret, body);
  if (sig !== expected) return null;
  try {
    const padded = body.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(decodeURIComponent(escape(atob(padded))));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const secret = env.SESSION_SECRET || "richelieu-dev-secret";
  return verifySessionToken(secret, cookies.rc_session);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const sessionSecret = env.SESSION_SECRET || "richelieu-dev-secret";

    // 1. Health check
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ONLINE",
        unit: "RICHELIEU-BLOG-REV04",
        d1Ready: Boolean(env.DB),
        oauthReady: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        timestamp: new Date().toISOString(),
      });
    }

    // 1b. Edge geolocation
    if (url.pathname === "/api/geo") {
      const cf = request.cf || {};
      return Response.json({
        city: cf.city || "",
        country: cf.country || "",
        timezone: cf.timezone || "",
        latitude: cf.latitude || null,
        longitude: cf.longitude || null,
      });
    }

    // 1c. Server-side weather proxy
    if (url.pathname === "/api/weather") {
      const lat = url.searchParams.get("lat");
      const lon = url.searchParams.get("lon");
      if (!lat || !lon) return Response.json({ error: "Missing lat/lon" }, { status: 400 });
      const wr = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current_weather=true`
      );
      if (!wr.ok) return Response.json({ error: "Weather upstream error" }, { status: 502 });
      const wd = await wr.json();
      return Response.json({ temperature: wd.current_weather?.temperature ?? null });
    }

    // 2. Auth: current user & logout
    if (url.pathname === "/api/auth/me") {
      const user = await getSessionUser(request, env);
      return Response.json({ user: user || null });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "rc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        },
      });
    }

    // 2b. GitHub OAuth login
    if (url.pathname === "/api/auth/github") {
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        return Response.json(
          { error: "GitHub OAuth not configured (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)." },
          { status: 503 }
        );
      }
      const oauthState = crypto.randomUUID();
      const ghUrl = new URL("https://github.com/login/oauth/authorize");
      ghUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      ghUrl.searchParams.set("redirect_uri", `${url.origin}/api/auth/github/callback`);
      ghUrl.searchParams.set("scope", "read:user");
      ghUrl.searchParams.set("state", oauthState);

      return new Response(null, {
        status: 302,
        headers: {
          Location: ghUrl.toString(),
          "Set-Cookie": `rc_oauth_state=${oauthState}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        },
      });
    }

    if (url.pathname === "/api/auth/github/callback") {
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const cookies = parseCookies(request.headers.get("Cookie"));
      if (!code || !returnedState || returnedState !== cookies.rc_oauth_state) {
        return new Response("Invalid OAuth state or code.", { status: 400 });
      }

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return new Response("GitHub OAuth token exchange failed.", { status: 401 });
      }

      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "User-Agent": "richelieu-cassette-blog",
        },
      });
      const ghUser = await userRes.json();
      if (!ghUser || !ghUser.id) {
        return new Response("Failed to fetch GitHub user profile.", { status: 401 });
      }

      const githubId = String(ghUser.id);
      const nickname = String(ghUser.login || ghUser.name || "github_user").slice(0, 32);
      const avatarUrl = String(ghUser.avatar_url || "");
      const now = new Date().toISOString().slice(0, 16).replace("T", " ");

      if (env.DB) {
        await env.DB.prepare(
          `INSERT INTO users (github_id, nickname, avatar_url, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(github_id) DO UPDATE SET nickname = excluded.nickname, avatar_url = excluded.avatar_url`
        )
          .bind(githubId, nickname, avatarUrl, now)
          .run();
      }

      const sessionToken = await createSessionToken(sessionSecret, {
        provider: "github",
        githubId,
        nickname,
        avatarUrl,
        exp: Date.now() + 7 * 24 * 3600 * 1000,
      });

      return new Response(null, {
        status: 302,
        headers: [
          ["Location", "/"],
          [
            "Set-Cookie",
            `rc_session=${encodeURIComponent(sessionToken)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
          ],
          ["Set-Cookie", "rc_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"],
        ],
      });
    }

    // 2c. Reserved Email OTP endpoints (disabled until RESEND_API_KEY is configured)
    if (url.pathname === "/api/auth/otp/send" && request.method === "POST") {
      return Response.json(
        { error: "Email OTP not yet enabled. Configure RESEND_API_KEY to activate." },
        { status: 501 }
      );
    }

    if (url.pathname === "/api/auth/otp/verify" && request.method === "POST") {
      return Response.json(
        { error: "Email OTP not yet enabled." },
        { status: 501 }
      );
    }

    // 3. Comments API (D1 + Authenticated Session + Anti-spam)
    if (url.pathname === "/api/comments") {
      if (!env.DB) {
        return Response.json(
          { error: "D1 database binding (DB) not configured." },
          { status: 503 }
        );
      }

      if (request.method === "GET") {
        const postId = (url.searchParams.get("postId") || "").trim();
        if (!postId) return Response.json({ error: "Missing postId" }, { status: 400 });
        const { results } = await env.DB.prepare(
          "SELECT id, post_id, author, content, created_at FROM comments WHERE post_id = ? ORDER BY id DESC LIMIT 100"
        )
          .bind(postId)
          .all();
        return Response.json({ comments: results || [] });
      }

      if (request.method === "POST") {
        const user = await getSessionUser(request, env);
        if (!user) {
          return Response.json(
            { error: "请先通过 GitHub 登录认证后再发表评论。" },
            { status: 401 }
          );
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const postId = String(body.postId || "").trim().slice(0, 64);
        const author = user.nickname;
        const content = String(body.content || "").trim().slice(0, 1000);
        const honeypot = String(body.website || "").trim();
        const elapsedMs = Number(body.elapsedMs || 0);

        if (honeypot) {
          return Response.json({ error: "Spam rejected" }, { status: 403 });
        }
        if (elapsedMs > 0 && elapsedMs < 10000) {
          return Response.json({ error: "Too fast; please wait 10 seconds." }, { status: 429 });
        }
        if (!postId || !content) {
          return Response.json({ error: "postId and content are required" }, { status: 400 });
        }

        const dup = await env.DB.prepare(
          "SELECT id FROM comments WHERE post_id = ? AND content = ? LIMIT 1"
        )
          .bind(postId, content)
          .first();
        if (dup) {
          return Response.json({ error: "Duplicate comment rejected" }, { status: 409 });
        }

        if (env.TURNSTILE_SECRET_KEY) {
          const token = String(body.turnstileToken || "").trim();
          if (!token) return Response.json({ error: "Turnstile verification required" }, { status: 403 });
          const form = new URLSearchParams();
          form.append("secret", env.TURNSTILE_SECRET_KEY);
          form.append("response", token);
          const verifyRes = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            { method: "POST", body: form }
          );
          const verifyData = await verifyRes.json();
          if (!verifyData.success) {
            return Response.json({ error: "Turnstile verification failed" }, { status: 403 });
          }
        }

        const createdAt = new Date().toISOString().slice(0, 16).replace("T", " ");
        await env.DB.prepare(
          "INSERT INTO comments (post_id, author, content, created_at) VALUES (?, ?, ?, ?)"
        )
          .bind(postId, author, content, createdAt)
          .run();

        return Response.json({ ok: true, createdAt }, { status: 201 });
      }

      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // 4. Reserved payment / checkout & webhook stubs
    if (url.pathname === "/api/checkout" && request.method === "POST") {
      return Response.json(
        { error: "Payment API not yet configured. Add STRIPE_SECRET_KEY secret." },
        { status: 501 }
      );
    }

    if (url.pathname === "/api/webhook/payment" && request.method === "POST") {
      return Response.json({ received: true }, { status: 200 });
    }

    // 5. Serve static blog assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Static ASSETS binding not configured.", { status: 500 });
  },
};
