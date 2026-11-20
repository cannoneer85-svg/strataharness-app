# Спецификация 0008: Исправление запуска создания плагина и синхронизации встроенных плагинов в настройках (`fix-plugin-creation-and-settings-sync`)

- **Статус триажа:** `ready-for-agent`
- **Категория:** `Development` / `Feature`
- **Фича:** `fix-plugin-creation-and-settings-sync`

## Problem Statement

В пользовательской среде `StrataHarness` (поверх `@deepseek-ai/dsh-web-app` и `@strata/product-bundle`) наблюдаются два сбоя в сценариях работы с плагинами:

1. **Ошибка создания плагина (`Unknown agent preset: cordis`):** при нажатии на пункт меню «Создать свой плагин» в любом из трёх меню «Ещё» (левая боковая панель, вкладки представления сессии, правая панель) клиентский плагин `@deepseek-ai/dsh-client-ui-entry-customization` запускает новую сессию с пресетом `cordis`. Поскольку продуктовый слой `@strata/product-bundle` отключает апстримный `preset-cordis`, создание сессии завершается ошибкой `agent-preset/not-found: Unknown agent preset: cordis`. Кроме того, целевой пресет разработчика `strata-developer` не оснащён инструментом инспекции Cordis (`tool-cordis`), инструментами управления/поиска плагинов (`tool-plugin-manager`, `tool-plugin-market`) и документационным скиллом `dsh-doc`, необходимыми для разработки плагинов DSH.
2. **Ошибка синхронизации в «Настройки → Встроенные плагины» (`waiting for activation`):** при переходе в раздел настроек «Встроенные плагины» отображается красный баннер ошибки синхронизации для `@deepseek-ai/dsh-client-ui-account-notifications` с сообщением `client-modules: @deepseek-ai/dsh-client-ui-account-notifications is waiting for activation`. Причина — продуктовый слой `@strata/product-bundle` отключает `deepseek-account` и `ui-settings-account` (которые предоставляют сервисы `remote.account` и `accountUi`), но оставляет включённым зависящий от них `ui-account-notifications`.

## Solution

Устранить оба дефекта средствами продуктового слоя `@strata/product-bundle` без внесения точечных правок (`strata(override)`) в апстрим-пакеты:

1. **Маршрутизация пресета `cordis` на `strata-developer`:** добавить алиас `cordis: strata-developer` в конфигурацию `agent-preset-registry` слоя `@strata/product-bundle`, чтобы вызовы запуска сессии с `agentPreset: 'cordis'` (включая все три точки входа «Создать свой плагин») прозрачно открывали `strata-developer`.
2. **Оснащение `strata-developer` для разработки плагинов:** подключить в состав плагинов пресета `strata-developer` инструмент `tool-cordis`, инструменты `tool-plugin-manager` и `tool-plugin-market` (с защитой `disabled` при отсутствии `profileContext`), а также добавить каталог скиллов `@deepseek-ai/dsh-agent-preset` (`dsh-doc`) через `customSkillDirs` в `skill-filesystem` с сохранением `bundledSkillDir` для скиллов StrataHarness.
3. **Отключение `ui-account-notifications` и защита от рассинхронизации клиентских зависимостей:** отключить `ui-account-notifications` в продуктовом слое `@strata/product-bundle` рядом с `ui-settings-account`, задокументировать алиас и его ограничение в документации пакета `@strata/product-bundle`, а также добавить автоматические проверки в модульных тестах пакета.

## User Stories

