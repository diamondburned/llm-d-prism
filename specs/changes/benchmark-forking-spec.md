# Spec: Benchmark Forking & Read-Only Source Republishing

- **Status**: Implemented
- **Author**: diamondburned, Jetski
- **Date**: August 21, 2026
- **Feature Name**: `benchmark-forking`

---

## 1. Objective & Problem Statement

This specification defines the product requirements, UX architecture, and technical design for **Benchmark Forking** in Prism.

Benchmark Forking allows users to take any benchmark run from the **Prism Results Store** (including read-only GCS catalog mirrors populated by automated CI pipelines or external teams), clone it directly into the browser-local **Staging Workspace**, and treat it as a locally staged benchmark. Users can then freely edit metadata, curate runs, coalesce related stages, and publish the refined benchmarks to a **writable Results Store bucket or prefix** (`RESULTS_STORE_BUCKET`).

### The Core Problem: Read-Only Storage Enforcement & Incomplete Harness Metadata

In team and enterprise deployments, benchmark datasets frequently originate from automated test runners or shared continuous benchmarking pipelines. These pipelines output directly into dedicated GCS buckets or directory prefixes (e.g., `gs://internal-prism/benchmarks-mirror/prism-results-store` or buckets declared in `DEFAULT_BUCKETS`).

These catalog buckets are configured so that **GCS IAM enforces read-only access**. Prism writing directly to these buckets would fail with permission errors.

However, automated harnesses typically do not collect enough contextual metadata or information for Prism to perform its automations to group relevant runs together, which requires human intervention before they can be effectively analyzed, shared, or compared:

1. **Correlating & Grouping Related Runs**: Automated harness outputs often lack shared run identifiers or stage definitions required to automatically group multi-stage benchmarks into unified latency/throughput curves.
2. **Metadata Inaccuracies or Gaps**: Automated outputs often have missing or generic model names, unpopulated accelerator counts, or imprecise serving stack tags.
3. **Stage Pruning & Re-ordering**: Users may need to re-index, reorder, or remove outliers from runs.
4. **Publishing for Team Visibility**: Users need to make these combined and corrected benchmarks visible to teammates and stakeholders on shared dashboards.

Because read-only IAM makes in-place modifications impossible, users without forking have no in-app mechanism to bridge catalog data into their writable storage. They are forced to download raw YAML files, reorganize files on local disk, and manually re-upload them through the submission flow. Forking enables users to pull automated results into browser staging and curate them into useful, structured benchmark data entirely within Prism.

### The Solution: Benchmark Forking

**Forking** creates an instant, in-browser bridge between any existing Results Store benchmark and the staging workspace:

1. Users select one or more benchmarks directly in the Results Store table and click **"Fork"**.
2. Prism clones the canonical benchmark payload, generates a fresh staging UUID, attaches structured root provenance metadata (`$.forked_from`), and places the new benchmark directly into the local staging catalog alongside existing runs.
3. A full-page informational dialog appears explaining that the benchmark has been forked into staging, where it can now be edited, coalesced, or submitted.
4. The forked benchmark displays a small blue **"Forked"** badge to the left of its GCS status badge.
5. The user handles the forked benchmark exactly like any other staged benchmark, including editing metadata, coalescing/reordering stages, and submitting it to the writable Results Store (`RESULTS_STORE_BUCKET`).

### Writable Results Store & Prefix Scoping

To support environments where read-only mirrors and custom writable submissions share the same physical GCS bucket, Prism utilizes bucket path prefix scoping (configured via `parseBucketEntry` in `server/buckets.js`). For example:

- `DEFAULT_BUCKETS=internal-prism/benchmarks-mirror` (read-only mirror governed by GCS IAM)
- `RESULTS_STORE_BUCKET=internal-prism/custom` (writable results store destination)

> **Note**: This bucket prefix scoping infrastructure has already been implemented previously and will be shipped in the same pull request introducing this feature.

### Goals

