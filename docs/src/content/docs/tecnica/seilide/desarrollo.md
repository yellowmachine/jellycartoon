---
title: 'Desarrollo'
---

```sh
cd nube
cp .env.example .env          # y un BETTER_AUTH_SECRET
bun install
docker compose up -d          # Postgres en 127.0.0.1:5435 (con el rol nube_app) y rustfs en 19000
bun run familia "Casa de prueba" tu@email
bun run dev                   # migra y arranca
```

Los cambios del esquema, con `bun run db:generate`: nunca SQL a mano.
