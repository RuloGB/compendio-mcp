# Release and MCP registry

How the npm package and its MCP registry entry are published and kept consistent. Moved verbatim from `AGENTS.md`. `prepublishOnly` runs `build` then `test`, so publishing fails if either fails.

**The MCP registry entry is metadata only, and it is verified against the PUBLISHED npm tarball.**
`registry.modelcontextprotocol.io` hosts no artifact; it proves ownership of the name
`io.github.RuloGB/compendio-mcp` by reading `mcpName` from the `package.json` of the published
version named in `server.json` (`internal/validators/registries/npm.go`). A `mcpName` present only
on `main` verifies nothing — which is why the version that first carries it has to be cut and
published to npm before `mcp-publisher publish` can succeed, and why every mismatch is otherwise
discovered after the version number has already been spent.

**Two things that cost a version each to learn, both contradicting the common write-ups.** First,
**the namespace is NOT lowercase**: GitHub auth grants `io.github.<login>/*` carrying the login's
own case, and both that grant and the `mcpName` check compare with Go's `!=` — byte for byte. A
lowercase `io.github.rulogb/…` is refused with a 403 naming the grant it expected. Second, **the
`<!-- mcp-name: … -->` README marker plays no part in npm validation at all** — `mcpname.go` says
so in as many words ("NPM is unaffected because it compares an exact metadata field rather than
scanning README text"); the README-token validators serve PyPI, NuGet and Cargo. The marker is kept
because downstream directories read it, not because publishing needs it.

The registry's `description` is capped at **100 characters** (`maxLength` in its schema); npm's has
no such cap, so the two deliberately differ rather than being kept in sync.

`test/registry-metadata.test.ts` pins every field that can drift — the name and its exact case,
`package.json`'s version and `mcpName`, `server.json`'s root and `packages[0]` versions, the
description length, the README marker, and `packageArguments` carrying `serve` — so a PR fails
instead of a release. Validate the whole file with
`npx ajv-cli@5 validate -s server.schema.json -d server.json --strict=false`: the schema is
**draft-07**, not the draft 2020-12 its `$schema` URL suggests, and it uses the non-standard
`example` keyword, so both `--spec=draft2020` and ajv's strict mode reject it before it ever looks
at `server.json`. `release.yml` is deliberately left checking only tag-vs-`package.json`: it
runs `npm test`, so the rest is already covered there. `mcp-publisher` is the registry's Go CLI,
downloaded from `modelcontextprotocol/registry` releases
