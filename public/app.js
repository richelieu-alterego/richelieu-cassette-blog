const state = {
  posts: [],
  user: null,
  config: {
    unit: "RICHELIEU-BLOG // REV.04",
    title: "RICHELIEU // TAPE DECK BLOG",
    footer: "SYS://RICHELIEU-CASSETTE.COM // WORKERS_D1",
    enableEmailOtp: false,
    operator: {
      name: "黎塞留",
      id: "richelieu.alterego",
      avatar: "/avatar.jpg",
      status: "ONLINE",
      bio: "记录代码、系统折腾与思考的数字磁带归档站。",
    },
    categories: [],
  },
  activeTag: "ALL",
  view: "index",
  activeId: null,
  sfx: false,
  themeMode: localStorage.getItem("richelieu_theme_mode") || "auto",
  resolvedTheme: "crt",
  geo: { city: "", timezone: "", proxy: false, lat: null, lon: null },
};

let audioCtx = null;

function playClick() {
  if (!state.sfx) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.035);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch {}
}

function resolveAutoTheme() {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? "paper" : "crt";
}

function applyTheme() {
  const actual = state.themeMode === "auto" ? resolveAutoTheme() : state.themeMode;
  state.resolvedTheme = actual;
  document.documentElement.setAttribute("data-theme", actual);
  localStorage.setItem("richelieu_theme_mode", state.themeMode);
  const btn = document.getElementById("btn-theme");
  const status = document.getElementById("status-mode");
  if (state.themeMode === "auto") {
    btn.textContent = `[MODE: AUTO(${actual.toUpperCase()})]`;
  } else {
    btn.textContent = `[MODE: ${actual.toUpperCase()}]`;
  }
  const proxyTag = state.geo.proxy ? " | PROXY_DETECTED(LOCAL_CLK)" : "";
  status.textContent = `THEME: ${actual === "paper" ? "RETRO_PAPER" : "AMBER_CRT"}${proxyTag}`;
}

const TZ_COORDS = {
  "Asia/Shanghai": { city: "Shanghai", lat: 31.23, lon: 121.47 },
  "Asia/Chongqing": { city: "Chongqing", lat: 29.56, lon: 106.55 },
  "Asia/Urumqi": { city: "Urumqi", lat: 43.82, lon: 87.61 },
  "Asia/Hong_Kong": { city: "Hong Kong", lat: 22.32, lon: 114.17 },
  "Asia/Taipei": { city: "Taipei", lat: 25.03, lon: 121.56 },
  "Asia/Tokyo": { city: "Tokyo", lat: 35.68, lon: 139.69 },
  "Asia/Seoul": { city: "Seoul", lat: 37.57, lon: 126.98 },
  "America/Los_Angeles": { city: "Los Angeles", lat: 34.05, lon: -118.24 },
  "America/New_York": { city: "New York", lat: 40.71, lon: -74.01 },
  "Europe/London": { city: "London", lat: 51.51, lon: -0.13 },
};

async function fetchWeatherText(lat, lon, label) {
  const r = await fetch(`/api/weather?lat=${lat}&lon=${lon}`).catch(() => null);
  let wd = r && r.ok ? await r.json() : null;
  if (!wd || wd.temperature == null) {
    const wr = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
    ).catch(() => null);
    if (wr && wr.ok) {
      const raw = await wr.json();
      wd = { temperature: raw.current_weather?.temperature };
    }
  }
  return wd && wd.temperature != null ? `[WX: ${wd.temperature}°C // ${label}]` : `[WX: ${label}]`;
}

