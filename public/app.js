const state = {
  posts: [],
  config: {
    unit: "RICHELIEU-BLOG // REV.04",
    title: "RICHELIEU // TAPE DECK BLOG",
    footer: "SYS://RICHELIEU-CASSETTE.COM // WORKERS_D1",
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

async function initGeoAndWeather() {
  const wxEl = document.getElementById("wx-badge");
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  let geo = null;

  try {
    const r = await fetch("/api/geo");
    if (r.ok) {
      const d = await r.json();
      if (d && d.timezone) geo = d;
    }
  } catch {}

  if (!geo) {
    try {
      const r = await fetch("https://ipwho.is/?lang=zh-CN");
      if (r.ok) {
        const d = await r.json();
        if (d && d.success !== false) {
          geo = {
            city: d.city || d.country || "",
            timezone: (d.timezone && d.timezone.id) || "",
            latitude: d.latitude,
            longitude: d.longitude,
          };
        }
      }
    } catch {}
  }

  if (geo) {
    const isProxy = Boolean(geo.timezone && localTz && geo.timezone !== localTz);
    state.geo = {
      city: geo.city || "LOCAL",
      timezone: geo.timezone,
      proxy: isProxy,
      lat: geo.latitude,
      lon: geo.longitude,
    };
    applyTheme();

    if (geo.latitude != null && geo.longitude != null) {
      try {
        const wr = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current_weather=true`
        );
        if (wr.ok) {
          const wd = await wr.json();
          const temp = wd.current_weather?.temperature;
          const cityLabel = isProxy ? `${state.geo.city}*(PROXY)` : state.geo.city;
          wxEl.textContent = `[WX: ${temp ?? "--"}°C // ${cityLabel}]`;
          wxEl.title = isProxy
            ? `检测到代理/时区不一致 (本机: ${localTz}, IP: ${geo.timezone})，已优先采用本机时钟`
            : `本机与IP时区一致 (${localTz})`;
          return;
        }
      } catch {}
    }
  }

  wxEl.textContent = `[WX: LOCAL // ${localTz.split("/").pop() || "SYS"}]`;
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
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
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
          <div class="section-label">== COMMENTS // 终端留言区 (D1) ======================</div>
          <form class="comment-form" id="comment-form">
            <input class="comment-input" id="c-author" type="text" maxlength="32" placeholder="> 昵称 / CALLSIGN (默认 ANON_USER)" />
            <textarea class="comment-textarea" id="c-content" rows="3" maxlength="1000" placeholder="> 输入留言内容..." required></textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
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
  document.getElementById("comment-form").onsubmit = (e) => submitComment(e, post.id);
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

async function submitComment(e, postId) {
  e.preventDefault();
  playClick();
  const statusEl = document.getElementById("c-status");
  const author = document.getElementById("c-author").value.trim();
  const content = document.getElementById("c-content").value.trim();
  if (!content) return;
  statusEl.textContent = "TRANSMITTING...";
  try {
    const r = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, author, content }),
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
]).then(([posts, cfg]) => {
  state.posts = posts;
  if (cfg) {
    state.config = { ...state.config, ...cfg };
    document.title = state.config.title || document.title;
    const brandSpan = document.querySelector(".brand span:last-child");
    if (brandSpan && state.config.unit) brandSpan.textContent = `UNIT: ${state.config.unit}`;
  }
  render();
});
