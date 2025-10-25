# 🎬 Anime1v API - Documentación Pública

API REST para obtener información de animes desde AnimeAV1.com

**Base URL**: `https://fxxmorgan.me/api/anime1v`

[![Status](https://img.shields.io/badge/status-online-success)](https://fxxmorgan.me/api/anime1v)
[![API Version](https://img.shields.io/badge/version-1.0.0-blue)](https://fxxmorgan.me/api/anime1v)

---

## 🚀 Inicio Rápido

### 1. Obtener API Key

Regístrate en [https://fxxmorgan.me/api](https://fxxmorgan.me/api) para obtener tu API Key gratuita.

### 2. Hacer tu primera request

```bash
curl -H "X-API-Key: tu_api_key" \
  "https://fxxmorgan.me/api/anime1v/search?q=naruto&domain=animeav1.com"
```

```javascript
fetch('https://fxxmorgan.me/api/anime1v/search?q=naruto&domain=animeav1.com', {
  headers: {
    'X-API-Key': 'tu_api_key_aqui'
  }
})
.then(res => res.json())
.then(data => console.log(data));
```

---

## 📋 Endpoints Disponibles

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/search` | GET | Buscar anime por nombre |
| `/info` | GET | Información completa del anime |
| `/episode` | GET | Enlaces de un episodio |

---

## 📚 Documentación

- **[API Reference Completa](anime-scraper-api.md)** - Todos los endpoints y parámetros
- **[Guía de Uso](GUIA-ANIME-API.md)** - Cómo usar la API
- **[Filtro Mega](MEGA-FILTER-INFO.md)** - Sistema de filtrado de servidores
- **[Changelog](CAMBIOS-ANIMEAV1.md)** - Historial de cambios
- **[Ejemplos de Código](ejemplo-anime-api.js)** - Ejemplos en JavaScript

---

## 🔑 Autenticación

Todas las requests requieren una API Key en el header:

```http
X-API-Key: tu_api_key_aqui
```

---

## 📊 Rate Limiting

| Plan | Requests/Día | Precio |
|------|-------------|--------|
| Free | 100 | Gratis |
| Premium | 1,000 | Próximamente |
| Enterprise | 10,000 | Próximamente |

---

## 💡 Ejemplo Completo

```javascript
const API_KEY = 'tu_api_key';
const BASE_URL = 'https://fxxmorgan.me/api/anime1v';

async function buscarYObtenerInfo(query) {
  // 1. Buscar
  const searchRes = await fetch(
    `${BASE_URL}/search?q=${query}&domain=animeav1.com`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  const { data: { results } } = await searchRes.json();
  
  // 2. Obtener info del primero
  const infoRes = await fetch(
    `${BASE_URL}/info?url=${results[0].url}`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  const { data } = await infoRes.json();
  
  console.log(`${data.title} - ${data.totalEpisodes} episodios`);
}

buscarYObtenerInfo('naruto');
```

---

## ⚠️ Notas Importantes

- ✅ Mega está **excluido por defecto** (usa `includeMega=true` para incluirlo)
- ✅ Respeta el rate limiting de tu plan
- ✅ Las URLs de videos pueden expirar
- ✅ Solo contenido de AnimeAV1.com

---

## 🐛 Soporte

- 📧 Email: contact@fxxmorgan.me
- 🐛 Issues: Reporta problemas con la API
- 📖 Docs: Lee la documentación completa

---

## 📄 Licencia

Esta API es de uso exclusivo con API Key. El backend es propietario.

La documentación está bajo MIT License para referencia.

---

**Powered by FxxMorgan** | [Website](https://fxxmorgan.me) | [API Portal](https://fxxmorgan.me/api)
