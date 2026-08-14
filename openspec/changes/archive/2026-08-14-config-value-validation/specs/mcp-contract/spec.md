# Delta for MCP Contract

## ADDED Requirements

### Requirement: Config-Warning Visibility in `docs_overview` Response

The `docs_overview` MCP tool's rendered text response MUST include a `Config:` block whenever the running process's loaded configuration produced one or more config-load reports (an invalid declared numeric value, an unrecognized key, or an inverted `chunk.minTokens`/`chunk.maxTokens` pair — see the Configuration spec's "Config Load Reports Invalid Values and Unrecognized Keys"). This block is distinct from, and never folded into, the `Sync:` block: a config-load report describes a property of the running process, constant for its lifetime, while `Sync:` describes the outcome of the most recent sync pass. The `Config:` block MUST be omitted entirely — never rendered empty — when the loaded configuration produced no report. Because the report describes process-lifetime state rather than a one-time event, it MUST be rendered on every `docs_overview` call for as long as the process runs with that configuration, not only on the first call.

#### Scenario: A running process with an invalid declared value renders the block

- GIVEN a process started with `compendio.config.json` declaring an invalid `chunk.maxTokens`
- WHEN `docs_overview` is called
- THEN its rendered response includes a `Config:` block naming the fallback

#### Scenario: A clean configuration omits the block

- GIVEN a process started with no `compendio.config.json`, or one declaring only valid, recognized keys with `chunk.minTokens` at or below `chunk.maxTokens`
- WHEN `docs_overview` is called
- THEN its rendered response contains no `Config:` block

#### Scenario: The block persists across repeated calls, not only the first

- GIVEN a process started with an invalid declared config value
- WHEN `docs_overview` is called twice in the same process lifetime
- THEN the `Config:` block appears in both responses, not only the first
