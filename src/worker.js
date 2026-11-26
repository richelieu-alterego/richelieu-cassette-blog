/**
 * Cloudflare Worker entrypoint for Richelieu's Cassette Futurism Blog.
 * Serves static assets from `public/`, D1-backed comments at `/api/comments`,
 * geolocation at `/api/geo`, and reserves `/api/checkout` & `/api/webhook/payment`.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Health check endpoint
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ONLINE",
        unit: "RICHELIEU-BLOG-REV04",
        d1Ready: Boolean(env.DB),
        timestamp: new Date().toISOString(),
      });
    }

    // 1b. Edge geolocation endpoint (uses Cloudflare request.cf)
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

    // 1c. Server-side weather proxy (avoids client-side timeout/CORS)
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

    // 2. Comments API (Cloudflare D1 + optional Turnstile)
    if (url.pathname === "/api/comments") {
      if (!env.DB) {
        return Response.json(
          { error: "D1 database binding (DB) not configured." },
          { status: 503 }
        );
      }

      if (request.method === "GET") {
        const postId = (url.searchParams.get("postId") || "").trim();
        if (!postId) {
          return Response.json({ error: "Missing postId" }, { status: 400 });
        }
        const { results } = await env.DB.prepare(
          "SELECT id, post_id, author, content, created_at FROM comments WHERE post_id = ? ORDER BY id DESC LIMIT 100"
        )
          .bind(postId)
          .all();
        return Response.json({ comments: results || [] });
      }

      if (request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const postId = String(body.postId || "").trim().slice(0, 64);
        const author = String(body.author || "").trim().slice(0, 32) || "ANON_USER";
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

        // Duplicate content guard within the same post
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
          if (!token) {
            return Response.json({ error: "Turnstile verification required" }, { status: 403 });
          }
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

    // 3. Reserved payment / checkout API stub (Stripe or domestic payment gateway)
    if (url.pathname === "/api/checkout" && request.method === "POST") {
      return Response.json(
        { error: "Payment API not yet configured. Add STRIPE_SECRET_KEY secret." },
        { status: 501 }
      );
    }

    // 4. Reserved webhook endpoint for async payment notifications
    if (url.pathname === "/api/webhook/payment" && request.method === "POST") {
      return Response.json({ received: true }, { status: 200 });
    }

    // 5. Serve static blog assets via Workers Static Assets binding
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Static ASSETS binding not configured.", { status: 500 });
  },
};
