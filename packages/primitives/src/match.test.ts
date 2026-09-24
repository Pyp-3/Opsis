import { describe, expect, it } from 'vitest';
import { MATCH_THRESHOLD, matchPrimitive, normalize, rankPrimitives, singular } from './match';

describe('matchPrimitive', () => {
  it.each([
    ['sun', 'sun'],
    ['Sun', 'sun'],
    ['east', 'compass'],
    ['bread', 'bread_slice'],
    ['ham', 'generic_layer'],
    ['tomato', 'round_fruit'],
    ['tomatoes', 'round_fruit'],
    ['rises', 'curved_arrow'],
    ['horizon', 'horizon'],
    ['clouds', 'cloud'],
    ['water cycle', 'water'],
    ['stack layer', 'stack_layer'],
    ['person', 'person'],
    ['counter dots', 'counter_dots'],
  ])('%s → %s above the threshold', (query, id) => {
    const match = matchPrimitive(query);
    expect(match.id).toBe(id);
    expect(match.fallback).toBe(false);
    expect(match.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('matches exact keywords with score 1', () => {
    expect(matchPrimitive('compass')).toEqual({
      id: 'compass',
      score: 1,
      fallback: false,
      keyword: 'compass',
    });
  });

  it('tolerates small misspellings with a reduced score', () => {
    const match = matchPrimitive('montain');
    expect(match.id).toBe('mountain');
    expect(match.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(match.score).toBeLessThan(1);
  });

  it('accepts SG entities', () => {
    expect(matchPrimitive({ lemma: 'rise', surface: 'rises', kind: 'action' }).id).toBe(
      'curved_arrow',
    );
    expect(matchPrimitive({ lemma: 'sun', surface: 'Sun', kind: 'celestial_body' })).toMatchObject({
      id: 'sun',
      score: 1,
    });
  });

  it.each(['quasar', 'democracy', 'xylophone', '', '   ', '!!!'])(
    'unknown entity %j falls back to labeled_card',
    (query) => {
      const match = matchPrimitive(query);
      expect(match.id).toBe('labeled_card');
      expect(match.fallback).toBe(true);
      expect(match.score).toBeLessThan(MATCH_THRESHOLD);
    },
  );

  it('falls back when the best score is positive but below the threshold', () => {
    // "mountainous" only shares a prefix with "mountain", scoring below the threshold.
    const [top] = rankPrimitives('mountainous region');
    expect(top?.score ?? 0).toBeGreaterThan(0);
    expect(top?.score ?? 1).toBeLessThan(MATCH_THRESHOLD);
    expect(matchPrimitive('mountainous region')).toMatchObject({
      id: 'labeled_card',
      fallback: true,
      score: top?.score,
    });
  });

  it('respects a custom threshold', () => {
    expect(matchPrimitive('montain', 0.99)).toMatchObject({ id: 'labeled_card', fallback: true });
  });

  it('never ranks labeled_card itself', () => {
    expect(rankPrimitives('card').map((r) => r.id)).not.toContain('labeled_card');
  });

  it('adds a small, capped bonus when the entity kind fits the category', () => {
    const score = (q: Parameters<typeof rankPrimitives>[0]) =>
      rankPrimitives(q).find((r) => r.id === 'mountain')?.score ?? 0;
    expect(score({ lemma: 'montain', kind: 'place' })).toBe(score('montain'));
    expect(matchPrimitive({ lemma: 'sun', kind: 'celestial_body' }).score).toBe(1);
    const star = rankPrimitives({ lemma: 'sunshin', kind: 'celestial_body' })[0];
    expect(star?.id).toBe('sun');
    expect(star?.score ?? 0).toBeGreaterThan(rankPrimitives('sunshin')[0]?.score ?? 1);
  });
});

describe('text helpers', () => {
  it('normalizes', () => {
    expect(normalize('  North-East!! ')).toBe('north east');
  });

  it.each([
    ['tomatoes', 'tomato'],
    ['berries', 'berry'],
    ['clouds', 'cloud'],
    ['glass', 'glass'],
    ['bus', 'bus'],
    ['sun', 'sun'],
  ])('singular(%s) = %s', (word, expected) => {
    expect(singular(word)).toBe(expected);
  });
});
