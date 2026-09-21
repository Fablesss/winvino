// Мок-каталог: 10 реальных вин из зеркала vino-svoe.ru (разные цвета и сахар), выгружены
// тем же SELECT, что понадобится настоящему распознавателю: форма строки — CatalogWineRow.
import type { CatalogWineRow } from '../catalog/wineFromCatalogRow.ts';

export const MOCK_CATALOG_ROWS: CatalogWineRow[] = [
  {
    "id": "a646b93f-db36-450d-ae89-dfb5195cbf5f",
    "slug": "vinodelnya-batrak-prikumskoe-sonnenschein-shardone-beloe-suhoe-12",
    "title": "Прикумское Sonnenschein",
    "category_name": "Белое сухое",
    "wine_color": "Белое",
    "sweetness": "сухое",
    "hue": "Насыщенно-золотой",
    "public_rating": "5.00",
    "alcohol": "12.0",
    "serve_temperature": "10-12",
    "description": "Вкус: Свежий, яркий, с сочной кислинкой, тонами фруктов и полевых цветов, с медовыми мотивами в мягком послевкусии. Интенсивный, с цветочными акцентами, тонами спелых желтых яблок, груш и дыни.",
    "image_url": "/uploads/vinodelnya_batrak_prikumskoe_sonnenschein_shardone_beloe_suhoe_12_ee92c4745e.webp",
    "vintage": null,
    "manufacturer_slug": "vinodelnya-batrak",
    "manufacturer_name": "Винодельня Батрак",
    "region_name": "Ставрополье",
    "grapes": [
      "Шардоне"
    ],
    "dishes": [
      "Блюда из птицы",
      "Легкие закуски",
      "Мясо и стейки",
      "Рыба и морепродукты",
      "Фрукты"
    ]
  },
  {
    "id": "2cee78b4-4120-4462-92f9-ef7c812b2285",
    "slug": "valeriy-zaharin-rubedo-reserve-merlo-krasnoe-suhoe-13",
    "title": "Rubedo. Reserve",
    "category_name": "Красное сухое",
    "wine_color": "Красное",
    "sweetness": "сухое",
    "hue": "Глубокий рубиновый",
    "public_rating": "5.00",
    "alcohol": "13.0",
    "serve_temperature": "16-18",
    "description": "Вкус: С тонами вишни, черешни, шелковицы, ежевики, какао, гвоздики, с мягкими танинами и долгим послевкусием. Насыщенный, с нотами спелых ягод, шоколада и пряностей.",
    "image_url": "/uploads/valeriy_zaharin_rubedo_reserve_merlo_krasnoe_suhoe_13_bb611a1ce9.webp",
    "vintage": null,
    "manufacturer_slug": "valeriy-zaharin",
    "manufacturer_name": "Валерий Захарьин",
    "region_name": "Крым",
    "grapes": [
      "Мерло"
    ],
    "dishes": [
      "Мясо и стейки",
      "Паста",
      "Сыры"
    ]
  },
  {
    "id": "dc000ae0-9055-4004-9d41-fc3ad3adac5f",
    "slug": "denisov-winery-pino-nuar-rozovoe-suhoe-125",
    "title": "Пино Нуар",
    "category_name": "Розовое сухое",
    "wine_color": "Розовое",
    "sweetness": "сухое",
    "hue": "Светло-персиковый с тонкими розоватыми штрихами.",
    "public_rating": "5.00",
    "alcohol": "12.0",
    "serve_temperature": "10-12",
    "description": "Вкус: Мягкий, с нотами малины, красной смородины, трав и белых цветов, пикантной кислинкой и чарующим послевкусием. Гармоничный, свежий, с оттенками красного апельсина, малины, белых цветов и сахарной.",
    "image_url": "/uploads/denisov_winery_pino_nuar_rozovoe_suhoe_125_ad6a3633ed.webp",
    "vintage": null,
    "manufacturer_slug": "denisov-winery",
    "manufacturer_name": "Denisov Winery",
    "region_name": "Самара",
    "grapes": [
      "Пино Нуар"
    ],
    "dishes": [
      "Мясо и стейки",
      "Рыба и морепродукты"
    ]
  },
  {
    "id": "efef708c-5517-4676-a5f5-0bc21fb41cf7",
    "slug": "gevyurcztraminer-oranzh",
    "title": "Гевюрцтраминер Оранж",
    "category_name": "Оранжевое сухое",
    "wine_color": "Оранжевое",
    "sweetness": "сухое",
    "hue": "Золотистый с розовым отливом",
    "public_rating": "5.00",
    "alcohol": "12.0",
    "serve_temperature": "10-12",
    "description": "Брожение на мезге в течение 21 дня.\n\nВинодел: Дмитрий Болотаев\n\nВ аромате благоухающие лепестки роз и цветов. Во вкусе — баланс между яркой фруктовостью и тонкой танинной структурой, с оттенками кураги, айвы и специй.\n \nВино получилось ярким и гастрономичным.",
    "image_url": "/uploads/Gevyurcztraminer_Oranzh_Usadba_Petovskih_f3d914f332.webp",
    "vintage": null,
    "manufacturer_slug": "usadba-perovskih",
    "manufacturer_name": "Усадьба Перовских",
    "region_name": "Крым",
    "grapes": [
      "Гевюрцтраминер"
    ],
    "dishes": [
      "Азиатская кухня",
      "Запеченные овощи",
      "Сыры"
    ]
  },
  {
    "id": "03ca4d5a-114d-44f3-af88-05b4ca9442e7",
    "slug": "vinodelnya-myshako-quintessence-new-generation-brut-white-shardone-beloe-bryut-11",
    "title": "Quintessence New Generation. Brut White",
    "category_name": "Белое брют",
    "wine_color": "Белое",
    "sweetness": "брют",
    "hue": "Светло-соломенный",
    "public_rating": "5.00",
    "alcohol": "11.0",
    "serve_temperature": "8-10",
    "description": "Вкус: Сбалансированный с приятным послевкусием с фруктово-цитрусовыми оттенками. Ноты крыжовника, смородины, шелковицы, оттенки цитрусовых.",
    "image_url": "/uploads/vinodelnya_myshako_quintessence_new_generation_brut_white_shardone_igristoe_bryut_beloe_11_a6ff8c556a.webp",
    "vintage": null,
    "manufacturer_slug": "vinodelnya-myshako",
    "manufacturer_name": "Мысхако",
    "region_name": "Кубань",
    "grapes": [
      "Шардоне"
    ],
    "dishes": [
      "Легкие закуски",
      "Рыба и морепродукты",
      "Салаты"
    ]
  },
  {
    "id": "c349dfa8-cc7b-4a42-85e9-50d965f6fa28",
    "slug": "aristov-kyuve-aleksandr-roze-de-pino",
    "title": "Аристов. Кюве Александр. Розе Де Пино",
    "category_name": "Розовое экстра брют",
    "wine_color": "Розовое",
    "sweetness": "экстра брют",
    "hue": "Жемчужно-розовый",
    "public_rating": "5.00",
    "alcohol": "11.0",
    "serve_temperature": "6-8",
    "description": "Вкус насыщенный, изысканный, с приятной бархатистой текстурой, тонами спелых фруктов, сбалансированной кислотностью и долгим развивающимся послевкусием. В аромате фруктово-ягодные тона, с минеральными нотами, нюансами джема и фиалки.\n\nКлассическая технология производства, согласно которой вино подвергается бутылочной шампанизации с выдержкой не менее 9 месяцев после её окончания.",
    "image_url": "/uploads/Aristov_Kyuve_Roze_Pino_2023_0_75l_bryut_Normal_Photoroom_cc598880d5.webp",
    "vintage": null,
    "manufacturer_slug": "kuban-vino",
    "manufacturer_name": "Кубань-Вино",
    "region_name": "Кубань",
    "grapes": [
      "Пино Нуар"
    ],
    "dishes": [
      "Блюда из птицы",
      "Рыба и морепродукты",
      "Салаты",
      "Сыры"
    ]
  },
  {
    "id": "e08a165d-dd58-4ac3-9b26-b2e6a23fe917",
    "slug": "inkermanskiy-zmv-winemakers-selection-saperavi-krasnoe-polusladkoe-12",
    "title": "Winemaker's Selection Саперави",
    "category_name": "Красное полусладкое",
    "wine_color": "Красное",
    "sweetness": "полусладкое",
    "hue": "Цвет глубокий, рубиновый.",
    "public_rating": "5.00",
    "alcohol": "12.0",
    "serve_temperature": "8–10",
    "description": "Игра мелких настойчивых пузырьков. Аромат узнаваемый сортовой: черная пряная вишня, зрелый кизил, тона черной смородины и граната. Простой и понятный вкус сладких черных фруктов уравновешен заметной кислотностью и приятной терпкостью.",
    "image_url": "/uploads/inkermanskiy_zmv_winemakers_selection_saperavi_igristoe_polusladkoe_krasnoe_12_b8254979b2.webp",
    "vintage": null,
    "manufacturer_slug": "inkermanskiy_zmv",
    "manufacturer_name": "Инкерманский ЗМВ",
    "region_name": "Крым",
    "grapes": [
      "Саперави"
    ],
    "dishes": [
      "Выпечка и десерты",
      "Русская кухня",
      "Рыба и морепродукты",
      "Сыры"
    ]
  },
  {
    "id": "86e5bff2-039b-4ce2-a337-2b0b7e866279",
    "slug": "massandra-portveyn-belyy-krymskiy-kokur-beloe-sladkoe-18",
    "title": "Портвейн белый крымский",
    "category_name": "Белое сладкое",
    "wine_color": "Белое",
    "sweetness": "сладкое",
    "hue": "Янтарно-золотистый",
    "public_rating": "5.00",
    "alcohol": "18.0",
    "serve_temperature": "8-10",
    "description": "Аромат сложный, многоплановый: сухофрукты, ваниль, лёгкие ореховые тона; вкус богатый, гармоничный, с оттенками ореха и сухофруктов, приятным сухим финишем. Создан из множества белых сортов 1944 года. К рыбным блюдам, морепродуктам, голубым сырам и орехам.",
    "image_url": "/uploads/massandra_portveyn_belyy_krymskiy_kokur_beloe_sladkoe_18_4a04230d4f.webp",
    "vintage": null,
    "manufacturer_slug": "massandra",
    "manufacturer_name": "Массандра",
    "region_name": "Крым",
    "grapes": [
      "Алиготе",
      "Кокур",
      "Ркацители"
    ],
    "dishes": [
      "Десерты",
      "Мороженое"
    ]
  },
  {
    "id": "fcfbdaec-4895-4251-ac79-61828abfc3e6",
    "slug": "risling-1",
    "title": "Рислинг",
    "category_name": "Белое полусухое",
    "wine_color": "Белое",
    "sweetness": "полусухое",
    "hue": "Светло-золотистый",
    "public_rating": "5.00",
    "alcohol": "12.0",
    "serve_temperature": "10-12",
    "description": "В аромате фруктово-цветочные ноты, с оттенками свежескошенной травы и медовой сладости. Вкус фруктовый, в потенциале бензольные ноты.",
    "image_url": "/uploads/Screenshot_11_a9d7c8f8df.webp",
    "vintage": null,
    "manufacturer_slug": "tabiya",
    "manufacturer_name": "Табия",
    "region_name": "Кубань",
    "grapes": [
      "Рислинг Рейнский"
    ],
    "dishes": [
      "Морепродукты",
      "Салаты",
      "Сыры"
    ]
  },
  {
    "id": "f7cc7234-64f9-4a05-b671-8bff005804eb",
    "slug": "abrau-dyurso-abrau-estates-amurskiy-potapenko-krasnoe-suhoe-105",
    "title": "Abrau Estates Амурский Потапенко",
    "category_name": "Красное сухое",
    "wine_color": "Красное",
    "sweetness": "сухое",
    "hue": "Рубиновый с пурпурным оттенком",
    "public_rating": "5.00",
    "alcohol": "10.0",
    "serve_temperature": "16-18",
    "description": "В аромате цветочные ноты пионов и фиалок, тона черных ягод и фруктов – шелковицы, черной смородины и ежевики с нюансами пряностей. Во вкусе ноты синей сливы, черешни, черной смородины. Послевкусие с яркими танинами и тонкой пряностью.",
    "image_url": "/uploads/abrau_dyurso_abrau_estates_amurskiy_potapenko_krasnoe_suhoe_105_a70c9cabe2.webp",
    "vintage": null,
    "manufacturer_slug": "abrau-dyurso",
    "manufacturer_name": "Абрау-Дюрсо",
    "region_name": "Кубань",
    "grapes": [
      "Амурский Потапенко"
    ],
    "dishes": [
      "Мясное ассорти",
      "Сыры"
    ]
  }
];
