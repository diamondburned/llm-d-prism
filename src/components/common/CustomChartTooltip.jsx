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

import React from 'react';
import { Row } from './Row';
import { normalizeQualityModelName } from '../../utils/qualityParser';
import { getAcceleratorCount } from '../../utils/dashboardHelpers';

// Find the baseline Y at the nearest baseline point to a target X. Used to
// compute %diff for non-baseline points hovered on the scatter chart.
const baselineYNearX = (baselineSeries, targetX) => {
    if (!baselineSeries || baselineSeries.length === 0 || targetX == null) return null;
    let best = baselineSeries[0];
    let bestDelta = Math.abs(best.vx - targetX);
    for (let i = 1; i < baselineSeries.length; i++) {
        const d = Math.abs(baselineSeries[i].vx - targetX);
        if (d < bestDelta) {
            best = baselineSeries[i];
            bestDelta = d;
        }
    }
    return best.vy;
};

const yMetricIsHigherBetter = (yLabel) => {
    if (!yLabel) return null;
    const l = yLabel.toLowerCase();
    if (l.includes('cost')) return false;
    if (l.includes('latency') || l.includes('time') || l.includes('ttft') || l.includes('tpot') || l.includes('itl')) return false;
    // Throughput, QPS, quality scores — higher is better.
    return true;
};

const getRightBoundaryLimit = (el) => {
    let rightLimit = window.innerWidth;

    // 1. If popover is inside a dialog/drawer, clip to that dialog's right edge
    const containingDialog = el.closest('.fixed.right-4, .fixed.right-0, [role="dialog"]');
    if (containingDialog) {
        return containingDialog.getBoundingClientRect().right - 12;
    }

    // 2. If a right-side sidebar/panel is visible on screen, use its left edge
    const rightSidebars = document.querySelectorAll('.fixed.right-4, .fixed.right-0, aside.right-0');
    for (const sidebar of rightSidebars) {
        const sRect = sidebar.getBoundingClientRect();
        if (sRect.width > 0 && sRect.left > 200 && sRect.left < rightLimit) {
            rightLimit = sRect.left;
        }
    }

    // 3. Fallback to chart container right edge if smaller
    const chartContainer = el.closest('.relative');
    if (chartContainer) {
        const cRect = chartContainer.getBoundingClientRect();
        if (cRect.right > 0 && cRect.right < rightLimit) {
            rightLimit = cRect.right;
        }
    }

    return rightLimit - 12;
};

const getLeftBoundaryLimit = (el) => {
    let leftLimit = 12;

    const containingDialog = el.closest('.fixed.right-4, .fixed.right-0, [role="dialog"]');
    if (containingDialog) {
        return containingDialog.getBoundingClientRect().left + 12;
    }

    const chartContainer = el.closest('.relative');
    if (chartContainer) {
        const cRect = chartContainer.getBoundingClientRect();
        if (cRect.left > leftLimit) {
            leftLimit = cRect.left + 12;
        }
    }

    return leftLimit;
};

