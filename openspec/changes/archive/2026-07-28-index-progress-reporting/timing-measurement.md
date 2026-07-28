# Timing Measurement — resolves exploration §1e and proposal risk 1

The exploration could not measure wall time (no shell tool) and concluded **by elimination** that the
reported 5-minute run is "very likely dominated by CPU embedding compute". That conclusion is now
measured, and it is **wrong**. The download dominates.

## Method

The production path, instrumented: the same adapters `composition.ts` wires
(`FileDocumentSource`, `RemarkMarkdownParser`, `SqliteIndexStore`, `createConventionPolicy`,
`IndexDocuments`), with the real `TransformersEmbeddings` wrapped in a timing decorator so every
`embed()` batch is timed individually. `TransformersEmbeddings.create()` is constructed eagerly and
timed in isolation, which separates model load from steady-state throughput.

- Corpus: a copy of `ejemplos/` in a scratch directory (11 indexable documents; `INDEX.md` excluded
  by `config.exclude` as always).
- Model cache: **warm**. `create()` here measures ONNX session init only, with **no download**.
- Machine: the reporting user's Windows 10 dev machine.
- Runs: 3. Script: `measure.mjs` (scratch, not committed).

## Results

| Metric | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Documents indexed | 11 | 11 | 11 |
| **Chunks (real count)** | **27** | 27 | 27 |
| Embedding batches (size 16) | 2 | 2 | 2 |
| `create()` — warm cache | 1.02 s | 0.85 s | 0.82 s |
| Sum of `embed()` batches | 2.86 s | 2.84 s | 2.82 s |
| Everything else (discover + parse + chunk + SQLite) | 0.06 s | 0.06 s | 0.06 s |
| **Per-chunk embedding cost** | **105.8 ms** | 105.3 ms | 104.5 ms |

Variance across runs is under 1%. Per-batch: 1399 ms for 16 texts, 1458 ms for 11 texts — batch
latency is roughly flat in batch size at this scale, so per-chunk cost falls as batches fill.

## Findings

**1. The exploration over-estimated the chunk count by 30-100%.** It projected 35-55 chunks for
`ejemplos/`; the real number is **27** (2.45 chunks/document). Its downstream projection of "8 to 12
embedding batches" for a 36-document corpus is correspondingly inflated.

**2. Non-embedding work is 2% of a warm run.** Discovery, parsing, chunking and every SQLite write
together cost 0.06 s against 2.86 s of embedding. The exploration called this "small-moderate"; it is
negligible.

**3. Embedding compute cannot explain 5 minutes.** At 105 ms/chunk:

| Corpus assumption for 36 documents | Chunks | Embedding time |
|---|---|---|
| Same density as `ejemplos/` (2.45 chunks/doc) | 88 | **9 s** |
| 3× denser | 265 | **28 s** |
| 5× denser | 442 | **46 s** |
| Required to reach 300 s | **2 857** | 300 s |

The last row is the reductio: 2 857 chunks over 36 documents is 79 chunks per document — roughly 79
H2 sections each. Not a real corpus.

**4. Therefore the model download is the dominant cost on a cold cache.** With embedding at
~10-45 s and everything else negligible, roughly **255-290 of the reported 300 seconds** are the
129 MB download. That implies ~0.44-0.51 MB/s, i.e. an effective ~3.5-4 Mbps — a slow link, a
metered connection, or CDN throttling.

## Consequences for design

1. **The download is the main event, not a sub-signal.** The exploration and proposal framed
   download progress as nested inside the embedding phase. On the run the user actually complained
   about, it *is* the run. The bar must give it first-class treatment, and the download-event
   throttle cadence — which the proposal deferred to design — is now the highest-value cadence
   decision, not a footnote.
2. **The batch counter is a minor signal.** Realistically 6-28 batches for 36 documents, each ~1.4 s,
   totalling well under a minute. Worth showing, not worth optimising for.
3. **Warm runs are ~3 s end to end.** Every run after the first is nearly instant, so the bar appears
   and vanishes. Design should decide whether a short run shows a bar at all, or whether a minimum
   elapsed threshold suppresses it to avoid a flash of noise. This decision did not exist before this
   measurement.
4. **`create()` is ~0.9 s warm.** Cheap enough that the phase-transition message around the existing
   lazy call site (proposal decision 4) has no perceptible cost on warm runs.

## Limitations

- Measured on **one** machine. The "fresh machine" in the original report may have different CPU
  throughput; but finding 3's margin is ~10×, so it survives a 3× slower CPU comfortably.
- The 36-document corpus was never measured directly — only `ejemplos/` was. The extrapolation table
  brackets that uncertainty rather than assuming it away.
- The download itself was **not** timed (the cache is warm and deliberately was not purged). Its
  duration is inferred by subtraction from the user's report, not observed. Timing a genuine cold
  start would require clearing the transformers.js cache and re-downloading 129 MB.

---

## Addendum — two measurements taken after apply (2026-07-28)

Both close gaps this document originally listed under "Limitations".

### A. Does ONNX inference block Node's event loop?

Probe: a `setInterval(50 ms)` counter running alongside a real `create()` + `embed()`, comparing
observed fires against `elapsed / 50`.

| Window | Duration | Timer fires | % of expected |
|---|---|---|---|
| Control (`await` a 1 s timer) | 1 011 ms | 16 / 20 | 80% — loop free |
| `create()` (model load + session init) | 1 828 ms | 2 / 36 | **6%** |
| `embed()` (16 texts) | 1 132 ms | **0 / 22** | **0%** |

**`onnxruntime-node` blocks the JS main thread for the full duration of inference.** No JS-level
timer can fire while it runs, whenever it is armed. This is a pre-existing property of the
embeddings pipeline, not of progress reporting, and it bounds what any main-thread renderer can do:
the repaint heartbeat animates during network download (async socket I/O) and in the gaps between
batches, never *during* an inference call. Removing that bound means moving inference to
`worker_threads` — a separate change, deliberately not attempted here.

### B. The cold-download run, finally observed rather than inferred

The 129 MB cache was moved aside and `compendio index` run against `ejemplos/` in `bar` mode.
Result: **1 681 bytes on stderr, 20 frames**, the download ratio climbing 4% → **100%** with the
elapsed indicator advancing throughout.

```
[==------------------------------------]   4% 2.0s downloading model   5.2/129.1 MB
[=================-------------------]  47% 3.2s downloading model  60.8/129.1 MB
[==================================-]  97% 4.0s downloading model 125.0/129.1 MB
[==================================] 100% 4.4s downloading model 128.9/129.1 MB
```

Three findings:

1. **The bar works for the case that motivated the change.** Previously argued from "socket I/O is
   async"; now observed.
2. **The ratio does reach 100% on a fully cold cache.** The earlier stall at 125.9/129.1 MB was the
   *partially* warm case, exactly as design residual (b) predicted.
3. **Finding A is visible in the frame timestamps**: a 1.5 s gap between the `4.4s` and `5.9s`
   frames, with no frame in between — the blocking inference window. The frames on either side are
   the heartbeat, advancing the clock while the progress number stays still.

**One correction to §Findings 4 above.** That section inferred ~0.44-0.51 MB/s (~3.5-4 Mbps) by
subtracting from the user's 5-minute report. On *this* machine the same 129 MB downloaded in ~4 s
(~32 MB/s). The subtraction arithmetic still holds for the machine that produced the 5-minute
report, but that machine's bandwidth was never measured and is not this one's. The download-dominates
conclusion is unaffected — it rests on embedding compute being far too cheap to explain 300 s, which
finding 3 establishes independently of any bandwidth figure.
