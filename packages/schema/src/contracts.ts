import { z } from 'zod';

const nonEmptyString = z.string().min(1);
const finiteNumber = z.number().finite();
const positionSchema = z.tuple([z.number(), z.number(), z.number()]);
const vector3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const spanSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

/** Counts whitespace-delimited words in human-readable schema fields. */
export function countWords(value: string): number {
  const normalized = value.trim();
  return normalized === '' ? 0 : normalized.split(/\s+/u).length;
}

function atMostWords(maximum: number, field: string) {
  return nonEmptyString.superRefine((value, context) => {
    if (countWords(value) > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} must contain at most ${maximum} words`,
      });
    }
  });
}

export const EntityKindSchema = z.enum([
  'object',
  'substance',
  'living_thing',
  'person',
  'place',
  'direction',
  'celestial_body',
  'event',
  'process',
  'quantity',
  'time',
  'abstract_concept',
  'action',
]);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const RelationTypeSchema = z.enum([
  'has_part',
  'contains',
  'is_a',
  'located_at',
  'direction',
  'moves',
  'causes',
  'precedes',
  'cycle',
  'compares',
  'quantity',
  'transforms_into',
  'property_of',
  'agent_of',
  'acts_on',
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const MetaphorIdSchema = z.enum([
  'compass',
  'stack',
  'container',
  'cycle',
  'timeline',
  'tree',
  'flow',
  'scale',
  'map',
  'actor_action',
]);
export type MetaphorId = z.infer<typeof MetaphorIdSchema>;

export const PrimitiveIdSchema = z.enum([
  'compass',
  'arrow',
  'curved_arrow',
  'horizon',
  'sun',
  'moon',
  'earth',
  'cloud',
  'raindrop',
  'tree',
  'leaf',
  'water',
  'mountain',
  'box',
  'stack_layer',
  'bowl',
  'cell',
  'group_frame',
  'bread_slice',
  'generic_layer',
  'round_fruit',
  'slice',
  'person',
  'hand',
  'cycle_ring',
  'timeline_axis',
  'scale_balance',
  'bar',
  'counter_dots',
  'labeled_card',
]);
export type PrimitiveId = z.infer<typeof PrimitiveIdSchema>;

export const EntitySchema = z
  .object({
    id: nonEmptyString,
    surface: nonEmptyString,
    lemma: nonEmptyString,
    kind: EntityKindSchema,
    span: spanSchema,
    attributes: z.record(z.union([z.string(), finiteNumber, z.boolean()])).optional(),
    summary: atMostWords(25, 'summary'),
  })
  .strict();
export type Entity = z.infer<typeof EntitySchema>;

export const RelationSchema = z
  .object({
    id: nonEmptyString,
    type: RelationTypeSchema,
    source: nonEmptyString,
    target: nonEmptyString,
    modality: z.enum(['certain', 'possible', 'typical', 'negated']),
    order: finiteNumber.optional(),
    evidenceSpan: spanSchema.optional(),
  })
  .strict();
export type Relation = z.infer<typeof RelationSchema>;

export const PedagogyNoteSchema = z
  .object({
    targetId: nonEmptyString,
    kind: z.enum(['misconception', 'nuance', 'safety', 'ambiguity']),
    text: nonEmptyString,
  })
  .strict();
export type PedagogyNote = z.infer<typeof PedagogyNoteSchema>;

export const SemanticGraphSchema = z
  .object({
    schemaVersion: z.literal('sg/1'),
    utterance: nonEmptyString,
    language: nonEmptyString,
    entities: z.array(EntitySchema),
    relations: z.array(RelationSchema),
    notes: z.array(PedagogyNoteSchema).optional(),
  })
  .strict()
  .superRefine((graph, context) => {
    const ids = new Set<string>();
    graph.entities.forEach((entity, index) => {
      if (ids.has(entity.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'entity ids must be unique',
          path: ['entities', index, 'id'],
        });
      }
      ids.add(entity.id);
    });
    graph.relations.forEach((relation, index) => {
      for (const endpoint of ['source', 'target'] as const) {
        if (!ids.has(relation[endpoint])) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `relation ${endpoint} must reference an existing entity`,
            path: ['relations', index, endpoint],
          });
        }
      }
    });
  });
export type SemanticGraph = z.infer<typeof SemanticGraphSchema>;

export const VisualNodeSchema = z
  .object({
    id: nonEmptyString,
    primitive: PrimitiveIdSchema,
    label: atMostWords(4, 'label'),
    role: z.enum(['anchor', 'part', 'actor', 'object', 'modifier', 'context']),
    optional: z.boolean().optional(),
    style: z
      .object({
        emphasis: z.enum(['none', 'highlight']).optional(),
        colorToken: nonEmptyString.optional(),
      })
      .strict()
      .optional(),
    explodable: z.boolean().optional(),
    drillable: z.boolean().optional(),
  })
  .strict();
export type VisualNode = z.infer<typeof VisualNodeSchema>;

export const VisualEdgeSchema = z
  .object({
    id: nonEmptyString,
    from: nonEmptyString,
    to: nonEmptyString,
    kind: z.enum(['arrow', 'line', 'leader', 'containment', 'path']),
    label: atMostWords(4, 'label').optional(),
    animated: z.boolean().optional(),
  })
  .strict();
export type VisualEdge = z.infer<typeof VisualEdgeSchema>;

const sceneShape = {
  id: nonEmptyString,
  metaphor: MetaphorIdSchema,
  nodes: z.array(VisualNodeSchema),
  edges: z.array(VisualEdgeSchema),
  camera: z.enum(['top', 'front', 'iso', 'free']).optional(),
  dimension: z.enum(['2d', '3d', 'auto']),
};

function validateSceneReferences(
  scene: { nodes: VisualNode[]; edges: VisualEdge[] },
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  let anchors = 0;
  scene.nodes.forEach((node, index) => {
    if (ids.has(node.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'node ids must be unique within a scene',
        path: ['nodes', index, 'id'],
      });
    }
    ids.add(node.id);
    if (node.role === 'anchor') anchors += 1;
  });
  if (anchors !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'scene must contain exactly one anchor',
      path: ['nodes'],
    });
  }
  scene.edges.forEach((edge, index) => {
    for (const endpoint of ['from', 'to'] as const) {
      if (!ids.has(edge[endpoint])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${endpoint} must reference an existing node`,
          path: ['edges', index, endpoint],
        });
      }
    }
  });
}

