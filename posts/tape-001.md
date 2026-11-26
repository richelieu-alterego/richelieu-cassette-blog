---
id: tape-001
title: 磁带未来主义与静态博客的重构笔记
date: 2026-11-26
tags: DESIGN, CSS, CLOUDFLARE
summary: 用 70-80 年代模拟工业硬件与 CRT 终端语言重构个人博客，并预留 Cloudflare Workers 动态边缘接口。
---

## 01. 视觉基调

磁带未来主义（Cassette Futurism）的核心是**克制的秩序感**与**模拟硬件触感**：

> 好的工业设计不是堆砌特效，而是让每个像素都像一块真实的物理面板。

本博客默认采用 **AMBER_CRT** 琥珀暗色模式，同时也支持一键切换至 **RETRO_PAPER** 复古米白工业说明书模式。

## 02. 为什么接入 Cloudflare Workers

静态资产（HTML/CSS/JS）由 Cloudflare 全球边缘节点直接分发，几乎零延迟；同时 `src/worker.js` 预留了 `/api/*` 路由，未来可以无缝扩展：

```javascript
// 未来可直接接入 Stripe Checkout 或国内支付回调
if (url.pathname === "/api/checkout" && request.method === "POST") {
  // 调用 Stripe API（密钥存放在 Cloudflare Secrets）
}
```