export const CustomChartTooltip = ({ active, payload, label, xLabel, yLabel, qualityMetrics, baselineBenchmarkKey, baselineSeries, isPinned, pinnedPayload, pinnedLabel, coordinate }) => {
    const effectivePayload = (isPinned && pinnedPayload && pinnedPayload.length) ? pinnedPayload : payload;
    const effectiveLabel = (isPinned && pinnedLabel !== undefined) ? pinnedLabel : label;

    const tooltipRef = React.useRef(null);
    const [flipLeft, setFlipLeft] = React.useState(false);

    React.useLayoutEffect(() => {
        if (!tooltipRef.current) return;
        const el = tooltipRef.current;
        const rect = el.getBoundingClientRect();

        const rightLimit = getRightBoundaryLimit(el);
        const leftLimit = getLeftBoundaryLimit(el);

        if (!flipLeft) {
            const flippedLeft = rect.left - rect.width - 24;
            if (rect.right > rightLimit && flippedLeft >= leftLimit) {
                setFlipLeft(true);
            }
        } else {
            const unflippedRight = rect.right + rect.width + 24;
            if (rect.left < leftLimit || unflippedRight <= rightLimit) {
                setFlipLeft(false);
            }
        }
    }, [active, isPinned, effectivePayload, effectiveLabel, coordinate, flipLeft]);

    if ((!active && !isPinned) || !effectivePayload || !effectivePayload.length) return null;

    // Sort payload by value (descending)
    const sortedPayload = [...effectivePayload].sort((a, b) => b.value - a.value);
    const higherIsBetter = yMetricIsHigherBetter(yLabel);

    return (
        <div
            ref={tooltipRef}
            className="bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700/50 rounded-xl shadow-2xl p-2.5 min-w-[260px] backdrop-blur-md text-slate-900 dark:text-slate-100 z-[100000]"
            style={flipLeft ? { transform: 'translateX(calc(-100% - 24px))' } : undefined}
        >
            <div className="space-y-2">
                {sortedPayload.map((entry, index) => {
                     const d = entry.payload;
                     const meta = d.metadata || {};
                     const config = meta.configuration || d.configuration;
                     const hardware = d.hardware || meta.hardware;
                     const machine = d.machine_type || meta.machine_type;
                     const accelerator = d.accelerator_type || meta.accelerator_type || meta.accelerator;
                     const chips = meta.accelerator_count || d.accelerator_count || getAcceleratorCount(d);
                     const tp = d.tp || meta.tensor_parallelism || d.tensor_parallelism;
                     const rawIsl = d.workload?.input_tokens ?? d.isl ?? meta.input_seq_len;
                     const rawOsl = d.workload?.output_tokens ?? d.osl ?? meta.output_seq_len;
                     const formatSeqNum = (val) => {
                         if (val == null || val === '' || isNaN(Number(val))) return null;
                         const n = Number(val);
                         return Number.isInteger(n) ? n.toString() : Number(n.toFixed(2)).toString();
                     };
                     const isl = formatSeqNum(rawIsl);
                     const osl = formatSeqNum(rawOsl);
                     const seqLen = (isl && osl) ? `${isl} / ${osl}` : null;
                     
                     // Format X-Value logic
                     const formattedXValue = (() => {
                        const val = Number(label);
                        if (isNaN(val)) return label;
                        const isMs = xLabel.toLowerCase().includes('time') || xLabel.toLowerCase().includes('lat');
                         if (isMs && Math.abs(val) >= 1000) {
                              return (val / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' s';
                         }
                        return val.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (isMs ? ' ms' : '');
                    })();

                     // Determine if Disaggregated
                     const isDisaggregated = (meta.prefill_node_count > 0 || meta.decode_node_count > 0);

                    return (
                        <div key={index} className="flex flex-col">
                             {/* Series Header */}
                            <div className="flex items-start justify-between gap-2.5 pb-0.5">
                                 <div className="flex items-start gap-2 min-w-0 flex-1">
                                     <div className="w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 shadow-sm" style={{ backgroundColor: entry.color, boxShadow: `0 0 6px ${entry.color}60` }} />
                                     <div className="flex-1 overflow-hidden">
                                         <h4 className="font-bold text-xs leading-tight truncate" title={d.model}>
                                            {d.model_name || d.model}
                                         </h4>
                                         {((hardware && hardware !== 'Unknown') || (machine && machine !== hardware)) && (
                                             <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate leading-tight mt-0.5">
                                                {hardware !== 'Unknown' ? hardware : ''} 
                                                {machine && machine !== hardware ? ` • ${machine}` : ''}
                                             </div>
                                         )}
                                     </div>
                                 </div>
                            </div>

                            {/* Metadata Rows */}
                            <Row label="Accelerator" value={accelerator || hardware} />
                            {isDisaggregated ? (
                               <Row label="Nodes (P/D)" value={`P:${meta.prefill_node_count}(TP${meta.prefill_tp}) | D:${meta.decode_node_count}(TP${meta.decode_tp})`} />
                            ) : (
                               <>
                                   <Row label="Chips" value={chips} />
                                   <Row label="TP" value={tp} />
                                   {config && config !== 'Unknown' && <Row label="Config" value={config} />}
                               </>
                            )}
                            <Row label="Seq Len (I/O)" value={seqLen} />

                            {/* Chart Metric Rows */}
                            <Row label={xLabel} value={formattedXValue} />
                            <Row
                                label={yLabel}
                                value={
                                    <>
                                        {Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        {yLabel.includes('Cost') && d.metrics?.cost?.source === 'derived_constant_product' && (
                                            <span className="text-[10px] text-amber-500 ml-1 font-normal align-top">(Est)</span>
                                        )}
                                    </>
                                }
                            />

                            {/* %diff vs baseline */}
                            {(() => {
                                if (!baselineBenchmarkKey || !baselineSeries || baselineSeries.length === 0) return null;
                                if (d.benchmarkKey === baselineBenchmarkKey) {
                                    return (
                                        <div className="flex justify-between items-center text-xs leading-tight py-0.5">
                                            <span className="text-cyan-500 dark:text-cyan-400 font-bold uppercase tracking-wider">★ Baseline</span>
                                        </div>
                                    );
                                }
                                const baseY = baselineYNearX(baselineSeries, d.vx);
                                if (baseY == null || baseY === 0) return null;
                                const diff = ((Number(entry.value) - baseY) / Math.abs(baseY)) * 100;
                                const isNeutral = Math.abs(diff) < 0.1;
                                const isImprovement = higherIsBetter === null ? null : (higherIsBetter ? diff > 0 : diff < 0);
                                const color = isNeutral
                                    ? 'text-slate-400'
                                    : isImprovement === null
                                        ? 'text-slate-400'
                                        : isImprovement
                                            ? 'text-emerald-500 dark:text-emerald-400'
                                            : 'text-red-500 dark:text-red-400';
                                return (
                                    <div className="flex justify-between items-center text-xs leading-tight py-0.5">
                                        <span className="text-slate-500 dark:text-slate-400 font-normal">vs baseline:</span>
                                        <span className={`font-mono text-xs font-bold ${color}`}>
                                            {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                                        </span>
                                    </div>
                                );
                            })()}
                            
                            {/* Quality Metrics */}
                            {(() => {
                                const normModel = normalizeQualityModelName(d.model);
                                const qData = qualityMetrics?.data?.[normModel];
                                if (!qData) return null;

                                const formatLabel = (key) => {
                                    return key
                                        .replace(/_/g, ' ')
                                        .replace(/\b\w/g, l => l.toUpperCase())
                                        .replace('Mmlu', 'MMLU')
                                        .replace('Live Code Bench', 'LiveCodeBench');
                                };

                                return (
                                    <>
                                        {Object.entries(qData).map(([key, value]) => {
                                            if (key === 'timestamp' || key === 'id') return null;
                                            const isPercentage = key.includes('mmlu') || key.includes('bench');
                                            const displayValue = isPercentage ? `${value}%` : value;
                                            return <Row key={key} label={formatLabel(key)} value={displayValue || 'N/A'} />;
                                        })}
                                    </>
                                );
                            })()}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