1. Как пользователь `StrataHarness`, я хочу нажать «Создать свой плагин» в меню «Ещё» левой боковой панели, чтобы открылась сессия с пресетом `Strata Developer` и предзаполненным черновиком промпта без ошибки `Unknown agent preset: cordis`.
2. Как пользователь `StrataHarness`, я хочу нажать «Создать свой плагин» в меню вкладок представления сессии (`conversation`), чтобы корректно подготовилась сессия разработки плагина представления сессии.
3. Как пользователь `StrataHarness`, я хочу нажать «Создать свой плагин» в меню правой боковой панели (`rightbar`), чтобы корректно подготовилась сессия разработки плагина правой панели.
4. Как пользователь `StrataHarness`, я хочу, чтобы в открывшейся сессии `Strata Developer` агент имел доступ к скиллу `dsh-doc` и инструменту инспекции `tool-cordis`, чтобы он опирался на канонический контракт API плагинов DSH, а не пытался восстанавливать его по исходникам приложения.
5. Как пользователь `StrataHarness`, я хочу, чтобы агент в пресете `Strata Developer` при работе в профиле имел доступ к инструментам управления и каталога плагинов (`tool-plugin-manager`, `tool-plugin-market`), чтобы помогать с установкой и проверкой разрабатываемого плагина.
6. Как пользователь `StrataHarness`, я хочу, чтобы при запуске пресета `Strata Developer` в окружении без `profileContext` инструменты `tool-plugin-manager` и `tool-plugin-market` безопасно отключались без ошибки загрузки пресета.
7. Как пользователь `StrataHarness`, я хочу открывать «Настройки → Встроенные плагины» без красного баннера ошибки синхронизации `waiting for activation` у `@deepseek-ai/dsh-client-ui-account-notifications`.
8. Как пользователь `StrataHarness`, я хочу, чтобы кнопка «Повторить синхронизацию страницы» и список встроенных плагинов отражали полностью синхронизированное состояние клиентских модулей, при котором отключённые аккаунт-зависимые плагины не зависают в ожидании активации.
9. Как мейнтейнер `Soft-Fork`, я хочу, чтобы исправление выполнялось целиком в пакете `@strata/product-bundle` без `strata(override)` в апстрим-пакетах, чтобы не усложнять последующие слияния с релизами `dsh-v*`.
10. Как мейнтейнер `Soft-Fork`, я хочу, чтобы автоматический тест проверял граф `inject`-зависимостей всех активных клиентских плагинов в композиции `@strata/product-bundle`, чтобы будущие обновления апстрима сразу выявляли плагины, зависящие от отключённых сервисов.
11. Как мейнтейнер `Soft-Fork`, я хочу, чтобы документация пакета `@strata/product-bundle` явно описывала алиас `cordis: strata-developer`, состав инструментов `strata-developer` и ограничение коллизии при ручном включении `preset-cordis`.

## Implementation Decisions

- **Область изменений (принцип `minimal-diff`):** изменения ограничиваются пакетом `@strata/product-bundle` (конфигурационный патч слоя, описание пресета `strata-developer`, документация пакета и его тестовый набор). Правки в апстрим-пакеты `@deepseek-ai/dsh-client-ui-entry-customization`, `@deepseek-ai/dsh-agent-preset-registry` и `@deepseek-ai/dsh-client-ui-account-notifications` не вносятся, новые внешние зависимости не добавляются (все необходимые пакеты, включая `@deepseek-ai/dsh-tool-cordis`, `@deepseek-ai/dsh-agent-preset`, `@deepseek-ai/dsh-plugin-manager` и `@deepseek-ai/dsh-plugin-market`, уже объявлены в зависимостях `@strata/product-bundle`).
- **Алиас `cordis: strata-developer` в `agent-preset-registry`:** в конфигурации `agent-preset-registry` слоя `@strata/product-bundle` добавляется сопоставление `cordis` → `strata-developer` рядом с существующим алиасом `strata` → `strata-developer`. Механизм `normalizeId` в `AgentPresetRegistry` автоматически преобразует запрос `cordis` в `strata-developer` при разрешении, чтении и монтировании пресета.
- **Ограничение ручного переопределения `preset-cordis`:** `AgentPresetRegistry` запрещает совпадение идентификатора активного пресета с ключом алиаса. Поскольку в штатной композиции Strata `preset-cordis` отключён, алиас не конфликтует; поведение при ручном включении `preset-cordis` в пользовательском профиле документируется в обзоре пакета `@strata/product-bundle` как известное ограничение.
- **Состав инструментов и скиллов в `strata-developer`:**
  - подключается `tool-cordis` (`@deepseek-ai/dsh-tool-cordis`) — хостовые провайдеры инспекции (`cordis-inspect-providers`) уже смонтированы в базовой композиции `@deepseek-ai/dsh-web-app`;
  - подключаются `tool-plugin-manager` (`@deepseek-ai/dsh-plugin-manager/tools`) и `tool-plugin-market` (`@deepseek-ai/dsh-plugin-market/tools`) с условием отключения при отсутствии `profileContext`, аналогично пресетам `standard` и `cordis`;
  - в настройках `skill-filesystem` сохраняется `bundledSkillDir` для скиллов StrataHarness и добавляется `customSkillDirs`, указывающий на каталог скиллов пакета `@deepseek-ai/dsh-agent-preset` (содержащий `dsh-doc`), разрешаемый относительно файла пресета.
- **Отключение `ui-account-notifications`:** строка `ui-account-notifications` отключается (`disabled: true`) в общем патче `@strata/product-bundle` в секции отключения облачных аккаунт-сервисов рядом с `deepseek-account` и `ui-settings-account`.

## Testing Decisions

