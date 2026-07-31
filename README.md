# orthobio-site

> **Agents: read [`AGENTS.md`](AGENTS.md) first** — правила работы, workflow, конвенции (унаследованы от `bbm-public-website`).

Временный статичный сайт **VIII Конгресса ОРТОБИОЛОГИЯ-2027** + консолидированный архив конгрессов 2021–2026.

- **Трекинг:** Plane `doctor-school` → DSG2-11 «Организовать сайт конгресса ортобиологии, перелив трафика»; исполнение — GitHub Issues этого репо.
- **ТЗ и карта контента:** [`docs/content-map-and-tz.md`](docs/content-map-and-tz.md) (утверждено владельцем 2026-07-23).
- **Разведка источников:** [`docs/recon/`](docs/recon/) — orthobio.ru (2026) и архивы 2021–2025.

## Стек и принципы

- **Astro** (статик-генератор); контент каждого года конгресса — **данные (YAML)**, не вёрстка: структура «Событие → выпуск года → программа/спикеры/партнёры/материалы/фото» — прообраз модуля «конструктор мероприятий» платформы Doctor.School.
- **Хостинг свой** (Timeweb), тяжёлые фотоархивы — Timeweb S3, DNS — Beget. Не Tilda/Vercel/Cloudflare: обязательна RF-доступность и полный контроль 301-редиректов при переезде на платформу (ноябрь 2026).
- Никаких внешних архивных ссылок: все PDF и фото хостятся у нас.
- Честные заглушки: чего нет для 2027 — прямо «в разработке», контент-2026 под видом 2027 не выдаём.

## Сборка и запуск

Требования: **Node ≥ 22**, **pnpm ≥ 9** (`corepack enable`).

```sh
pnpm install        # зависимости
pnpm dev            # дев-сервер (http://localhost:4321)
pnpm build          # статическая сборка → dist/
pnpm preview        # локальный просмотр собранного dist/
pnpm lint:css       # token-only policy: цвета, размеры, breakpoints, inline styles
pnpm typecheck      # astro check + tsc --noEmit (строгий TS)
pnpm test           # Vitest: чистая логика и значения контента
pnpm test:e2e       # Playwright: overflow-лестница + axe на каждый маршрут
```

`pnpm test:e2e` сам собирает проект и поднимает `astro preview` на порту,
выведенном из пути checkout'а — параллельные worktree не мешают друг другу
(первый запуск: `pnpm exec playwright install chromium`). Оверрайды:
`PW_PORT=4331` — свой сервер на заданном порту, `PW_BASE_URL=http://…` — прогон
против уже запущенного сервера, свой при этом не поднимается. Детали и
обоснование: `tests/e2e/_port.ts`.

Контент годов конгресса — YAML-файлы `src/content/congress/<year>.yaml`;
схема и правила заполнения: `src/content/schemas.ts` + документированный
пример `src/content/congress/2099.yaml` (фикстура, `draft: true`,
в публичную сборку не попадает). Страница года: `/archive/<year>`.

Тексты статических разделов (`/program`, `/nmo`, `/participants`, …) — тоже
данные: `src/content/pages/<slug>.yaml` (схема `pageSchema`), поэтому
RU-типографика применяется автоматически на границе схемы.

Все сквозные продуктовые значения и базовый URL медиа живут в
`src/config/site.ts`. До открытия регистрации в ноябре 2026 сайт намеренно
работает без CTA; публичные контакты утверждены владельцем в Issue #54.

## Инфраструктура (медиа-архив)

Фото и PDF архива конгрессов живут в выделенном Timeweb S3-бакете
**`orthobio-media`** (public-read, endpoint `https://s3.twcstorage.ru`,
базовый URL объектов `https://s3.twcstorage.ru/orthobio-media/<key>`).
Terraform: [`infra/terraform/`](infra/terraform/) (runbook в его README);
реестр объектов — [`docs/assets-manifest.yaml`](docs/assets-manifest.yaml).

Имена env-переменных для доступа (значения — только в секрет-хранилище,
никогда в репо): `TIMEWEB_S3_ACCESS_KEY`, `TIMEWEB_S3_SECRET_KEY`,
`TIMEWEB_S3_ENDPOINT`, `TIMEWEB_S3_BUCKET`, `TIMEWEB_S3_REGION`,
токен провижининга — `TWC_TOKEN`.

## Хостинг и деплой

Сайт раздаёт **host-nginx на существующем VPS `tools-prod-tw`** (Timeweb, ru-3,
зона РФ) из hostname-neutral release-root `/var/www/orthobio-site/public`;
HTTPS — Let's Encrypt (certbot). Preview и production используют одни и те же
проверенные байты, но разные vhost: preview всегда `noindex`, production —
индексируемый canonical apex с `www` → apex.
Новых платных ресурсов под сайт не заводилось: переиспользованы VPS, nginx +
certbot и тот же приём «ключ, запертый forced-command», что у `kb.bbm.academy`.
Решения и чеклист владельца: [`docs/infrastructure-decisions.md`](docs/infrastructure-decisions.md).

```sh
pnpm redirects:build   # infra/redirects.yaml → infra/nginx/redirects.generated.conf
```

Деплой автоматический: push в `main` → workflow `CI` (typecheck, unit, проверка
актуальности сгенерированного сниппета, build, Playwright) → при зелёном CI
workflow `Deploy` собирает, синхронизирует `dist/` на хост, применяет карту
редиректов и **проверяет живую страницу** (200 + ожидаемый HTML). Ручной запуск —
`workflow_dispatch`.

**301-редиректы — данные:** [`infra/redirects.yaml`](infra/redirects.yaml).
Переезд на платформу в ноябре 2026 = правка этого файла + деплой; вёрстка и
конфиг nginx не трогаются. Генератор валидирует каждую запись, хост-скрипт
перепроверяет результат и откатывается, если `nginx -t` не прошёл.

Имена GitHub Secrets (значения — только в секрет-хранилище; заданы на окружении
`production`, а не на репозитории, и окружение пускает только `main`):
`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`. Variable с рабочим
значением по умолчанию: `DEPLOY_USER` (`deploy`). Variables `SITE_HOST`
и `SITE_INDEXABLE` обязательны и принимаются только согласованной парой:
`new.orthobio.ru` + `false` до cutover либо `orthobio.ru` + `true` после него.
Deploy завершается ошибкой, если одна из них отсутствует или изменена отдельно.

Конфиги хоста (vhost, forced-command-обёртка, установщик редиректов) деплоем
**не** доставляются — после их правки нужен `sh infra/host/provision.sh <ssh-target>`
с машины, у ключа которой есть sudo на хосте.

**Live domains (cutover completed 2026-07-31):**

- [`https://orthobio.ru/`](https://orthobio.ru/) — индексируемый production
  canonical; apex A указывает на Timeweb, а `www` перенаправляется на apex.
- [`https://new.orthobio.ru/`](https://new.orthobio.ru/) — отдельный preview на
  тех же байтах, намеренно отдающий `X-Robots-Tag: noindex, nofollow`.

Оба имени работают по HTTPS с HSTS. Production-сертификат покрывает apex и
`www`; автоматическое продление через certbot проверено после переключения.
Фактические DNS/TLS значения, runbook и rollback-процедура зафиксированы в
[`docs/infrastructure-decisions.md`](docs/infrastructure-decisions.md).

## Вне scope

Регистрация/ЛК, НМО-учёт, трансляции, бронирование отеля — появятся на платформе к открытию регистрации (ноябрь 2026).
