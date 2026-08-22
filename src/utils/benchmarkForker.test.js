// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import assert from 'node:assert';
import { v4 as uuidv4 } from 'uuid';
import { forkBenchmarkPayload, forkBenchmark } from './benchmarkForker.js';
import { getRawPrismCloudPayload } from './brv02Exporter.js';
import { PrismResultPayloadSchema } from '../../server/results/api.ts';
import { validatePrismUploadStructure } from './benchmarkValidator.js';

console.log('Running benchmark forking unit tests...');

// 1. Single Benchmark Forking Test
const originalRunId = uuidv4();
const originalEntryRunId = uuidv4();
const sampleStat = {
    benchmarkKey: `gcs:team-bucket:${originalRunId}`,
    model: "meta-llama/Llama-3.1-70B-Instruct",
    hardware: "H100",
    accelerator_count: 8,
    data: [
        {
            run_id: originalRunId,
            model: "meta-llama/Llama-3.1-70B-Instruct",
            source: "gcs:team-bucket",
            source_info: {
                type: "benchmark_report_v02",
                bucket: "team-bucket",
                submission_state: "public",
                submitted_at: "2026-08-01T10:00:00Z"
            },
            github_author: {
                username: "octocat",
                name: "Mona Lisa Octocat"
            },
            payload: {
                runId: originalRunId,
                runLabel: "Team Benchmark Baseline",
                model_name: "meta-llama/Llama-3.1-70B-Instruct",
                hardware: {
                    hardware_name: "H100",
                    accelerator_count: 8
                },
                format: "brv02",
                submission_state: "public",
                submitted_at: "2026-08-01T10:00:00Z",
                github_author: {
                    username: "octocat",
                    name: "Mona Lisa Octocat"
                },
                entries: [
                    {
                        run_id: originalEntryRunId,
                        run_description: "Team Benchmark Baseline",
                        filename: "stage_0_report.yaml",
                        prism_stage_index: 0,
                        raw_report: {
                            version: "0.2",
                            workload: { stage: 0 },
                            scenario: { model: "meta-llama/Llama-3.1-70B-Instruct" },
                            results: {
                                request_performance: {
                                    aggregate: {
                                        throughput: { output_token_rate: { mean: 128.5 } },
                                        latency: { request_latency: { mean: 0.25 }, time_to_first_token: { mean: 0.05 } }
                                    }
                                }
                            }
                        }
                    }
                ]
            }
        }
    ]
};

const { payload: forkedPayload, newRunId, forkDetail: singleForkDetail } = forkBenchmarkPayload(sampleStat, sampleStat.data);

// 1.1 Fresh UUIDs generated
assert.ok(forkedPayload.runId, "Forked payload must have a runId");
assert.strictEqual(forkedPayload.runId, newRunId, "Returned newRunId must match payload.runId");
assert.notStrictEqual(forkedPayload.runId, originalRunId, "Forked runId must be freshly generated");
assert.ok(forkedPayload.entries[0].run_id, "Forked entry must have a run_id");
assert.notStrictEqual(forkedPayload.entries[0].run_id, originalEntryRunId, "Forked entry run_id must be freshly generated");

// 1.2 State reset to local staging
assert.strictEqual(forkedPayload.submission_state, "staged", "Forked submission_state must be 'staged'");
assert.strictEqual(forkedPayload.submitted_at, undefined, "submitted_at must be stripped");
assert.strictEqual(forkedPayload.github_author, undefined, "github_author must be stripped");
assert.strictEqual(forkedPayload.review, undefined, "review must be stripped");
assert.strictEqual(forkedPayload.feedback, undefined, "feedback must be stripped");

// 1.3 Provenance metadata populated in root $.forked_from
assert.ok(forkedPayload.forked_from, "Root $.forked_from must be defined");
const forkDetail = Array.isArray(forkedPayload.forked_from) ? forkedPayload.forked_from[0] : forkedPayload.forked_from;
assert.strictEqual(forkDetail.original_run_id, originalRunId);
assert.strictEqual(forkDetail.original_run_label, "Team Benchmark Baseline");
assert.strictEqual(forkDetail.source_bucket, "team-bucket");
assert.deepStrictEqual(forkDetail.original_author, { username: "octocat", name: "Mona Lisa Octocat" });
assert.ok(forkDetail.forked_at, "forked_at must be an ISO timestamp");
assert.deepStrictEqual(forkDetail, singleForkDetail);

// 1.4 Raw reports remain intact and unmodified
assert.deepStrictEqual(
    forkedPayload.entries[0].raw_report,
    sampleStat.data[0].payload.entries[0].raw_report,
    "Raw report dictionary must remain strictly intact"
);

// 1.5 Zod & structure validation tests
const zodResult = PrismResultPayloadSchema.safeParse(forkedPayload);
assert.strictEqual(zodResult.success, true, `Zod schema validation failed: ${JSON.stringify(zodResult.error?.issues)}`);

const structValidation = validatePrismUploadStructure(forkedPayload, { isUpload: false });
assert.strictEqual(structValidation.isValid, true, `Structure validation failed: ${structValidation.errors?.join(', ')}`);