async function initGeoAndWeather() {
  const wxEl = document.getElementById("wx-badge");
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  let geo = null;

  try {
    const r = await fetch("/api/geo");
    if (r.ok) {
      const d = await r.json();
      if (d && d.timezone) geo = d;
    }
  } catch {}

  const isProxy = Boolean(geo && geo.timezone && localTz && geo.timezone !== localTz);
  let lat = geo?.latitude;
  let lon = geo?.longitude;
  let cityLabel = geo?.city || localTz.split("/").pop() || "LOCAL";

  // If proxy detected, do NOT use proxy's IP location; use real timezone coords first
  if (isProxy || lat == null || lon == null) {
    const fallback = TZ_COORDS[localTz] || { city: localTz.split("/").pop() || "LOCAL", lat: 31.23, lon: 121.47 };
    lat = fallback.lat;
    lon = fallback.lon;
    cityLabel = fallback.city;
  }

  state.geo = { city: cityLabel, timezone: localTz, proxy: isProxy, lat, lon };
  applyTheme();

  wxEl.textContent = await fetchWeatherText(lat, lon, cityLabel);
  wxEl.style.cursor = "pointer";
  wxEl.title = isProxy
    ? `检测到代理 (IP时区: ${geo.timezone}，本机时区: ${localTz})，已按本机时区定位 ${cityLabel}；点击可授权浏览器精确定位`
    : `点击可授权浏览器精确定位`;

  wxEl.onclick = () => {
    if (!navigator.geolocation) return;
    wxEl.textContent = "[WX: LOCATING...]";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        wxEl.textContent = await fetchWeatherText(
          latitude.toFixed(2),
          longitude.toFixed(2),
          "GPS"
        );
      },
      () => {
        wxEl.textContent = `[WX: ${cityLabel}]`;
      },
      { timeout: 6000 }
    );
  };
}

