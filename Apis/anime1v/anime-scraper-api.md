# 📺 AnimeAV1 API Reference

API RESTful para obtener información de anime, enlaces de streaming y descarga de AnimeAV1.com

## 🔑 Autenticación

Todos los endpoints requieren autenticación con API Key:

**Header:**
```
X-API-Key: tu_api_key_aqui
```

**Obtener API Key:**
1. Regístrate en `http://localhost:3000`
2. Copia tu API Key del dashboard
3. Úsala en todas las peticiones

## 📊 Rate Limits

| Plan | Requests/día | Descargas/día |
|------|--------------|---------------|
| Free | 100 | 5 |
| Premium | 1,000 | 50 |
| Enterprise | 10,000 | ∞ |

---

## 📍 Endpoints

### 1. Información del Anime

Obtiene información completa del anime incluyendo metadatos, géneros y lista de episodios.

**Endpoint:**
```
GET /api/v1/anime/info
```

**Parámetros:**
- `url` (string, requerido): URL del anime en AnimeAV1

**Ejemplo:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/info?url=https://animeav1.com/media/leviathan"
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "id": 2121,
    "title": "Leviathan",
    "titleJapanese": "リヴァイアサン",
    "description": "Ambientada en una reimaginación de 1914...",
    "image": "https://cdn.animeav1.com/poster.jpg",
    "backdrop": "https://cdn.animeav1.com/backdrop.jpg",
    "status": "En Emisión",
    "type": "TV Anime",
    "year": "2025",
    "startDate": "2025-07-10",
    "endDate": null,
    "score": 6.91,
    "votes": 1188,
    "totalEpisodes": 12,
    "malId": 59005,
    "trailer": "https://www.youtube.com/watch?v=...",
    "genres": [
      {
        "id": 2,
        "name": "Aventura",
        "slug": "aventura",
        "malId": 2
      },
      {
        "id": 3,
        "name": "Ciencia Ficción",
        "slug": "ciencia-ficcion",
        "malId": 24
      }
    ],
    "episodes": [
      {
        "id": 31458,
        "number": 1,
        "title": "Episodio 1",
        "url": "https://animeav1.com/media/leviathan/1"
      }
    ]
  },
  "source": "json"
}
```

---

### 2. Enlaces del Episodio

Obtiene todos los enlaces de streaming y descarga de un episodio específico.

**Endpoint:**
```
GET /api/v1/anime/episode
```

**Parámetros:**
- `url` (string, requerido): URL del episodio
- `includeMega` (boolean, opcional): Incluir enlaces de Mega (default: false)
- `excludeServers` (string, opcional): Servidores a excluir (separados por coma)

**Ejemplos:**
```bash
# Sin Mega (por defecto)
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/episode?url=https://animeav1.com/media/leviathan/1"

# Con Mega
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/episode?url=https://animeav1.com/media/leviathan/1&includeMega=true"

# Solo PDrain y HLS
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/episode?url=https://animeav1.com/media/leviathan/1&excludeServers=upnshare,mp4upload,1fichier"
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "id": 31458,
    "episode": 1,
    "title": "Episodio 1",
    "season": null,
    "variants": {
      "SUB": 1,
      "DUB": 1
    },
    "publishedAt": null,
    "streamLinks": {
      "SUB": [
        {
          "server": "PDrain",
          "url": "https://pixeldrain.com/u/LN3zSTWL?embed"
        },
        {
          "server": "HLS",
          "url": "https://player.zilla-networks.com/play/302494df06adbc23569652df58874e60"
        },
        {
          "server": "UPNShare",
          "url": "https://animeav1.uns.bio/#iprwfy"
        },
        {
          "server": "MP4Upload",
          "url": "https://www.mp4upload.com/embed-bpy9274ci94b.html"
        }
      ],
      "DUB": [...]
    },
    "downloadLinks": {
      "SUB": [
        {
          "server": "PDrain",
          "url": "https://pixeldrain.com/u/LN3zSTWL",
          "quality": "1080p"
        },
        {
          "server": "MP4Upload",
          "url": "https://www.mp4upload.com/bpy9274ci94b",
          "quality": "1080p"
        },
        {
          "server": "1Fichier",
          "url": "https://1fichier.com/?gq89kfwngt4qq8avbjk9",
          "quality": "1080p"
        }
      ],
      "DUB": [...]
    }
  },
  "source": "json"
}
```

---

### 3. Buscar Anime

Busca anime por nombre o palabras clave.

**Endpoint:**
```
GET /api/v1/anime/search
```

**Parámetros:**
- `q` (string, requerido): Término de búsqueda
- `domain` (string, opcional): Dominio (default: animeav1.com)

**Ejemplo:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/search?q=naruto"
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "query": "naruto",
    "results": [
      {
        "id": 123,
        "title": "Naruto Shippuden",
        "slug": "naruto-shippuden",
        "url": "https://animeav1.com/media/naruto-shippuden",
        "image": "https://cdn.animeav1.com/poster.jpg",
        "backdrop": "https://cdn.animeav1.com/backdrop.jpg",
        "type": "TV Anime",
        "score": 8.5,
        "status": "Finalizado",
        "year": "2007"
      }
    ],
    "count": 20
  },
  "source": "json"
}
```

---

### 4. Descargar Episodio

Inicia una descarga en cola. Retorna un ID para verificar el progreso.

**Endpoint:**
```
POST /api/v1/anime/download
```

**Body (JSON):**
```json
{
  "url": "https://animeav1.com/media/leviathan/1",
  "quality": "1080p",
  "variant": "SUB"
}
```

