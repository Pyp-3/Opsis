import type { OSG } from '@opsis/schema';
import { FLOW_SCALE } from './model';

const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Serializes the canonical OSG as a formatted JSON file. */
export function osgJson(osg: OSG): Blob {
  return new Blob([JSON.stringify(osg, null, 2)], { type: 'application/json' });
}

/** Builds a standalone SVG rendering of the first 2D scene. */
export function osgSvg(osg: OSG): Blob {
  const scene = osg.scenes[0];
  const nodes = scene?.nodes ?? [];
  const points = nodes.map((node) => ({
    id: node.id,
    label: node.label,
    x: node.position[0] * FLOW_SCALE,
    y: -node.position[1] * FLOW_SCALE,
    optional: node.optional === true,
  }));
  const minX = Math.min(0, ...points.map((point) => point.x - 75));
  const minY = Math.min(0, ...points.map((point) => point.y - 35));
  const maxX = Math.max(300, ...points.map((point) => point.x + 75));
  const maxY = Math.max(180, ...points.map((point) => point.y + 35));
  const byId = new Map(points.map((point) => [point.id, point]));
  const edges = (scene?.edges ?? [])
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return '';
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#2b3440" stroke-width="2" marker-end="url(#arrow)"/>`;
    })
    .join('');
  const cards = points
    .map(
      (point) =>
        `<g><rect x="${point.x - 65}" y="${point.y - 25}" width="130" height="50" rx="10" fill="#fff" stroke="#2b3440" stroke-width="2"${point.optional ? ' stroke-dasharray="7 5"' : ''}/><text x="${point.x}" y="${point.y + 5}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#1b1f24">${xml(point.label)}</text></g>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX - minX}" height="${maxY - minY}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="${xml(osg.title)}"><title>${xml(osg.title)}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2b3440"/></marker></defs><rect x="${minX}" y="${minY}" width="100%" height="100%" fill="#f4f1ea"/>${edges}${cards}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** Rasterizes the standalone SVG into a PNG. */
export async function osgPng(osg: OSG): Promise<Blob> {
  const svg = osgSvg(osg);
  const source = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is not supported by this browser.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create PNG.');
    return blob;
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Exports a lightweight binary glTF representation of the positioned 3D OSG. */
export async function osgGlb(osg: OSG): Promise<Blob> {
  const [{ BoxGeometry, Color, Mesh, MeshStandardMaterial, Scene }, { GLTFExporter }] =
    await Promise.all([import('three'), import('three/addons/exporters/GLTFExporter.js')]);
  const root = new Scene();
  for (const node of osg.scenes.flatMap((scene) => scene.nodes)) {
    const geometry = new BoxGeometry(...node.size);
    const material = new MeshStandardMaterial({
      color: new Color(node.role === 'anchor' ? '#1f6fd1' : '#e69f00'),
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = node.label;
    mesh.position.set(...node.position);
    if (node.rotation) mesh.rotation.set(...node.rotation);
    root.add(mesh);
  }
  const output = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  if (!(output instanceof ArrayBuffer)) throw new Error('GLB exporter returned JSON.');
  return new Blob([output], { type: 'model/gltf-binary' });
}

/** Downloads a generated browser file and then releases its object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/** Filesystem-safe base name for an OSG export. */
export function exportBaseName(osg: OSG): string {
  return (
    osg.title
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'opsis-diagram'
  );
}
