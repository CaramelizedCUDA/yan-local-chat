# Pre-P0 基线（原版，无 bot/ACP 改动）

- 日期：2026-11-24；基点：5701af2（main 合并 upstream/main 至 #183）；Node v22.22.2；言 v1.4.4
- 冷启动耗时（`node server.js` 拉起至 `GET /` 首个 200）：493 / 436 / 455 ms（三次，中位 455 ms）
- 空载内存（监听后静置约 4 s，桥接进程 WorkingSet64）：48.9 / 49.0 / 49.0 MB
- 口径：仅 Node 桥接进程，未开页面（未加 `--open`）；页面运行态内存未计入
- 验证：`npm run unit` 1100 过 / 0 败 / 12 跳过；`npm run check`（tsc × 2）通过
