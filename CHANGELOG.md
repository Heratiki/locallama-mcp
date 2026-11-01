# [1.32.0](https://github.com/Heratiki/locallama-mcp/compare/v1.31.4...v1.32.0) (2026-11-01)


### Bug Fixes

* **#137:** stop sending draft_model to OpenRouter; gate speculative decoding to local providers ([4993fa0](https://github.com/Heratiki/locallama-mcp/commit/4993fa05cfe04c48b6c28e562a3c6b433e8a2a02)), closes [#137](https://github.com/Heratiki/locallama-mcp/issues/137) [#137](https://github.com/Heratiki/locallama-mcp/issues/137)
* **coordinator,modelsDb:** stop provider===model-id at the source and drop the qualified-id probe ([#150](https://github.com/Heratiki/locallama-mcp/issues/150) fix round) ([b136b1f](https://github.com/Heratiki/locallama-mcp/commit/b136b1f4ba833f54febf36b5058ea86d3e81581b))
* **cost-monitor:** include llama.cpp provider models in getAvailableModels ([a88b002](https://github.com/Heratiki/locallama-mcp/commit/a88b002aedf216d778bc0e082629d9eba5ed07bb)), closes [#149](https://github.com/Heratiki/locallama-mcp/issues/149)
* **llama-cpp:** router health probe no longer drops provider on cold start ([0791380](https://github.com/Heratiki/locallama-mcp/commit/0791380713537a5bc604917ea8dce8ea489b7eda)), closes [#154](https://github.com/Heratiki/locallama-mcp/issues/154)
* **openrouter:** caller abort throws AbortError, not InferenceTimeoutError ([de467d1](https://github.com/Heratiki/locallama-mcp/commit/de467d1bb544d5e86f45fa4f6b76c80c3dc39d5d)), closes [#145](https://github.com/Heratiki/locallama-mcp/issues/145)
* **patch_task:** list optional task_type in the input schema ([bc68bbe](https://github.com/Heratiki/locallama-mcp/commit/bc68bbeffe6a2741e5fdd557ed46f6043ff1ae02)), closes [#152](https://github.com/Heratiki/locallama-mcp/issues/152)
* **patch:** rank ladder by benchmark-only code score, normalized ids, param size ([f246e25](https://github.com/Heratiki/locallama-mcp/commit/f246e250870e5a3228d1e39e7444b6fc9d3b3332)), closes [#153](https://github.com/Heratiki/locallama-mcp/issues/153)
* **patch:** record true paid cost, count tokens with js-tiktoken ([66249dd](https://github.com/Heratiki/locallama-mcp/commit/66249dde30086870c195e3255fa15a133f44d454)), closes [#144](https://github.com/Heratiki/locallama-mcp/issues/144)
* **provider:** clean test exit, AbortError for caller abort, clear timer on abort ([b7ec7f9](https://github.com/Heratiki/locallama-mcp/commit/b7ec7f9682e59f76bea4acb13697a6b70e767dc3)), closes [#145](https://github.com/Heratiki/locallama-mcp/issues/145)
* **routing:** fail on subtask execution errors; mark unverified attempts null ([1c31016](https://github.com/Heratiki/locallama-mcp/commit/1c3101671320de2a27d4831bab22864368ec5a45)), closes [#151](https://github.com/Heratiki/locallama-mcp/issues/151)
* **routing:** local subtask assignments with provider === model id are repaired or replaced ([#150](https://github.com/Heratiki/locallama-mcp/issues/150)) ([273c0e3](https://github.com/Heratiki/locallama-mcp/commit/273c0e323aa4876c1b0b43fc227be9b114e1f0c8))


### Features

* **job-store:** patch Job persistence (kind, patch_state, patch_attempts, conditional terminal writes) ([89e437c](https://github.com/Heratiki/locallama-mcp/commit/89e437cba4a246a101eb8473c3a9caef2a3f92b4)), closes [#143](https://github.com/Heratiki/locallama-mcp/issues/143)
* **patch:** dispatcher, recovery, patch_task tool, patch status and cancel ([d413879](https://github.com/Heratiki/locallama-mcp/commit/d413879f2d017c7b273809b0fb02a2a31d6c6ab3)), closes [#147](https://github.com/Heratiki/locallama-mcp/issues/147)
* **patch:** edit-block parser and applier ([00d93eb](https://github.com/Heratiki/locallama-mcp/commit/00d93eb22b4dd2c9cb12e58c2bcf93a5f93fcfb4)), closes [#140](https://github.com/Heratiki/locallama-mcp/issues/140)
* **patch:** get_savings tool — accepted tasks, pass rate, dollars, estimated frontier tokens saved ([3173ad5](https://github.com/Heratiki/locallama-mcp/commit/3173ad5f6224a46078b3960f1526fe406a94b15c)), closes [#152](https://github.com/Heratiki/locallama-mcp/issues/152) [#152](https://github.com/Heratiki/locallama-mcp/issues/152)
* **patch:** ladder, prompt builder, context budget, paid accounting ([c892e20](https://github.com/Heratiki/locallama-mcp/commit/c892e20de2cf5db6782392e330b6a74361a9b526)), closes [#144](https://github.com/Heratiki/locallama-mcp/issues/144)
* **patch:** load declared checks and run them with process-group cleanup ([c891ee2](https://github.com/Heratiki/locallama-mcp/commit/c891ee263745bb54b7c64a8358d5df325529b87c)), closes [#141](https://github.com/Heratiki/locallama-mcp/issues/141)
* **patch:** PRD 01 contracts — shared types, config keys and safety flags ([173c10b](https://github.com/Heratiki/locallama-mcp/commit/173c10bc6c5bd1f59f28089e18ba5b9707026600)), closes [#138](https://github.com/Heratiki/locallama-mcp/issues/138)
* **patch:** snapshot and isolate jobs in git worktrees ([54534ab](https://github.com/Heratiki/locallama-mcp/commit/54534ab14c171310623393a8d459c7533cc58a20)), closes [#142](https://github.com/Heratiki/locallama-mcp/issues/142)
* **provider:** optional AbortSignal in TaskExecutionOptions; providers honour it ([fbaa145](https://github.com/Heratiki/locallama-mcp/commit/fbaa145fe31795cadc57b8e66b356e41f8bbeffe)), closes [#145](https://github.com/Heratiki/locallama-mcp/issues/145)
* **provider:** pass options.signal into axios on executeTask paths of the four modules ([99d9044](https://github.com/Heratiki/locallama-mcp/commit/99d90449b5ec9fe68a82348851ca95ae9a1bf6e5)), closes [#145](https://github.com/Heratiki/locallama-mcp/issues/145)

## [1.31.4](https://github.com/Heratiki/locallama-mcp/compare/v1.31.3...v1.31.4) (2026-06-08)


### Bug Fixes

* **llama-cpp:** detect running servers via pgrep to prevent duplicate spawns ([d61e1bf](https://github.com/Heratiki/locallama-mcp/commit/d61e1bf7c85920b74ccece109d86fb076174d4d4))

## [1.31.3](https://github.com/Heratiki/locallama-mcp/compare/v1.31.2...v1.31.3) (2026-06-04)


### Bug Fixes

* **deps:** bump hono to 4.12.23 and npm override to 11.16.0 to resolve 4 Dependabot advisories ([#134](https://github.com/Heratiki/locallama-mcp/issues/134)) ([6c8d0b9](https://github.com/Heratiki/locallama-mcp/commit/6c8d0b9e0e3547f0924a912d4fc2a5f834454bb3))

## [1.31.2](https://github.com/Heratiki/locallama-mcp/compare/v1.31.1...v1.31.2) (2026-06-03)


### Bug Fixes

* **output:** strip <think> blocks from all model output paths ([#133](https://github.com/Heratiki/locallama-mcp/issues/133)) ([b1912b4](https://github.com/Heratiki/locallama-mcp/commit/b1912b42aef30091b631c270f53c1dc8cd9c0c47))

## [1.31.1](https://github.com/Heratiki/locallama-mcp/compare/v1.31.0...v1.31.1) (2026-06-03)


### Bug Fixes

* **routing:** local-first cost routing, llama.cpp port scan, provider field normalization ([#132](https://github.com/Heratiki/locallama-mcp/issues/132)) ([762fda1](https://github.com/Heratiki/locallama-mcp/commit/762fda1ad5edbf5c2e094f4237829ce3a7bd3836))

# [1.31.0](https://github.com/Heratiki/locallama-mcp/compare/v1.30.0...v1.31.0) (2026-06-03)


### Features

* **benchmark:** add validation fixtures and loader ([6ed2224](https://github.com/Heratiki/locallama-mcp/commit/6ed2224e6c259560aff7f1d0d94ba23b88f057c8)), closes [#117](https://github.com/Heratiki/locallama-mcp/issues/117)

# [1.30.0](https://github.com/Heratiki/locallama-mcp/compare/v1.29.0...v1.30.0) (2026-06-03)


### Features

* **tool:** add rate_model MCP tool ([6891432](https://github.com/Heratiki/locallama-mcp/commit/6891432801f619949e6f1cf0c5bbe8dd944d7e23)), closes [#116](https://github.com/Heratiki/locallama-mcp/issues/116)

# [1.29.0](https://github.com/Heratiki/locallama-mcp/compare/v1.28.0...v1.29.0) (2026-06-02)


### Features

* **routing:** wire sync validation & retry loop ([7888d0a](https://github.com/Heratiki/locallama-mcp/commit/7888d0a02811acfcaad0bcbbd0ecf0032caeb98e)), closes [#115](https://github.com/Heratiki/locallama-mcp/issues/115)

# [1.28.0](https://github.com/Heratiki/locallama-mcp/compare/v1.27.0...v1.28.0) (2026-06-02)


### Features

* **routing:** add getBestValidatorModel selector ([#126](https://github.com/Heratiki/locallama-mcp/issues/126)) ([fbda47d](https://github.com/Heratiki/locallama-mcp/commit/fbda47db8f409f9722c324289ca0b01d988f3fc0)), closes [#114](https://github.com/Heratiki/locallama-mcp/issues/114)

# [1.27.0](https://github.com/Heratiki/locallama-mcp/compare/v1.26.0...v1.27.0) (2026-06-02)


### Features

* **validation:** add OutputValidator module ([#125](https://github.com/Heratiki/locallama-mcp/issues/125)) ([826fc1b](https://github.com/Heratiki/locallama-mcp/commit/826fc1bf8458d8b3ffa61a7085abfb972b38cfe6)), closes [#113](https://github.com/Heratiki/locallama-mcp/issues/113) [#113](https://github.com/Heratiki/locallama-mcp/issues/113)

# [1.26.0](https://github.com/Heratiki/locallama-mcp/compare/v1.25.0...v1.26.0) (2026-06-02)


### Features

* **telemetry:** add OpenTelemetry tracing and persistent analytics ([#124](https://github.com/Heratiki/locallama-mcp/issues/124)) ([9b1f228](https://github.com/Heratiki/locallama-mcp/commit/9b1f228ad0fb19fd9cd6d2bede0c89d36ef8cffb)), closes [hi#error-rate](https://github.com/hi/issues/error-rate)

# [1.25.0](https://github.com/Heratiki/locallama-mcp/compare/v1.24.0...v1.25.0) (2026-06-02)


### Features

* **prompts:** upgrade system prompts across all features ([#123](https://github.com/Heratiki/locallama-mcp/issues/123)) ([47a999a](https://github.com/Heratiki/locallama-mcp/commit/47a999a497ea1187e1aec9d9df3b5bfb9f8f2aff))

# [1.24.0](https://github.com/Heratiki/locallama-mcp/compare/v1.23.1...v1.24.0) (2026-06-02)


### Features

* **routing:** implement ranked trio and benchmark recommendations for route_task and preemptive_route_task ([#110](https://github.com/Heratiki/locallama-mcp/issues/110)) ([#120](https://github.com/Heratiki/locallama-mcp/issues/120)) ([7281765](https://github.com/Heratiki/locallama-mcp/commit/7281765908a417824663094102f36487845da490))

## [1.23.1](https://github.com/Heratiki/locallama-mcp/compare/v1.23.0...v1.23.1) (2026-06-01)


### Bug Fixes

* **deps:** bump axios to ^1.16.0 to resolve security alerts ([#108](https://github.com/Heratiki/locallama-mcp/issues/108)) ([5506332](https://github.com/Heratiki/locallama-mcp/commit/550633271690ed743fc6029acda9de98f7df88e7))
* **server:** robust stdio lifecycle — exit on disconnect, drop singleton, clean update restart ([#109](https://github.com/Heratiki/locallama-mcp/issues/109)) ([6aa8338](https://github.com/Heratiki/locallama-mcp/commit/6aa8338e7005b403830ebe44494c86f8f8a19528))

# [1.23.0](https://github.com/Heratiki/locallama-mcp/compare/v1.22.0...v1.23.0) (2026-05-30)


### Features

* **llama-cpp:** GGUF metadata pre-read and direct CLI inference ([#107](https://github.com/Heratiki/locallama-mcp/issues/107)) ([fc1a3f3](https://github.com/Heratiki/locallama-mcp/commit/fc1a3f3f13d0f4993b36deaee3299bdb65e50a37)), closes [#93](https://github.com/Heratiki/locallama-mcp/issues/93) [#93](https://github.com/Heratiki/locallama-mcp/issues/93) [#95](https://github.com/Heratiki/locallama-mcp/issues/95)

# [1.22.0](https://github.com/Heratiki/locallama-mcp/compare/v1.21.0...v1.22.0) (2026-05-26)


### Features

* **llama-cpp:** managed llama-server lifecycle ([#106](https://github.com/Heratiki/locallama-mcp/issues/106)) ([d3bc0e1](https://github.com/Heratiki/locallama-mcp/commit/d3bc0e196884e3da3d80d627e6b4e1fedccd131e)), closes [#92](https://github.com/Heratiki/locallama-mcp/issues/92)

# [1.21.0](https://github.com/Heratiki/locallama-mcp/compare/v1.20.0...v1.21.0) (2026-05-26)


### Features

* **llama-cpp:** add cross-platform binary discovery ([#105](https://github.com/Heratiki/locallama-mcp/issues/105)) ([14b5c17](https://github.com/Heratiki/locallama-mcp/commit/14b5c170e3f25833cd4836850640eb0f02f7e322)), closes [#94](https://github.com/Heratiki/locallama-mcp/issues/94)

# [1.20.0](https://github.com/Heratiki/locallama-mcp/compare/v1.19.0...v1.20.0) (2026-05-26)


### Features

* add Binary Discovery and User-managed llama.cpp mode descriptions to documentation ([8f7b753](https://github.com/Heratiki/locallama-mcp/commit/8f7b753d81d56cdffec2ab029d295d268f00d2c0))

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
