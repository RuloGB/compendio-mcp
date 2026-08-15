# Delta for MCP Contract

## ADDED Requirements

### Requirement: `docs_overview` Taxonomy Counters Are Safe For Any `type`/`module` Value

Every `type` and `module` value MUST be counted correctly in `docs_overview`'s rendered `By type:` and `By module:` lines, regardless of the string — including a value that collides with a member name inherited from `Object.prototype` (`__proto__`, `constructor`, and their kin). A bucket keyed by such a value MUST appear in the rendered output with its correct numeric count: it MUST NOT be silently omitted, MUST NOT render as anything other than that count in its place, and MUST NOT alter the count reported for any other value in the same corpus. This requirement governs the *safety of a bucket's value* for any string key; it is a sibling to, and does not modify, "`docs_overview` Omits Empty Taxonomy Buckets", which governs bucket *presence* and is unaffected by this one — a corpus that genuinely declares no `type`/`module` still omits that line entirely, exactly as before.

#### Scenario: A `__proto__` type value is not silently dropped

- GIVEN a corpus containing a document whose `type` is the literal string `__proto__`
- WHEN `docs_overview` is called
- THEN the rendered `By type:` line includes a `__proto__ (1)` entry, not an omitted bucket

#### Scenario: A `constructor` type value renders as a count, not garbled text

- GIVEN a corpus containing a document whose `type` is the literal string `constructor`
- WHEN `docs_overview` is called
- THEN the rendered `By type:` line includes a `constructor (1)` entry, and contains no rendered function source text (e.g. `native code`) in its place

#### Scenario: A `__proto__` module value, reached via a folder name, is not silently dropped

- GIVEN a corpus containing a document whose path places it under a folder literally named `__proto__`, so its inferred `module` is `__proto__`
- WHEN `docs_overview` is called
- THEN the rendered `By module:` line includes a `__proto__ (1)` entry, not an omitted bucket

#### Scenario: A `constructor` module value, reached via a folder name, renders as a count

- GIVEN a corpus containing a document whose path places it under a folder literally named `constructor`, so its inferred `module` is `constructor`
- WHEN `docs_overview` is called
- THEN the rendered `By module:` line includes a `constructor (1)` entry, and contains no rendered function source text in its place

#### Scenario: A hostile value does not affect an ordinary value's count in the same corpus

- GIVEN a corpus mixing documents typed `__proto__`, `constructor`, and an ordinary value such as `guide`
- WHEN `docs_overview` is called
- THEN the rendered `By type:` line reports the correct count for all three, with the ordinary value's count unaffected by the other two