function mdToHtml(md) {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><div class="mono" style="color:var(--accent);margin-bottom:6px;">[CODE: ${lang || "TEXT"}]</div><code>${code.trim()}</code></pre>`;
  });

  html = html
    .replace(/^## (.+)$/gm, (_, t) => `<h2 id="${encodeURIComponent(t)}">${t}</h2>`)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="mono" style="background:var(--panel-alt);padding:1px 5px;">$1</code>')
    .replace(/\n\n+/g, "</p><p>");

  return `<p>${html}</p>`;
}

function renderIndex() {
  const root = document.getElementById("app-root");
  const op = state.config.operator;
  const postTags = [...new Set(state.posts.flatMap((p) => p.tags))];
  const configuredTags = (state.config.categories || []).map((c) => c.tag);
  const allTags = [...new Set(["ALL", ...configuredTags, ...postTags])];
  const labelMap = Object.fromEntries(
    (state.config.categories || []).map((c) => [c.tag, c.label])
  );

  const filtered =
    state.activeTag === "ALL"
      ? state.posts
      : state.posts.filter((p) => p.tags.includes(state.activeTag));

  const totalWords = state.posts.reduce((acc, p) => acc + p.words, 0);

  root.innerHTML = `
    <div class="console-grid">
      <aside>
        <div class="panel">
          <div class="panel-head"><span>OPERATOR // 个人铭牌</span><span>#01</span></div>
          <div class="panel-body">
            <div class="operator-card">
              <div class="avatar-box"><img class="avatar-img" src="${op.avatar || '/avatar.jpg'}" alt="${op.name}" /></div>
              <div>
                <div class="mono" style="font-weight:700;">${op.name}</div>
                <div class="mono" style="font-size:12px;color:var(--muted);">ID: ${op.id}</div>
                <div class="mono" style="font-size:12px;color:var(--accent-2);">STATUS: ${op.status}</div>
              </div>
            </div>
            <p style="font-size:13px;color:var(--muted);margin:0;">${op.bio}</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><span>DECK_SLOTS // 分类</span><span>${allTags.length}</span></div>
          <div class="panel-body" style="padding:8px;">
            <ul class="slot-list">
              ${allTags
                .map((tag) => {
                  const count =
                    tag === "ALL"
                      ? state.posts.length
                      : state.posts.filter((p) => p.tags.includes(tag)).length;
                  const label = labelMap[tag] ? ` ${labelMap[tag]}` : "";
                  return `<li class="slot-item ${state.activeTag === tag ? "active" : ""}" data-tag="${tag}">
                    <span>${state.activeTag === tag ? ">" : " "} [${tag}]${label}</span>
                    <span>(${count})</span>
                  </li>`;
                })
                .join("")}
            </ul>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><span>SYS_METRICS</span><span>OK</span></div>
          <div class="panel-body mono" style="font-size:12px;">
            <div>TOTAL_TAPES : ${state.posts.length}</div>
            <div>TOTAL_WORDS : ${totalWords}</div>
            <div>EDGE_READY  : CF_WORKERS</div>
          </div>
        </div>
      </aside>

      <section>
        <button class="search-trigger" id="inline-search">> 点击或按 Ctrl+K 检索全站磁带...</button>
        <div class="section-label">== TAPE DECK // 收录列表 (${filtered.length}) ======================</div>
        ${filtered
          .map(
            (p) => `
          <article class="tape-card" data-post-id="${p.id}">
            <div class="tape-meta">
              <span>[${p.id.toUpperCase()}] ${p.date}</span>
              <span>READ: ${p.readMin} MIN // ${p.words} WORDS</span>
            </div>
            <h2 class="tape-title">${p.title}</h2>
            <p class="tape-summary">${p.summary}</p>
            <div class="tape-footer">
              <div>${p.tags.map((t) => `<span class="tag">#${t}</span>`).join(" ")}</div>
              <span class="btn">[LOAD ->]</span>
            </div>
          </article>`
          )
          .join("")}
      </section>
    </div>
  `;

  document.getElementById("inline-search").onclick = openSearch;
  root.querySelectorAll("[data-tag]").forEach((el) => {
    el.onclick = () => {
      playClick();
      state.activeTag = el.dataset.tag;
      render();
    };
  });
  root.querySelectorAll("[data-post-id]").forEach((el) => {
    el.onclick = () => {
      playClick();
      state.view = "post";
      state.activeId = el.dataset.postId;
      window.scrollTo(0, 0);
      render();
    };
  });
}

function renderPost() {
  const root = document.getElementById("app-root");
  const idx = state.posts.findIndex((p) => p.id === state.activeId);
  const post = state.posts[idx] || state.posts[0];
  const headings = [...post.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

  root.innerHTML = `
    <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <button class="btn" id="btn-back">[<< BACK TO DECK]</button>
      <span class="mono" style="font-size:12px;color:var(--accent);">[${post.id.toUpperCase()}] ${post.date}</span>
    </div>
    <div class="progress-track"><div class="progress-fill" id="read-progress"></div></div>
    <div class="reader-layout">
      <article class="article-body">
        <h1>${post.title}</h1>
        <div style="margin-bottom:18px;">${post.tags.map((t) => `<span class="tag">#${t}</span>`).join(" ")}</div>
        <div>${mdToHtml(post.body)}</div>
        <div style="margin-top:28px;padding-top:16px;border-top:2px dashed var(--border);display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          ${idx > 0 ? `<button class="btn" data-jump="${state.posts[idx - 1].id}">[<< PREV: ${state.posts[idx - 1].id.toUpperCase()}]</button>` : "<span></span>"}
          ${idx < state.posts.length - 1 ? `<button class="btn" data-jump="${state.posts[idx + 1].id}">[NEXT: ${state.posts[idx + 1].id.toUpperCase()} >>]</button>` : ""}
        </div>

        <section class="comments-section">
          <div class="section-label">== COMMENTS // 终端留言区 (D1 + AUTH) ===============</div>
          <div id="auth-gate" style="margin-bottom:14px;">
            ${
              state.user
                ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border:1.5px solid var(--border);background:var(--panel-alt);">
                    <span class="mono" style="font-size:12px;color:var(--accent-2);">AUTH_VERIFIED: @${escapeHtml(state.user.nickname)}</span>
                    <button class="btn" type="button" id="btn-logout">[LOGOUT // 退出]</button>
                  </div>`
                : `<div style="padding:12px;border:1.5px dashed var(--border);background:var(--panel-alt);">
                    <div class="mono" style="font-size:12px;margin-bottom:10px;color:var(--muted);">需完成身份认证后方可发送留言（防止垃圾信息）：</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                      <a class="btn" href="/api/auth/github">[LOGIN WITH GITHUB // GitHub 登录]</a>
                      <button class="btn" type="button" id="btn-otp-toggle" style="${state.config.enableEmailOtp ? "" : "display:none;"}">[EMAIL OTP // 邮箱验证码]</button>
                    </div>
                    <!-- 预留邮箱 OTP 登录面板，默认隐藏 -->
                    <div id="otp-panel" style="display:none;margin-top:10px;gap:8px;flex-direction:column;">
                      <input class="comment-input" id="otp-email" type="email" placeholder="> 输入邮箱地址..." />
                      <div style="display:flex;gap:8px;">
                        <input class="comment-input" id="otp-code" type="text" maxlength="6" placeholder="> 6位验证码" />
                        <button class="btn" type="button" id="btn-otp-send">[SEND_CODE]</button>
                        <button class="btn" type="button" id="btn-otp-verify">[VERIFY]</button>
                      </div>
                    </div>
                  </div>`
            }
          </div>
          <form class="comment-form" id="comment-form" style="${state.user ? "" : "display:none;"}">
            <input type="text" id="c-website" style="display:none;" tabindex="-1" autocomplete="off" />
            <textarea class="comment-textarea" id="c-content" rows="3" maxlength="1000" placeholder="> 输入留言内容..." required></textarea>
            <div id="turnstile-box"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
              <span class="mono" id="c-status" style="font-size:12px;color:var(--muted);">READY</span>
              <button class="btn" type="submit">[TRANSMIT // 发送留言]</button>
            </div>
          </form>
          <div id="comments-list" class="mono" style="font-size:12px;color:var(--muted);">LOADING_COMMENTS...</div>
        </section>
      </article>
      <aside>
        <div class="panel">
          <div class="panel-head"><span>INDEX // 导轨目录</span><span>TOC</span></div>
          <div class="panel-body">
            ${headings.length ? headings.map((h) => `<div style="margin-bottom:6px;"><a class="mono" style="font-size:12px;color:var(--text);text-decoration:none;" href="#${encodeURIComponent(h)}">> ${h}</a></div>`).join("") : '<span class="mono" style="font-size:12px;color:var(--muted);">NO_HEADINGS</span>'}
          </div>
        </div>
      </aside>
    </div>
  `;

  document.getElementById("btn-back").onclick = () => {
    playClick();
    state.view = "index";
    render();
  };
  root.querySelectorAll("[data-jump]").forEach((el) => {
    el.onclick = () => {
      playClick();
      state.activeId = el.dataset.jump;
      window.scrollTo(0, 0);
      render();
    };
  });
  loadComments(post.id);
  const formLoadedAt = Date.now();
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      playClick();
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
      state.user = null;
      renderPost();
    };
  }
  const otpToggle = document.getElementById("btn-otp-toggle");
  if (otpToggle) {
    otpToggle.onclick = () => {
      playClick();
      const p = document.getElementById("otp-panel");
      if (p) p.style.display = p.style.display === "none" ? "flex" : "none";
    };
  }
  if (state.user && state.config.turnstileSiteKey && window.turnstile) {
    window.turnstile.render("#turnstile-box", { sitekey: state.config.turnstileSiteKey });
  }
  const formEl = document.getElementById("comment-form");
  if (formEl) {
    formEl.onsubmit = (e) => submitComment(e, post.id, formLoadedAt);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadComments(postId) {
  const listEl = document.getElementById("comments-list");
  if (!listEl) return;
  try {
    const r = await fetch(`/api/comments?postId=${encodeURIComponent(postId)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const items = data.comments || [];
    listEl.innerHTML = items.length
      ? items
          .map(
            (c) => `<div class="comment-item">
              <div class="comment-meta"><span>@${escapeHtml(c.author)}</span><span>${escapeHtml(c.created_at)}</span></div>
              <div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(c.content)}</div>
            </div>`
          )
          .join("")
      : `<div class="mono" style="color:var(--muted);">NO_COMMENTS_YET // 暂无留言</div>`;
  } catch {
    listEl.innerHTML = `<div class="mono" style="color:var(--muted);">D1_OFFLINE (部署至 Cloudflare Workers 并绑定 D1 后自动启用)</div>`;
  }
}

async function submitComment(e, postId, formLoadedAt) {
  e.preventDefault();
  playClick();
  const statusEl = document.getElementById("c-status");
  const website = document.getElementById("c-website")?.value || "";
  const content = document.getElementById("c-content").value.trim();
  const turnstileToken = document.querySelector('[name="cf-turnstile-response"]')?.value || "";
  if (!content) return;
  statusEl.textContent = "TRANSMITTING...";
  try {
    const r = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId,
        content,
        website,
        elapsedMs: Date.now() - (formLoadedAt || 0),
        turnstileToken,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      statusEl.textContent = `ERR: ${data.error || r.status}`;
      return;
    }
    document.getElementById("c-content").value = "";
    statusEl.textContent = "TRANSMITTED_OK";
    loadComments(postId);
  } catch {
    statusEl.textContent = "ERR: D1_NOT_CONNECTED";
  }
}

function renderAbout() {
  const root = document.getElementById("app-root");
  root.innerHTML = `
    <div class="panel">
      <div class="panel-head"><span>ABOUT // 系统说明</span><span>REV.04</span></div>
      <div class="panel-body">
        <h2>Richelieu's Cassette Futurism Blog</h2>
        <p>这是一个基于零依赖静态架构与 Cloudflare Workers 边缘计算设计的新一代个人博客。</p>
        <ul>
          <li>前端采用纯原生 HTML/CSS/JS，支持 CRT 琥珀暗色与复古工业纸质双模式。</li>
          <li>后端预留 <code>/api/*</code> Cloudflare Worker 路由，可直接扩展动态接口、D1 数据库及 Stripe / 支付回调。</li>
        </ul>
      </div>
    </div>
  `;
}

function render() {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === state.view);
  });
  if (state.view === "post") renderPost();
  else if (state.view === "about") renderAbout();
  else renderIndex();
}

function openSearch() {
  playClick();
  const modal = document.getElementById("search-modal");
  const input = document.getElementById("search-input");
  modal.classList.add("open");
  input.value = "";
  renderSearchResults("");
  input.focus();
}

function closeSearch() {
  document.getElementById("search-modal").classList.remove("open");
}

function renderSearchResults(q) {
  const box = document.getElementById("search-results");
  const kw = q.trim().toLowerCase();
  const hits = state.posts.filter(
    (p) =>
      !kw ||
      p.title.toLowerCase().includes(kw) ||
      p.summary.toLowerCase().includes(kw) ||
      p.body.toLowerCase().includes(kw)
  );
  box.innerHTML = hits.length
    ? hits
        .map(
          (p) => `<div class="modal-item" data-hit="${p.id}">
            <div class="mono" style="font-size:11px;color:var(--accent);">[${p.id.toUpperCase()}] ${p.date}</div>
            <div>${p.title}</div>
          </div>`
        )
        .join("")
    : `<div class="modal-item mono" style="color:var(--muted);">NO_MATCHING_TAPES</div>`;

  box.querySelectorAll("[data-hit]").forEach((el) => {
    el.onclick = () => {
      playClick();
      closeSearch();
      state.view = "post";
      state.activeId = el.dataset.hit;
      render();
    };
  });
}

window.addEventListener("scroll", () => {
  const bar = document.getElementById("read-progress");
  if (!bar) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  bar.style.width = max > 0 ? `${Math.min(100, (window.scrollY / max) * 100)}%` : "100%";
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearch();
  } else if (e.key === "Escape") {
    closeSearch();
  }
});

document.getElementById("btn-search").onclick = openSearch;
document.getElementById("btn-close-search").onclick = closeSearch;
document.getElementById("search-input").oninput = (e) => renderSearchResults(e.target.value);
document.getElementById("btn-theme").onclick = () => {
  playClick();
  const order = ["auto", "crt", "paper"];
  state.themeMode = order[(order.indexOf(state.themeMode) + 1) % order.length];
  applyTheme();
};
document.getElementById("btn-sfx").onclick = () => {
  state.sfx = !state.sfx;
  document.getElementById("btn-sfx").textContent = state.sfx ? "[SFX: ON]" : "[SFX: OFF]";
  playClick();
};
document.querySelectorAll("[data-nav]").forEach((el) => {
  el.onclick = () => {
    playClick();
    state.view = el.dataset.nav;
    render();
  };
});

applyTheme();
initGeoAndWeather();
Promise.all([
  fetch("/posts.json").then((r) => r.json()),
  fetch("/site.config.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
  fetch("/api/auth/me")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
]).then(([posts, cfg, auth]) => {
  state.posts = posts;
  state.user = auth?.user || null;
  if (cfg) {
    state.config = { ...state.config, ...cfg };
    document.title = state.config.title || document.title;
    const brandSpan = document.querySelector(".brand span:last-child");
    if (brandSpan && state.config.unit) brandSpan.textContent = `UNIT: ${state.config.unit}`;
  }
  render();
});