- **Шов тестирования:** единый существующий интеграционный шов в модуле тестов `@strata/product-bundle` — композиция полных слоёв бандла (`base` + `web-app` + `@strata/product-bundle`) с последующей проверкой через публичные API `AgentPresetRegistry`, `skill-filesystem` и статический разбор `inject`-зависимостей клиентских модулей. Создание новых тестовых швов или моков не требуется.
- **Проверяемое внешнее поведение:**
  - реестр `AgentPresetRegistry`, инициализированный из скомпонованной конфигурации, разрешает алиасы `strata` и `cordis` в `strata-developer` и сохраняет 4 активных пресета (`standard`, `strata-developer`, `strata-analyst`, `strata-designer`);
  - в скомпонованном пресете `strata-developer` присутствуют `tool-cordis`, `tool-plugin-manager`, `tool-plugin-market` (с выражением отключения при отсутствии `profileContext`), а `skill-filesystem` сохраняет `bundledSkillDir` и содержит `customSkillDirs`, путь из которого реально разрешается на диске и содержит скилл `dsh-doc`;
  - `ui-account-notifications` отключён в итоговой композиции `@strata/product-bundle`;
  - ни один активный клиентский модуль из итоговой композиции, поставляемый пакетами рабочей области, не объявляет в `export const inject` сервисы, чьи единственные провайдеры отключены в `@strata/product-bundle` (включая `remote.account`, `accountUi`, `remote.productAnalytics`, `remote.sessionLog`).
- **Аналоги в кодовой базе:** существующие тесты композиции пресетов и конфигов в `@strata/product-bundle`.

## Acceptance Criteria

1. `[auto]` В итоговой композиции `base` + `web-app` + `@strata/product-bundle` в конфигурации `agent-preset-registry` присутствуют алиасы `strata: strata-developer` и `cordis: strata-developer`, а `AgentPresetRegistry.resolve('cordis')` возвращает `{ id: 'strata-developer' }`.
2. `[auto]` В скомпонованном пресете `strata-developer` подключён `tool-cordis` (`@deepseek-ai/dsh-tool-cordis`).
3. `[auto]` В скомпонованном пресете `strata-developer` подключены `tool-plugin-manager` и `tool-plugin-market` с условием отключения при отсутствии `profileContext`.
4. `[auto]` В `skill-filesystem` пресета `strata-developer` сохранено свойство `bundledSkillDir` и настроено `customSkillDirs`, указывающее на каталог скиллов `@deepseek-ai/dsh-agent-preset`, при этом скилл `dsh-doc` физически доступен в этом каталоге и загружается совместно со скиллами StrataHarness.
5. `[auto]` В итоговой композиции `base` + `web-app` + `@strata/product-bundle` строка `ui-account-notifications` имеет `disabled: true`.
6. `[auto]` Автоматический тест в `@strata/product-bundle` подтверждает, что среди всех активных клиентских плагинов итоговой композиции ни один не объявляет в `inject` сервисы, провайдеры которых отключены слоем `@strata/product-bundle`.
7. `[auto]` Документация `@strata/product-bundle` (английская и русская/парная при наличии в проверках `doc-sync`) отражает алиас `cordis: strata-developer`, отключение `ui-account-notifications`, добавление `tool-cordis`/`tool-plugin-manager`/`tool-plugin-market`/`dsh-doc` в `strata-developer` и ограничение при ручном включении `preset-cordis`; релевантные проверки (`vitest`, `typecheck`, `doc-sync`) проходят без ошибок.
8. `[manual]` В запущенном веб-/десктоп-приложении нажатие «Создать свой плагин» в меню «Ещё» создаёт сессию с пресетом `Strata Developer` и черновиком промпта без ошибки `Unknown agent preset: cordis`, а раздел «Настройки → Встроенные плагины» открывается без красного баннера ошибки синхронизации у `@deepseek-ai/dsh-client-ui-account-notifications`.

## Out of Scope

- Изменение апстримного плагина `@deepseek-ai/dsh-client-ui-entry-customization` для параметризации имени пресета.
- Изменение логики обработки коллизии алиасов в `@deepseek-ai/dsh-agent-preset-registry`.
- Редактирование текста или переводов промптов `createPrompt.*` в `@strata/locale-ru`.
- Включение DeepSeek-аккаунта или облачных уведомлений аккаунта.

## Further Notes

- Все решения зафиксированы в журнале интервью без оставшихся открытых вопросов; кандидатов на отдельный ADR нет, поскольку изменения локализованы и обратимы в конфигурации `@strata/product-bundle`.
- Перед правкой документации `@strata/product-bundle` необходимо проверить парность/переводы в соответствии с `doc-sync` и `docs/AGENTS.md`.
