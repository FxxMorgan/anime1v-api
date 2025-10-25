# 🎬 Anime1v API - Guía de Uso

API REST para obtener información de animes desde AnimeAV1.com

**Base URL**: `https://fxxmorgan.me/api/anime1v`

---

## 🚀 Inicio Rápido

### 1. Obtener API Key

1. Visita [https://fxxmorgan.me/api](https://fxxmorgan.me/api)
2. Regístrate con tu email
3. Inicia sesión
4. Ve a tu Dashboard
5. Copia tu API Key

**Plan Free incluido**: 100 requests/día gratis 🎉

---

## 🎯 Cómo Usar la API

### Autenticación

Todas las requests requieren tu API Key en el header:

```http
X-API-Key: tu_api_key_aqui
```

### Endpoints Disponibles

#### 1. Buscar anime

```bash
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/search?q=naruto&domain=animeav1.com"
```

**Parámetros**:
- `q` (requerido): Nombre del anime a buscar
- `domain` (opcional): `animeav1.com` (default)

#### 2. Información del anime

```bash
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/info?url=https://animeav1.com/media/nombre-anime"
```

**Parámetros**:
- `url` (requerido): URL completa del anime en AnimeAV1

#### 3. Enlaces de episodio

```bash
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/episode?url=https://animeav1.com/media/anime/1"
```

**Parámetros**:
- `url` (requerido): URL del episodio
- `includeMega` (opcional): `true` para incluir Mega
- `excludeServers` (opcional): Lista separada por comas de servidores a excluir

---

## 💻 Ejemplos de Código

### JavaScript (Node.js)

```javascript
const API_KEY = 'tu_api_key_aqui';
const BASE_URL = 'https://fxxmorgan.me/api/anime1v';

async function buscarAnime(query) {
  const response = await fetch(
    `${BASE_URL}/search?q=${encodeURIComponent(query)}&domain=animeav1.com`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  const data = await response.json();
  return data;
}

buscarAnime('naruto').then(console.log);
```

### Python

```python
import requests

API_KEY = 'tu_api_key_aqui'
BASE_URL = 'https://fxxmorgan.me/api/anime1v'

def buscar_anime(query):
    response = requests.get(
        f'{BASE_URL}/search',
        headers={'X-API-Key': API_KEY},
        params={'q': query, 'domain': 'animeav1.com'}
    )
    return response.json()

print(buscar_anime('naruto'))
```

### cURL

```bash
# Buscar
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/search?q=naruto&domain=animeav1.com"

# Info
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/info?url=https://animeav1.com/media/anime"

# Episodio sin Mega (default)
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/episode?url=https://animeav1.com/media/anime/1"

# Episodio con Mega
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/episode?url=https://animeav1.com/media/anime/1&includeMega=true"

# Excluir múltiples servidores
curl -H "X-API-Key: TU_API_KEY" \
  "https://fxxmorgan.me/api/anime1v/episode?url=https://animeav1.com/media/anime/1&excludeServers=mega,fembed"
```

---

## 🚫 Filtro de Servidores Mega

Por defecto, **Mega está excluido** porque requiere clave de cifrado manual.

### Para incluir Mega:

```bash
# Agregar parámetro includeMega=true
curl -H "X-API-Key: TU_KEY" \
  "https://fxxmorgan.me/api/anime1v/episode?url=...&includeMega=true"
```

Ver [MEGA-FILTER-INFO.md](MEGA-FILTER-INFO.md) para más detalles.

---

## 📊 Rate Limiting

Tu plan determina cuántas requests puedes hacer:

| Plan | Límite | Reset |
|------|--------|-------|
| **Free** | 100/día | Diario (00:00 UTC) |
| Premium | 1,000/día | Próximamente |
| Enterprise | 10,000/día | Próximamente |

### Headers de Rate Limit

La API retorna estos headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1698364800
```

---

## ⚠️ Notas Importantes

- ✅ **Mega excluido por defecto** - Evita popups de clave de cifrado
- ✅ **Rate limiting activo** - Respeta tu límite diario
- ✅ **URLs pueden expirar** - Algunos servidores rotan enlaces
- ✅ **Solo AnimeAV1** - Otros sitios no soportados actualmente

---

## 🐛 Errores Comunes

### 401 Unauthorized
- ❌ API Key inválida o expirada
- ✅ Verifica que estés enviando el header `X-API-Key`

### 429 Too Many Requests
- ❌ Límite de rate excedido
- ✅ Espera hasta el reset o upgrade tu plan

### 404 Not Found
- ❌ URL del anime no existe
- ✅ Verifica la URL en animeav1.com

### 500 Internal Server Error
- ❌ Sitio cambió su estructura
- ✅ Reporta el problema

---

## 📚 Documentación Adicional

- **[API Reference Completa](anime-scraper-api.md)** - Todos los endpoints
- **[Filtro Mega](MEGA-FILTER-INFO.md)** - Documentación del filtro
- **[Changelog](CAMBIOS-ANIMEAV1.md)** - Historial de cambios
- **[Ejemplos](ejemplo-anime-api.js)** - Código de ejemplo

---

## 💡 Uso Avanzado

### Workflow Completo

```javascript
const API_KEY = 'tu_key';
const BASE = 'https://fxxmorgan.me/api/anime1v';

async function descargarAnime(nombre) {
  // 1. Buscar
  const search = await fetch(`${BASE}/search?q=${nombre}&domain=animeav1.com`, {
    headers: { 'X-API-Key': API_KEY }
  });
  const { data: { results } } = await search.json();
  
  // 2. Obtener info
  const info = await fetch(`${BASE}/info?url=${results[0].url}`, {
    headers: { 'X-API-Key': API_KEY }
  });
  const anime = await info.json();
  
  console.log(`${anime.data.title} - ${anime.data.totalEpisodes} episodios`);
  
  // 3. Obtener enlaces del primer episodio
  const ep = await fetch(`${BASE}/episode?url=${anime.data.episodes[0].url}`, {
    headers: { 'X-API-Key': API_KEY }
  });
  const links = await ep.json();
  
  console.log('Enlaces SUB:', links.data.servers.sub);
  console.log('Enlaces DUB:', links.data.servers.dub);
}

descargarAnime('naruto');
```

---

## 🆘 Soporte

- 📧 **Email**: contact@fxxmorgan.me
- 🌐 **Web**: [https://fxxmorgan.me/api](https://fxxmorgan.me/api)
- 📖 **Docs**: [GitHub](https://github.com/FxxMorgan/anime1v-api)
- 🐛 **Issues**: Reporta problemas con la API

---

## 📄 Términos de Uso

- ✅ Uso personal y educativo permitido
- ✅ Respeta el rate limiting
- ❌ No abuses de la API
- ❌ No revender accesos
- ❌ No hacer scraping de la API

---

**Powered by FxxMorgan** | API Version 1.0.0

```bash
npm install youtube-dl-exec
# o
npm install @distube/ytdl-core
```

### 3. Almacenamiento en la Nube

```bash
npm install @aws-sdk/client-s3
# o
npm install @google-cloud/storage
```

### 4. Procesamiento de Video

```bash
npm install fluent-ffmpeg
```

## 🔧 Configuración de Descarga Real

Para implementar descarga real de videos, puedes usar:

### Opción 1: youtube-dl

```javascript
const youtubedl = require('youtube-dl-exec');

async function downloadVideo(url, outputPath) {
  await youtubedl(url, {
    output: outputPath,
    format: 'bestvideo+bestaudio',
  });
}
```

### Opción 2: Puppeteer + Interceptar Requests

```javascript
const puppeteer = require('puppeteer');

async function extractVideoUrl(pageUrl) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const videoUrls = [];
  
  page.on('request', request => {
    if (request.resourceType() === 'media') {
      videoUrls.push(request.url());
    }
  });
  
  await page.goto(pageUrl);
  await browser.close();
  
  return videoUrls;
}
```

## 📊 Límites de la API

Recuerda que cada plan tiene límites:

- **Free**: 100 requests/día, 5 descargas/día
- **Premium**: 1000 requests/día, 50 descargas/día
- **Enterprise**: 10000 requests/día, descargas ilimitadas

## ⚖️ Consideraciones Legales

**IMPORTANTE**: El scraping puede violar términos de servicio de algunos sitios.

- Solo úsalo para **fines educativos**
- Respeta el `robots.txt` de los sitios
- No sobrecargues los servidores
- Considera el copyright del contenido

## 🐛 Debugging

Si tienes problemas:

1. Verifica que el sitio esté accesible
2. Inspecciona el HTML real del sitio
3. Ajusta los selectores CSS
4. Revisa los logs del servidor
5. Usa herramientas como Postman para probar

## 📞 Soporte

Para más ayuda, revisa:
- Documentación de Cheerio: https://cheerio.js.org/
- Documentación de Puppeteer: https://pptr.dev/
- Documentación de Axios: https://axios-http.com/