export const SceneIntentSchema = z.object(sceneShape).strict().superRefine(validateSceneReferences);
export type SceneIntent = z.infer<typeof SceneIntentSchema>;

export const VisualPlanSchema = z
  .object({
    schemaVersion: z.literal('vp/1'),
    sgRef: nonEmptyString,
    anchor: nonEmptyString,
    scenes: z.array(SceneIntentSchema).min(1).max(3),
  })
  .strict()
  .superRefine((plan, context) => {
    const anchorExists = plan.scenes.some((scene) =>
      scene.nodes.some((node) => node.id === plan.anchor),
    );
    if (!anchorExists) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'plan anchor must reference a scene node',
        path: ['anchor'],
      });
    }
  });
export type VisualPlan = z.infer<typeof VisualPlanSchema>;

export const PositionedNodeSchema = VisualNodeSchema.extend({
  position: positionSchema,
  size: vector3Schema,
  rotation: vector3Schema.optional(),
  explodedPosition: vector3Schema.optional(),
});
export type PositionedNode = z.infer<typeof PositionedNodeSchema>;

export const PositionedSceneSchema = z
  .object({
    ...sceneShape,
    nodes: z.array(PositionedNodeSchema),
    bounds: z.object({ min: vector3Schema, max: vector3Schema }).strict(),
  })
  .strict()
  .superRefine((scene, context) => {
    validateSceneReferences(scene, context);
    scene.nodes.forEach((node, nodeIndex) => {
      node.position.forEach((coordinate, axis) => {
        if (!Number.isFinite(coordinate)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'positions must contain only finite numbers',
            path: ['nodes', nodeIndex, 'position', axis],
          });
        }
      });
    });
    for (let axis = 0; axis < 3; axis += 1) {
      const minimum = scene.bounds.min[axis] as number;
      const maximum = scene.bounds.max[axis] as number;
      if (minimum > maximum) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'bounds minimum must not exceed maximum',
          path: ['bounds'],
        });
      }
      scene.nodes.forEach((node, nodeIndex) => {
        const coordinate = node.position[axis] as number;
        if (coordinate < minimum || coordinate > maximum) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'bounds must contain all nodes',
            path: ['nodes', nodeIndex, 'position', axis],
          });
        }
      });
    }
  });
