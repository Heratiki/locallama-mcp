# Product Context

Last updated: 2026-04-24

## Project Overview

LocalLama MCP is a Model Context Protocol server for local-first coding-agent workflows. It helps an MCP-capable agent decide when to use local models, free or low-cost remote models, or paid frontier models for coding tasks.

The revived product direction is provider-neutral and client-neutral. It should work well with current coding-agent tools such as Codex, Claude Code, Claw Code, Cursor, GitHub Copilot Agent mode, and generic MCP clients.

## Objectives

- Reduce cost by routing simple or repetitive work to capable local or free models.
- Preserve quality by routing complex, risky, or broad-context work to stronger models.
- Use benchmark history and live capability metadata instead of stale hardcoded model assumptions.
- Provide useful MCP resources for model status, active jobs, cost estimates, benchmark results, and routing explanations.
- Make model evaluation executable where possible by applying patches and running tests.

## Key Components

### MCP Integration

- Exposes tools and resources through MCP.
- Should remain safe for model-controlled use.
- Should support clear setup instructions for modern MCP clients.

### Provider Layer

- Supports local providers such as LM Studio and Ollama.
- Supports OpenRouter for free, low-cost, and paid models.
- Should grow toward a common provider contract for model listing, inference, pricing, and capabilities.

### Decision Engine

- Analyzes tasks, estimates context and complexity, and selects models.
- Should move from model-name heuristics to measured performance, discovered capabilities, and benchmark data.
- Should explain routing decisions in a way users and agents can audit.

### Benchmarking System

- Compares models by latency, cost, token usage, output quality, and reliability.
- Should move away from simulated paid-model results.
- Should prioritize executable outcomes, such as tests passing after an applied patch.

### Cost and Token Monitoring

- Tracks token usage, cost estimates, cache behavior, and available model pricing.
- Should support modern token accounting and provider-specific pricing metadata.

### Code Search

- Existing code search integrates Python/Retriv and BM25-style search.
- Future work should decide whether Retriv remains the default or becomes an optional backend.

## Product Principles

- Local-first, not local-only.
- Provider-neutral, not model-brand-specific.
- Benchmarks should measure work that matters to coding agents.
- Documentation should serve both humans and agents.
- Shared project memory should be updated as work happens.
