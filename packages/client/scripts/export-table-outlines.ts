/**
 * Writes each table's rail opening, cushion back line, pockets and diamonds to
 * assets/blender/outlines/<tableId>.json and .svg, as the base drawing for the Blender rail models.
 * Run with: pnpm --filter @breakshot/client export-outlines
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTableGeometry, TABLES, type TableId } from '@breakshot/shared';
import { RENDER3D } from '../src/config';
import { railOpening } from '../src/render3d/table';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/blender/outlines');
mkdirSync(outDir, { recursive: true });

for (const id of Object.keys(TABLES) as TableId[]) {
  const geom = buildTableGeometry(TABLES[id]);
  const { length: L, width: W, spec } = geom;
  const cw = spec.cushionWidth;
  const rail = spec.railWidth;
  const opening = railOpening(L, W, cw, geom.pockets);
  const outline = {
    id,
    length: L,
    width: W,
    cushionWidth: cw,
    railWidth: rail,
    railTop: spec.cushionNoseHeight + RENDER3D.railRise,
    skirtDepth: RENDER3D.skirtDepth,
    /** Same corner radius as the built-in rail. */
    outerCornerRadius: rail * 0.35,
    railColor: spec.colors.rail,
    opening,
    cushionBack: { x0: -cw, y0: -cw, x1: L + cw, y1: W + cw },
    pockets: geom.pockets.map((p) => ({ id: p.id, center: p.center, radius: p.radius })),
    diamonds: geom.diamonds,
    diamondRadius: spec.diamonds.radius,
  };
  writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(outline, null, 2)}\n`);

  // SVG in millimetres, y flipped so the drawing matches the top view.
  const px = (x: number) => ((x + rail) * 1000).toFixed(2);
  const py = (y: number) => ((W + rail - y) * 1000).toFixed(2);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(L + 2 * rail) * 1000}mm" height="${(W + 2 * rail) * 1000}mm" viewBox="0 0 ${(L + 2 * rail) * 1000} ${(W + 2 * rail) * 1000}" fill="none" stroke-width="1.5">`,
    `<rect x="0" y="0" width="${(L + 2 * rail) * 1000}" height="${(W + 2 * rail) * 1000}" rx="${rail * 350}" stroke="#555"/>`,
    `<polygon points="${opening.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}" stroke="#c00"/>`,
    `<rect x="${px(-cw)}" y="${py(W + cw)}" width="${(L + 2 * cw) * 1000}" height="${(W + 2 * cw) * 1000}" stroke="#06c" stroke-dasharray="6 4"/>`,
    ...geom.pockets.map((p) => `<circle cx="${px(p.center.x)}" cy="${py(p.center.y)}" r="${p.radius * 1000}" stroke="#090"/>`),
    ...geom.diamonds.map((d) => `<circle cx="${px(d.x)}" cy="${py(d.y)}" r="${spec.diamonds.radius * 1000}" fill="#999" stroke="none"/>`),
    '</svg>',
  ].join('\n');
  writeFileSync(join(outDir, `${id}.svg`), `${svg}\n`);
  console.log(`${id}: ${opening.length} opening points`);
}
