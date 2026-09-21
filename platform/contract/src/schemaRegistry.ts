import { z } from 'zod';

/**
 * Схемы, которые становятся именованными `components.schemas` в OpenAPI.
 * Id — имя компонента: по нему генерируются типы в нативных клиентах, поэтому
 * переименование id — ломающее изменение контракта.
 * Описания полей — через `.describe()`: реестр хранит только id.
 */
export const openApiComponents = z.registry<{ id: string }>();
