# [1.19.0](https://github.com/Heratiki/locallama-mcp/compare/v1.18.0...v1.19.0) (2026-05-23)


### Features

* add get_system_state MCP tool for remote queue/benchmark visibility (closes [#85](https://github.com/Heratiki/locallama-mcp/issues/85)) ([#104](https://github.com/Heratiki/locallama-mcp/issues/104)) ([4d10382](https://github.com/Heratiki/locallama-mcp/commit/4d10382f6761d94bc6e7fdb348311e15cfe0ab09))

# [1.18.0](https://github.com/Heratiki/locallama-mcp/compare/v1.17.0...v1.18.0) (2026-05-23)


### Features

* disable startup auto-benchmarking; add lazy benchmark freshness service (closes [#97](https://github.com/Heratiki/locallama-mcp/issues/97)) ([bf0cdab](https://github.com/Heratiki/locallama-mcp/commit/bf0cdab28240038849b3b821e57350f1b140e985))

# [1.17.0](https://github.com/Heratiki/locallama-mcp/compare/v1.16.0...v1.17.0) (2026-05-23)


### Bug Fixes

* add settings.local.json to .gitignore to prevent accidental commits ([36258ba](https://github.com/Heratiki/locallama-mcp/commit/36258ba8e364b68ede2b9d309b777fe8f2923f33))
* benchmark_model honors requested provider_id ([#87](https://github.com/Heratiki/locallama-mcp/issues/87)) ([#89](https://github.com/Heratiki/locallama-mcp/issues/89)) ([a8dbff0](https://github.com/Heratiki/locallama-mcp/commit/a8dbff0937ec568367d8c22566621f24267b7ea3))
* bump ws to ^8.20.1, add qs override ^6.15.2, run npm install ([2c1f139](https://github.com/Heratiki/locallama-mcp/commit/2c1f13949cacf69765cabe9753983dc2a2939783))
* local provider single-slot concurrency cap broken (Issue [#86](https://github.com/Heratiki/locallama-mcp/issues/86)) ([0db95f7](https://github.com/Heratiki/locallama-mcp/commit/0db95f7c5904f858f71c6c04519d0f05dabf4a6c))
* prioritize tasks over benchmark queue and surface contention metadata ([#84](https://github.com/Heratiki/locallama-mcp/issues/84)) ([#103](https://github.com/Heratiki/locallama-mcp/issues/103)) ([2512f2c](https://github.com/Heratiki/locallama-mcp/commit/2512f2c62ec0ccbf3c32c246e1643772291cf58b))
* read-time per-slot queue position eliminates duplicate positions (Issue [#88](https://github.com/Heratiki/locallama-mcp/issues/88)) ([#101](https://github.com/Heratiki/locallama-mcp/issues/101)) ([c8c5e1b](https://github.com/Heratiki/locallama-mcp/commit/c8c5e1b18911c078543b220a1cd895670b27c3e1))
* resolve stale get_task_status and metadata clearing (Issue [#83](https://github.com/Heratiki/locallama-mcp/issues/83)) ([104010c](https://github.com/Heratiki/locallama-mcp/commit/104010c19dbb26730a607d234b3fd6ac9dbcca0c))


### Features

* enhance MCP server configuration and logging, add live testing documentation ([c5c20a9](https://github.com/Heratiki/locallama-mcp/commit/c5c20a9f32b4b4aced4464fd1f2ac011394e5f1c))
* **llama-cpp:** add inference health probe ([#91](https://github.com/Heratiki/locallama-mcp/issues/91)) ([#96](https://github.com/Heratiki/locallama-mcp/issues/96)) ([d5edd6d](https://github.com/Heratiki/locallama-mcp/commit/d5edd6d3155d13bc1aaa50b71d48313f1b01c0c2))
