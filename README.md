# zyta-sign-mcp

Servidor [Model Context Protocol](https://modelcontextprotocol.io) (stdio) que
expone tus documentos, firmas y estudios de **Zyta Sign** a un agente como
Claude Desktop, Cursor o Codex CLI — respetando tus permisos exactos.

## Instalación rápida (cualquier usuario)

```json
{
  "mcpServers": {
    "zyta": {
      "command": "npx",
      "args": ["-y", "zyta-sign-mcp"],
      "env": {
        "KAIRO_BASE_URL": "https://sign.zyta.app",
        "KAIRO_CLIENT_LABEL": "Cursor"
      }
    }
  }
}
```

1. Pegá eso en `.cursor/mcp.json` (Cursor) o `claude_desktop_config.json` (Claude)
2. Recargá MCP → conectado
3. En el chat: *"logueate en zyta"* → el agente llama `kairo_login` → autorizás en `/device`

No hace falta clonar repos ni rutas locales. Solo Node.js 18+.

> **Nota:** el paquete npm se llama `zyta-sign-mcp` (el nombre `kairo-mcp` ya está
> ocupado en npm por otro proyecto). Las herramientas siguen usando el prefijo `kairo_*`.

## Autenticación (login obligatorio)

**Sin sesión autenticada, todas las herramientas fallan** — salvo `kairo_login` y
`kairo_disconnect`. No hay auto-login silencioso por variables de entorno: el token
`KAIRO_API_TOKEN` solo se usa si lo pasás explícitamente a `kairo_login({ access_token })`
(o como fallback dentro de esa herramienta). Los permisos los determina el usuario del
token: el agente no puede hacer más de lo que podés hacer vos en el dashboard.

### Device Authorization Flow (recomendado, estilo `gh auth login`)

El MCP **conecta al instante** (stdio) sin bloquear en login. Cuando el agente necesita
operar, llama a `kairo_login`:

1. Se abre el navegador en `/device?user_code=XXXX-XXXX`
2. Autorizás con tu cuenta (o email/contraseña si no tenés sesión web)
3. El agente recibe el token y responde en el chat: *"Sesión OK como Juan…"*
4. El token queda en `~/.kairo/credentials-*.json` (sesiones posteriores se reutilizan)

No hace falta copiar/pegar secretos en `mcp.json`.

### Cursor (recomendado)

1. Levantá la app:

```bash
cd kairo-sign
npm run dev          # :3000
```

2. Configurá `.cursor/mcp.json` (proyecto o global):

```json
{
  "mcpServers": {
    "zyta": {
      "command": "npx",
      "args": ["-y", "zyta-sign-mcp"],
      "env": {
        "KAIRO_BASE_URL": "http://localhost:3000",
        "KAIRO_CLIENT_LABEL": "Cursor"
      }
    }
  }
}
```

3. Cursor → Settings → MCP → **Reload** → `kairo` conectado (verde)
4. En el chat: *"logueate en kairo"* o el agente llama `kairo_login`
5. Autorizás en el browser → **mensaje en Cursor** (hook) y/o respuesta de `kairo_login`

Al autorizar en `/device`, se escribe `.cursor/kairo-auth-complete.json` y un hook de Cursor muestra en el chat que la sesión quedó lista (al terminar la respuesta del agente o al enviar el próximo mensaje).

Smoke test device flow: `cd kairo-sign && npx tsx scripts/smoke-device-auth.ts`

### Bridge local (misma PC, alternativa al device flow)

Si desarrollás con el dashboard y Cursor en la **misma máquina**, podés sincronizar la
sesión del navegador al MCP sin abrir `/device`:

1. `cd kairo-sign && npm run agent:setup` — genera un secreto compartido en `.env.local`
   y `.cursor/mcp.json` (`KAIRO_AGENT_BRIDGE_SECRET`)
2. Reiniciá `npm run dev` y recargá el MCP en Cursor
3. Logueate en el dashboard → el front hace POST al puente local (`127.0.0.1:9322`) y el
   agente queda autenticado solo

El puente **no reemplaza** el login obligatorio: solo copia el token cuando ya iniciaste
sesión en el browser. En producción remota seguí usando `kairo_login` (device flow).

### Token manual (alternativa)

1. Dashboard → **"Acceso para agentes (MCP)"** → Crear token
2. En el chat: `kairo_login({ access_token: "ztk_..." })` — **no** lo pongas en `mcp.json`

### Config mínima (sin token manual)

```json
{
  "mcpServers": {
    "zyta": {
      "command": "npx",
      "args": ["-y", "zyta-sign-mcp"],
      "env": {
        "KAIRO_BASE_URL": "https://sign.zyta.app",
        "KAIRO_CLIENT_LABEL": "Cursor laptop"
      }
    }
  }
}
```

## Instalación

```bash
npm install -g zyta-sign-mcp
# o on-demand: npx -y zyta-sign-mcp
```

### Claude Desktop

Editá `claude_desktop_config.json` (Settings → Developer):

```json
{
  "mcpServers": {
    "kairo": {
      "command": "npx",
      "args": ["-y", "zyta-sign-mcp"],
      "env": {
        "KAIRO_BASE_URL": "https://sign.zyta.app"
      }
    }
  }
}
```

### Codex CLI

En `~/.codex/config.toml`:

```toml
[mcp_servers.kairo]
command = "npx"
args = ["-y", "zyta-sign-mcp"]
env = { KAIRO_BASE_URL = "https://app.zyta.legal" }
```

## Avanzado / legacy: HTTP OAuth en Cursor

Cursor también puede conectarse por URL con OAuth 2.1 (`cursor://` redirect).
Este flujo es más frágil en Windows (alert del browser, PKCE en Cursor).
Preferí stdio + `kairo_login` arriba.

Si igual querés probarlo:

```bash
cd kairo-sign
npm run dev          # :3000
npm run mcp:http     # :3001
```

```json
{
  "mcpServers": {
    "kairo": {
      "url": "http://localhost:3001/mcp",
      "transport": "http"
    }
  }
}
```

Smoke test: `npx tsx scripts/smoke-cursor-oauth.ts`

## Flujo típico: subir, firmar y descargar

1. `kairo_login` si no hay sesión
2. `kairo_upload_document({ base64, filename, alias? })` → `document.id`
3. `kairo_get_sign_url({ documentId, mode: "external" })` → `url` + `waitParams`
4. Abrís la URL en el browser y firmás con el mouse
5. `kairo_wait_for_signature(waitParams)` → cuando `signed: true`, obtenés `signature.id`
6. `kairo_download_signed_pdf({ signatureId })` → PDF firmado en base64
7. `kairo_verify_signature({ documentHash })` → verificación por hash

Para firma con tu cuenta (PIN + certificado completo), usá `mode: "account"` en el paso 3.

## Variables de entorno

| Variable          | Default                  | Descripción                                  |
|-------------------|--------------------------|----------------------------------------------|
| `KAIRO_BASE_URL`       | `http://localhost:3000` | URL base de la instancia de Kairo.           |
| `KAIRO_API_TOKEN`      | —                       | Solo para scripts/CI o `kairo_login` vía env; **no** auto-login al arrancar. |
| `KAIRO_CLIENT_LABEL`   | `Agente MCP`            | Nombre mostrado en la pantalla `/device`.    |
| `KAIRO_AGENT_BRIDGE_SECRET` | —                  | Secreto compartido con el dashboard (bridge local). |
| `KAIRO_AGENT_BRIDGE_PORT`   | `9322`             | Puerto del puente localhost.                 |
| `KAIRO_AGENT_BRIDGE`        | *(activo)*         | `0` = no levantar el bridge al arrancar.     |
| `BRAVE_PATH`           | *(Windows)* ruta a `brave.exe` | Navegador usado por `kairo_login` (default: Brave). |
| `KAIRO_TOKEN_CACHE_DIR` | `~/.kairo`             | Carpeta donde se guarda el token tras Device Flow. |

## Tools expuestas (49)

### Autenticación

| Tool | Qué hace |
|------|----------|
| `kairo_login` | Inicia sesión (device flow o token manual). |
| `kairo_whoami` | Usuario detrás del token. |
| `kairo_disconnect` | Borra token cacheado. |

### Documentos

| Tool | Qué hace |
|------|----------|
| `kairo_list_documents` | Lista documentos visibles. |
| `kairo_get_document` | Detalle + firmas. |
| `kairo_download_document` | PDF original en base64. |
| `kairo_upload_document` | Sube PDF (base64). Requiere scope `write`. |
| `kairo_upload_documents` | Sube hasta 10 PDFs en una llamada. |
| `kairo_update_document` | Cambia alias. Requiere scope `write`. |
| `kairo_delete_document` | Elimina documento propio. Requiere scope `write`. |

### Firma

| Tool | Qué hace |
|------|----------|
| `kairo_get_sign_url` | URL para firmar + `waitParams` + share links (WhatsApp/Telegram). Soporta `placement` e `inviteMessage`. |
| `kairo_wait_for_signature` | Polling hasta firmado. |
| `kairo_sign_workflow` | Subir PDF + link externo en un paso. |
| `kairo_request_external_sign` | *(legacy)* Preferí `get_sign_url` o `sign_workflow`. |
| `kairo_create_external_bundle` | Paquete multi-documento (2–25 PDFs). |
| `kairo_get_external_bundle_status` | Estado del paquete. |
| `kairo_wait_for_external_bundle` | Polling hasta paquete completo. |
| `kairo_list_external_requests` | Pedidos externos de un documento. |
| `kairo_revoke_external_request` | Revoca link externo. Requiere scope `write`. |
| `kairo_download_signed_pdf` | PDF estampado en base64. |
| `kairo_get_signature_certificate` | Certificado JSON con `verifyUrl`. |
| `kairo_verify_signature` | Verifica por hash del documento. |
| `kairo_verify_document` | Verifica subiendo el PDF + signatureId. |
| `kairo_signature_diff` | Informe diff PDF (Premium). |
| `kairo_signature_anchor` | OpenTimestamps: status / upgrade / .ots |
| `kairo_open_browser` | Abre URL de firma en navegador. |

### Presets de firma

| Tool | Qué hace |
|------|----------|
| `kairo_list_signature_presets` | Biblioteca de firmas guardadas. |
| `kairo_create_signature_preset` | Crea preset (PNG base64 obligatorio). Scope `write`. |
| `kairo_update_signature_preset` | Edita preset. Scope `write`. |
| `kairo_delete_signature_preset` | Elimina preset. Scope `write`. |

### Estudios

| Tool | Qué hace |
|------|----------|
| `kairo_list_studios` | Estudios donde sos miembro. |
| `kairo_create_studio` | Crea estudio (Premium). Scope `write`. |
| `kairo_get_studio` | Detalle con áreas y miembros. |
| `kairo_update_studio` | Renombra estudio. Scope `write`. |
| `kairo_delete_studio` | Elimina estudio. Scope `write`. |
| `kairo_create_studio_area` | Crea área. Scope `write`. |
| `kairo_update_studio_area` | Renombra área. Scope `write`. |
| `kairo_delete_studio_area` | Elimina área. Scope `write`. |
| `kairo_add_studio_member` | Agrega miembro por email. Scope `write`. |
| `kairo_update_studio_member` | Cambia rol/área. Scope `write`. |
| `kairo_remove_studio_member` | Quita miembro. Scope `write`. |

### Cuenta, webhooks y settings

| Tool | Qué hace |
|------|----------|
| `kairo_get_plan_quota` | Plan, cuota mensual y features. |
| `kairo_get_external_sign_settings` | TTL del link externo. |
| `kairo_update_external_sign_settings` | Cambia TTL (`10m`…`on_sign`). Scope `write`. |
| `kairo_list_webhooks` | Lista webhooks HTTPS. |
| `kairo_create_webhook` | Registra webhook. Scope `write`. |
| `kairo_delete_webhook` | Elimina webhook. Scope `write`. |

### Próximamente (stub)

| Tool | Estado |
|------|--------|
| `kairo_create_template` | No implementado en backend |
| `kairo_create_sequential_sign` | Firma A→B no implementada |

Las mutaciones con scope `write` fallan con 403 si el token es solo lectura.

## Modelo de seguridad

- El token está hasheado con HMAC-SHA256 (`SIGNING_SECRET`) en la base; solo
  guardamos el prefijo + últimos 4 chars para identificación.
- Cualquier endpoint que el MCP consume usa el mismo `getCurrentUserOrToken`
  que el dashboard → no hay "modo admin" oculto.
- Podés revocar un token en cualquier momento desde el dashboard. La revocación
  es instantánea (no hay TTL de caché).
- Los tokens pueden tener vencimiento opcional (1–365 días).

## Desarrollo

```bash
npm install
KAIRO_BASE_URL=http://localhost:3000 npm run dev
# o lo inspeccionás con MCP Inspector (login explícito vía kairo_login):
KAIRO_API_TOKEN=ztk_... npm run inspect
```
