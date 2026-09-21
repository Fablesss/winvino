import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { convertBottleToChatJpeg, fetchBottlePhotoJpeg } from '../src/bottlePhoto.ts';

/** Как в каталоге: узкая бутылка на прозрачном фоне, WebP. */
async function transparentWebp(width: number, height: number): Promise<Uint8Array> {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer();
}

describe('convertBottleToChatJpeg', () => {
  it('fillsTransparencyWithPaperAndPadsNarrowBottleToThreeByFour', async () => {
    const jpeg = await convertBottleToChatJpeg(await transparentWebp(40, 160));

    const metadata = await sharp(jpeg).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 120, height: 160, hasAlpha: false });
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const [red = 0, green = 0, blue = 0] = data;
    // #F1F3EF с допуском на JPEG
    expect(Math.abs(red - 0xf1) + Math.abs(green - 0xf3) + Math.abs(blue - 0xef)).toBeLessThan(9);
  });

  it('keepsWideImageSize', async () => {
    const metadata = await sharp(await convertBottleToChatJpeg(await transparentWebp(200, 100))).metadata();
    expect(metadata).toMatchObject({ width: 200, height: 100 });
  });
});

describe('fetchBottlePhotoJpeg', () => {
  it('convertsCatalogOctetStreamIntoJpegBlob', async () => {
    const webp = await transparentWebp(40, 160);
    const catalogFetch: typeof fetch = async () =>
      new Response(new Blob([webp]), { headers: { 'Content-Type': 'application/octet-stream' } });

    const photo = await fetchBottlePhotoJpeg('https://catalog.test/bottle.webp', catalogFetch);

    expect(photo.type).toBe('image/jpeg');
    expect((await sharp(new Uint8Array(await photo.arrayBuffer())).metadata()).format).toBe('jpeg');
  });

  it('failsLoudlyOnHttpError', async () => {
    const catalogFetch: typeof fetch = async () => new Response('not found', { status: 404 });
    await expect(fetchBottlePhotoJpeg('https://catalog.test/missing.webp', catalogFetch)).rejects.toThrow(/HTTP 404/);
  });
});
