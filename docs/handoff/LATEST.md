> Копия архивного handoff: [2026-10-31-russian-localization.md](2026-10-31-russian-localization.md)

# Handoff: Полная русская локализация StrataHarness (`russian-localization`)

## Состояние

- **Цель:** Внедрить полный стандартный пакет русской локализации (`ru`, `Русский`) в `StrataHarness` (Web и Desktop): установить русский язык активным по умолчанию при отсутствии сохранённого `locale.preference`, зафиксировать порядок выбора в `Настройки → Основные → Язык` (`1. Русский` → `2. English` → `3. 中文`), локализовать 100% клиентских словарей, нативные меню/диалоги Electron и Windows NSIS-инсталлятор, ролевые пресеты `Strata*` и метаданные встроенных плагинов в архитектуре `Soft-Fork` ([0003-russian-localization-spec.md](../specs/0003-russian-localization-spec.md)).
- **Достигнутый этап:** Этап 6 — Закрытие задачи (`/close-task`); маршрут `Development` / `Epic` (этапы `1 → 2 → 3 → 4 → 5 → 6`), трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`), сборка и ручная проверка Windows NSIS `.exe`-установщика успешно завершены.
- **Что сделано:**
  - Создан изолированный пакет [`@strata/locale-ru`](../../packages/strata/locale-ru/package.json) (`version: 1.0.0`, `dsh.client.immediately: true`), подключённый в [cordis.patch.yml](../../packages/strata/product-bundle/cordis.patch.yml) с конфигурацией `defaultLocale: "ru"` и `localeOrder: ["ru", "en", "zh"]`.
  - В [`@deepseek-ai/dsh-client-locale`](../../packages/client/locale/README.md) добавлены валидируемые поля `Config` (`defaultLocale`, `localeOrder`) с пробросом через `__DSH_LOCALE_CONFIG__`, реестр `registerTextCatalog`, поддержка ICU-множественного числа (`{count, plural, one ... few ... many ... other ...}`) через стандартный `Intl.PluralRules` ([interpolate.ts](../../packages/client/locale/src/client/interpolate.ts)) и отложенная первичная синхронизация `<html lang>` / `__DSH_LOCALE__.onChange` до регистрации внешнего языкового пакета Phase 1.
  - Переведены все `66` клиентских пространств имён (`65` типизированных в `LocaleNamespaceMap` + `directory-browser`), все `167` ключей оболочки Electron ([apps/desktop/src/locale.ts](../../apps/desktop/src/locale.ts)), экран ранней загрузки [boot-page.ts](../../packages/client/web/src/boot-page.ts), HTML-оболочки (`<html lang="ru">`), строки Windows NSIS-инсталлятора ([strings.nsh](../../apps/desktop/installer/strings.nsh), `STRATA_NSIS_INSTALLER_LANGUAGES = ['ru_RU', 'en_US', 'zh_CN']`) и локали macOS (`CFBundleLocalizations = ['ru', 'en', 'zh_CN']`).
  - Добавлена локализация описаний четырёх встроенных ролевых пресетов (`strata`, `strata-developer`, `strata-analyst`, `strata-designer`) с сохранением их технических названий и англоязычных системных промптов для модели, добавлены `locale/ru.json` во все пакеты `packages/strata/*`, локализованы встроенные запросы подтверждения (`sandbox` escalation и `auto-review`), а также собран каталог [`ruPluginMetadataCatalog`](../../packages/strata/locale-ru/src/client/locales/plugin-metadata.ts) (`522` записи), покрывающий все встроенные `locale/en.json`, `OFFICIAL_ON_DEMAND_CATALOG` и встроенные YAML-спецификаторы без `locale/en.json`.
  - Добавлен автоматический гейт стопроцентного паритета [russian-localization-parity.spec.ts](../../scripts/strata/russian-localization-parity.spec.ts), расширен аудит `pnpm run strata:audit-overrides` ([fork-ops.ts](../../scripts/strata/fork-ops.ts)), обновлены глоссарий [CONTEXT.md](../../.agents/CONTEXT.md), ранбук [fork-maintenance.md](../strata/fork-maintenance.md) и двуязычная архитектурная заметка [2026-10-31-strata-russian-localization-pack.md](../../.agents/notes/implemented/architecture/2026-10-31-strata-russian-localization-pack.md) ([.zh.md](../../.agents/notes/implemented/architecture/2026-10-31-strata-russian-localization-pack.zh.md)).
- **Важные эксплуатационные нюансы (Gotchas):**
  - При обновлении уже установленного `StrataHarness` поверх существующего профиля `%USERPROFILE%\.strataharness\` сохранённый вручную `locale.preference` (например, `en`) в `cordis.patch.yml` имеет приоритет над `defaultLocale: "ru"`; безусловный русский язык применяется ко всем новым профилям и профилям без явно записанного `locale.preference`.
  - При будущих синхронизациях с апстримом (`sync/dsh-v*`) любые новые ключи в `LocaleNamespaceMap`, `apps/desktop/src/locale.ts` или встроенных плагинах детерминированно ловятся компиляцией `@strata/locale-ru` и тестом `scripts/strata/russian-localization-parity.spec.ts`.
  - Локальный неподписанный установщик Windows собирается командой `pnpm run package:desktop:win:x64:unsigned` в `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`.

## Открытые тикеты

none

## Следующий шаг

1. При готовности отправить локальный коммит в удалённый репозиторий (`git push`) и перейти к подготовке релиза `strata-v1.0.0` через ручной скилл `/strata-release` (или пересобрать чистовой `.exe` после коммита, если требуется `dshBuildDirty: false` в метаданных пакета).
2. Любую новую задачу разработки или анализа начинать с **Шага 0** согласно корневому [AGENTS.md](../../AGENTS.md).

## Рекомендуемые скиллы

- Ручной мастер подготовки и выпуска релиза продукта (`/strata-release`): `.agents/skills/strata-release/SKILL.md`
- Выбор минимального набора локальных проверок перед пушем: `.agents/skills/dsh-pre-push-checks/SKILL.md`
- Роутер скиллов и маршрутов: `.agents/skills/ask/SKILL.md`
- Этап 1 (Интервью разработки): `.agents/skills/grill-with-docs/SKILL.md`
- Маршрут исследования без правок кода (`Analysis`): `.agents/skills/analyze/SKILL.md`
