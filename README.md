# VectorFlick

**Un mapa interactivo de 1.916.272 películas.** Cada película es un punto; las que se parecen quedan cerca.
De lejos se ven "continentes" por género; al acercarse cada punto se separa del resto, muestra su póster y
se puede abrir para ver la ficha.

**→ [crisd404.github.io/VectorFlick](https://crisd404.github.io/VectorFlick/)**

Funciona en computadora y en celular. No tiene cuentas, publicidad ni analíticas.

## Qué se puede hacer

- **Explorar** el mapa con zoom y arrastre. Los nombres de las regiones aparecen en tres niveles a medida
  que te acercás (género → subgénero → tema).
- **Buscar** cualquier título del catálogo.
- **Filtrar** por género, año, nota mínima e idioma, y **colorear** el mapa por género, año, nota o idioma.
- **Abrir una ficha**: póster, año, idioma, duración, dirección, nota, géneros, sinopsis, reparto,
  enlaces a TMDB/IMDb y 12 películas similares (también dibujadas como líneas sobre el mapa).
- **Guardar películas** con ★: quedan en una lista aparte, marcadas con una estrella dorada en el mapa, y se
  pueden aislar con un filtro. La lista vive en tu navegador y se puede exportar/importar.
- **Dónde ver**: cada ficha enlaza a las plataformas disponibles en tu país (página de TMDB y búsqueda en
  JustWatch). Con un token gratuito de TMDB, las plataformas aparecen dentro de la ficha.

## Controles

| Acción | Computadora | Celular |
| --- | --- | --- |
| Moverse | arrastrar | arrastrar |
| Zoom | rueda del mouse, `+` / `−` | pellizco |
| Abrir una ficha | click en un punto | toque en un punto |
| Buscar | `/` | barra superior |
| Filtros y colores | `F` | botón de filtros |
| Guardar la película abierta | `S` o botón **★ Guardar** | botón **★ Guardar** |
| Ver las guardadas | `G` o ★ de la barra | ★ de la barra |
| Ampliar el póster | click en el póster | toque en el póster |
| Expandir / cerrar la ficha | `Esc` cierra | arrastrar la hoja hacia arriba o abajo |
| Ver todo el mapa | `0` | botón de encuadre |
| Mostrar / ocultar nombres | `L` | botón de etiquetas |
| Película al azar | `R` | botón de dado |
| Medidor de rendimiento | `P` | agregar `?perf` a la dirección |

El enlace de la barra de direcciones (`#p=…`) apunta a la película abierta, para compartirla.

## Cómo se armó

El mapa se calcula una sola vez, fuera del navegador, y se publica como archivos estáticos. El código que
genera los datos no está en este repositorio; acá está solo la web. El proceso, en resumen:

1. **Catálogo.** Se unieron el volcado completo de TMDB (1.272.994 películas) y los datasets de IMDb, que
   aportan 643.278 títulos que TMDB no tiene, además de notas y votos. Los duplicados se resolvieron por
   identificador de IMDb y, cuando faltaba, por título + año + dirección.
2. **Significado.** De cada película se obtuvo un vector con un modelo de lenguaje multilingüe
   (`multilingual-e5-small`) a partir de su título, géneros, palabras clave y sinopsis. A ese vector se le
   sumaron los géneros y la época, y se lo acercó al promedio de la filmografía de quien la dirigió.
3. **Mapa.** Para cada película se buscaron sus 30 vecinas más parecidas (cálculo exacto, en GPU) y ese
   grafo se proyectó a dos dimensiones con UMAP. Esas mismas vecinas son las "películas similares" de cada
   ficha.
4. **Sin amontonamientos.** Cada película es un disco, más grande cuantos más votos tiene. Un paso de
   "flujo de densidad" expande solo las zonas donde los discos no caben y deja intacto el resto; después una
   relajación corta separa los pares que aún se tocan. Por eso al hacer zoom ningún punto queda tapado.
5. **Publicación.** Los datos se cortan en trozos ordenados por importancia (las películas más votadas se
   descargan y dibujan primero) y en zonas del mapa (las fichas se piden solo cuando hacen falta).

### La web

HTML, CSS y JavaScript sin dependencias ni paso de compilación.

- **Dibujo:** WebGL2. Los casi dos millones de puntos se dibujan como `gl.POINTS`; filtros y colores se
  resuelven en el shader. Con el mapa lejos se dibuja solo la fracción de puntos que hace falta para
  conservar la densidad visible.
- **Pósters y nombres:** una capa de canvas 2D encima, que solo trabaja con lo que está en pantalla.
- **Búsqueda:** un Web Worker recorre los títulos sin trabar la interfaz; el índice se descarga recién
  cuando usás el buscador.
- **Datos:** archivos pre-comprimidos con gzip que el navegador descomprime (`DecompressionStream`).

```
index.html · style.css · app.js · search-worker.js
data/
  manifest.json     conteos, límites del mapa, géneros, idiomas, nombres de regiones
  pts/              posición y atributos de cada punto, en trozos de 65.536
  titles/           títulos (búsqueda)
  ids/              identificador estable de cada punto (para las guardadas)
  tiles/            título y póster por zona del mapa
  details/          ficha completa por zona del mapa
```

### Probarlo en tu máquina

Es un sitio estático: alcanza con cualquier servidor de archivos en la carpeta del repo.

```bash
python -m http.server 8000
```

Y abrir <http://localhost:8000>.

## Datos y créditos

VectorFlick es un proyecto personal, sin fines comerciales y **sin afiliación con TMDB, IMDb ni JustWatch**.
Los datos son una foto del 9 de noviembre de 2026.

- **[TMDB](https://www.themoviedb.org/)** — títulos, sinopsis, pósters, géneros, palabras clave, dirección y
  reparto, tomados del volcado diario
  [TMDB Movies Daily Updates](https://www.kaggle.com/datasets/alanvourch/tmdb-movies-daily-updates).
  Los pósters se cargan directamente desde los servidores de TMDB.
  *This product uses the TMDB API but is not endorsed or certified by TMDB.*
- **[IMDb](https://www.imdb.com/)** — notas, votos y los títulos que no están en TMDB, de los
  [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/).
  *Information courtesy of IMDb (https://www.imdb.com). Used with permission.*
- **[JustWatch](https://www.justwatch.com/)** — la disponibilidad en plataformas, a través de TMDB.

Las sinopsis y palabras clave están en inglés, tal como figuran en TMDB. Los títulos que solo existen en
IMDb no tienen póster ni sinopsis.

## Privacidad

El sitio no recolecta nada. Las películas guardadas, el país elegido y el token de TMDB (si lo cargás)
quedan en el almacenamiento local de tu navegador; el token solo se envía a TMDB.
