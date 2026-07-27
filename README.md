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
pnpm typecheck      # astro check + tsc --noEmit (строгий TS)
pnpm test:e2e       # Playwright: overflow-лестница + axe на каждый маршрут
```

`pnpm test:e2e` сам собирает проект и поднимает `astro preview` на порту 4331
(первый запуск: `pnpm exec playwright install chromium`).

Контент годов конгресса — YAML-файлы `src/content/congress/<year>.yaml`;
схема и правила заполнения: `src/content/schemas.ts` + документированный
пример `src/content/congress/2099.yaml` (фикстура, `draft: true`,
в публичную сборку не попадает). Страница года: `/archive/<year>`.

Тексты статических разделов (`/program`, `/nmo`, `/participants`, …) — тоже
данные: `src/content/pages/<slug>.yaml` (схема `pageSchema`), поэтому
RU-типографика применяется автоматически на границе схемы.

Все нерешённые владельцем значения (канал CTA «узнать первым», контакты
оргкомитета) и базовый URL медиа — в одном файле `src/config/site.ts`
с пометками `TODO(Антон)`.

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

## Вне scope

Регистрация/ЛК, НМО-учёт, трансляции, бронирование отеля — появятся на платформе к открытию регистрации (ноябрь 2026).