// 2. Lineage Chaining Test (Forking an already forked benchmark)
const secondStat = {
    benchmarkKey: `brv02:${forkedPayload.runId}`,
    payload: forkedPayload,
    data: [
        {
            run_id: forkedPayload.runId,
            source: `brv02:${forkedPayload.runId}`,
            source_info: {
                type: "benchmark_report_v02",
                bucket: "custom-writable-bucket"
            },
            github_author: { username: "contributor2" },
            payload: forkedPayload
        }
    ]
};

const { payload: secondForkedPayload } = forkBenchmarkPayload(secondStat, secondStat.data);

assert.ok(Array.isArray(secondForkedPayload.forked_from), "Re-forked benchmark should have an array forked_from lineage");
assert.strictEqual(secondForkedPayload.forked_from.length, 2, "Lineage should chain both origins");
assert.strictEqual(secondForkedPayload.forked_from[0].original_run_id, originalRunId);
assert.strictEqual(secondForkedPayload.forked_from[1].original_run_id, forkedPayload.runId);

const zodResult2 = PrismResultPayloadSchema.safeParse(secondForkedPayload);
assert.strictEqual(zodResult2.success, true, `Zod validation failed for array forked_from: ${JSON.stringify(zodResult2.error?.issues)}`);

// 3. Bundle Builder & forkBenchmark Function Test
const { bundle, payload: resultPayload } = forkBenchmark(sampleStat, sampleStat.data);
assert.ok(bundle, "forkBenchmark must return a bundle");
assert.ok(resultPayload, "forkBenchmark must return payload");
assert.strictEqual(bundle.payload.runId, resultPayload.runId);
assert.strictEqual(bundle.validation.isValid, true);
assert.ok(bundle.stageFiles.length > 0, "bundle should contain stageFiles");

// 4. Raw payload reconstruction preserves forked_from
const reconstructedSingle = getRawPrismCloudPayload(secondStat, secondStat.data);
assert.ok(reconstructedSingle.forked_from, "getRawPrismCloudPayload must preserve single forked_from");
assert.strictEqual(reconstructedSingle.forked_from.original_run_id, originalRunId);

const reconstructedChained = getRawPrismCloudPayload({ data: [{ forked_from: secondForkedPayload.forked_from, raw_report: {} }] });
assert.ok(Array.isArray(reconstructedChained.forked_from), "getRawPrismCloudPayload must preserve chained array forked_from");
assert.strictEqual(reconstructedChained.forked_from.length, 2);

// 5. Submission payload construction preserves forked_from and validates against schema
const submissionPayload = {
    runId: bundle.payload.runId,
    runLabel: bundle.name,
    model_name: bundle.payload.model_name,
    hardware: bundle.payload.hardware,
    forked_from: bundle.payload.forked_from,
    format: "brv02",
    entries: bundle.payload.entries.map(e => ({
        run_id: e.run_id,
        run_description: bundle.name,
        filename: e.filename,
        raw_report: e.raw_report
    }))
};
const submissionZod = PrismResultPayloadSchema.safeParse(submissionPayload);
assert.strictEqual(submissionZod.success, true, `Submission payload schema validation failed: ${JSON.stringify(submissionZod.error?.issues)}`);

// 6. Test groupStagesIntoRuns and stageToEntry preserve forked_from
import { groupStagesIntoRuns, stageToEntry } from './benchmarkReportV02Parser.js';
import { PrismResultContextSchema } from '../../server/results/api.ts';

const groupedRuns = groupStagesIntoRuns([
    {
        runId: forkedPayload.runId,
        runLabel: "Forked Run",
        filename: "stage_0_report.yaml",
        model_name: "meta-llama/Llama-3.1-70B-Instruct",
        forked_from: forkedPayload.forked_from,
        github_author: { username: "author1" },
        scenario: { model: "meta-llama/Llama-3.1-70B-Instruct", hardware: "H100" },
        performance: { outputTokenRate: 100, e2eMean: 0.2, ttftMean: 0.05 },
        rawReport: {}
    }
]);
assert.strictEqual(groupedRuns.length, 1);
assert.ok(groupedRuns[0].forked_from, "groupStagesIntoRuns must preserve forked_from");
assert.strictEqual(groupedRuns[0].forked_from.original_run_id, originalRunId);
assert.strictEqual(groupedRuns[0].github_author.username, "author1");

const entry = stageToEntry(groupedRuns[0].stages[0]);
assert.ok(entry.forked_from, "stageToEntry must preserve forked_from");
assert.strictEqual(entry.forked_from.original_run_id, originalRunId);

// 7. Test PrismResultContextSchema accepts boolean forked flag
const contextValidation = PrismResultContextSchema.safeParse({
    submission_state: { value: "submitted_pending_review" },
    github_user: { value: "octocat" },
    run_id: { value: forkedPayload.runId },
    hardware_name: { value: "H100" },
    model_name: { value: "meta-llama/Llama-3.1-70B-Instruct" },
    run_label: { value: "Forked Run" },
    forked: { value: "true" }
});
assert.strictEqual(contextValidation.success, true, "PrismResultContextSchema must accept forked");

console.log('All benchmark forking unit tests passed successfully!');
