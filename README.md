# 🎬 Anime1v API - Documentación

Documentación oficial de la API pública para scraping de anime desde AnimeAV1.com

**Base URL**: `https://fxxmorgan.me/api/anime1v`

[![Status](https://img.shields.io/badge/status-online-success)](https://fxxmorgan.me/api/anime1v)
[![API Version](https://img.shields.io/badge/version-1.0.0-blue)](https://fxxmorgan.me/api/anime1v)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 🌟 Características

- 🔍 **Búsqueda de anime** por nombre
- 📺 **Información completa** de anime (episodios, géneros, score)
- 🎬 **Enlaces de video** SUB y DUB
- 🚫 **Filtro de servidores** (Mega excluido por default)
- 🔐 **Autenticación con API Key**
- ⚡ **Rate limiting** por planes
- 📊 **100 requests/día gratis**

---

## 🚀 Inicio Rápido

### 1. Obtener API Key

Regístrate en **[fxxmorgan.me/api](https://fxxmorgan.me/api)** para obtener tu API Key gratuita.

### 2. Primera Request

```bash
curl -H "X-API-Key: tu_api_key" \
  "https://fxxmorgan.me/api/anime1v/search?q=naruto&domain=animeav1.com"
```

```javascript
fetch('https://fxxmorgan.me/api/anime1v/search?q=naruto&domain=animeav1.com', {
  headers: { 'X-API-Key': 'tu_api_key' }
})
.then(res => res.json())
.then(data => console.log(data));
```

---

## 📋 Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/search` | GET | Buscar anime por nombre |
| `/info` | GET | Información completa del anime |
| `/episode` | GET | Enlaces de un episodio (SUB/DUB) |

---

## 📚 Documentación

- **[README](Apis/anime1v/README.md)** - Inicio rápido
- **[API Reference](Apis/anime1v/anime-scraper-api.md)** - Referencia completa
- **[Guía de Uso](Apis/anime1v/GUIA-ANIME-API.md)** - Tutorial detallado
- **[Filtro Mega](Apis/anime1v/MEGA-FILTER-INFO.md)** - Sistema de filtrado
- **[Changelog](Apis/anime1v/CAMBIOS-ANIMEAV1.md)** - Historial de cambios
- **[Ejemplos](Apis/anime1v/ejemplo-anime-api.js)** - Código de ejemplo

---

## 💡 Ejemplo Completo

```javascript
const API_KEY = 'tu_api_key';
const BASE_URL = 'https://fxxmorgan.me/api/anime1v';

async function obtenerAnime(query) {
  // 1. Buscar
  const searchRes = await fetch(
    `${BASE_URL}/search?q=${query}&domain=animeav1.com`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  const { data: { results } } = await searchRes.json();
  
  // 2. Obtener info
  const infoRes = await fetch(
    `${BASE_URL}/info?url=${results[0].url}`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  const anime = await infoRes.json();
  
  console.log(`${anime.data.title} - ${anime.data.totalEpisodes} episodios`);
  
  // 3. Obtener enlaces del primer episodio
  const epRes = await fetch(
    `${BASE_URL}/episode?url=${anime.data.episodes[0].url}`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  const links = await epRes.json();
  
  console.log('Servidores SUB:', links.data.servers.sub.length);
  console.log('Servidores DUB:', links.data.servers.dub.length);
}

obtenerAnime('naruto');
```

---

## 📊 Planes y Rate Limiting

| Plan | Requests/Día | Precio | Estado |
|------|-------------|--------|--------|
| **Free** | 100 | Gratis | ✅ Disponible |
| Premium | 1,000 | - | 🔒 Próximamente |
| Enterprise | 10,000 | - | 🔒 Próximamente |

---

## 🚫 Filtro de Servidores

Por defecto, **Mega está excluido** porque requiere clave de cifrado manual en el navegador.

### Para incluir Mega:

```bash
curl -H "X-API-Key: tu_key" \
  "https://fxxmorgan.me/api/anime1v/episode?url=...&includeMega=true"
```

### Excluir otros servidores:

```bash
curl -H "X-API-Key: tu_key" \
  "https://fxxmorgan.me/api/anime1v/episode?url=...&excludeServers=mega,fembed"
```

Ver [documentación del filtro](Apis/anime1v/MEGA-FILTER-INFO.md) para más detalles.

---

## ⚠️ Notas Importantes

- ✅ Mega excluido por defecto (evita popups de clave)
- ✅ Rate limiting automático por plan
- ✅ URLs de video pueden expirar
- ✅ Solo contenido de AnimeAV1.com

---

## 🐛 Soporte

- 📧 **Email**: contact@fxxmorgan.me
- 🌐 **Portal**: [fxxmorgan.me/api](https://fxxmorgan.me/api)
- 📖 **Docs**: [github.com/FxxMorgan/anime1v-api](https://github.com/FxxMorgan/anime1v-api)
- 🐛 **Issues**: [Reportar problemas](https://github.com/FxxMorgan/anime1v-api/issues)

---

## 📄 Licencia

Documentación bajo MIT License. El backend es propietario.

Ver [LICENSE](LICENSE) para más detalles.

---

## ⚖️ Disclaimer

Esta API es solo para fines educativos. Respeta los términos de servicio de AnimeAV1.com y las leyes de copyright de tu jurisdicción.

---

## 👨‍💻 Autor

**Feer** - [FxxMorgan](https://github.com/FxxMorgan)

---

## 🙏 Agradecimientos

- AnimeAV1.com por el contenido
- Comunidad de Node.js
- Todos los usuarios de la API

---

⭐ **Si te gusta esta API, dale una estrella en GitHub!**

**[Obtener API Key →](https://fxxmorgan.me/api)**
