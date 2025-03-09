# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.10.1](https://github.com/Heratiki/locallama-mcp/compare/v1.10.0...v1.10.1) (2025-03-09)

## [1.10.0](https://github.com/Heratiki/locallama-mcp/compare/v1.9.1...v1.10.0) (2025-03-09)


### Features

* add bridge readiness handling and implement timeouts for initialization and indexing ([76dcbef](https://github.com/Heratiki/locallama-mcp/commit/76dcbefa29c9cb2e8ca29f34901dd37406b46b6c))
* enhance execution mode handling and update user preferences type definitions ([fb1ee03](https://github.com/Heratiki/locallama-mcp/commit/fb1ee03585956d9a37ad56c3e49eb92674801606))


### Bug Fixes

* enhance task routing and add new commands for job management and model initialization ([b400399](https://github.com/Heratiki/locallama-mcp/commit/b4003996e88fb598b935abd8b7d7491882bc9e3e))

### [1.9.1](https://github.com/Heratiki/locallama-mcp/compare/v1.9.0...v1.9.1) (2025-03-09)

## [1.9.0](https://github.com/Heratiki/locallama-mcp/compare/v1.8.0...v1.9.0) (2025-03-09)


### Features

* add user preferences management with loading, saving, and updating capabilities ([319e88b](https://github.com/Heratiki/locallama-mcp/commit/319e88b99f5440af3761d3dc0bbf19dc3eb69c81))


### Bug Fixes

* update path handling in index.ts to use fileURLToPath and dirname for improved compatibility with ES modules ([3f5ef6c](https://github.com/Heratiki/locallama-mcp/commit/3f5ef6c6ee764e4b10bbb33de3b924360e3a5730))
* update resource module to use fileURLToPath and dirname for improved path handling ([f616701](https://github.com/Heratiki/locallama-mcp/commit/f616701cca13b2a58a0150cd3a69092d0c5deb0c))

## [1.8.0](https://github.com/Heratiki/locallama-mcp/compare/v1.7.0...v1.8.0) (2025-03-09)


### Features

* enhance CodeSearchEngine with configurable options for chunk size, exclusion patterns, and BM25 parameters ([8ff31d9](https://github.com/Heratiki/locallama-mcp/commit/8ff31d96ea00734fdc473aa9ece802f8dd64ceef))


### Bug Fixes

* enhance task routing and model selection with additional type definitions and method renaming ([ceb06ec](https://github.com/Heratiki/locallama-mcp/commit/ceb06ec04d4e8d92fb3a9998f57af8e8af7e9f76))

## [1.7.0](https://github.com/Heratiki/locallama-mcp/compare/v1.6.1...v1.7.0) (2025-03-09)


### Features

* add integration and domain factors evaluation to code task analysis ([f6c2523](https://github.com/Heratiki/locallama-mcp/commit/f6c2523a1b58635cdba485e9d8fc2a7d8c127b03))
* add new phase and components, implement task and cache optimizers, and enhance task execution logic ([3169f16](https://github.com/Heratiki/locallama-mcp/commit/3169f1677d4968281a3d2f234d09de3401bbb8c3))
* add technical requirements evaluation to code task analysis ([4ca19af](https://github.com/Heratiki/locallama-mcp/commit/4ca19af23c42b58d69ad42265f79b369333a5607))
* enhance complexity analysis with detailed integration metrics and critical path evaluation ([c57866e](https://github.com/Heratiki/locallama-mcp/commit/c57866ee46f7ec525c4dac6a748a76fc90a6da58))
* implement task routing service for smart task distribution and load balancing ([68bf328](https://github.com/Heratiki/locallama-mcp/commit/68bf328644c1738fdf70b88cf350c8ba7ef150e3))
* update phase statuses and completion metrics for code task analysis and integration ([117477a](https://github.com/Heratiki/locallama-mcp/commit/117477a822f70c120c3b29185e6dc9d85c8bd539))
* update phase statuses and completion metrics for model selection enhancement ([cc37a81](https://github.com/Heratiki/locallama-mcp/commit/cc37a81453f39b6555094a6bd7241523df1da708))
* update version to 1.6.2, enhance task routing with new job tracking and indexing status features ([f1ecc82](https://github.com/Heratiki/locallama-mcp/commit/f1ecc828c1491a8ab5187a054180d669447ade56))


### Bug Fixes

* provide workspace root to createCodeSearchEngine in getRealtimeIndexStatus ([3fb1ff0](https://github.com/Heratiki/locallama-mcp/commit/3fb1ff08d368ee6946de7af518851167ab391c29))
* remove unnecessary whitespace in CodeTaskAnalysisOptions interface ([19f8d6a](https://github.com/Heratiki/locallama-mcp/commit/19f8d6a993e6a71b8839956fcdadae3a849ef1d7))
* simplify return statement in BM25Searcher initialization ([75125a9](https://github.com/Heratiki/locallama-mcp/commit/75125a9ee2280289b0850cba26bc152224405163))
* started fix for semantic code search functionality and configuration options in README and sample.env ([7a2b7d6](https://github.com/Heratiki/locallama-mcp/commit/7a2b7d65367bc971d04fe8ad3161059d224a0f28))
* update benchmarkService to use ModelPerformanceData type and replace save method with updateModelData ([c015c71](https://github.com/Heratiki/locallama-mcp/commit/c015c71d19735cc3a56d8cb253a55c83ba95682c))
* update code search engine instantiation and change timestamp format to use Date.now() ([440ce3f](https://github.com/Heratiki/locallama-mcp/commit/440ce3fb44b6698d96edca27b236b8db06bd1601))
* update timestamp format in model performance tracking to ISO string ([af06fcf](https://github.com/Heratiki/locallama-mcp/commit/af06fcf15ffb6dcd7943ee9dbe507c28c22269c4))

### [1.6.2](https://github.com/Heratiki/locallama-mcp/compare/v1.6.1...v1.6.2) (2025-03-09)

### Features
* enhance code task analysis with improved complexity scoring ([d8f7a21])
* add adaptive thresholds to model selection system ([c9e3b42])
* implement BM25-based semantic code search optimization ([f5e9b23])

### Improvements
* update development plans with current progress and metrics
* enhance documentation with latest features and configuration
* optimize token reduction strategies with pattern caching

### [1.6.1](https://github.com/Heratiki/locallama-mcp/compare/v1.6.0...v1.6.1) (2025-03-08)

### Bug Fixes

* update import paths to include file extensions and improve promise handling in cost-monitor module ([ccf62b8](https://github.com/Heratiki/locallama-mcp/commit/ccf62b8f1f8827867fed5a9cb0c8d6675015665d))

## [1.6.0](https://github.com/Heratiki/locallama-mcp/compare/v1.5.2...v1.6.0) (2025-03-08)


### Features

* add code search functionality with CodeSearchEngine and retriv integration ([371d1f0](https://github.com/Heratiki/locallama-mcp/commit/371d1f06f68a9066a721ae40b2e1b9f1912ae9f4))
* enhance error handling and export interfaces in cost-monitor and decision-engine modules ([82a5aec](https://github.com/Heratiki/locallama-mcp/commit/82a5aec568c0fc9365f3c6be969a272abad0a425))

### [1.5.2](https://github.com/Heratiki/locallama-mcp/compare/v1.5.1...v1.5.2) (2025-03-07)

### [1.5.1](https://github.com/Heratiki/locallama-mcp/compare/v1.5.0...v1.5.1) (2025-03-07)

## [1.5.0](https://github.com/Heratiki/locallama-mcp/compare/v1.4.0...v1.5.0) (2025-03-07)


### Features

* enhance configuration structure with detailed type definitions and validation logic ([4e7c631](https://github.com/Heratiki/locallama-mcp/commit/4e7c631e15c51804b2e2357109ae4cc2cdcb49c2))

## [1.4.0](https://github.com/Heratiki/locallama-mcp/compare/v1.3.2...v1.4.0) (2025-03-07)


### Features

* add code task analysis and decomposition functionality ([a4ba231](https://github.com/Heratiki/locallama-mcp/commit/a4ba2314dede02c9c63ea9fdde57f5f038e59172))
* update tokenManager with new dependencies and enhance code task handling ([d6f56ea](https://github.com/Heratiki/locallama-mcp/commit/d6f56ea65005da8ff41c3897643548b8fabdae74))


### Bug Fixes

* rename benchmark function for clarity in API integration tools ([a6ce4ca](https://github.com/Heratiki/locallama-mcp/commit/a6ce4cafc6781588134dad50ee937e7650ca417b))

### [1.3.2](https://github.com/Heratiki/locallama-mcp/compare/v1.3.1...v1.3.2) (2025-03-07)


### Bug Fixes

* dynamically read version from package.json in server and resource handlers ([c52481b](https://github.com/Heratiki/locallama-mcp/commit/c52481b28b87156969126f9cd4d9b5a75fd2ad79))

### 1.3.1 (2025-03-06)
