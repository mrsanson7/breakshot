import * as THREE from 'three';
import type { BallDef } from '@breakshot/shared';
import { RENDER3D } from '../config';

const IVORY = '#f6f3ea';

/**
 * Equirectangular ball texture for THREE.SphereGeometry. u = 0.25 on the equator is the sphere's
 * local +Z (world up at identity orientation), u = 0.75 is −Z, so numbers sit there.
 */
export function ballTexture(def: BallDef, renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const w = RENDER3D.ballTexturePx;
  const hgt = w / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const g = c.getContext('2d')!;

  if (def.stripe) {
    g.fillStyle = IVORY;
    g.fillRect(0, 0, w, hgt);
    g.fillStyle = def.color;
    // Band of ±36° latitude around the equator.
    g.fillRect(0, hgt * 0.3, w, hgt * 0.4);
  } else {
    g.fillStyle = def.color;
    g.fillRect(0, 0, w, hgt);
  }

  if (def.number !== undefined) {
    for (const u of [0.25, 0.75]) {
      const x = u * w;
      const y = hgt / 2;
      const r = hgt * 0.12;
      g.fillStyle = IVORY;
      g.beginPath();
      // At the equator the equirect map has equal scale both ways, so a circle stays round.
      g.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.font = `700 ${Math.round(r * 1.25)}px "IBM Plex Sans KR", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(def.number), x, y + r * 0.06);
    }
  } else if (def.id !== 'cue') {
    // Carom: six dots on the ±x, ±y, ±z axes.
    const dot = def.id.startsWith('red') ? IVORY : '#c8102e';
    const rad = (RENDER3D.caromDotDeg / 360) * w;
    g.fillStyle = dot;
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      g.beginPath();
      g.arc(u * w, hgt / 2, rad, 0, Math.PI * 2);
      g.fill();
    }
    // Poles: a band at the top and bottom of the map.
    const band = (RENDER3D.caromDotDeg / 180) * hgt;
    g.fillRect(0, 0, w, band);
    g.fillRect(0, hgt - band, w, band);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}
