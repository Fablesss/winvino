/**
 * Цвета, которые нужны вне CSS: манифест PWA, theme-color, иконки, окно Telegram.
 * Те же значения — в app/globals.css (--paper, --action); меняются вместе.
 */
export const BRAND_COLORS = {
  paper: '#FEFDFA',
  paperDark: '#1A1614',
  ruby: '#8F3D42',
} as const;

export const APP_NAME = 'winvino';
export const APP_TITLE = 'winvino — вино по этикетке';
export const APP_DESCRIPTION =
  'Сфотографируйте этикетку российского вина — покажем винодельню, сорт, регион и как его подавать.';
