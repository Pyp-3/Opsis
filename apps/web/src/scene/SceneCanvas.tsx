import { Bounds, OrbitControls, useBounds } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import type { OSG, PositionedScene } from '@opsis/schema';
import { resolveColor, type PaletteId } from '@opsis/ui';
import { useEffect } from 'react';
import { Box3, PerspectiveCamera, Vector3, type WebGLRenderer } from 'three';
import type { Vec3 } from '@opsis/primitives';
import { centerOf, compassHighlights, fitDistance, fitPoints } from './model';
import { SceneEdges } from './SceneEdges';
import { SceneNode } from './SceneNode';

/** Camera fit margin: 1.1 ≈ 10 % padding around the scene (PROMPT.md §10.2). */
const FIT_MARGIN = 1.1;
const FOV = 40;

const CAMERA_DIRECTION = {
  top: [0, 1, 0.001],
  front: [0, 0.15, 1],
  iso: [0.8, 0.7, 1],
  free: [0.8, 0.7, 1],
} as const;

export type RenderMetrics = {
  renderedFrames: number;
  renderer: string;
};

type InstrumentedCanvas = HTMLCanvasElement & { __opsisRenderMetrics?: RenderMetrics };

/** Counts completed Three.js render passes for the browser performance gate. */
function installRenderTelemetry(gl: WebGLRenderer) {
  const canvas = gl.domElement as InstrumentedCanvas;
  const context = gl.getContext();
  const extension = context.getExtension('WEBGL_debug_renderer_info');
  canvas.__opsisRenderMetrics = {
    renderedFrames: 0,
    renderer: String(
      extension
        ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : context.getParameter(context.RENDERER),
    ),
  };
  const render = gl.render.bind(gl);
  gl.render = (scene, camera) => {
    render(scene, camera);
    if (canvas.__opsisRenderMetrics) canvas.__opsisRenderMetrics.renderedFrames += 1;
  };
}

/**
 * Zooms to fit on mount, on resize and when `signal` changes; the caller remounts it when
 * the fit points change (e.g. explode). Keeps the viewing angle; animates via drei `Bounds`.
 */
function ZoomToFit({ points, signal }: { points: Vec3[]; signal: number }) {
  const bounds = useBounds();
  const { camera, size, controls } = useThree();
  useEffect(() => {
    const center = centerOf(points);
    const pivot =
      (controls as unknown as { target?: Vector3 } | null)?.target ?? new Vector3(...center);
    const direction = camera.position.clone().sub(pivot).normalize();
    const fov = camera instanceof PerspectiveCamera ? camera.fov : FOV;
    const aspect = size.width / Math.max(size.height, 1);
    const distance = fitDistance(points, center, direction.toArray(), fov, aspect, FIT_MARGIN);
    const position = new Vector3(...center).addScaledVector(direction, distance);
    bounds
      .refresh(new Box3().setFromPoints(points.map((p) => new Vector3(...p))))
      .clip()
      .to({ position: position.toArray(), target: center });
    // Points are fixed per mount (the caller keys this component on them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, signal, size.width, size.height]);
  return null;
}

type Props = {
  osg: OSG;
  scene: PositionedScene;
  exploded: boolean;
  reducedMotion: boolean;
  paletteId: PaletteId;
  hoveredId: string | null;
  selectedId: string | null;
  fitSignal: number;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
};

/** The react-three-fiber canvas for one positioned scene. */
export default function SceneCanvas(props: Props) {
  const { osg, scene, exploded, reducedMotion, paletteId } = props;
  const points = fitPoints(scene, exploded);
  const fitKey = points.flat().join(',');
  const highlights = compassHighlights(scene);
  const kinds = new Map(osg.sg.entities.map((e) => [e.id, e.kind]));
  const [cx, cy, cz] = CAMERA_DIRECTION[scene.camera ?? 'iso'];
  const direction = [cx, cy, cz].map((v) => v / Math.hypot(cx, cy, cz)) as Vec3;
  const center = centerOf(points);
  const distance = fitDistance(points, center, direction, FOV, 1.5, FIT_MARGIN);

  return (
    <Canvas
      camera={{
        position: center.map((c, i) => c + (direction[i] ?? 0) * distance) as Vec3,
        fov: FOV,
      }}
      dpr={[1, 2]}
      onCreated={({ gl }) => installRenderTelemetry(gl)}
      onPointerMissed={() => props.onSelect(null)}
      aria-hidden
    >
      <color
        attach="background"
        args={[resolveColor('ui.background', 'ui.background', paletteId)]}
      />
      <hemisphereLight args={['#ffffff', '#b9a98f', 1.1]} />
      <directionalLight position={[6, 10, 8]} intensity={1.6} />
      <Bounds margin={FIT_MARGIN} maxDuration={reducedMotion ? 0.001 : 0.5}>
        <ZoomToFit key={fitKey} points={points} signal={props.fitSignal} />
        {scene.nodes.map((node) => (
          <SceneNode
            key={node.id}
            node={node}
            scene={scene}
            exploded={exploded}
            reducedMotion={reducedMotion}
            paletteId={paletteId}
            hovered={props.hoveredId === node.id}
            selected={props.selectedId === node.id}
            highlightAnchors={node.primitive === 'compass' ? highlights : []}
            kind={kinds.get(node.id)}
            onHover={props.onHover}
            onSelect={props.onSelect}
          />
        ))}
        <SceneEdges scene={scene} paletteId={paletteId} reducedMotion={reducedMotion} />
      </Bounds>
      <OrbitControls makeDefault enableDamping={!reducedMotion} />
    </Canvas>
  );
}
