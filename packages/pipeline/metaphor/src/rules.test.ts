import { describe, expect, it } from 'vitest';
import {
  visualPlanSchemaFor,
  type EntityKind,
  type MetaphorId,
  type Relation,
  type SemanticGraph,
} from '@opsis/schema';
import { RULE_IDS, type RuleId } from './rules';
import { selectMetaphorOffline } from './select';

type E = [id: string, kind?: EntityKind];
type R = [type: Relation['type'], source: string, target: string, modality?: Relation['modality']];

/** Minimal valid SG: entities named by id (lemma = id without `e_`), one relation per tuple. */
function sg(entities: E[], relations: R[] = []): SemanticGraph {
  const words = entities.map(([id]) => id.replace(/^e_/, '').replace(/_/g, ' '));
  const utterance = `${words.join(' ')}.`;
  let offset = 0;
  return {
    schemaVersion: 'sg/1',
    utterance,
    language: 'en',
    entities: entities.map(([id, kind = 'object'], i) => {
      const lemma = words[i] ?? id;
      const span: [number, number] = [offset, offset + lemma.length];
      offset += lemma.length + 1;
      return { id, surface: lemma, lemma, kind, span, summary: `${lemma} is a thing.` };
    }),
    relations: relations.map(([type, source, target, modality = 'certain'], i) => ({
      id: `r_${i + 1}`,
      type,
      source,
      target,
      modality,
    })),
  };
}

type Case = {
  name: string;
  rule: RuleId;
  metaphor: MetaphorId;
  anchor: string;
  graph: SemanticGraph;
};

/** One case per PROMPT.md §10.1 rule (plus the variants the rule text names). */
const CASES: Case[] = [
  {
    name: '1. direction relation ⇒ compass',
    rule: 'direction',
    metaphor: 'compass',
    anchor: 'v_compass',
    graph: sg(
      [
        ['e_sun', 'celestial_body'],
        ['e_west', 'direction'],
      ],
      [['direction', 'e_sun', 'e_west']],
    ),
  },
  {
    name: '1. direction entity alone ⇒ compass',
    rule: 'direction',
    metaphor: 'compass',
    anchor: 'v_compass',
    graph: sg([['e_north', 'direction']]),
  },
  {
    name: '2. layered parts ⇒ stack',
    rule: 'composition',
    metaphor: 'stack',
    anchor: 'e_earth',
    graph: sg(
      [['e_earth', 'celestial_body'], ['e_crust'], ['e_mantle'], ['e_core']],
      [
        ['has_part', 'e_earth', 'e_crust'],
        ['has_part', 'e_earth', 'e_mantle'],
        ['has_part', 'e_earth', 'e_core'],
      ],
    ),
  },
  {
    name: '2. non-layered parts ⇒ container',
    rule: 'composition',
    metaphor: 'container',
    anchor: 'e_car',
    graph: sg(
      [['e_car'], ['e_engine'], ['e_seat']],
      [
        ['has_part', 'e_car', 'e_engine'],
        ['contains', 'e_car', 'e_seat'],
      ],
    ),
  },
  {
    name: '2. food inside a vessel ⇒ container, not stack',
    rule: 'composition',
    metaphor: 'container',
    anchor: 'e_bowl',
    graph: sg(
      [['e_bowl'], ['e_apple', 'substance'], ['e_banana', 'substance']],
      [
        ['contains', 'e_bowl', 'e_apple'],
        ['contains', 'e_bowl', 'e_banana'],
      ],
    ),
  },
  {
    name: '3. graph cycle over precedes/transforms_into ⇒ cycle',
    rule: 'cycle',
    metaphor: 'cycle',
    anchor: 'v_cycle',
    graph: sg(
      [['e_egg'], ['e_caterpillar', 'living_thing'], ['e_butterfly', 'living_thing']],
      [
        ['transforms_into', 'e_egg', 'e_caterpillar'],
        ['transforms_into', 'e_caterpillar', 'e_butterfly'],
        ['precedes', 'e_butterfly', 'e_egg'],
      ],
    ),
  },
  {
    name: '3. explicit cycle relation ⇒ cycle',
    rule: 'cycle',
    metaphor: 'cycle',
    anchor: 'v_cycle',
    graph: sg(
      [
        ['e_day', 'time'],
        ['e_night', 'time'],
      ],
      [['cycle', 'e_day', 'e_night']],
    ),
  },
  {
    name: '4. precedes path of actions ⇒ timeline',
    rule: 'sequence',
    metaphor: 'timeline',
    anchor: 'v_timeline',
    graph: sg(
      [
        ['e_wake', 'action'],
        ['e_eat', 'action'],
        ['e_leave', 'action'],
      ],
      [
        ['precedes', 'e_wake', 'e_eat'],
        ['precedes', 'e_eat', 'e_leave'],
      ],
    ),
  },
  {
    name: '4. precedes path of things ⇒ flow',
    rule: 'sequence',
    metaphor: 'flow',
    anchor: 'e_flour',
    graph: sg(
      [
        ['e_wheat', 'substance'],
        ['e_flour', 'substance'],
        ['e_bread', 'substance'],
      ],
      [
        ['precedes', 'e_wheat', 'e_flour'],
        ['precedes', 'e_flour', 'e_bread'],
      ],
    ),
  },
  {
    name: '5. is_a tree ⇒ tree rooted at the most general class',
    rule: 'classification',
    metaphor: 'tree',
    anchor: 'e_animal',
    graph: sg(
      [
        ['e_dog', 'living_thing'],
        ['e_cat', 'living_thing'],
        ['e_animal', 'living_thing'],
      ],
      [
        ['is_a', 'e_dog', 'e_animal'],
        ['is_a', 'e_cat', 'e_animal'],
      ],
    ),
  },
  {
    name: '6. compares ⇒ scale',
    rule: 'comparison',
    metaphor: 'scale',
    anchor: 'v_scale',
    graph: sg(
      [
        ['e_whale', 'living_thing'],
        ['e_shark', 'living_thing'],
      ],
      [['compares', 'e_whale', 'e_shark']],
    ),
  },
  {
    name: '7. agent_of + acts_on ⇒ actor_action anchored on the action',
    rule: 'actor_action',
    metaphor: 'actor_action',
    anchor: 'e_kick',
    graph: sg(
      [['e_child', 'person'], ['e_kick', 'action'], ['e_ball']],
      [
        ['agent_of', 'e_child', 'e_kick'],
        ['acts_on', 'e_kick', 'e_ball'],
      ],
    ),
  },
  {
    name: '8. otherwise ⇒ flow anchored on the highest-degree node',
    rule: 'default',
    metaphor: 'flow',
    anchor: 'e_heat',
    graph: sg(
      [['e_fire'], ['e_heat'], ['e_smoke']],
      [
        ['causes', 'e_fire', 'e_heat'],
        ['causes', 'e_heat', 'e_smoke'],
      ],
    ),
  },
];

