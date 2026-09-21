import { describe, expect, it } from 'vitest';
import { API_ROUTES, createWinvinoClient, WinvinoApiError, type WinvinoErrorCode } from '../src/index.ts';
import { sampleMatched } from './sampleRecognition.ts';

type RecordedRequest = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return respond();
    },
  };
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function captureError(promise: Promise<unknown>): Promise<WinvinoApiError> {
  const error = await promise.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(WinvinoApiError);
  return error as WinvinoApiError;
}

const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

describe('createWinvinoClient.recognizeLabel', () => {
  it('postsMultipartImageFieldToRecognitionsRoute', async () => {
    const server = fakeFetch(() => jsonResponse(200, sampleMatched));
    const client = createWinvinoClient({ baseUrl: 'https://api.test/', fetch: server.fetch });

    const recognition = await client.recognizeLabel(image);

    expect(recognition).toEqual(sampleMatched);
    expect(server.requests[0]?.url).toBe(`https://api.test${API_ROUTES.recognitions}`);
    expect(server.requests[0]?.init?.method).toBe('POST');
    const form = server.requests[0]?.init?.body as FormData;
    expect(form.get('image')).toBeInstanceOf(Blob);
  });

  it('turnsErrorBodyIntoTypedError', async () => {
    const server = fakeFetch(() =>
      jsonResponse(413, { error: { code: 'IMAGE_TOO_LARGE', message: 'Фото больше 10 МБ', requestId: 'req-1', details: { maxBytes: 10 } } }),
    );
    const client = createWinvinoClient({ baseUrl: '', fetch: server.fetch });

    const error = await captureError(client.recognizeLabel(image));

    expect(error.code satisfies WinvinoErrorCode).toBe('IMAGE_TOO_LARGE');
    expect(error.httpStatus).toBe(413);
    expect(error.requestId).toBe('req-1');
    expect(error.details).toEqual({ maxBytes: 10 });
  });

  it('keepsUnknownServerCodeInsteadOfInvalidResponse', async () => {
    const server = fakeFetch(() => jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'Слишком часто', requestId: null } }));
    const error = await captureError(createWinvinoClient({ baseUrl: '', fetch: server.fetch }).recognizeLabel(image));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.httpStatus).toBe(429);
  });

  it('reportsNonJsonErrorAsInvalidResponseWithRequestIdHeader', async () => {
    const server = fakeFetch(() => new Response('<html>502</html>', { status: 502, headers: { 'X-Request-Id': 'req-2' } }));
    const error = await captureError(createWinvinoClient({ baseUrl: '', fetch: server.fetch }).recognizeLabel(image));
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.requestId).toBe('req-2');
  });

  it('rejectsSuccessBodyThatBreaksContract', async () => {
    const server = fakeFetch(() => jsonResponse(200, { ...sampleMatched, status: 'maybe' }));
    const error = await captureError(createWinvinoClient({ baseUrl: '', fetch: server.fetch }).recognizeLabel(image));
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  it('wrapsTransportFailureAsNetworkError', async () => {
    const server = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await captureError(createWinvinoClient({ baseUrl: '', fetch: server.fetch }).recognizeLabel(image));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.httpStatus).toBeNull();
  });

  it('passesCallerAbortThroughUnwrapped', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException('aborted', 'AbortError');
    const server = fakeFetch(() => Promise.reject(abortError));

    const rejection = createWinvinoClient({ baseUrl: '', fetch: server.fetch }).recognizeLabel(image, { signal: controller.signal });

    await expect(rejection).rejects.toBe(abortError);
  });
});