1. **Any-Benchmark Forking**: Allow users to fork any Results Store benchmark into browser staging via single-card action panels or multi-select floating toolbars.
2. **Clear In-App Feedback**: Provide 1-sentence hover popovers on Fork buttons and a full-page educational modal on fork completion.
3. **Distinct Visual Identity**: Render a small, blue "Forked" button/badge to the left of the community/GCS status badge on every forked benchmark.
4. **Root Provenance Tracking**: Store complete origin lineage and author attribution in a dedicated `$.forked_from` root property.
5. **Decoupled Staging Lifecycle**: Forked runs immediately join the local staging catalog; editing, coalescing, and submission remain independent user-driven actions.

### Non-Goals

- Bypassing GCS IAM permissions or writing directly to read-only buckets.
- Forcing users into immediate coalescing or submission wizards upon forking.

---

## 2. Data Model & Lineage (`$.forked_from`)

Lineage and provenance are tracked directly at the root of the [`PrismResultPayload`](../main/completed/results-api/README.md#2-combined-api-payload-schema) object via the `forked_from` field.

A benchmark payload is considered forked if and only if `$.forked_from` is non-null and defined. If `forked_from` is missing or `null`, the benchmark is an original upload.

### TypeScript Definition

```typescript
export interface ForkDetail {
    /** UUID of the benchmark run that was forked */
    original_run_id: string;
    /** Human-readable label or description of the original run */
    original_run_label: string;
    /** Original author/submitter of the source benchmark */
    original_author?: {
        username: string;
        name?: string;
        email?: string;
    } | string | null;
    /** GCS source bucket or prefix where the original benchmark was stored */
    source_bucket: string;
    /** ISO 8601 timestamp when the fork was created */
    forked_at: string;
}

export interface PrismResultPayload {
    runId: string;
    runLabel: string;
    model_name: string;
    hardware: {
        hardware_name: string;
        accelerator_count?: number;
    };
    format: 'brv02' | string;
    /**
     * Provenance tracking. Single ForkDetail for direct forks,
     * or an array of ForkDetails if forked multiple times or coalesced from multiple forks.
     */
    forked_from?: ForkDetail | ForkDetail[] | null;
    entries: PrismStageEntry[];
    // ... remaining standard payload properties
}
```

### Transformation Rules

1. **Root `$.forked_from` Injection**: The newly created staged payload contains `original_run_id`, `original_run_label`, `original_author`, `source_bucket`, and `forked_at`.
2. **Multi-Fork / Coalesce Support**: If a forked benchmark is forked again, or if multiple forked runs are combined using the [Manual Benchmark Coalescing](manual-benchmark-coalescing.md) tool, `forked_from` becomes an array of `ForkDetail` objects representing all ancestral sources.
3. **Payload Cloned, Raw Reports Untouched**: Constituent stage reports in `entries` are cloned into the new run. The underlying raw BRV0.2 report dictionaries (`entries[].raw_report`) remain strictly intact and unmodified.
4. **Staging UUID**: A fresh UUID v4 is assigned to `runId` and synchronized across stage entries (`entries[].run_id`).

---

## 3. Frontend UI & User Experience (UX)

### 3.1 Fork Action Entry Points & Hover Popovers

Users can initiate a fork from two primary UI locations:

1. **Multi-Select Floating Action Bar**:
   - When one or more benchmark rows are checked in the table, a **"Fork"** button appears in the bottom floating toolbar.
   - Hovering over the button reveals a short 1-sentence popover card:
     *"Clone selected benchmarks into local staging to modify, coalesce, or republish."*
2. **Benchmark Detail Card / Row Action Panel**:
   - In each expanded benchmark row or detail panel, a **"Fork"** button is placed directly adjacent to the **Download ZIP** / **Download BRV0.2** button.
   - Hovering over this button reveals a short 1-sentence popover card:
     *"Clone this benchmark into local staging to modify, coalesce, or republish."*

### 3.2 Post-Fork Educational Full-Page Dialog

Clicking either "Fork" button immediately stages the selected benchmark(s) and displays an informational full-page modal/dialog:

- **Purpose**: Explains what just happened, clarifies that the benchmark now exists in local browser staging, and outlines what forking allows the user to do (similar to the onboarding dialog displayed when staging or uploading benchmarks for the first time).
- **Core Guidance in Dialog**:
  - Explains that the benchmark was copied into local staging with a fresh identifier.
  - Highlights that the user can now edit metadata, adjust labels, or coalesce multiple stages together on their own time.
  - Notes that the benchmark remains local until the user explicitly chooses to submit it to the writable Results Store.
- **Action**: A primary **"Got it"** / **"View in Results Store"** button dismisses the modal and returns focus to the table.

### 3.3 Blue "Forked" Badge Indicator

On every forked benchmark (both in the table and expanded cards):

- A small, styled blue **"Forked"** button/badge is displayed directly to the left of the existing community/GCS status badge.
- Clicking or hovering over the badge reveals origin details (original author, source bucket, and timestamp).

### 3.4 Decoupled Staging Lifecycle

Forking is strictly decoupled from editing and submission:

- When forked, the new staged benchmark appears immediately in the Results Store / Benchmark list alongside the original run (highlighted with its staged status and blue "Forked" badge).
- The user can choose to edit metadata, reorder stages, or coalesce runs later at their own discretion.

---

## 4. End-to-End Workflow & Execution Steps

1. **Select Benchmark(s)**:
   - The user browses the Results Store catalog and clicks "Fork" on a single benchmark card, or selects multiple benchmarks and clicks "Fork" in the floating action bar.
2. **Stage & Hydrate**:
   - Prism clones the canonical payload(s), assigns fresh staging UUIDs, records the original author and bucket in `$.forked_from`, and adds the item(s) to the local staging catalog.
3. **Review Educational Dialog**:
   - The full-page modal appears detailing the fork operation and explaining the available staging capabilities. The user dismisses the dialog.
4. **View Staged Benchmark**:
   - The user sees the forked benchmark in the table alongside existing runs, clearly marked with the blue "Forked" badge and staged accent styling.
5. **Downstream Actions**:
   - The user handles the forked benchmark the same as any other staged benchmark, including editing metadata, coalescing/reordering stages, or submitting it to the writable Results Store (`RESULTS_STORE_BUCKET`) as needed.

---

## 5. High-Level Implementation Plan

### 5.1 Fork Utility & Payload Cloner

- Implement a lightweight payload forker that accepts an existing benchmark run stat/payload, extracts the canonical payload, generates a new staging UUID, and populates `$.forked_from` with original run ID, label, author, source bucket, and timestamp.
- Ensure `entries` are re-indexed to the new run ID while keeping `raw_report` contents intact.

### 5.2 Results Store UI & Action Bars

- Add the "Fork" button to the multi-select floating action bar and row action panel in the Results Store table.
- Implement short 1-sentence hover popover cards for both buttons.
- Render the blue "Forked" badge to the left of the community/GCS status badge on all runs with a non-null `$.forked_from`.

### 5.3 Post-Fork Modal Dialog

- Create the full-page explanation modal describing the fork operation and downstream staging actions.
- Wire the modal to trigger upon completing a single or bulk fork action.

### 5.4 Staging State & Coalescing Integration

- Connect the forker output into the local staging state management hooks so forked runs appear immediately as staged benchmarks.
- In the manual coalescing workflow, when combining runs with `forked_from` metadata, aggregate the individual provenance entries into an array under `$.forked_from`.

### 5.5 Backend Schema & Validation

- Update payload validation schemas to recognize optional `forked_from` (single object or array of objects) at the root level.
- Ensure submissions containing `forked_from` metadata pass schema validation on upload.

---

## 6. Verification & Testing Plan

### Automated Unit & Schema Tests

1. **Fork Payload Extraction**: Verify that forking a benchmark creates a valid `PrismResultPayload` with a new UUID, staged status, intact `raw_report` entries, and populated root `$.forked_from`.
2. **Author Attribution**: Verify that original author/submitter information is accurately captured inside `$.forked_from`.
3. **Multi-Fork & Coalesce Aggregation**: Verify that coalescing multiple forked runs produces an array of `ForkDetail` objects under `$.forked_from`.
4. **Schema Acceptance**: Verify that payloads with single and array `forked_from` blocks pass schema validation.

### Browser & UI Verification

1. Hover over the "Fork" button on a benchmark card and in the floating selection bar; verify 1-sentence popover cards appear.
2. Click "Fork" on a benchmark; verify the full-page explanation modal appears with clear staging instructions.
3. Dismiss the modal; verify the forked benchmark appears in the table with the blue "Forked" badge to the left of the community/GCS status badge.
4. Verify the forked run can be edited, coalesced, and submitted through standard staging workflows.