**Ejemplo:**
```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://animeav1.com/media/leviathan/1","quality":"1080p"}' \
  "http://localhost:3000/api/v1/anime/download"
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "downloadId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "url": "https://animeav1.com/media/leviathan/1",
    "quality": "1080p"
  }
}
```

---

### 5. Estado de Descarga

Verifica el estado y progreso de una descarga.

**Endpoint:**
```
GET /api/v1/anime/download/:id
```

**Parámetros:**
- `id` (string, URL param): ID de la descarga

**Ejemplo:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/download/550e8400-e29b-41d4-a716-446655440000"
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "downloadId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "progress": 100,
    "url": "https://animeav1.com/media/leviathan/1",
    "downloadUrl": "http://localhost:3000/downloads/leviathan-ep1.mp4",
    "fileSize": "524288000"
  }
}
```

---

## 🔴 Errores

### Formato de Error
```json
{
  "success": false,
  "message": "Descripción del error",
  "error": "Detalles técnicos (solo en desarrollo)"
}
```

### Códigos de Estado

| Código | Descripción |
|--------|-------------|
| 200 | Éxito |
| 400 | Parámetros inválidos |
| 401 | API Key inválida o faltante |
| 403 | Rate limit excedido |
| 404 | Recurso no encontrado |
| 500 | Error del servidor |

### Ejemplos de Errores

**401 - Sin API Key:**
```json
{
  "success": false,
  "message": "API Key requerida. Usa el header X-API-Key o parámetro apiKey"
}
```

**403 - Rate Limit:**
```json
{
  "success": false,
  "message": "Límite de requests alcanzado. Tu plan permite 100 requests/día."
}
```

**400 - Parámetro faltante:**
```json
{
  "success": false,
  "message": "Se requiere el parámetro url"
}
```

---

## 📝 Notas

### Mega Links
Los enlaces de Mega están **excluidos por defecto** porque pueden mostrar un popup pidiendo la clave de descifrado en algunos navegadores. Para incluirlos, usa `&includeMega=true`.

### Servidores Disponibles
- **PDrain** - Rápido, sin límites
- **HLS** - Streaming directo
- **UPNShare** - Estable
- **MP4Upload** - Puede tener ads
- **1Fichier** - Lento pero confiable
- **Mega** - Requiere `includeMega=true`

### Fuente de Datos
- `"source": "json"` - Datos extraídos del JSON de SvelteKit (rápido y confiable)
- `"source": "html"` - Datos extraídos por HTML scraping (fallback)

---

## 🔗 Ver También

- [Guía de Instalación](GUIA-ANIME-API.md)
- [Información sobre Mega](MEGA-FILTER-INFO.md)
- [Changelog](CAMBIOS-ANIMEAV1.md)

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "episode": 1,
    "title": "Episodio 1",
    "downloadLinks": [
      {
        "quality": "1080p",
        "size": "450MB",
        "url": "https://...",
        "server": "mega"
      },
      {
        "quality": "720p",
        "size": "250MB",
        "url": "https://...",
        "server": "mediafire"
      }
    ],
    "streamLinks": [
      {
        "quality": "1080p",
        "url": "https://...",
        "server": "mp4upload"
      }
    ]
  }
}
```

### 3. Descargar capítulo directamente
```
POST /api/v1/anime/download
Body: {
  "url": "https://animeav1.com/media/leviathan/1",
  "quality": "1080p",
  "webhook": "https://tu-webhook.com/notify" (opcional)
}
```

**Respuesta (modo async):**
```json
{
  "success": true,
  "data": {
    "downloadId": "uuid-123",
    "status": "queued",
    "statusUrl": "/api/v1/anime/download/uuid-123"
  }
}
```

### 4. Verificar estado de descarga
```
GET /api/v1/anime/download/:downloadId
```

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "downloadId": "uuid-123",
    "status": "downloading", // queued, downloading, completed, failed
    "progress": 45,
    "downloadedBytes": 200000000,
    "totalBytes": 450000000,
    "downloadUrl": "https://tu-servidor.com/downloads/anime-ep1.mp4" // cuando complete
  }
}
```

### 5. Buscar anime
```
GET /api/v1/anime/search?q={query}&domain={domain}
```

**Ejemplo:**
```
GET /api/v1/anime/search?q=naruto&domain=animeav1.com
```

### 6. Descargar múltiples capítulos (batch)
```
POST /api/v1/anime/batch-download
Body: {
  "animeUrl": "https://animeav1.com/media/leviathan",
  "episodes": [1, 2, 3, 4, 5],
  "quality": "1080p",
  "webhook": "https://tu-webhook.com/notify"
}
```

## Características

✅ Multi-sitio (animeav1.com, animeflv.net, etc.)
✅ Extracción automática de enlaces
✅ Descarga paralela
✅ Sistema de cola
✅ Webhooks para notificaciones
✅ Rate limiting por plan
✅ Almacenamiento temporal/permanente
✅ Conversión de formatos (opcional)
✅ Subtítulos automáticos

## Límites por Plan

| Plan | Requests/Día | Descargas/Día | Almacenamiento |
|------|--------------|---------------|----------------|
| Free | 100 | 5 | 1GB (24h) |
| Premium | 1000 | 50 | 50GB (7 días) |
| Enterprise | 10000 | Ilimitado | 500GB (30 días) |

## Notas Técnicas

- Puppeteer para scraping dinámico
- FFmpeg para procesamiento de video
- Bull para sistema de colas
- Redis para cache
- S3/Local storage para archivos
