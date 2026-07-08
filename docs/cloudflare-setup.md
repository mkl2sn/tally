# Cloudflare-Setup für das erste Deployment

Stand: 2026-07-08. Der Code ist deploy-fertig (wrangler.jsonc mit Durable
Object + SQLite-Migration, CI-Deploy-Job in `.github/workflows/ci.yml`).
Es fehlt nur die Einrichtung auf Cloudflare- und GitHub-Seite.

## 1. Cloudflare-Account

- Account anlegen (Free-Plan reicht): https://dash.cloudflare.com/sign-up
- SQLite-backed Durable Objects (`new_sqlite_classes`) laufen auch im
  Free-Plan. Kein Workers-Paid-Plan nötig.

## 2. workers.dev-Subdomain registrieren

- Dashboard → Compute (Workers) → im Onboarding eine
  `<name>.workers.dev`-Subdomain wählen.
- Nötig, weil `wrangler.jsonc` `workers_dev: true` setzt. Die App ist danach
  unter `tally.<name>.workers.dev` erreichbar.

## 3. Account-ID notieren

- Dashboard → Workers & Pages → rechts in der Sidebar steht die **Account ID**
  (alternativ: `npx wrangler whoami` nach `wrangler login`).

## 4. API-Token erstellen

- Dashboard → My Profile → API Tokens → **Create Token** →
  Template **"Edit Cloudflare Workers"**.
- Scope auf den eigenen Account beschränken, Token kopieren
  (wird nur einmal angezeigt).

## 5. GitHub-Secrets setzen

Repo → Settings → Secrets and variables → Actions:

| Secret | Wert |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token aus Schritt 4 |
| `CLOUDFLARE_ACCOUNT_ID` | Account-ID aus Schritt 3 |

Oder per CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

## 6. Deployen

- Push auf `main` → CI-Job `deploy` läuft `wrangler deploy` mit
  `wrangler.jsonc`. Die DO-Migration `v1` (PokerRoom) wird beim ersten
  Deploy automatisch angelegt.
- Alternativ manuell vorab testen:

```bash
npx wrangler login
pnpm build
npx wrangler deploy
```

## 7. Später: Custom Domain (optional)

Siehe [domain-options.md](domain-options.md) - Empfehlung `tallypoker.app`.

1. Domain registrieren (geht direkt bei Cloudflare Registrar, Einkaufspreis).
2. Zone ist bei Cloudflare-Registrierung automatisch im Account.
3. Worker → Settings → Domains & Routes → **Custom Domain** hinzufügen
   (z. B. `tallypoker.app`). TLS/DNS macht Cloudflare selbst.
4. Optional dann `workers_dev: false` setzen, damit nur noch die eigene
   Domain bedient wird.

## Hinweise

- Der Worker heißt `tally` (in allen wrangler-Configs, Stand 2026-07-08).
- Die App braucht keine Secrets/Env-Vars zur Laufzeit - nur das
  `POKER_ROOM`-DO-Binding, das wrangler aus der Config anlegt.
- Der Deploy-Job triggert bei jedem Push auf `main` (nach grünen Checks).
