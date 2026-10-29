# Эксплуатационный ранбук сопровождения Soft-Fork и релизов StrataHarness Desktop

Настоящий документ описывает эксплуатационный регламент сопровождения десктопного продукта `StrataHarness` поверх апстрим-репозитория `DeepSeek Harness` (`https://github.com/deepseek-ai/deepseek-harness.git`), управления двухконтурным версионированием, обновления методологии, выпуска кроссплатформенных релизов `strata-v*` и перехода от неподписанных (`unsigned`) к криптографически подписанным (`signed`) сборкам без изменения исходного кода.

Связанные документы:

- Доменный глоссарий: [`.agents/CONTEXT.md`](../../.agents/CONTEXT.md)
- Спецификация инфраструктуры релизов и `Soft-Fork`: [`docs/specs/0001-strata-ci-release-and-fork-sync-spec.md`](../specs/0001-strata-ci-release-and-fork-sync-spec.md)
- Архитектурные решения (Agent Notes):
  - [Dual-track product versioning for StrataHarness Desktop](../../.agents/notes/implemented/architecture/2026-10-29-strata-dual-track-product-versioning.md)
  - [Isolate upstream GitHub Actions workflows via archive relocation](../../.agents/notes/implemented/process/2026-10-29-upstream-workflow-relocation-isolation.md)
  - [StrataHarness release distribution, signing modes, and upstream release radar](../../.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.md)

---

## 1. Архитектура двухконтурного версионирования (`Dual-Track Versioning`)

`StrataHarness Desktop` разделяет собственную продуктовую версию (`1.0.0+`) и версию встроенного агентного движка `DeepSeek Harness` (`0.2.1-rc.4`), чтобы выпускать независимые продуктовые релизы без конфликтов слияния в сотне апстримных `package.json`:

| Контур | Источник истины | Текущая базовая линия | Где отображается и применяется |
|---|---|---|---|
| **Продуктовая версия (`Product SemVer`)** | [`strata-product.json`](../../strata-product.json) (`productVersion`) + `packages/strata/*/package.json` | `1.0.0` (теги `strata-v1.0.0`) | `app.getVersion()`, имена установщиков `strataharness-<version>-<os>-<arch>.*`, фиды `electron-updater`, окно `About StrataHarness`, `DSH_CLIENT_VERSION`, GitHub Releases |
| **Версия ядра (`DSH Engine Version`)** | Корневой [`package.json`](../../package.json), `apps/desktop/package.json` и все `@deepseek-ai/dsh-*` | `0.2.1-rc.4` (`upstreamBaseTag: "dsh-v0.2.1-rc.4"`) | `app.asar/dsh/desktop-runtime.json`, `pnpm run constraints` (`checkDshFamilyVersion`), справочная строка `Engine: DSH <version>` в `About` и Release Notes |

Правила изменения версий:

1. **Никогда не редактируйте поле `version` в корневом `package.json`, `apps/desktop/package.json` или пакетах `@deepseek-ai/dsh-*` вручную.** Они обновляются исключительно при слиянии нового апстрим-тега `dsh-v*`.
2. **Все изменения продуктовой версии выполняются атомарно через CLI [`scripts/strata/fork-ops.ts`](../../scripts/strata/fork-ops.ts):**
   - `PATCH` (`1.0.1`) — исправления ошибок, локальные UI-правки, обновление сабмодуля методологии `resources/strataharness`;
   - `MINOR` (`1.1.0`) — новые пользовательские возможности `StrataHarness` или плановая синхронизация с новым апстрим-тегом `dsh-v*`;
   - `MAJOR` (`2.0.0`) — крупные продуктовые вехи или несовместимые миграции.

Основные команды диагностики и управления версией:

```sh
# Сводка текущей продуктовой версии, версии ядра DSH, ревизии сабмодуля и реестра strata(override)
pnpm run strata:status

# Бамп продуктовой версии (patch | minor | major | явный SemVer X.Y.Z)
pnpm run strata:version patch
pnpm run strata:version minor
pnpm run strata:version 1.2.0

# Одновременное обновление продуктовой версии и фиксация нового базового тега апстрима
pnpm run strata:version minor -- --upstream-base dsh-v0.3.0
```