describe('§10.1 rules', () => {
  it('has a case for every rule', () => {
    expect(new Set(CASES.map((c) => c.rule))).toEqual(new Set(RULE_IDS));
  });

  it.each(CASES)('$name', ({ graph, rule, metaphor, anchor }) => {
    const { plan, rule: applied } = selectMetaphorOffline(graph);
    expect(applied).toBe(rule);
    expect(plan.scenes[0]?.metaphor).toBe(metaphor);
    expect(plan.anchor).toBe(anchor);
    expect(visualPlanSchemaFor(graph).safeParse(plan).success).toBe(true);
  });
});

describe('rule order and details', () => {
  it('direction beats composition (first match wins)', () => {
    const graph = sg(
      [['e_house'], ['e_door'], ['e_window'], ['e_south', 'direction']],
      [
        ['has_part', 'e_house', 'e_door'],
        ['has_part', 'e_house', 'e_window'],
        ['direction', 'e_door', 'e_south'],
      ],
    );
    expect(selectMetaphorOffline(graph).rule).toBe('direction');
  });

  it('puts the directional entity at its bearing: a compass → bearing line, highlighted', () => {
    const graph = sg(
      [
        ['e_sun', 'celestial_body'],
        ['e_east', 'direction'],
      ],
      [['direction', 'e_sun', 'e_east']],
    );
    const [scene] = selectMetaphorOffline(graph).plan.scenes;
    expect(scene?.edges).toContainEqual({
      id: 've_v_compass_e_east',
      from: 'v_compass',
      to: 'e_east',
      kind: 'line',
    });
    const east = scene?.nodes.find((n) => n.id === 'e_east');
    expect(east).toMatchObject({ primitive: 'labeled_card', label: 'East', role: 'context' });
    expect(east?.style?.emphasis).toBe('highlight');
    expect(scene?.nodes.find((n) => n.id === 'e_sun')).toMatchObject({
      primitive: 'sun',
      role: 'actor',
    });
  });

  it('a single has_part is not a composition', () => {
    const graph = sg(
      [
        ['e_tree', 'living_thing'],
        ['e_leaf', 'living_thing'],
      ],
      [['has_part', 'e_tree', 'e_leaf']],
    );
    expect(selectMetaphorOffline(graph).rule).toBe('default');
  });

  it('negated composition does not count', () => {
    const graph = sg(
      [['e_box'], ['e_cat', 'living_thing'], ['e_dog', 'living_thing']],
      [
        ['contains', 'e_box', 'e_cat', 'negated'],
        ['contains', 'e_box', 'e_dog', 'negated'],
      ],
    );
    expect(selectMetaphorOffline(graph).rule).toBe('default');
  });

  it('keeps part order from relation.order and marks parts explodable', () => {
    const graph = sg(
      [['e_cake'], ['e_icing'], ['e_sponge']],
      [
        ['has_part', 'e_cake', 'e_icing'],
        ['has_part', 'e_cake', 'e_sponge'],
      ],
    );
    graph.relations[0]!.order = 2;
    graph.relations[1]!.order = 1;
    const [scene] = selectMetaphorOffline(graph).plan.scenes;
    expect(scene?.nodes.map((n) => n.id)).toEqual(['e_cake', 'e_sponge', 'e_icing']);
    expect(scene?.nodes.slice(1).every((n) => n.explodable && n.role === 'part')).toBe(true);
    expect(scene?.nodes[0]).toMatchObject({ role: 'anchor', primitive: 'group_frame' });
  });

  it('only two precedes steps is not a sequence', () => {
    const graph = sg(
      [
        ['e_rain', 'event'],
        ['e_flood', 'event'],
      ],
      [['precedes', 'e_rain', 'e_flood']],
    );
    expect(selectMetaphorOffline(graph).rule).toBe('default');
  });

  it('is_a with two parents is not a tree', () => {
    const graph = sg(
      [['e_bat'], ['e_mammal'], ['e_flyer']],
      [
        ['is_a', 'e_bat', 'e_mammal'],
        ['is_a', 'e_bat', 'e_flyer'],
      ],
    );
    expect(selectMetaphorOffline(graph).rule).toBe('default');
  });

  it('disjoint comparisons become side-by-side scenes, at most 3', () => {
    const pairs = ['a', 'b', 'c', 'd'].flatMap((x): E[] => [[`e_${x}1`], [`e_${x}2`]]);
    const graph = sg(
      pairs,
      ['a', 'b', 'c', 'd'].map((x): R => ['compares', `e_${x}1`, `e_${x}2`]),
    );
    const { plan } = selectMetaphorOffline(graph);
    expect(plan.scenes).toHaveLength(3);
    expect(plan.scenes.map((s) => s.metaphor)).toEqual(['scale', 'scale', 'scale']);
    expect(plan.scenes[1]?.nodes.map((n) => n.id)).toEqual(['v_scale_2', 'e_b1', 'e_b2']);
    expect(visualPlanSchemaFor(graph).safeParse(plan).success).toBe(true);
  });

  it('actor_action roles: actor, action anchor, object', () => {
    const graph = sg(
      [['e_child', 'person'], ['e_kick', 'action'], ['e_ball']],
      [
        ['agent_of', 'e_child', 'e_kick'],
        ['acts_on', 'e_kick', 'e_ball'],
      ],
    );
    const nodes = selectMetaphorOffline(graph).plan.scenes[0]?.nodes ?? [];
    expect(nodes.map((n) => [n.id, n.role, n.primitive])).toEqual([
      ['e_kick', 'anchor', 'arrow'],
      ['e_child', 'actor', 'person'],
      ['e_ball', 'object', 'labeled_card'],
    ]);
  });

  it('breaks degree ties by entity order offline', () => {
    const graph = sg([['e_x'], ['e_y']], [['causes', 'e_x', 'e_y']]);
    expect(selectMetaphorOffline(graph).plan.anchor).toBe('e_x');
  });

  it('marks optional only for targets of a possible relation', () => {
    const graph = sg(
      [
        ['e_soup', 'substance'],
        ['e_salt', 'substance'],
        ['e_pepper', 'substance'],
      ],
      [
        ['contains', 'e_soup', 'e_salt', 'possible'],
        ['contains', 'e_soup', 'e_pepper'],
      ],
    );
    const nodes = selectMetaphorOffline(graph).plan.scenes[0]?.nodes ?? [];
    expect(nodes.find((n) => n.id === 'e_salt')?.optional).toBe(true);
    expect(nodes.find((n) => n.id === 'e_pepper')?.optional).toBeUndefined();
  });

  it('an SG with no entities still yields a valid labeled_card plan', () => {
    const graph = sg([]);
    graph.utterance = 'Flibbertigibbet quorps the zindle again today.';
    const { plan } = selectMetaphorOffline(graph);
    expect(plan.scenes[0]?.nodes).toEqual([
      {
        id: 'v_statement',
        primitive: 'labeled_card',
        label: 'Flibbertigibbet quorps the zindle…',
        role: 'anchor',
      },
    ]);
    expect(visualPlanSchemaFor(graph).safeParse(plan).success).toBe(true);
  });

  it('synthetic anchor ids never collide with entity ids', () => {
    const graph = sg(
      [['v_compass'], ['e_east', 'direction']],
      [['direction', 'v_compass', 'e_east']],
    );
    expect(selectMetaphorOffline(graph).plan.anchor).toBe('v_compass_2');
  });
});
