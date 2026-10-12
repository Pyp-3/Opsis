import { expect, it } from 'vitest';
import { collectionDeletion, collectionPathLabel, collectionPlacement } from './board-collections';

const collections = [
  { id: 'education', name: 'Education', parentId: null },
  { id: 'ai', name: 'Artificial Intelligence', parentId: 'education' },
  { id: 'topic', name: 'Topic 1', parentId: 'ai' },
];

it('names paths and prevents ancestor moves without global name restrictions', () => {
  expect(collectionPathLabel(collections, 'topic')).toBe(
    'Education / Artificial Intelligence / Topic 1',
  );
  expect(collectionPlacement(collections, { ...collections[0]!, parentId: 'topic' })).toBe('cycle');
  expect(collectionPlacement(collections, { ...collections[1]!, parentId: 'ai' })).toBe('cycle');
  expect(collectionPlacement(collections, { id: 'new', name: 'topic 1', parentId: 'ai' })).toBe(
    'duplicate',
  );
  expect(
    collectionPlacement(collections, { id: 'new', name: 'Topic 1', parentId: 'education' }),
  ).toBeNull();
  expect(
    collectionPlacement(collections, { id: 'new', name: 'Private', parentId: 'foreign' }),
  ).toBe('missing');
});

it('keeps children when deleting containers and refuses ambiguous promotion', () => {
  expect(collectionDeletion(collections, 'ai')).toBeNull();
  expect(
    collectionDeletion(
      [...collections, { id: 'other', name: 'Topic 1', parentId: 'education' }],
      'ai',
    ),
  ).toBe('duplicate');
  expect(collectionDeletion(collections, 'missing')).toBe('missing');
});