Команда `strata:version` синхронно обновляет [`strata-product.json`](../../strata-product.json), [`packages/strata/product-bundle/package.json`](../../packages/strata/product-bundle/package.json) и [`packages/strata/ui-brand/package.json`](../../packages/strata/ui-brand/package.json).

---

## 2. Обновление встроенной методологии (`resources/strataharness`)

Методология и каталог скиллов `StrataHarness` подключены как Git-сабмодуль в `resources/strataharness` (см. [`resources/strataharness/README.md`](../../resources/strataharness/README.md)) и при упаковке десктопного приложения копируются в `extraResources/strataharness` вне `app.asar`.

```sh
# Проверить целостность инициализации сабмодуля и наличие .agents/skills без переключения коммита
pnpm run strata:update-methodology

# Переключить сабмодуль на конкретный релизный тег или ветку методологии
pnpm run strata:update-methodology -- --ref v1.2.0

# Подтянуть актуальное состояние отслеживаемой ветки сабмодуля из удалённого репозитория
pnpm run strata:update-methodology -- --remote
```

После обновления указателя сабмодуля поднимите `PATCH`-версию продукта (`pnpm run strata:version patch`), выполните `pnpm run strata:audit-overrides` и зафиксируйте обновлённый указатель сабмодуля вместе с `strata-product.json` в одном атомарном коммите `strata(bundle): ...`.

---

## 3. Фоновый радар релизов апстрима (`strata-upstream-watch`)

Клиентское приложение `StrataHarness Desktop` полностью автономно и **не выполняет никаких фоновых запросов к инфраструктуре апстрима**. Отслеживание новых релизов `DeepSeek Harness` выполняется исключительно на стороне репозитория для системного архитектора через воркфлоу [`.github/workflows/strata-upstream-watch.yml`](../../.github/workflows/strata-upstream-watch.yml):

- **Расписание и ручной запуск:** запускается ежедневно в `07:00 UTC` (`cron: '0 7 * * *'`), а также вручную через `workflow_dispatch` (с параметрами `upstream_url` и `dry_run`).
- **Логика проверки:** вызывает `pnpm run strata:check-upstream --fetch --json`, сравнивая список тегов `dsh-v*` из `upstreamRepository` с текущим `upstreamBaseTag` в `strata-product.json`.
- **Дедупликация уведомлений:** если обнаружен более новый тег `dsh-v*`, воркфлоу создаёт GitHub Issue с меткой `strata:upstream-radar` и подробным `Impact Report` (список новых тегов, новые карточки в `docs/upgrade-guide/`, пересечения изменённых в апстриме файлов с локальными коммитами `strata(override)`). Если открытый Issue с меткой `strata:upstream-radar` уже существует, воркфлоу идемпотентно обновляет его заголовок и описание вместо создания дубликатов.
- **Опциональный Webhook:** если в секретах репозитория задан `STRATA_ARCHITECT_WEBHOOK_URL` (Slack / Telegram-bridge / Discord-совместимый JSON endpoint с полями `text` и `content`), воркфлоу дополнительно отправляет краткую сводку архитектору.

Запустить проверку локально в любой момент можно командой:

```sh
pnpm run strata:check-upstream -- --fetch --markdown
```

---

## 4. Пятишаговый регламент синхронизации `Soft-Fork` с новым тегом `dsh-v*`

Никогда не сливайте сырую ветку `upstream/master` в основную ветку продукта — синхронизация выполняется строго по стабильным релизным тегам `dsh-v*` в изолированной ветке `sync/<tag>`.

### Шаг 1. Разведка и оценка влияния (`Impact Report`)

Получите свежие теги из `upstream` и изучите пересечения с модифицированными файлами `StrataHarness`:

```sh
pnpm run strata:check-upstream -- --fetch --markdown
pnpm run strata:audit-overrides
```

Обратите особое внимание на два блока отчёта:

1. **Карточки `docs/upgrade-guide/`**, добавленные между текущим `upstreamBaseTag` и целевым тегом `dsh-vX.Y.Z` (миграции форматов сессий, изменения `cordis.yml` или конфигурации плагинов).
2. **Пересечения с файлами `strata(override)`** — точечными правками поверх файлов апстрима (брендинг, маршрутизация путей `~/.strataharness`, изоляция `strata-desktop-config.mjs`, константы путей к `.github/upstream-workflows/`).

### Шаг 2. Подготовка изолированной ветки синхронизации

На чистом рабочем дереве (`git status` без незакоммиченных изменений) запустите подготовку ветки:

```sh
pnpm run strata:prepare-upstream-sync dsh-vX.Y.Z
```

Скрипт проверит чистоту рабочего дерева, настроит `remote upstream` при его отсутствии, подтянет целевой тег `dsh-vX.Y.Z`, создаст ветку `sync/dsh-vX.Y.Z` и выведет предварительный план пересечений.

### Шаг 3. Слияние тега без автокоммита и контроль изоляции воркфлоу

Выполните слияние целевого тега без автоматического создания коммита, чтобы проверить все изменения до фиксации:

```sh
git merge --no-commit --no-ff dsh-vX.Y.Z
```

При разрешении конфликтов и проверке индекса соблюдайте три инварианта `Soft-Fork`:

1. **Апстримные воркфлоу GitHub Actions:** двадцать пять базовых воркфлоу перенесены через `git mv` в `.github/upstream-workflows/`, поэтому Git автоматически применяет правки апстрима к перенесённым файлам. Однако если апстрим в новом релизе **добавил совершенно новый файл** `.github/workflows/<new-upstream>.yml`, немедленно перенесите его побайтово в архивный каталог:
   ```sh
   git mv .github/workflows/<new-upstream>.yml .github/upstream-workflows/<new-upstream>.yml
   ```
   В `.github/workflows/` разрешены исключительно файлы с префиксом `strata-*.yml`.
2. **Трёхуровневая изоляция данных и идентичности:** убедитесь, что `apps/desktop/src/paths.ts` по-прежнему указывает на `.strataharness`, `apps/desktop/scripts/strata-desktop-config.mjs` сохраняет `com.nikl.strataharness`, `@strata/desktop` и схему `strata://`, а `DOWNLOAD_PROD_ORIGIN` не откатился на `download.deepseek.com`.
3. **Версии пакетов ядра:** примите новые версии `0.x.y` из апстрима во всех `@deepseek-ai/dsh-*` и корневом `package.json` без ручных правок.

### Шаг 4. Прогон квалификационных и сборочных гейтов

Установите обновлённые зависимости и прогоните обязательные проверки:

```sh
pnpm install
pnpm run strata:audit-overrides
pnpm run constraints
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run check:package
pnpm --filter @deepseek-ai/dsh-desktop run test:updates:local
```

Примечание для локальной среды Windows: при запуске `check:package` или `package` системный `C:\Windows\System32\tar.exe` (`bsdtar`) должен располагаться в `PATH` раньше `C:\Program Files\Git\usr\bin\tar.exe` (GNU `tar` некорректно интерпретирует двоеточие `D:\...` как удалённый хост). В CI-воркфлоу `strata-windows-package.yml` эта нормализация `PATH` выполняется автоматически первым шагом.

### Шаг 5. Обновление продуктового манифеста и завершение синхронизации

Зафиксируйте новый базовый тег апстрима и поднимите `MINOR`-версию продукта `StrataHarness`:

```sh
pnpm run strata:version minor -- --upstream-base dsh-vX.Y.Z
pnpm run strata:status
```

После успешной проверки закоммитьте результат слияния в ветке `sync/dsh-vX.Y.Z`, откройте Pull Request (или влейте ветку в основную ветку продукта после зелёного прогона проверок) и закройте открытый Issue радара `strata:upstream-radar`.

---

## 5. Выпуск кроссплатформенного релиза `strata-v*`

Релизный конвейер состоит из трёх модульных воркфлоу в `.github/workflows/`:

