# 📌 Información sobre el filtro de Mega

## ¿Por qué Mega está excluido por defecto?

Los enlaces de Mega incluyen una **clave de cifrado** en el hash de la URL:
```
https://mega.nz/file/zlZlTbTK#9a8ui9hzqxY-iQ_F0_3hletor2_WqoB5fHI_AU7Znpw
                          ↑ Esta parte (#...) es la clave de descifrado
```

### Problema
Algunos navegadores y aplicaciones pueden **eliminar el hash** al copiar/pegar o redirigir enlaces, causando que Mega muestre un popup pidiendo la clave de descifrado manualmente.

### Solución implementada
**Mega está excluido por defecto** para evitar confusión, pero puedes incluirlo cuando lo necesites.

## Cómo usar

### Sin Mega (por defecto)
```bash
GET /api/v1/anime/episode?url=https://animeav1.com/media/leviathan/1
```

**Respuesta:** PDrain, HLS, UPNShare, MP4Upload, 1Fichier

### Con Mega
```bash
GET /api/v1/anime/episode?url=https://animeav1.com/media/leviathan/1&includeMega=true
```

**Respuesta:** PDrain, HLS, UPNShare, **Mega**, MP4Upload, 1Fichier

### Combinaciones

```bash
# Solo Mega y PDrain
GET /api/v1/anime/episode?url=...&includeMega=true&excludeServers=hls,upnshare,mp4upload,1fichier

# Todo menos MP4Upload (incluye Mega)
GET /api/v1/anime/episode?url=...&includeMega=true&excludeServers=mp4upload

# Solo servidores rápidos (sin Mega ni 1Fichier)
GET /api/v1/anime/episode?url=...&excludeServers=1fichier
```

## Recomendaciones

### ✅ Usar Mega cuando:
- Descargas con herramientas CLI (wget, curl, aria2)
- Aplicaciones que preservan el hash (#)
- Acceso directo sin redirecciones

### ❌ Evitar Mega cuando:
- Enlaces para usuarios finales en navegadores
- Sistemas que hacen redirects
- Integraciones que copian/pegan URLs

## Servidores recomendados

| Servidor | Velocidad | Fiabilidad | Notas |
|----------|-----------|------------|-------|
| **PDrain** | ⚡⚡⚡ | ✅ Alta | Rápido, sin limitaciones |
| **HLS** | ⚡⚡⚡ | ✅ Alta | Streaming directo |
| **Mega** | ⚡⚡ | ⚠️ Media | Requiere clave en hash |
| **1Fichier** | ⚡ | ✅ Alta | Lento pero estable |
| **MP4Upload** | ⚡⚡ | ⚠️ Media | Puede tener ads |

## Configuración en código

### JavaScript/Node.js
```javascript
// Sin Mega (por defecto)
const response = await fetch(`${API_URL}/episode?url=${episodeUrl}`, {
  headers: { 'X-API-Key': apiKey }
});

// Con Mega
const response = await fetch(`${API_URL}/episode?url=${episodeUrl}&includeMega=true`, {
  headers: { 'X-API-Key': apiKey }
});

// Personalizado
const params = new URLSearchParams({
  url: episodeUrl,
  includeMega: 'true',
  excludeServers: 'mp4upload,1fichier'
});

const response = await fetch(`${API_URL}/episode?${params}`, {
  headers: { 'X-API-Key': apiKey }
});
```

### Python
```python
import requests

# Sin Mega
response = requests.get(
    f"{API_URL}/episode",
    params={'url': episode_url},
    headers={'X-API-Key': api_key}
)

# Con Mega
response = requests.get(
    f"{API_URL}/episode",
    params={'url': episode_url, 'includeMega': 'true'},
    headers={'X-API-Key': api_key}
)

# Personalizado
response = requests.get(
    f"{API_URL}/episode",
    params={
        'url': episode_url,
        'includeMega': 'true',
        'excludeServers': 'mp4upload,1fichier'
    },
    headers={'X-API-Key': api_key}
)
```

### cURL
```bash
# Sin Mega
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/episode?url=https://animeav1.com/media/leviathan/1"

# Con Mega
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/v1/anime/episode?url=https://animeav1.com/media/leviathan/1&includeMega=true"
```

## Formato de respuesta

```json
{
  "success": true,
  "data": {
    "episode": 1,
    "title": "Episodio 1",
    "streamLinks": {
      "SUB": [
        {
          "server": "PDrain",
          "url": "https://pixeldrain.com/u/LN3zSTWL?embed"
        }
        // Mega NO incluido por defecto
      ],
      "DUB": [...]
    },
    "downloadLinks": {
      "SUB": [
        {
          "server": "PDrain",
          "url": "https://pixeldrain.com/u/LN3zSTWL",
          "quality": "1080p"
        }
        // Mega NO incluido por defecto
      ],
      "DUB": [...]
    }
  },
  "source": "json"
}
```

Con `&includeMega=true`, Mega aparecerá en las listas.

## Troubleshooting

### Problema: "Mega pide clave de descifrado"
**Solución:** Asegúrate de copiar la URL completa con el hash (#). Si el problema persiste, usa `excludeServers=mega` o no uses `includeMega=true`.

### Problema: "No hay enlaces de descarga"
**Solución:** Verifica que el episodio tenga enlaces disponibles. Algunos episodios recién publicados pueden no tener todos los servidores activos.

### Problema: "Quiero solo un servidor específico"
**Solución:** Excluye todos los demás:
```
?url=...&includeMega=true&excludeServers=pdrain,hls,upnshare,mp4upload,1fichier
```
Esto dejará solo Mega.

## Cambios en versiones

### v1.0 (Actual)
- ✅ Mega excluido por defecto
- ✅ Parámetro `includeMega=true` para incluirlo
- ✅ Parámetro `excludeServers` para filtrar otros
- ✅ Funciona en streaming y descarga, SUB y DUB

### Futuro
- Configuración de servidores preferidos por usuario
- Cache de enlaces para mejorar velocidad
- Detección automática de enlaces caídos
