# Hóvége helyi kiadás — átadás

## Termékhatár

A felhasználó döntése: kisebb indulás, későbbi bővíthetőség; kizárólag helyi használat, fiók nélkül. A jelenlegi átadás ennek megfelelő helyi kiadásjelölt. Nyilvános internetes szolgáltatásként nem telepíthető változtatás nélkül.

A felület hat munkaterületet ad: áttekintés, számlák, naptár, kimutatások, tervezés, beállítások. Mobilon az első öt az alsó navigációból, a beállítások a felső profilgombból érhetők el. A navigáció URL-hash alapú, ezért a vissza/előre gomb is használható.

## Backend döntési alapok

A senior-backend döntési szempontjai a helyi termékre alkalmazva:

1. Terhelés: egy felhasználó/helyi folyamat. Tervezési feltételezés: olvasás/írás körülbelül 10:1; p99 API-terhelés legfeljebb 5 kérés/másodperc, OCR külön 12 kérés/perc korláttal. A nézetek olvasása a böngészőben történik; a korábbi 100 felhasználós felhőbecslés a helyi használat választásával nem egy szerverre vonatkozik.
2. Tenancy: egy háztartás/böngészőprofil, nincs közös felhasználói adatbázis.
3. Feldolgozás: közvetlen HTTP kérés/válasz; aszinkron helyi OCR gyermekfolyamatokkal, korlátozott párhuzamossággal, tartós feladatsor nélkül.
4. Adatérzékenység: személyes pénzügyi adatok és a számlaképekben lehetséges személyazonosító adatok. Az OCR a helyi gépen marad, a szerver naplója nem tartalmazza a dokumentum tartalmát.
5. Felépítés: egy Node.js folyamat + böngésző, elkülönített OCR- és számítási modulok. Nincs mikroszolgáltatás vagy új adatbázis-migráció.
6. Helyreállítás: tervezési cél RPO legfeljebb 24 óra **napi manuális export mellett**, RTO 15 perc meglévő exportból és működő telepítésből. Export nélkül nincs garantált RPO.
7. Minőségi cél: a helyi folyamat futási ideje alatt 99,5% sikeres, érvényes nem-OCR kérés; a prioritásokról a termék tulajdonosa dönt. Statikus/health cél p50 <50 ms, p95 <150 ms, p99 <300 ms. OCR cél p50 <5 s, p95 <30 s, p99 <120 s a támogatott dokumentumokon. **Ezek tervezési célok, nem mért SLO-tanúsítványok.** A teljesítmény a felhasználó gépétől függ, bezárt alkalmazásra nem értelmezünk rendelkezésre állást.

## Megvalósított védelmek

- Kizárólag loopback kiszolgálás, engedélyezett Host és Origin, cross-site kérések tiltása.
- CSP, frame tiltás, MIME sniffing tiltás, minimális jogosultságpolitika.
- Statikus útvonalak és feloldott szimbolikus linkek könyvtárhatár-ellenőrzése.
- OCR fájlméret- és formátumellenőrzés, fájlszignatúra, kéréskorlát, párhuzamossági plafon, időkorlát, megszakítás és ideiglenesfájl-takarítás normál lezáráskor.
- Sérült helyi adat megőrzése, importvalidálás, tárhelyhiba tartós jelzése, helyreállítási export.
- Billentyűzetes fókuszcsapda és Escape a modális ablakoknál, háttér inert állapota, fókusz visszaadása, csökkentett animáció támogatása, navigáció állapotjelzése.
- Felismert idegen pénznem automatikus RON-ként mentésének tiltása.

## Elvégzett ellenőrzések

- `npm run build`: sikeres TypeScript ellenőrzés és Vite build.
- `npm test`: 4 tesztfájl; összesen 22 teszteset.
- Számítások: későbbi hónap kizárása, tényleges/becsült elsőbbség, korrekció, terv mint fallback, szökőév és hónapvégi határidő.
- Adatok: üres előzmény megőrzése, duplikált azonosító és hibás összeg elutasítása, jóváírás, export/import körbejárás, éves/egyszeri ismétlődés, sérült tárolás védelme, tervezési mezők validálása.
- OCR: román összegformátum, érvénytelen dátum, hibás metódus/origin/JSON/MIME/szignatúra/méret.
- Mind a hat oldal React-renderelése ellenőrizve, üres adatokkal. Ez nem vizuális böngészőteszt.
- HTTP: kezdőlap és health 200, külső Host/Origin 403, hiányos OCR-kérés 400.
- Teljes helyi OCR: mesterséges PDF és ugyanannak PNG-változata. Mindkettő eredménye: Electrica, 2026-09, 2026-10-15, 1234.56 RON, 180 kWh. Ez működési próba, nem reprezentatív pontossági mérés.

## Kiadás előtt még elvégzendő

Ebben a munkamenetben nem volt elérhető csatlakoztatott böngésző. Ezért a következők még **nincsenek igazoltan ellenőrizve**:

- 360, 390, 768 és 1440 px szélességen minden oldal, világos és sötét témában;
- új számla teljes varázsló, szerkesztés, fizetett státusz, törlés/visszavonás;
- billentyűzetes bejárás, fókusz-visszaállítás és képernyőolvasó;
- újratöltés, több ablak, import/export a tényleges böngészőben;
- hosszú szolgáltatónevek, sok számla, többéves előzmény;
- valós, változatos magyar és román számlák OCR-pontossága;
- becslési célértékek teljesítménymérése a támogatni kívánt gépeken.

A `localStorage` nem titkosított adatbázis. A helyi géphez vagy böngészőprofilhoz hozzáférő személy az adatokat is elérheti. Böngészőadatok törlése után csak a külön exportból állítható helyre az állapot. Az értesítések csak megnyitott alkalmazás mellett működnek; nincs háttérben futó push szolgáltatás.

## Későbbi felhős bővítés

Új termékdöntés után: fiók és hitelesítés, szerveres adatelkülönítés, tranzakciós adatbázis, verziózott mentések és konfliktuskezelés, tartós OCR-sor, operatív mérés és helyreállítási próba. A helyi szervert nem szabad egyszerűen `0.0.0.0` címre átállítani és nyilvánosan kitenni.