1. [`.github/workflows/strata-windows-package.yml`](../../.github/workflows/strata-windows-package.yml) — сборка `win-x64` NSIS `.exe` на раннере `windows-2022` (с кэшированием `pnpm`, `apps/desktop/.desktop-build/downloads` и Electron, приоритетом `System32\tar.exe`, проверкой `check:package` и встроенным smoke-тестом упакованного `dsh`).
2. [`.github/workflows/strata-macos-package.yml`](../../.github/workflows/strata-macos-package.yml) — матричная сборка `mac-arm64` и `mac-x64` (`fail-fast: false`) на раннере `macos-15` (с автоматической установкой Rosetta 2 для `mac-x64` и обязательной генерацией пары `.dmg` + `.zip` для каждой архитектуры как в `signed`, так и в `unsigned` режиме).
3. [`.github/workflows/strata-release.yml`](../../.github/workflows/strata-release.yml) — оркестратор атомарного релиза по пушу тега `strata-v*` или ручному `workflow_dispatch`.

### Стандартный выпуск боевого релиза по тегу

1. Убедитесь, что `productVersion` в [`strata-product.json`](../../strata-product.json) установлена в целевое значение (например, `1.1.0`), сабмодуль `resources/strataharness` чист и указывает на закоммиченную ревизию, а `pnpm run strata:audit-overrides` проходит без ошибок:
   ```sh
   pnpm run strata:version 1.1.0
   pnpm run strata:audit-overrides
   ```
2. Закоммитьте обновление версии в основную ветку, создайте аннотированный тег `strata-v<productVersion>` и отправьте его в `origin`:
   ```sh
   git tag -a strata-v1.1.0 -m "StrataHarness v1.1.0"
   git push origin strata-v1.1.0
   ```
3. Джоба `preflight` в `strata-release.yml` проверит строгое равенство тега `strata-v1.1.0` и `productVersion: "1.1.0"` в `strata-product.json` (при расхождении конвейер немедленно прерывается до старта дорогостоящих раннеров Windows и macOS).
4. После успешного завершения **всех трёх платформ** (`win-x64`, `mac-arm64`, `mac-x64`) джоба `publish` формирует:
   - единый GitHub Release `StrataHarness v1.1.0` с установщиками `.exe`, `.dmg`, `.zip`;
   - файл контрольных сумм `SHA256SUMS.txt` для всех опубликованных бинарных файлов;
   - автоматически сгенерированные `RELEASE_NOTES.md` с указанием продуктовой версии, базового движка `Engine: DSH <version> (<upstreamBaseTag>)`, ревизии методологии и статуса цифровой подписи (включая инструкции первого запуска для `-unsigned` сборок);
   - архивный артефакт `update-feed` (и при наличии `STRATA_S3_*` — синхронизацию статического HTTPS-фида `strataharness/feeds/<target>/`).

Если хотя бы одна из трёх целевых платформ завершилась ошибкой, боевой GitHub Release и статический фид автообновления **не публикуются** (принцип атомарности релиза), при этом собранные артефакты успешных платформ (`strata-dist-*`) и диагностические логи (`strata-packaging-runs-*`) сохраняются в GitHub Actions для разбора.

### Ручной тестовый запуск (`workflow_dispatch`)

Через вкладку **Actions → Strata Atomic Desktop Release → Run workflow** доступен ручной запуск с параметрами:

- `signing_mode`: `auto` (по умолчанию), `unsigned` или `signed`;
- `targets`: `all`, `win-x64`, `mac-arm64` или `mac-x64` (выбор одной платформы разрешён **только** при включённом флаге `draft: true` или `prerelease: true`, чтобы исключить публикацию неполного боевого релиза);
- `draft` / `prerelease`: публикация черновика или пререлиза;
- `download_prod_origin`: опциональное переопределение HTTPS-источника статического фида автообновления.

---

## 6. Переход из `unsigned` в `signed` без правок кода и справочник секретов

По умолчанию все воркфлоу работают в режиме `signing_mode: auto`. Поведение матрицы подписи и автообновления полностью определяется наличием секретов в настройках репозитория GitHub (**Settings → Secrets and variables → Actions**):

