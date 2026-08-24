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
import { mutateRawReportMetadata, compareOriginalStageOrder } from './benchmarkReportV02Parser.js';

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
});
