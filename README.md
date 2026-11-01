# otthon-3d-card

Forgatható, nagyítható 3D alaprajz-kártya Home Assistanthoz, three.js alapon. A ház geometriája a dashboard
konfigjában utazik (a kártya generikus, nem tartalmaz személyes adatot); a címkék élő entitás-állapotot mutatnak,
koppintásra a HA részletező ablakát nyitják.

**Kezelés:** húzás = forgatás, görgő / csípés = nagyítás, jobb gomb vagy Shift+húzás = tolás, szint-gombok fent.

**Szerkesztő mód (csak admin felhasználónak látszik, „✎ Szerkesztés”):** a címkéket húzással helyezed át; a „+ Eszköz”
gomb a látható szint közepére tesz egy új eszközt (entitás-választó HA-beli nevekkel + címke neve), vagy a padlóra koppintva
oda, ahová koppintottál; címkére koppintva átnevezed vagy törlöd (✕).
„💾 Mentés” a pozíciókat közvetlenül a dashboard konfigjába írja (`lovelace/config/save`), „Mégse” visszavonja.
A dashboard `url_path`-ját az oldal címéből veszi; ha máshol ágyazod be, add meg a `url_path` konfig-kulcsban.

**Erőforrás** (Beállítások → Irányítópultok → Erőforrások, típus: JavaScript module):

```
https://cdn.jsdelivr.net/gh/Endhuner/otthon-3d-card@main/otthon-3d-card.js
```

**Kártya-konfig:** (a `climates` térkép opcionális: a címke 🔥 ikont és sárga keretet kap, ha a felsorolt termosztátok közül valamelyik éppen fűt, ❄-t és kéket, ha hűt; `heat_color` / `cool_color` a színek)

```yaml
type: custom:otthon-3d-card
height: calc(100vh - 110px)   # CSS magasság (opcionális, ez az alap)
wall_h: 1.1          # fal magassága méterben (babaház-vágás)
slab_h: 0.25         # födém vastagsága
furniture_h: 0.55    # bútor-tömbök magassága
default_level: 1     # induláskor látható szint indexe, vagy 'all' (alapértelmezés: mind)
url_path: dashboard-otthon   # opcionális, a mentéshez (alapértelmezés: az URL első szegmense)
origin: [487, 353]   # a koordináta-mód visszaszámolásához (terv-pt), opcionális
levels:
  - name: Földszint
    z: 0             # a szint padlószintje méterben
    walls: ["x,y;x,y;…", …]   # gyűrűk méterben, x kelet, y dél; az anyag a bejárási irány jobbján
    floor: [...]
    glass: [...]
    deck: "x,y;…"    # opcionális terasz
    furniture: [...]  # opcionális bútor-körvonalak (alacsony tömbként rajzolja)
points:
  - entity: sensor.nappali_homerseklet
    name: Nappali
    level: 0         # index a levels listában
    x: 1.2
    y: -3.4
```

A gyűrűket egy alaprajzból generáló Python-szkript (PDF-sraffozásból) a szerző privát repójában van; a formátum fent.

A kamera a látható szintek befoglaló dobozát a gombsor alatti sávba illeszti (képarány-követő, 95%-os kitöltés); „⬇ Felülnézet” felülről, észak felfelé, „⟲ Nézet” az alap szögből mutatja; szintváltáskor az utoljára választott nézettípus marad.
