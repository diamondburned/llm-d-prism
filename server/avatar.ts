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

import { Router, Request, Response } from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Avatar from 'boring-avatars';
import { isPlaygroundMode } from './iam.ts';

export const avatarRouter = Router();

export const PRISM_AVATAR_COLORS = [
    '#06b6d4', // Cyan
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#f59e0b', // Amber
];

const VALID_VARIANTS = new Set(['marble', 'beam', 'pixel', 'sunset', 'ring', 'bauhaus']);

/**
 * Deterministically generates an SVG avatar for a given seed string using boring-avatars.
 */
export function generateSvgAvatar(
    seed: string,
    variant: 'marble' | 'beam' | 'pixel' | 'sunset' | 'ring' | 'bauhaus' = 'beam',
    size = 80
): string {
    const cleanSeed = (seed || 'anonymous').trim();
    const effectiveVariant = VALID_VARIANTS.has(variant) ? variant : 'beam';

    return renderToStaticMarkup(
        React.createElement(Avatar as any, {
            size,
            name: cleanSeed,
            variant: effectiveVariant,
            colors: PRISM_AVATAR_COLORS,
        })
    );
}

/**
 * GET /api/avatar/:seed
 * GET /api/avatar
 * Returns a deterministic SVG avatar powered by boring-avatars.
 * Only available when RESULTS_STORE_PLAYGROUND_MODE is active.
 * In non-playground mode, returns HTTP 500.
 */
avatarRouter.get(['/api/avatar/:seed', '/api/avatar'], (req: Request, res: Response) => {
    if (!isPlaygroundMode()) {
        res.status(500).json({
            error: 'Avatar generation is only available when Playground Mode is enabled.'
        });
        return;
    }

    const seed = (req.params.seed || (req.query.seed as string) || (req.query.name as string) || 'anonymous').trim();
    const variantQuery = (req.query.variant as string) || 'beam';
    const variant = (VALID_VARIANTS.has(variantQuery) ? variantQuery : 'beam') as
        | 'marble'
        | 'beam'
        | 'pixel'
        | 'sunset'
        | 'ring'
        | 'bauhaus';
    const size = parseInt(req.query.size as string) || 80;

    const svg = generateSvgAvatar(seed, variant, size);

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.status(200).send(svg);
});
