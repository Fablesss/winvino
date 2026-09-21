/**
 * Цвета, которые нужны вне CSS: манифест PWA, theme-color, иконки.
 * Те же значения — в app/globals.css (--paper, --ruby); меняются вместе.
 */
export const BRAND_COLORS = {
  paper: '#F1F3EF',
  paperDark: '#151D19',
  ruby: '#8A1C3B',
} as const;

export const APP_NAME = 'winvino';
export const APP_TITLE = 'winvino — вино по этикетке';
export const APP_DESCRIPTION =
  'Сфотографируйте этикетку российского вина — покажем винодельню, сорт, регион и как его подавать.';
