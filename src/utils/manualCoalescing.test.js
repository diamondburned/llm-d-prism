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

import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { validatePrismUploadStructure } from './benchmarkValidator.js';
import { PrismResultPayloadSchema } from '../../server/results/api.ts';
import { mutateRawReportMetadata, compareOriginalStageOrder, getOriginalStageIndex, parseReportV02, groupStagesIntoRuns, stageToEntry } from './benchmarkReportV02Parser.js';

describe('manual benchmark coalescing', () => {
    it('validates coalesced payload schema with prism_stage_index', () => {
        const samplePayload = {
            runId: uuidv4(),
            runLabel: "Coalesced uBench Multi-Stage Run",
            model_name: "meta-llama/Llama-3-8B-Instruct",
            hardware: {
                hardware_name: "H100",
                accelerator_count: 8
            },
            format: "brv02",
            entries: [
                {
                    run_id: uuidv4(),
                    run_description: "Coalesced uBench Multi-Stage Run",
                    filename: "stage_0_report.yaml",
                    prism_stage_index: 0,
                    raw_report: {
                        version: "0.2",
                        workload: { stage: 0 },
                        run: { uid: "ubench-stage-0" },
                        scenario: { model: "meta-llama/Llama-3-8B-Instruct" },
                        results: {
                            request_performance: {
                                aggregate: {
                                    throughput: { output_token_rate: { mean: 45.2 } },
                                    latency: { request_latency: { mean: 0.25 }, time_to_first_token: { mean: 0.1 }, time_per_output_token: { mean: 0.02 } }
                                }
                            }
                        }
                    }
                },
                {
                    run_id: uuidv4(),
                    run_description: "Coalesced uBench Multi-Stage Run",
                    filename: "stage_1_report.yaml",
                    prism_stage_index: 1,
                    raw_report: {
                        version: "0.2",
                        workload: { stage: 1 },
                        run: { uid: "ubench-stage-1" },
                        scenario: { model: "meta-llama/Llama-3-8B-Instruct" },
                        results: {
                            request_performance: {
                                aggregate: {
                                    throughput: { output_token_rate: { mean: 55.0 } },
                                    latency: { request_latency: { mean: 0.22 }, time_to_first_token: { mean: 0.09 }, time_per_output_token: { mean: 0.018 } }
                                }
                            }
                        }
                    }
                }
            ]
        };

        const parseResult = PrismResultPayloadSchema.safeParse(samplePayload);
        expect(parseResult.success).toBe(true);
        expect(samplePayload.entries[0].prism_stage_index).toBe(0);
        expect(samplePayload.entries[1].prism_stage_index).toBe(1);

        const structValidation = validatePrismUploadStructure(samplePayload, { isUpload: false });
        expect(structValidation.isValid).toBe(true);
    });

    it('ensures raw report immutability during stage re-indexing', () => {
        const rawReport = {
            version: "0.2",
            workload: { stage: 0 },
            results: { throughput: 45.2 }
        };
        const entries = [
            { run_id: "e1", filename: "s0.yaml", prism_stage_index: 0, raw_report: { ...rawReport } },
            { run_id: "e2", filename: "s1.yaml", prism_stage_index: 1, raw_report: { ...rawReport } }
        ];

        const rawReportBefore0 = { ...entries[0].raw_report };
        const reindexed = entries.map((entry, idx) => ({
            ...entry,
            prism_stage_index: 1 - idx
        }));

        expect(reindexed[0].raw_report).toEqual(rawReportBefore0);
        expect(reindexed[0].prism_stage_index).toBe(1);
        expect(reindexed[1].prism_stage_index).toBe(0);
    });

    it('groups candidate runs using auto-grouping heuristics', () => {
        const runA = {
            id: "run-1",
            payload: {
                model_name: "meta-llama/Llama-3-8B-Instruct",
                hardware: { hardware_name: "H100", accelerator_count: 8 },
                inference_tool: "vllm"
            }
        };
        const runB = {
            id: "run-2",
            payload: {
                model_name: "meta-llama/Llama-3-8B-Instruct",
                hardware: { hardware_name: "H100", accelerator_count: 8 },
                inference_tool: "vllm"
            }
        };
        const runC = {
            id: "run-3",
            payload: {
                model_name: "Qwen/Qwen2.5-7B",
                hardware: { hardware_name: "TPU v6e", accelerator_count: 4 },
                inference_tool: "tgi"
            }
        };

        const bundles = [runA, runB, runC];
        const groupsMap = new Map();
        bundles.forEach(bundle => {
            const m = (bundle.payload?.model_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const h = (bundle.payload?.hardware?.hardware_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const tool = (bundle.payload?.inference_tool || '').toLowerCase().trim();
            const key = `${m}::${h}::${tool}`;

            if (!groupsMap.has(key)) {
                groupsMap.set(key, [bundle]);
            } else {
                groupsMap.get(key).push(bundle);
            }
        });

        expect(groupsMap.size).toBe(2);
        const matchingGroup = Array.from(groupsMap.values()).find(g => g.length === 2);
        expect(matchingGroup).toBeDefined();
        expect(matchingGroup.length).toBe(2);
        expect(matchingGroup[0].id).toBe("run-1");
        expect(matchingGroup[1].id).toBe("run-2");
    });

    it('sorts stages by original BRV02 stage number', () => {
        const unsortedEntries = [
            { filename: "stage_9_report.yaml", raw_report: { workload: { stage: 9 } } },
            { filename: "stage_3_report.yaml", raw_report: { workload: { stage: 3 } } },
            { filename: "stage_8_report.yaml", raw_report: { workload: { stage: 8 } } },
            { filename: "stage_5_report.yaml", raw_report: { workload: { stage: 5 } } }
        ];

        unsortedEntries.sort(compareOriginalStageOrder);
        unsortedEntries.forEach((entry, idx) => {
            entry.prism_stage_index = idx;
        });

        expect(unsortedEntries[0].raw_report.workload.stage).toBe(3);
        expect(unsortedEntries[0].prism_stage_index).toBe(0);

        expect(unsortedEntries[1].raw_report.workload.stage).toBe(5);
        expect(unsortedEntries[1].prism_stage_index).toBe(1);

        expect(unsortedEntries[2].raw_report.workload.stage).toBe(8);
        expect(unsortedEntries[2].prism_stage_index).toBe(2);

        expect(unsortedEntries[3].raw_report.workload.stage).toBe(9);
        expect(unsortedEntries[3].prism_stage_index).toBe(3);
    });

    it('synchronizes metadata mutations across raw_report fields', () => {
        const brv02Report = {
            version: "0.2",
            run: { uid: "stage-uid-123", description: "Old Run Description" },
            scenario: {
                stack: [
                    {
                        standardized: {
                            role: "aggregate",
                            model: { name: "qwen3_coder_480b_a35b_instruct-fp8_8k_1k_inference_perf" },
                            accelerator: { model: "Old Hardware" }
                        }
                    }
                ],
                load: {
                    native: {
                        config: {
                            server: { model_name: "qwen3_coder_480b_a35b_instruct-fp8_8k_1k_inference_perf" }
                        }
                    }
                }
            }
        };

        const updatedReport = mutateRawReportMetadata(brv02Report, {
            model_name: "qwen3_coder_480b",
            hardware_name: "H100",
            runLabel: "Unified Coalesced Run"
        });

        expect(updatedReport.run.uid).toBe("stage-uid-123");
        expect(updatedReport.run.description).toBe("Unified Coalesced Run");
        expect(updatedReport.scenario.stack[0].standardized.model.name).toBe("qwen3_coder_480b");
        expect(updatedReport.scenario.load.native.config.server.model_name).toBe("qwen3_coder_480b");
        expect(updatedReport.scenario.stack[0].standardized.accelerator.model).toBe("H100");
    });

    it('preserves all stages with identical filenames during coalesce staging without dropping or summing metrics', async () => {
        const coalescedRunId = uuidv4();
        const stageConfigs = [
            { concurrency: 16, tput: 500.0, tpotSec: 0.040, uid: "ubench-run-c16" },
            { concurrency: 32, tput: 1000.0, tpotSec: 0.080, uid: "ubench-run-c32" },
            { concurrency: 64, tput: 1500.0, tpotSec: 0.173, uid: "ubench-run-c64" }
        ];

        // All 3 stage reports come from separate runs with the exact same filename
        const entries = stageConfigs.map((cfg, idx) => ({
            run_id: uuidv4(),
            run_description: "Coalesced uBench Suite",
            filename: "llmd_benchmark_report.json",
            prism_stage_index: idx,
            raw_report: {
                version: "0.2",
                run: { uid: cfg.uid, description: "Coalesced uBench Suite" },
                scenario: {
                    stack: [
                        {
                            standardized: {
                                role: "aggregate",
                                model: { name: "meta-llama/Llama-3-8B-Instruct" },
                                accelerator: { model: "TPU v6e", count: 4 }
                            }
                        }
                    ],
                    load: {
                        standardized: {
                            tool: "vllm",
                            concurrency: cfg.concurrency
                        }
                    }
                },
                results: {
                    request_performance: {
                        aggregate: {
                            throughput: { output_token_rate: { mean: cfg.tput } },
                            latency: {
                                request_latency: { mean: 0.5 },
                                time_to_first_token: { mean: 0.05 },
                                time_per_output_token: { mean: cfg.tpotSec }
                            }
                        }
                    }
                }
            }
        }));

        // Simulate handleValidatedUpload stage extraction and deduplication logic
        const trulyNewStages = [];
        for (let idx = 0; idx < entries.length; idx++) {
            const entry = entries[idx];
            const record = await parseReportV02(entry.raw_report, entry.filename);
            expect(record).toBeDefined();

            record.runId = coalescedRunId;
            record.runLabel = "Coalesced uBench Suite";
            record.run_id = entry.run_id;
            record.prism_stage_index = entry.prism_stage_index !== undefined ? entry.prism_stage_index : idx;
            if (record.stageIndex === null || record.stageIndex === undefined) {
                record.stageIndex = record.prism_stage_index;
            }
            if (record.workload) {
                record.workload.stage = record.prism_stage_index;
            }

            const isDupInBatch = trulyNewStages.some(s => {
                if (s.runId !== record.runId) return false;
                if (s.run_id && record.run_id) return s.run_id === record.run_id;
                if (s.prism_stage_index !== undefined && record.prism_stage_index !== undefined) {
                    return s.prism_stage_index === record.prism_stage_index && s.filename === record.filename;
                }
                return s.filename === record.filename;
            });

            if (!isDupInBatch) {
                trulyNewStages.push(record);
            }
        }

        // Verify that NO stages were dropped due to sharing filename "llmd_benchmark_report.json"
        expect(trulyNewStages.length).toBe(3);

        // Group into runs
        const groupedRuns = groupStagesIntoRuns(trulyNewStages);
        expect(groupedRuns.length).toBe(1);
        const run = groupedRuns[0];
        expect(run.runId).toBe(coalescedRunId);
        expect(run.stages.length).toBe(3);

        // Convert each stage to entry (as useDashboardData does for scatter chart and tables)
        const entriesForDashboard = run.stages.map(stageToEntry);
        expect(entriesForDashboard.length).toBe(3);

        // Verify each stage preserves its distinct metrics without summation
        expect(entriesForDashboard[0].throughput).toBe(500.0);
        expect(entriesForDashboard[0].time_per_output_token).toBe(40.0); // 0.040s converted to 40ms
        expect(entriesForDashboard[0].workload.stage).toBe(0);
        expect(entriesForDashboard[0].prism_stage_index).toBe(0);

        expect(entriesForDashboard[1].throughput).toBe(1000.0);
        expect(entriesForDashboard[1].time_per_output_token).toBe(80.0); // 0.080s converted to 80ms
        expect(entriesForDashboard[1].workload.stage).toBe(1);
        expect(entriesForDashboard[1].prism_stage_index).toBe(1);

        expect(entriesForDashboard[2].throughput).toBe(1500.0);
        expect(entriesForDashboard[2].time_per_output_token).toBe(173.0); // 0.173s converted to 173ms
        expect(entriesForDashboard[2].workload.stage).toBe(2);
        expect(entriesForDashboard[2].prism_stage_index).toBe(2);

        // Ensure metrics are NOT summed into one single row
        expect(entriesForDashboard.map(e => e.time_per_output_token)).toEqual([40.0, 80.0, 173.0]);
        expect(entriesForDashboard.map(e => e.throughput)).toEqual([500.0, 1000.0, 1500.0]);
    });

    it('correctly deduplicates true duplicate entries with identical run_id or prism_stage_index', async () => {
        const runId = uuidv4();
        const stageId = uuidv4();
        const stageRawReport = {
            version: "0.2",
            run: { uid: "duplicate-check-uid" },
            scenario: { stack: [{ standardized: { role: "aggregate", model: { name: "model-x" } } }] },
            results: { request_performance: { aggregate: { throughput: { output_token_rate: { mean: 120 } } } } }
        };

        const firstRecord = await parseReportV02(stageRawReport, "llmd_benchmark_report.json");
        firstRecord.runId = runId;
        firstRecord.run_id = stageId;
        firstRecord.prism_stage_index = 0;

        const duplicateRecord = await parseReportV02(stageRawReport, "llmd_benchmark_report.json");
        duplicateRecord.runId = runId;
        duplicateRecord.run_id = stageId; // Same stage run_id
        duplicateRecord.prism_stage_index = 0;

        const trulyNewStages = [firstRecord];
        const isDup = trulyNewStages.some(s => {
            if (s.runId !== duplicateRecord.runId) return false;
            if (s.run_id && duplicateRecord.run_id) return s.run_id === duplicateRecord.run_id;
            if (s.prism_stage_index !== undefined && duplicateRecord.prism_stage_index !== undefined) {
                return s.prism_stage_index === duplicateRecord.prism_stage_index && s.filename === duplicateRecord.filename;
            }
            return s.filename === duplicateRecord.filename;
        });

        expect(isDup).toBe(true);
    });

    it('prepends original run label to filenames when coalescing runs', () => {
        const bundleA = {
            id: 'bundle-a',
            name: 'vLLM Baseline',
            payload: {
                runLabel: 'vLLM Baseline',
                entries: [
                    { filename: 'llmd_benchmark_report.json', raw_report: { version: '0.2' } }
                ]
            },
            stageFiles: [
                { filename: 'llmd_benchmark_report.json', name: 'llmd_benchmark_report.json' }
            ]
        };

        const bundleB = {
            id: 'bundle-b',
            name: 'SGLang Baseline',
            payload: {
                runLabel: 'SGLang Baseline',
                entries: [
                    { filename: 'llmd_benchmark_report.json', raw_report: { version: '0.2' } }
                ]
            },
            stageFiles: [
                { filename: 'llmd_benchmark_report.json', name: 'llmd_benchmark_report.json' }
            ]
        };

        const targetBundles = [bundleA, bundleB];
        const combinedEntries = [];
        const combinedStageFiles = [];

        targetBundles.forEach(bundle => {
            const originalRunLabel = bundle.payload?.runLabel || bundle.name || bundle.dirKey || '';

            if (bundle.stageFiles) {
                const mappedStageFiles = bundle.stageFiles.map(sf => {
                    const originalName = sf.filename || sf.name || sf.file?.name || '';
                    const newFilename = originalRunLabel && !originalName.startsWith(`${originalRunLabel}/`)
                        ? `${originalRunLabel}/${originalName}`
                        : originalName;
                    return {
                        ...sf,
                        name: newFilename,
                        filename: newFilename
                    };
                });
                combinedStageFiles.push(...mappedStageFiles);
            }

            const entries = bundle.payload?.entries || [];
            entries.forEach(entry => {
                const originalFilePath = entry.filename || entry.run_uid || 'report.json';
                const newFilename = originalRunLabel && !originalFilePath.startsWith(`${originalRunLabel}/`)
                    ? `${originalRunLabel}/${originalFilePath}`
                    : originalFilePath;

                combinedEntries.push({
                    ...entry,
                    filename: newFilename
                });
            });
        });

        expect(combinedEntries[0].filename).toBe('vLLM Baseline/llmd_benchmark_report.json');
        expect(combinedEntries[1].filename).toBe('SGLang Baseline/llmd_benchmark_report.json');
        expect(combinedStageFiles[0].filename).toBe('vLLM Baseline/llmd_benchmark_report.json');
        expect(combinedStageFiles[1].filename).toBe('SGLang Baseline/llmd_benchmark_report.json');

        // Does not double-prepend if already prefixed
        const rePrefixedFilename = bundleA.payload.runLabel && !combinedEntries[0].filename.startsWith(`${bundleA.payload.runLabel}/`)
            ? `${bundleA.payload.runLabel}/${combinedEntries[0].filename}`
            : combinedEntries[0].filename;
        expect(rePrefixedFilename).toBe('vLLM Baseline/llmd_benchmark_report.json');
    });

    it('sorts coalesced stages grouping by run label directory before stage index', () => {
        const entries = [
            { filename: 'vLLM Baseline/stage_1.yaml', raw_report: { workload: { stage: 1 } } },
            { filename: 'vLLM Baseline/stage_0.yaml', raw_report: { workload: { stage: 0 } } },
            { filename: 'SGLang Baseline/stage_1.yaml', raw_report: { workload: { stage: 1 } } },
            { filename: 'SGLang Baseline/stage_0.yaml', raw_report: { workload: { stage: 0 } } }
        ];

        entries.sort(compareOriginalStageOrder);

        expect(entries.map(e => e.filename)).toEqual([
            'SGLang Baseline/stage_0.yaml',
            'SGLang Baseline/stage_1.yaml',
            'vLLM Baseline/stage_0.yaml',
            'vLLM Baseline/stage_1.yaml'
        ]);
    });

    it('extracts stage number from basename even if run label has numbers or stage keywords', () => {
        const entryWithStageInLabel = {
            filename: 'Stage 3 Sweep/stage_0.yaml'
        };
        expect(getOriginalStageIndex(entryWithStageInLabel)).toBe(0);

        const entryWithNumberInLabel = {
            filename: 'Cluster-42/stage-1.json'
        };
        expect(getOriginalStageIndex(entryWithNumberInLabel)).toBe(1);
    });
});
