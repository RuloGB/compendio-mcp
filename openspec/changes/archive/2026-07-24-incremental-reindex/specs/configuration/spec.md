# Delta for Configuration

## ADDED Requirements

### Requirement: `sync` Configuration Section With a Per-Project Throttle Default

The system MUST accept an optional `sync` block in `compendio.config.json` with a `throttleMs` key controlling the minimum interval between throttled incremental sync passes (see Indexing spec). When the block or the key is absent, the system MUST default `sync.throttleMs` to `30000` (30 seconds), following the project's existing "every key has a default" convention. A declared `throttleMs` that is not a finite positive number (non-numeric, negative, or `0`) MUST be treated the same as an absent key and MUST also fall back to the default `30000`, rather than being accepted as-is; any finite positive value, however small, MUST be accepted, with the tradeoff (more frequent per-call filesystem diffs) left to the project's choice.

#### Scenario: No `sync` block declared

- GIVEN a `compendio.config.json` with no `sync` block
- WHEN `compendio serve` starts
- THEN the throttled sync check uses the default 30-second interval

#### Scenario: Custom throttle declared

- GIVEN `compendio.config.json` containing `{ "sync": { "throttleMs": 60000 } }`
- WHEN `compendio serve` starts
- THEN the throttled sync check uses a 60-second interval instead of the default

#### Scenario: Invalid throttle value falls back to the default

- GIVEN `compendio.config.json` containing a `sync.throttleMs` value that is non-numeric, negative, or `0`
- WHEN `compendio serve` starts
- THEN the throttled sync check uses the default 30-second interval instead of the invalid value
