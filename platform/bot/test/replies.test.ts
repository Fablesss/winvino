import { RecognitionSchema } from '@winvino/contract';
import { describe, expect, it } from 'vitest';
import { buildFailureReply, buildHelpReply, buildRecognitionReply, escapeHtml } from '../src/replies.ts';
import { sampleAmbiguous, sampleMatched, sampleNotInCatalog, sampleUnreadable, sampleWine } from './sampleRecognition.ts';

const WEB_APP_URL = 'https://winvino.test';
const privateChat = { webAppUrl: WEB_APP_URL };
const groupChat = { webAppUrl: null };

const webAppRow = [{ text: 'Открыть сканер', web_app: { url: WEB_APP_URL } }];
const catalogRow = [{ text: 'Карточка в каталоге', url: sampleWine.catalogUrl }];

describe('sample fixtures', () => {
  it('conformToContractSchema', () => {
    for (const recognition of [sampleMatched, sampleAmbiguous, sampleUnreadable, sampleNotInCatalog]) {
      expect(RecognitionSchema.safeParse(recognition).error).toBeUndefined();
    }
  });
});

describe('buildRecognitionReply', () => {
  it('matchedShowsWineCardWithBottlePhotoAndLinks', () => {
    const reply = buildRecognitionReply(sampleMatched, privateChat);

    expect(reply.html).toBe(
      [
        '<b>Бельбек Рислинг Резерв</b>',
        'Бельбек, Крым',
        'Белое сухое',
        '',
        'Сорт: Рислинг',
        'Крепость: 13,5 %',
        'Подавать при: 10–12 °C',
        '',
        'Совпадение 93 %',
      ].join('\n'),
    );
    expect(reply.photoUrl).toBe(sampleWine.imageUrl);
    expect(reply.buttons).toEqual([catalogRow, webAppRow]);
  });

  it('ambiguousWarnsFirstAndListsSimilarWinesAsCatalogLinks', () => {
    const reply = buildRecognitionReply(sampleAmbiguous, privateChat);

    expect(reply.html.startsWith('Не уверены — похоже на это вино (64 %).\n\n<b>Бельбек Рислинг Резерв</b>')).toBe(true);
    expect(reply.html).not.toContain('Совпадение');
    expect(reply.html).toContain(
      'Если не оно — похожие вина:\n• <a href="https://vino-svoe.ru/wines/usadba-divnomorskoe-riesling">' +
        'Усадьба Дивноморское «Рислинг &amp; Co»</a> — Усадьба Дивноморское, Краснодарский край · 21 %',
    );
    expect(reply.photoUrl).toBe(sampleWine.imageUrl);
  });

  it('matchedWithAlternativesOffersThemAsNotThatWine', () => {
    const reply = buildRecognitionReply({ ...sampleAmbiguous, status: 'matched' }, privateChat);
    expect(reply.html).toContain('Совпадение 64 %\n\nНе то вино?\n• ');
  });

  it('unreadableAsksToRetakeWithoutPhoto', () => {
    const reply = buildRecognitionReply(sampleUnreadable, privateChat);

    expect(reply.html).toBe(
      '<b>Не удалось прочитать этикетку</b>\n' +
        'Пришлите фото ближе и без бликов: текст этикетки должен быть чётким и занимать почти весь кадр.',
    );
    expect(reply.photoUrl).toBeNull();
    expect(reply.buttons).toEqual([webAppRow]);
  });

  it('notInCatalogSaysSoInsteadOfAskingToRetake', () => {
    const reply = buildRecognitionReply(sampleNotInCatalog, privateChat);
    expect(reply.html).toMatch(/^<b>Этого вина нет в каталоге<\/b>\nПока мы узнаём только российские вина/);
  });

  it('skipsEmptyWineFieldsAndMissingLinks', () => {
    const bareWine = {
      ...sampleWine,
      manufacturer: null,
      region: null,
      categoryLabel: null,
      grapes: [],
      alcoholPercent: null,
      servingTemperatureC: null,
      imageUrl: null,
      catalogUrl: null,
    };
    const reply = buildRecognitionReply({ ...sampleMatched, match: { wine: bareWine, confidence: 0.9 } }, groupChat);

    expect(reply.html).toBe('<b>Бельбек Рислинг Резерв</b>\n\nСовпадение 90 %');
    expect(reply.photoUrl).toBeNull();
    expect(reply.buttons).toEqual([]);
  });

  it('listsSeveralGrapesVintageAndSingleServingTemperature', () => {
    const wine = { ...sampleWine, grapes: ['Каберне-фран', 'Мерло'], vintage: 2021, servingTemperatureC: { min: 16, max: 16 } };
    const reply = buildRecognitionReply({ ...sampleMatched, match: { wine, confidence: 0.9 } }, privateChat);
    expect(reply.html).toContain('Сорта: Каберне-фран, Мерло\nУрожай: 2021\nКрепость: 13,5 %\nПодавать при: 16 °C');
  });

  it('escapesCatalogTextForTelegramHtml', () => {
    const wine = { ...sampleWine, title: 'Шато <Тест> & Ко' };
    const reply = buildRecognitionReply({ ...sampleMatched, match: { wine, confidence: 0.9 } }, privateChat);
    expect(reply.html).toContain('<b>Шато &lt;Тест&gt; &amp; Ко</b>');
  });
});

describe('buildFailureReply', () => {
  it('showsApiMessageAndRequestIdForSupport', () => {
    const reply = buildFailureReply({ message: 'Фото слишком маленькое — снимите этикетку крупнее.', requestId: '1024' }, privateChat);

    expect(reply.html).toBe(
      '<b>Не получилось распознать</b>\nФото слишком маленькое — снимите этикетку крупнее.\n\n' +
        'Номер запроса для поддержки: <code>1024</code>',
    );
    expect(reply.buttons).toEqual([webAppRow]);
  });
});

describe('buildHelpReply', () => {
  it('offersMiniAppOnlyWhereTelegramAllowsIt', () => {
    expect(buildHelpReply(privateChat).buttons).toEqual([webAppRow]);
    expect(buildHelpReply(groupChat).buttons).toEqual([]);
  });
});

describe('escapeHtml', () => {
  it('escapesAttributeQuotesToo', () => {
    expect(escapeHtml('a"b<c>&')).toBe('a&quot;b&lt;c&gt;&amp;');
  });
});