| Запрошенный `signing_mode` | Сертификаты платформы в Secrets | `DOWNLOAD_PROD_ORIGIN` задан | Итоговый режим и поведение сборки |
|---|---|---|---|
| `auto` (по умолчанию) | Отсутствуют | Не важен | Чистый откат в `unsigned`: артефакты с суффиксом `-unsigned` (`.exe`, `.dmg`, `.zip`), `publish: null` (без `latest*.yml`) |
| `auto` (по умолчанию) | Присутствуют (полный набор) | Нет | Режим `signed`: подписанные (и нотаризованные на macOS) бинарные файлы без суффикса `-unsigned`, `publish: null` (раздача через GitHub Releases без CDN-автообновления) |
| `auto` (по умолчанию) | Присутствуют (полный набор) | Да (`https://...`) | Полный боевой режим `signed`: подписанные установщики + генерация `latest.yml` / `latest-mac.yml` со ссылкой на `${DOWNLOAD_PROD_ORIGIN}/strataharness/feeds/<target>/` |
| `unsigned` | Любые | Не важен | Принудительная `unsigned`-сборка без обращения к сертификатам |
| `signed` | Отсутствует хотя бы один обязательный секрет | Любой | Немедленный `fail-fast` отказ на шаге `preflight` с перечислением недостающих переменных |

### Полный справочник секретов GitHub Actions

#### Доступ к сабмодулю и радару архитектора

| Секрет | Обязательность | Назначение |
|---|---|---|
| `STRATA_SUBMODULE_TOKEN` | Только если репозиторий `resources/strataharness` приватный | Fine-grained PAT с правом `Contents: Read-only` на репозиторий методологии для `actions/checkout` (`submodules: recursive`). Если сабмодуль публичный, используется стандартный `GITHUB_TOKEN`. |
| `STRATA_ARCHITECT_WEBHOOK_URL` | Опционально | HTTPS Webhook URL (Slack / Telegram-bridge / Discord) для уведомлений воркфлоу `strata-upstream-watch.yml` о выходе новых тегов `dsh-v*`. |

#### Код-сайнинг Windows (`strata-windows-package.yml` + [`apps/desktop/scripts/windows-sign.mjs`](../../apps/desktop/scripts/windows-sign.mjs))

| Секрет | Обязательность для `signed` на Windows | Формат и назначение |
|---|---|---|
| `WIN_CSC_LINK` | Да | Base64-строка PKCS#12 архива сертификата Authenticode (`.pfx`). Кодирование в PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))`. В CI декодируется строго в `$RUNNER_TEMP\strata-win-cert.pfx`, маскируется в логах и гарантированно удаляется в шаге `if: always()`. |
| `WIN_CSC_KEY_PASSWORD` | Да | Пароль экспорта `.pfx`-сертификата. Маскируется через `::add-mask::`. |

Адаптер [`windows-sign.mjs`](../../apps/desktop/scripts/windows-sign.mjs) автоматически использует RFC-3161 штампы времени с отказоустойчивой цепочкой TSA-серверов (`http://timestamp.digicert.com` → `http://timestamp.sectigo.com` → `http://timestamp.globalsign.com/tsa/r6advanced1`), а при локальной сборке без `WIN_CSC_LINK` сохраняет поддержку аппаратных USB-токенов SafeNet (`DSH_WINDOWS_SIGN_THUMBPRINT` / `DSH_WINDOWS_SIGN_SUBJECT`).

#### Код-сайнинг и нотаризация macOS (`strata-macos-package.yml`)

Для перехода macOS в `signed` задаются **четыре секрета сертификата Developer ID** и **один из двух вариантов учётных данных Apple Notarization** (рекомендуется App Store Connect API Key):

