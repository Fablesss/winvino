import { describe, expect, it } from 'vitest';
import { pickLabelFile, pickPhotoSize } from '../src/pickLabelFile.ts';
import type { TelegramMessage } from '../src/telegram/botApi.ts';

const baseMessage: TelegramMessage = { message_id: 1, chat: { id: 1, type: 'private' } };

describe('pickPhotoSize', () => {
  it('takesLargestSizeWithinRecommendedSide', () => {
    const sizes = [
      { file_id: 'original', width: 2560, height: 1920 },
      { file_id: 'thumb', width: 320, height: 240 },
      { file_id: 'fits', width: 1600, height: 1200 },
    ];
    expect(pickPhotoSize(sizes)?.file_id).toBe('fits');
  });

  it('takesSmallestWhenAllExceedRecommendedSide', () => {
    const sizes = [
      { file_id: 'huge', width: 4000, height: 3000 },
      { file_id: 'large', width: 2560, height: 1920 },
    ];
    expect(pickPhotoSize(sizes)?.file_id).toBe('large');
  });
});

describe('pickLabelFile', () => {
  it('prefersPhotoAndNamesItJpeg', () => {
    const message = { ...baseMessage, photo: [{ file_id: 'p', width: 1280, height: 960 }] };
    expect(pickLabelFile(message)).toEqual({ kind: 'file', fileId: 'p', filename: 'label.jpg' });
  });

  it('leavesFormatCheckOfImageDocumentsToApi', () => {
    const message = { ...baseMessage, document: { file_id: 'd', file_name: 'IMG_1.HEIC', mime_type: 'image/heic', file_size: 3_000_000 } };
    expect(pickLabelFile(message)).toEqual({ kind: 'file', fileId: 'd', filename: 'IMG_1.HEIC' });
  });

  it('refusesImageDocumentsOverApiLimit', () => {
    const message = { ...baseMessage, document: { file_id: 'd', mime_type: 'image/jpeg', file_size: 10 * 1024 * 1024 + 1 } };
    expect(pickLabelFile(message)).toEqual({ kind: 'too_large' });
  });

  it('ignoresTextAndNonImageDocuments', () => {
    expect(pickLabelFile({ ...baseMessage, text: 'привет' })).toEqual({ kind: 'none' });
    expect(pickLabelFile({ ...baseMessage, document: { file_id: 'd', mime_type: 'application/pdf' } })).toEqual({ kind: 'none' });
  });
});
