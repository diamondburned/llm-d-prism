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
import yaml from 'js-yaml';
import {
    getRawPrismCloudPayload,
    syncMetadataToStageRawReport,
    serializeRawReportToYaml,
} from './brv02Exporter.js';

describe('brv02Exporter', () => {
    describe('getRawPrismCloudPayload', () => {
        it('properly extracts hardware.hardware_name as a string and hardware.accelerator_count as a number when hardware is an object', () => {
            const stat = {
                runId: '11111111-1111-4111-8111-111111111111',
                runLabel: 'Test Object Hardware Run',
                model: 'qwen3-32b',
                hardware: { hardware_name: 'TPU v7x', accelerator_count: 4 },
                data: [{
                    prism_stage_index: 0,
                    raw_report: {
                        version: '0.2',
                        scenario: {
                            stack: [{
                                standardized: {
                                    model: { name: 'qwen3-32b' },
                                    accelerator: { model: 'Unknown' },
                                },
                            }],
                        },
                    },
                }],
            };

            const payload = getRawPrismCloudPayload(stat);
            expect(payload.hardware).toEqual({
                hardware_name: 'TPU v7x',
                accelerator_count: 4,
            });
            expect(typeof payload.hardware.hardware_name).toBe('string');
            expect(typeof payload.hardware.accelerator_count).toBe('number');
        });
    });

    describe('syncMetadataToStageRawReport and export serialization', () => {
        it('exports a payload where hardware: { hardware_name: "TPU v7x", accelerator_count: 4 } and raw_report has no accelerator.count, producing YAML with accelerator.count: 4 and accelerator.model: "TPU v7x"', () => {
            const payload = {
                runId: '22222222-2222-4222-8222-222222222222',
                runLabel: 'Sync Explicit Count',
                model_name: 'qwen3-32b',
                hardware: { hardware_name: 'TPU v7x', accelerator_count: 4 },
            };

            const rawReport = {
                version: '0.2',
                scenario: {
                    stack: [{
                        standardized: {
                            role: 'aggregate',
                            model: { name: 'qwen3-32b' },
                            accelerator: { model: 'Unknown' },
                        },
                    }],
                },
            };

            const synced = syncMetadataToStageRawReport(rawReport, payload);
            const yamlStr = serializeRawReportToYaml(synced);
            const parsedBack = yaml.load(yamlStr);

            expect(parsedBack.scenario.stack[0].standardized.accelerator.model).toBe('TPU v7x');
            expect(parsedBack.scenario.stack[0].standardized.accelerator.count).toBe(4);
        });

        it('exports a payload where hardware: { hardware_name: "TPU v7x" } (no accelerator_count) and raw_report has accelerator: { model: "tpu7x-2x2x1" }, preserving/setting accelerator.count: 4 in exported YAML', () => {
            const payload = {
                runId: '33333333-3333-4333-8333-333333333333',
                runLabel: 'Sync Topology Count',
                model_name: 'qwen3-32b',
                hardware: { hardware_name: 'TPU v7x' },
            };

            const rawReport = {
                version: '0.2',
                scenario: {
                    stack: [{
                        standardized: {
                            role: 'aggregate',
                            model: { name: 'qwen3-32b' },
                            accelerator: { model: 'tpu7x-2x2x1' },
                        },
                    }],
                },
            };

            const synced = syncMetadataToStageRawReport(rawReport, payload);
            const yamlStr = serializeRawReportToYaml(synced);
            const parsedBack = yaml.load(yamlStr);

            expect(parsedBack.scenario.stack[0].standardized.accelerator.model).toBe('TPU v7x');
            expect(parsedBack.scenario.stack[0].standardized.accelerator.count).toBe(4);
        });
    });
});
