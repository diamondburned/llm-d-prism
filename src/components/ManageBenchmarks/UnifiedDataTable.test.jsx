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
import { buildBundleForRun } from './UnifiedDataTable.jsx';

describe('UnifiedDataTable buildBundleForRun', () => {
    it('preserves hardware_name when run.hardware is a string and preserves accelerator_count', () => {
        const run = {
            runId: '11111111-1111-4111-8111-111111111111',
            runLabel: 'Benchmark Run String HW',
            model_name: 'qwen3-32b',
            hardware: 'TPU v7x',
            accelerator_count: 4,
            stages: [
                {
                    stageIndex: 0,
                    filename: 'stage_1.yaml',
                    rawReport: {
                        version: '0.2',
                        scenario: {
                            model: 'qwen3-32b',
                            hardware: 'TPU v7x',
                            stack: [
                                {
                                    standardized: {
                                        model: { name: 'qwen3-32b' },
                                        accelerator: { model: 'Unknown' },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        };

        const bundle = buildBundleForRun(run);
        expect(bundle.payload.hardware).toEqual({
            hardware_name: 'TPU v7x',
            accelerator_count: 4,
        });

        const entryRaw = bundle.payload.entries[0].raw_report;
        expect(entryRaw.scenario.stack[0].standardized.accelerator.count).toBe(4);
        expect(entryRaw.scenario.stack[0].standardized.accelerator.model).toBe('TPU v7x');
        expect(entryRaw.scenario.stack[0].standardized.model.name).toBe('qwen3-32b');
    });

    it('infers topology accelerator count when explicit count is absent or 1', () => {
        const run = {
            runId: '22222222-2222-4222-8222-222222222222',
            runLabel: 'Benchmark Run Topology HW',
            model_name: 'meta-llama/Llama-3-70b',
            hardware: 'tpu7x-2x2x1',
            accelerator_count: 1,
            stages: [
                {
                    stageIndex: 0,
                    filename: 'stage_1.yaml',
                    rawReport: {
                        version: '0.2',
                        scenario: {
                            model: 'meta-llama/Llama-3-70b',
                            hardware: 'tpu7x-2x2x1',
                            stack: [
                                {
                                    standardized: {
                                        model: { name: 'meta-llama/Llama-3-70b' },
                                        accelerator: { model: 'Unknown' },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        };

        const bundle = buildBundleForRun(run);
        expect(bundle.payload.hardware).toEqual({
            hardware_name: 'tpu7x-2x2x1',
            accelerator_count: 4,
        });

        const entryRaw = bundle.payload.entries[0].raw_report;
        expect(entryRaw.scenario.stack[0].standardized.accelerator.count).toBe(4);
        expect(entryRaw.scenario.stack[0].standardized.accelerator.model).toBe('tpu7x-2x2x1');
    });

    it('preserves hardware object and mutates raw_report entries with resolved metadata', () => {
        const run = {
            runId: '33333333-3333-4333-8333-333333333333',
            runLabel: 'Benchmark Run Object HW',
            model_name: 'meta-llama/Llama-3-8b',
            hardware: {
                hardware_name: 'TPU v6e',
                accelerator_count: 8,
            },
            stages: [
                {
                    stageIndex: 0,
                    filename: 'stage_1.yaml',
                    rawReport: JSON.stringify({
                        version: '0.2',
                        scenario: {
                            model: 'old-model',
                            hardware: 'old-hardware',
                        },
                    }),
                },
            ],
        };

        const bundle = buildBundleForRun(run);
        expect(bundle.payload.hardware).toEqual({
            hardware_name: 'TPU v6e',
            accelerator_count: 8,
        });
        expect(bundle.payload.model_name).toBe('meta-llama/Llama-3-8b');

        const entryRaw = bundle.payload.entries[0].raw_report;
        expect(entryRaw.scenario.stack[0].standardized.accelerator.count).toBe(8);
        expect(entryRaw.scenario.stack[0].standardized.accelerator.model).toBe('TPU v6e');
        expect(entryRaw.scenario.stack[0].standardized.model.name).toBe('meta-llama/Llama-3-8b');
    });
});