| Секрет | Обязательность для `signed` на macOS | Формат и назначение |
|---|---|---|
| `CSC_LINK` | Да | Base64-строка экспортированного сертификата `Developer ID Application` с закрытым ключом (`.p12`), например `base64 -i DeveloperID.p12 \| tr -d '\n'`. Материализуется в `$RUNNER_TEMP/strata-macos-cert.p12` с правами `0600` и удаляется в `if: always()`. |
| `CSC_KEY_PASSWORD` | Да | Пароль экспорта `.p12`-архива. |
| `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` | Да | Квалификатор сертификата без префикса `Developer ID Application:`, например `Example Corp (TEAMID1234)` (если вставить полное имя из Keychain Access с префиксом `Developer ID Application:`, `strata-macos-package.yml` автоматически срежет префикс перед вызовом упаковщика). |
| `DSH_DESKTOP_MACOS_TEAM_ID` | Да | 10-символьный идентификатор команды Apple Developer (`TEAMID1234`). |
| `APPLE_API_KEY` | Вариант нотаризации A (рекомендуемый) | Содержимое файла `AuthKey_<KEY_ID>.p8` (PEM-текст `-----BEGIN PRIVATE KEY-----...` или Base64). Материализуется в `$RUNNER_TEMP/AuthKey.p8` (`0600`) и удаляется в `if: always()`. |
| `APPLE_API_KEY_ID` | Вариант нотаризации A (рекомендуемый) | Key ID ключа App Store Connect API (например, `ABC1234567`). |
| `APPLE_API_ISSUER` | Вариант нотаризации A (рекомендуемый) | Issuer UUID из раздела App Store Connect → Users and Access → Integrations. |
| `APPLE_ID` | Вариант нотаризации B (альтернативный) | Email учётной записи Apple Developer (используется, если не задана тройка `APPLE_API_*`). |
| `APPLE_APP_SPECIFIC_PASSWORD` | Вариант нотаризации B (альтернативный) | App-specific пароль, выпущенный на `appleid.apple.com`. |
| `APPLE_TEAM_ID` | Вариант нотаризации B (альтернативный) | 10-символьный Apple Team ID для Apple ID нотаризации. |

Как только перечисленные секреты Windows и macOS добавлены в GitHub Secrets, следующий же запуск `strata-release.yml` в стандартном режиме `signing_mode: auto` автоматически переключится с `unsigned` на `signed` без единого изменения YAML-файлов или исходного кода.

---

## 7. Настройка статического HTTPS-канала автообновлений и S3 / Cloudflare R2 / MinIO

Автообновление установленных клиентов `StrataHarness Desktop` работает через стандартный `generic` HTTPS-провайдер `electron-updater` и включается **только для подписанных (`signed`) сборок**, чтобы исключить фоновую установку неподписанных бинарных файлов.

### Маршрутизация URL фида

При заданном секрете `DOWNLOAD_PROD_ORIGIN` (строго HTTPS-источник без завершающего слэша и пути, например `https://downloads.strataharness.example`; домены `download.deepseek.com` и `*.deepseek.com` заблокированы валидатором в [`strata-desktop-config.mjs`](../../apps/desktop/scripts/strata-desktop-config.mjs)) в `app-update.yml` упакованного приложения прописываются адреса:

- Windows `win-x64`: `${DOWNLOAD_PROD_ORIGIN}/strataharness/feeds/win-x64/` (`latest.yml` + `.exe` + `.exe.blockmap`)
- macOS Apple Silicon `mac-arm64`: `${DOWNLOAD_PROD_ORIGIN}/strataharness/feeds/mac-arm64/` (`latest-mac.yml` + `.zip` + `.dmg` + `.blockmap`)
- macOS Intel `mac-x64`: `${DOWNLOAD_PROD_ORIGIN}/strataharness/feeds/mac-x64/` (`latest-mac.yml` + `.zip` + `.dmg` + `.blockmap`)

### Секреты автоматической выгрузки фида в S3-совместимое хранилище

В каждом релизе `strata-release.yml` сохраняет готовую структуру каталогов `strataharness/feeds/<target>/` в артефакт прогона `update-feed` (доступен для ручной выгрузки на любой веб-сервер, GitHub Pages или CDN). Если дополнительно настроены S3-секреты, джоба `publish` автоматически синхронизирует подписанный фид в бакет:

