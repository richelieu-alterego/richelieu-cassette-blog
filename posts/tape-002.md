---
id: tape-002
title: 本地自动化工具与桌面工作流实验
date: 2026-11-18
tags: PYTHON, MCP, LAB
summary: 从零搭建基于 MCP 协议与 Windows UI Automation 的桌面辅助工具链，减少重复操作与 Token 消耗。
---

## 01. 从截图到 UI Automation

早期通过全屏截图识图定位窗口虽然通用，但速度慢且消耗大量视觉 Token。改用 Windows 原生 `UIAutomation` 后，可以直接以纯文本枚举窗口和控件坐标。

## 02. 架构要点

- **轻量 MCP Server**：基于 Python `FastMCP` 暴露 `list_windows`、`focus_window`、`get_ui_elements` 等工具。
- **DPI 感知**：调用 `SetProcessDpiAwareness(1)` 确保高分屏下坐标与物理像素严格对齐。