export type PositionedScene = z.infer<typeof PositionedSceneSchema>;

function validateOptionalNodes(
  scenes: readonly { nodes: readonly VisualNode[] }[],
  graph: SemanticGraph,
  context: z.RefinementCtx,
  pathPrefix: (string | number)[] = [],
): void {
  const possibleTargets = new Set(
    graph.relations
      .filter((relation) => relation.modality === 'possible')
      .map((relation) => relation.target),
  );
  scenes.forEach((scene, sceneIndex) => {
    scene.nodes.forEach((node, nodeIndex) => {
      if (node.optional === true && !possibleTargets.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'optional nodes must be targets of a possible relation',
          path: [...pathPrefix, sceneIndex, 'nodes', nodeIndex, 'optional'],
        });
      }
    });
  });
}

export const OSGSchema = z
  .object({
    schemaVersion: z.literal('osg/1'),
    id: z.string().uuid(),
    title: nonEmptyString,
    utterance: nonEmptyString,
    createdAt: z.string().datetime({ offset: true }),
    seed: finiteNumber,
    sg: SemanticGraphSchema,
    scenes: z.array(PositionedSceneSchema).min(1).max(3),
    breadcrumbs: z.array(z.object({ id: nonEmptyString, label: atMostWords(4, 'label') }).strict()),
    parentId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((osg, context) => {
    validateOptionalNodes(osg.scenes, osg.sg, context, ['scenes']);
  });
export type OSG = z.infer<typeof OSGSchema>;

/** Returns a VP validator bound to the SG needed for optional-modality validation. */
export function visualPlanSchemaFor(graph: SemanticGraph) {
  return VisualPlanSchema.superRefine((plan, context) => {
    validateOptionalNodes(plan.scenes, graph, context, ['scenes']);
  });
}

export const ExplanationSchema = z
  .object({
    schemaVersion: z.literal('exp/1'),
    nodeId: nonEmptyString,
    osgId: z.string().uuid(),
    level: z.enum(['summary', 'explanation']),
    audience: z.enum(['child', 'teen', 'adult']),
    summary: atMostWords(25, 'summary'),
    sections: z
      .object({
        whatItIs: nonEmptyString,
        whyItMattersHere: nonEmptyString,
        howItWorks: nonEmptyString.optional(),
        funFact: nonEmptyString.optional(),
        commonMisconception: nonEmptyString.optional(),
      })
      .strict()
      .optional(),
    confidence: z.enum(['high', 'medium', 'low']),
    suggestedDrillDown: z.array(nonEmptyString).optional(),
  })
  .strict();
export type Explanation = z.infer<typeof ExplanationSchema>;

export const AudienceSchema = z.enum(['child', 'teen', 'adult']);

export const VisualizeRequestSchema = z
  .object({
    utterance: nonEmptyString.max(500),
    audience: AudienceSchema.optional(),
    seed: finiteNumber.optional(),
  })
  .strict();
export type VisualizeRequest = z.infer<typeof VisualizeRequestSchema>;

export const ExplainRequestSchema = z
  .object({
    osgId: z.string().uuid(),
    nodeId: nonEmptyString,
    level: z.enum(['summary', 'explanation']),
    audience: AudienceSchema,
  })
  .strict();
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export const DrilldownRequestSchema = z
  .object({ osgId: z.string().uuid(), nodeId: nonEmptyString })
  .strict();
export type DrilldownRequest = z.infer<typeof DrilldownRequestSchema>;

export const SaveOSGRequestSchema = OSGSchema;
export type SaveOSGRequest = z.infer<typeof SaveOSGRequestSchema>;

export const ErrorResponseSchema = z
  .object({
    code: nonEmptyString,
    message: nonEmptyString,
    stage: nonEmptyString,
    retryable: z.boolean(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const VisualizeProgressSchema = z.enum(['parsing', 'mapping', 'layout', 'done']);
export type VisualizeProgress = z.infer<typeof VisualizeProgressSchema>;
