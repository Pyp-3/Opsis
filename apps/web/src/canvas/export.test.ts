import { describe, expect, it } from 'vitest';
import { loadFixture } from '../scene/fixtures';
import { exportBaseName, osgGlb, osgJson, osgSvg } from './export';

describe('2D and OSG exports', () => {
  it('creates valid JSON and standalone SVG files', async () => {
    const osg = loadFixture('sandwich');
    const json = osgJson(osg);
    expect(json.type).toBe('application/json');
    expect(JSON.parse(await json.text())).toEqual(osg);
    const svg = osgSvg(osg);
    expect(svg.type).toBe('image/svg+xml');
    expect(await svg.text()).toMatch(/^<svg[\s\S]*<\/svg>$/u);
    expect(await svg.text()).toContain('Tomato');
    expect(exportBaseName(osg)).toBe('a-sandwich-and-its-parts');
  });

  it('creates a binary glTF with the GLB magic header', async () => {
    class TestFileReader {
      result: string | ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        void blob.arrayBuffer().then((result) => {
          this.result = result;
          this.onloadend?.();
        });
      }
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then((result) => {
          this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;
          this.onloadend?.();
        });
      }
    }
    Object.assign(globalThis, { FileReader: TestFileReader });
    const glb = await osgGlb(loadFixture('sun-east'));
    expect(glb.type).toBe('model/gltf-binary');
    expect(new TextDecoder().decode((await glb.arrayBuffer()).slice(0, 4))).toBe('glTF');
  });
});
