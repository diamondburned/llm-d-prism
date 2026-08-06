# Spec: BRV0.2 Benchmark Download Specification

- **Status**: Implemented
- **Author**: diamondburned, Jetski
- **Date**: August 5, 2026

## 1. Objective & Context

This proposal specifies the design and implementation for downloading **Benchmark Report v0.2 (BRV0.2)** files from the Prism Results Store.

In Prism, benchmark runs uploaded or ingested into the Cloud Results Store are coalesced into a single unified JSON payload object ([`PrismResultPayload`](../main/completed/results-api/README.md#2-combined-api-payload-schema)) stored in Google Cloud Storage (`gs://<bucket>/prism-results-store/<runId>.v1.json`). Each payload contains descriptive run-level metadata alongside an `entries` array of parsed benchmark stages ([`PrismStageEntry`](../main/completed/results-api/README.md#2-combined-api-payload-schema)). Within each stage entry, the original parsed report is stored in the `raw_report` dictionary property.

Upstream developers, benchmark analysts, and MLOps engineers need to extract these raw BRV0.2 benchmark files back out of Prism for offline analysis, re-running, or integration with external command-line utilities (such as `llm-d-benchmark` scripts).

### Key Capabilities

1. **Individual Entry YAML Download**: Dissect and export any single stage entry (`entries[i].raw_report`) directly as a clean, standardized `.yaml` file matching the BRV0.2 specification.
2. **Single-Run ZIP Download**: Dissect and package all constituent BRV0.2 stage entries of a single benchmark run into a downloadable `.zip` archive containing individual stage `.yaml` reports.
3. **Programmatic REST API Endpoints**: Expose server-side GET download routes allowing both browser UI interactions and command-line HTTP clients (`curl`, `wget`, python scripts) to retrieve raw YAML files and ZIP archives directly.

## 2. Background & Existing Architecture

### Existing Data Structures

As documented in the [Prism Results Store Specification](../main/completed/results-api/README.md) and [Parser & Data Model Spec](../main/completed/results-api/parser_and_data_model.md), a stored benchmark run payload has the following structure:

```json
{
  "runId": "e2bb0924-f746-4553-91ed-d771beae8057",
  "runLabel": "llm-d-tpu-v6e-findings-20260731",
  "model_name": "google/gemma-4-9b-it",
  "hardware": {
    "hardware_name": "TPU v6e",
    "accelerator_count": 4
  },
  "format": "brv02",
  "entries": [
    {
      "run_id": "e2bb0924-f746-4553-91ed-d771beae8057",
      "run_description": "llm-d-tpu-v6e-findings-20260731",
      "filename": "benchmark_report_v0.2,_stage_0_lifecycle_metrics.json.yaml",
      "prism_stage_index": 0,
      "raw_report": {
        "version": "0.2",
        "run": { "description": "llm-d-tpu-v6e-findings-20260731" },
        "scenario": { ... },
        "metrics": { ... }
      }
    }
  ]
}
```

## 3. BRV0.2 Report Dissection & ZIP Serialization Specification

### 3.1 Supported Data Sources & Scope Exclusivity

Downloading exclusively supports benchmark runs from:
- **Cloud GCS Results Store**: Payloads stored in Cloud Storage under `/prism-results-store/*.v1.json`.
- **Local BRV0.2 Files**: Staged BRV0.2 benchmark runs stored locally in the browser context (`brv02:*`).

Legacy static benchmarks, Google Drive imports, and non-BRV0.2 sample datasets are out of scope and do not support export operations.

### 3.2 Stage Dissection & Canonical Filename Schema

When extracting a constituent stage entry from a benchmark run:
1. The raw stage report dictionary is extracted.
2. Output stage files are formatted according to the canonical BRV0.2 stage filename pattern:
   `benchmark_report_v0.2,_stage_${STAGE}_lifecycle_metrics.json.yaml`
   where `${STAGE}` is the 0-indexed stage number (0, 1, 2...).
3. The raw report is serialized to a clean, standardized UTF-8 YAML document.

### 3.3 Single-Run ZIP Archive Packaging & Run Label Resolution

When exporting a single run, the generated ZIP archive is named according to the canonical pattern:
`<sanitized_run_label>-<short_runId>.zip`
where:
- `<sanitized_run_label>` is the sanitized human-readable run label or directory upload name.
- `<short_runId>` is the first segment (first 8 characters) of the run UUID (e.g. `e2bb0924`).

#### Run Label Resolution & Fallback Hierarchy

Run label resolution prioritizes descriptive metadata to prevent generic model names from obscuring run identities:
1. **Explicit Run Descriptions**: Uses explicit run descriptions or labels defined within the benchmark report metadata.
2. **Directory & Folder Names**: Uses directory or folder names specified during batch uploads when explicit report descriptions are absent.
3. **User Custom Labels**: Respects user-defined custom labels assigned within the UI.
4. **Model Name Fallback**: Falls back to the standardized model name only if no distinct run description, folder name, or custom label is present.

Example ZIP Archive structure:

```
llm-d-tpu-v6e-findings-20260731-e2bb0924.zip
├── benchmark_report_v0.2,_stage_0_lifecycle_metrics.json.yaml
└── benchmark_report_v0.2,_stage_1_lifecycle_metrics.json.yaml
```

## 4. API Route Specification

To support CLI tools, automated pipelines, and programmatic downloads, two backend endpoints are provided under `/api/results`:

1. `GET /api/results/:runId/export`: Downloads an entire benchmark run dissected into constituent BRV0.2 YAML files as a ZIP archive (or a single YAML file if the run contains only 1 stage).
2. `GET /api/results/:runId/entries/:entryIndex/download`: Downloads a specific stage entry from a benchmark run as a standalone BRV0.2 YAML file.

## 5. Frontend UI Integration & User Experience

### 5.1 Table Row Action Panel

In the Results Store table row details section:
- Under each expanded benchmark run's details panel, a **Download BRV0.2** button is positioned directly to the left of the **Inspect Raw Manifest** button.
- **Targeted Visibility**: The Download button is displayed exclusively for valid BRV0.2 benchmark runs stored in the Cloud Results Store or staged locally, and is hidden for static sample datasets, built-in Drive files, and legacy benchmarks.
- **Header Alignment & Visual Divider**: The action panel buttons stretch vertically to align with the full height of the adjacent metadata header box, separated by a thin 1px vertical divider line.
- Clicking **Download BRV0.2** triggers an instant browser download of a ZIP archive for multi-stage runs or a single YAML report file for single-stage runs.

### 5.2 Raw Report Inspector Modal

Inside the raw manifest inspector modal:
- Next to the **Copy YAML** button, a **Download BRV0.2** button provides direct single-stage or run-level export capability.

## 6. Security & Authorization

Export and download endpoints follow the exact same authorization and access control rules as result viewing. For complete details on identity resolution, role mappings, and submission state access permissions, refer to [iam.md](../main/completed/results-api/iam.md).

## 7. Implementation Notes

### 7.1 Data Pipeline Architecture & Payload Retention

Previously, data ingestion unpacked canonical `PrismResultPayload` objects into isolated scatter plot points, discarding parent run metadata and raw stage structures. UI components and export tools had to heuristically reconstruct run labels and stage arrays on the fly, leading to field drift and missing metadata.

Under the current architecture, data loaders retain the original `PrismResultPayload` directly on ingested data points at load time. This payload flows intact through scatter plot parsing, table row grouping, and action panel handlers. Export and inspection utilities consume this canonical payload directly, eliminating heuristic reconstruction and ensuring exact structural parity between client views and server APIs.
