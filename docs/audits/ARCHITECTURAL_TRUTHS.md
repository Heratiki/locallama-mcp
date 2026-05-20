# Architectural Truths

## Benchmark Philosophy

Benchmarks must materially influence routing behavior.

If benchmark results cannot affect routing decisions, the benchmark system is considered non-functional.

---

## Routing Philosophy

Capability correctness is more important than latency or local-first preference.

---

## Persistence Philosophy

Routing should rely on a single authoritative telemetry source.

---

## Validation Philosophy

Unit tests and mocked integrations are necessary but are not considered sufficient proof of operational correctness.

Core system behaviors — especially routing, provider interoperability, benchmarking, model discovery, resource management, and MCP tool execution — must be validated through real-world operational testing against live providers whenever possible.

A feature is not considered production-trustworthy until it has been exercised under realistic runtime conditions, including failure scenarios and degraded states.

Operational behavior is considered a higher-confidence signal than synthetic happy-path test success.