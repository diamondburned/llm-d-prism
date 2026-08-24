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
import { parseReportV02, stageToEntry } from './benchmarkReportV02Parser.js';

const createReport = (throughput) => ({
    version: '0.2',
    scenario: {
        stack: [{
            standardized: {
                role: 'aggregate',
                model: { name: 'test-model' },
                accelerator: { model: 'H100', count: 1 },
            },
        }],
        load: { standardized: { tool: 'vllm' } },
    },
    results: {
        request_performance: {
            aggregate: { throughput },
        },
    },
});

const parseRates = (throughput) => {
    const stage = parseReportV02(createReport(throughput), 'report.yaml');
    expect(stage).toBeDefined();
    return { stage, entry: stageToEntry(stage) };
};

describe('benchmarkReportV02Parser token rates', () => {
    it('preserves and normalizes reported token rates in BR v0.2', () => {
        const { stage, entry } = parseRates({
            input_token_rate: { mean: 80 },
            output_token_rate: { mean: 20 },
            total_token_rate: { mean: 105 },
        });

        expect(stage.performance.totalTokenRate).toBe(105);
        expect(entry.metrics.input_tput).toBe(80);
        expect(entry.metrics.output_tput).toBe(20);
        expect(entry.metrics.total_tput).toBe(105);
    });

    it('derives total token rate when it is absent in BR v0.2', () => {
        const { entry } = parseRates({
            input_token_rate: { mean: 80 },
            output_token_rate: { mean: 20 },
        });

        expect(entry.metrics.total_tput).toBe(100);
    });

    it('derives input token rate from total and output rates in BR v0.2', () => {
        const { entry } = parseRates({
            output_token_rate: { mean: 20 },
            total_token_rate: { mean: 100 },
        });

        expect(entry.metrics.input_tput).toBe(80);
    });

    it('leaves rates null when fallback inputs are insufficient or invalid in BR v0.2', () => {
        const missingTotal = parseRates({ output_token_rate: { mean: 20 } });
        expect(missingTotal.entry.metrics.input_tput).toBe(null);
        expect(missingTotal.entry.metrics.total_tput).toBe(null);

        const inconsistent = parseRates({
            output_token_rate: { mean: 20 },
            total_token_rate: { mean: 10 },
        });
        expect(inconsistent.entry.metrics.input_tput).toBe(null);
        expect(inconsistent.entry.metrics.total_tput).toBe(10);
    });

    it('preserves zero and coerces numeric strings in token-rate normalization', () => {
        const { stage, entry } = parseRates({
            input_token_rate: { mean: '0' },
            output_token_rate: { mean: '20.5' },
        });

        expect(stage.performance.inputTokenRate).toBe(0);
        expect(stage.performance.outputTokenRate).toBe(20.5);
        expect(entry.metrics.input_tput).toBe(0);
        expect(entry.metrics.total_tput).toBe(20.5);
    });
});
