import { describe, expect, it } from 'vitest';
import { BoardDocumentSchema, createEmptyBoard } from '@opsis/schema';
import { boardFileJson, splitBoardFile } from './board-file';

describe('board JSON files', () => {
  const board = createEmptyBoard('Mail');

  it('names a filed board’s collection beside the document, leaving the document valid', () => {
    expect(JSON.parse(boardFileJson(board))).toEqual(board);
    const file = JSON.parse(boardFileJson(board, 'Networking'));
    expect(file.collection).toBe('Networking');
    const split = splitBoardFile(file);
    expect(split).toEqual({ board, collection: 'Networking', images: [] });
    expect(BoardDocumentSchema.safeParse(split.board).success).toBe(true);
  });

  it('drops an unusable collection name and leaves other files untouched', () => {
    expect(splitBoardFile({ ...board, collection: '   ' })).toEqual({ board, images: [] });
    expect(splitBoardFile({ ...board, collection: 'x'.repeat(61) })).toEqual({
      board,
      images: [],
    });
    expect(splitBoardFile({ ...board, collection: '  Trimmed ' }).collection).toBe('Trimmed');
    expect(splitBoardFile([1])).toEqual({ board: [1], images: [] });
    expect(splitBoardFile(null)).toEqual({ board: null, images: [] });
  });

  it('carries the pictures beside the document and drops malformed ones', () => {
    const picture = { id: 'a'.repeat(64), mediaType: 'image/png' as const, data: 'iVBORw0K' };
    const file = JSON.parse(boardFileJson(board, undefined, [picture]));
    expect(file.images).toEqual([picture]);
    expect(splitBoardFile(file)).toEqual({ board, images: [picture] });
    for (const images of [
      [{ ...picture, mediaType: 'image/svg+xml' }],
      [{ ...picture, id: '../x' }],
      [{ ...picture, data: '<script>' }],
      [picture, picture],
    ])
      expect(splitBoardFile({ ...board, images }).images).toEqual([]);
  });
});