| Секрет | Обязательность для автовыгрузки S3 | Назначение |
|---|---|---|
| `DOWNLOAD_PROD_ORIGIN` | Да | Публичный HTTPS-домен раздачи бакета/CDN (например, `https://updates.example.com`). |
| `STRATA_S3_BUCKET` | Да | Имя S3-бакета (например, `strata-updates` или `s3://strata-updates`). |
| `STRATA_S3_ACCESS_KEY_ID` | Да | Идентификатор ключа доступа S3 / Cloudflare R2 / MinIO. |
| `STRATA_S3_SECRET_ACCESS_KEY` | Да | Секретный ключ доступа S3 / Cloudflare R2 / MinIO. |
| `STRATA_S3_ENDPOINT` | Для R2 / MinIO / Yandex Object Storage | Кастомный S3 API endpoint (например, `https://<account>.r2.cloudflarestorage.com` или `https://storage.yandexcloud.net`). Для AWS S3 не требуется. |
| `STRATA_S3_REGION` | Опционально | Регион S3 (по умолчанию `auto`, что совместимо с Cloudflare R2). |

Синхронизация выполняется в два прохода `aws s3 sync`: сначала загружаются бинарные установщики и `.blockmap`, и только после их полной записи обновляются манифесты `latest*.yml` с заголовком `Cache-Control: no-cache, must-revalidate`, что исключает гонку, при которой клиент видит новый `latest.yml` до появления `.exe`/`.zip` на CDN.

### Локальная квалификация автообновления на Windows

Перед выпуском релиза или после изменений в слое упаковки/обновления запустите локальный интеграционный стенд в реальном процессе Electron без публикации в сеть и без запуска системного инсталлятора:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run check:package
pnpm --filter @deepseek-ai/dsh-desktop run test:updates:local
```

Стенд [`apps/desktop/scripts/test-local-updater.mjs`](../../apps/desktop/scripts/test-local-updater.mjs) поднимает локальный loopback HTTP-сервер, проверяет изоляцию идентичности `StrataHarness` (`com.nikl.strataharness`, `@strata/desktop`, `.strataharness`, `strataharness/feeds/win-x64/latest.yml`), скачивание и SHA-512 верификацию обновления `1.0.0` → `1.0.1` и записывает квалификационный отчёт в `apps/desktop/.desktop-build/qualification/`.

---

## 8. Инструкции первого запуска неподписанных (`-unsigned`) сборок для пользователей

До подключения платных сертификатов Apple Developer ID и Windows Authenticode публикуемые артефакты имеют суффикс `-unsigned` (`strataharness-<version>-win-x64-unsigned.exe`, `strataharness-<version>-mac-arm64-unsigned.dmg`, `strataharness-<version>-mac-x64-unsigned.dmg`). При первом запуске ОС покажет стандартное предупреждение карантина для неподписанных приложений.

### macOS (Apple Gatekeeper)

1. Смонтируйте образ `strataharness-<version>-mac-<arch>-unsigned.dmg` и перетащите `StrataHarness.app` в папку `/Applications` (`Программы`).
2. **Способ А (через Терминал — самый быстрый):** снимите атрибут карантина `com.apple.quarantine` одной командой и запустите приложение:
   ```sh
   xattr -cr /Applications/StrataHarness.app
   open /Applications/StrataHarness.app
   ```
3. **Способ Б (через интерфейс macOS):** попробуйте открыть `StrataHarness.app` двойным кликом, закройте окно предупреждения («Не удаётся проверить разработчика» / «Приложение повреждено»), затем откройте **Системные настройки → Конфиденциальность и безопасность** (*System Settings → Privacy & Security*), прокрутите вниз до блока безопасности и нажмите **Открыть в любом случае** (*Open Anyway*).

### Windows 10 / Windows 11 (Microsoft Defender SmartScreen)

1. Сверьте SHA-256 хеш скачанного файла `strataharness-<version>-win-x64-unsigned.exe` со значением в `SHA256SUMS.txt` на странице релиза:
   ```powershell
   Get-FileHash .\strataharness-1.0.0-win-x64-unsigned.exe -Algorithm SHA256
   ```
2. Запустите установщик. При появлении синего окна фильтра **Система Windows защитила ваш компьютер** (*Windows protected your PC*) нажмите ссылку **Подробнее** (*More info*).
3. В раскрывшемся окне нажмите кнопку **Выполнить в любом случае** (*Run anyway*) — запустится штатный установщик `StrataHarness`.
