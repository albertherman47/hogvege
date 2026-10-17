# Hóvége — helyi háztartási kiadástervező

Magyar felületű, RON pénznemű alkalmazás. **Fiók nélkül, a saját gépen fut.** A felhasználó által választott kiadás: kisebb indulás, helyi használat. Nem többfelhasználós felhőszolgáltatás.

## Indítás

Node.js **22.18 vagy újabb** szükséges.

```sh
npm ci
npm run build
npm start
```

Nyisd meg: **http://127.0.0.1:4173**. A kiszolgáló kizárólag a `127.0.0.1` címen figyel. Az alapértelmezett port `.env` fájlban `PORT=4173` értékkel módosítható. Leállítás: Ctrl+C.

Fejlesztéshez: `npm run dev`. Típusellenőrzés: `npm run check`. Automatikus ellenőrzés: `npm test`.

**Meglévő adatok átvitele:** előbb a régi címen futó alkalmazás Beállítások oldalán exportálj, majd az új címen importálj. A `localhost` és `127.0.0.1`, valamint az eltérő portok külön böngészőtárhelyet használnak. Válassz egy állandó címet a napi használathoz.

## Használat

- **Áttekintés:** indulási útmutató, havi kötelezettség, rendezett és hátralévő összegek, közelgő számlák, hathavi trend.
- **Számláim:** havi szűrés, név/szolgáltató/kategória szerinti keresés, állapotszűrők, rendezés, létrehozás, szerkesztés, számlatörténet, fizetett státusz. Az első megérkezett számla gyorsan felvehető névvel, tényleges összeggel és esedékességi nappal. Később a „Számla megérkezett” gombbal az adott havi tényleges összeg frissíthető, a fizetett állapot ettől külön kezelhető. Éves vagy egyszeri tételhez és számlafelismeréshez a részletes felvételt használd.
- **Naptár:** nap szerinti szűrés, több számla egy napon, hónapvégi határidők helyes kezelése.
- **Kimutatások:** havi, negyedéves és éves bontás, kategóriák és tételrészletek.
- **Tervezés:** kézi egyenleg és bevétel, fizetésnap, megtakarítási cél, várható pénzmozgások.
- **Beállítások:** megjelenés, értesítések, adatmentés és visszaállítás. A név a kezdőlapon módosítható.


Új telepítéskor nincs automatikus próbaadat. A minta külön gombbal tölthető be; egyértelműen jelölt, szemléltető becslés. A mintabetöltés meglévő adatokat csak megerősítés után cserél le.

A számlatörlés a felső „Visszavonás” sávból visszaállítható, amíg a sávot be nem zárod, másik számlát nem törölsz vagy az oldalt újra nem töltöd. A fontos adatokhoz külön JSON-exportot készíts.

## Számítási szabályok

Az adott hónap tényleges számlái elsőbbséget élveznek a becsült számlaadatokkal szemben. Ha nincs rögzített havi összeg, a kézzel megadott terv, ennek hiányában az adott időszakig ismert legutóbbi három hónap átlaga számít. A havi korrekció hozzáadódik a fizetendőhöz, de nem tanítja az átlagot. Jóváírás negatív korrekcióként rögzíthető.

A rendezett státusz a kiválasztott hónapra vonatkozik. A tervezett szabad keret kizárólag a bevitt adatokat használja: nem bankszámlaegyenleg, és a nem rögzített napi költéseket nem ismeri. A mai egyenleget a Tervezés oldalon szükség szerint frissíteni kell; a fizetettnek jelölés önmagában nem banki tranzakció. A ma megadott egyenleghez a fizetés napján nem adunk hozzá még egyszer bevételt. A megtakarítási cél hátralévő összegét a határidőig fennmaradó hónapokra osztjuk; az így tervezett félretétel nem csökkenti a ténylegesen megadott egyenleget, és nem számít tényleges megtakarításnak, amíg a „Már félretett összeg” mezőt nem frissíted.

## Tárolás és helyreállítás

A számlák és beállítások a böngésző `localStorage` tárhelyén vannak. Nincs automatikus felhőmentés, eszközök közötti szinkronizáció vagy szerveres felhasználói adatbázis. A gép és a böngészőprofil védelmét az operációs rendszer biztosítja.

A mentési hibák tartós jelzést kapnak. Sérült mentett adatot a rendszer nem ír felül automatikusan. A „Helyreállítási másolat” az eredeti nyers tárhelyadatokat exportálja hibakereséshez; ez **nem** normál importfájl. A normál „Adatmentés letöltése” a számlákat, a pénzügyi tervet és a személyes beállításokat menti. Érvényes normál mentés importálásával a sérült állapot lecserélhető.

A számlalista és a tervezési adatok módosításai az ugyanazon címen megnyitott másik böngészőablakban is megjelennek. Ez nem szerveres együttműködés; egy háztartás egy böngészőprofilban használja.

## Helyi számlafelismerés

A szerver gépén legyen telepítve:

- Tesseract OCR, képek és szkennelt PDF-ek felismeréséhez;
- Poppler (`pdftotext`, `pdftoppm`), PDF-ek feldolgozásához;
- opcionálisan magyar és román Tesseract nyelvi csomagok.

`TESSERACT_LANG=auto` az elérhető angol, magyar és román nyelveket választja. A kereshető PDF szövegkinyerése nem igényel Tesseractot.

Elfogadott formátum: PDF, JPG, PNG, WebP, legfeljebb 10 MB. A PDF első három oldala kerül feldolgozásra. Egyszerre legfeljebb két felismerés fut, egy feldolgozás legfeljebb 120 másodpercig; kliensenként 12 kérés/perc a korlát. Minden felismerés után ellenőrizni kell a mezőket. Nem RON számlát a felület nem emel be automatikusan RON összegként.

A fájl a böngészőből a **helyi kiszolgálóhoz** kerül, ideiglenes könyvtárban feldolgozódik, majd a feldolgozás lezárásakor törlődik. Külső AI-szolgáltatáshoz nem kerül. A program erőszakos leállítása vagy géphiba esetén az operációs rendszer ideiglenes könyvtárában maradhat fájl; ezt a rendszer szokásos ideiglenesfájl-takarítása kezeli.

## Műszaki felépítés

- React + TypeScript + Vite; rögzített függőségverziók és lockfile.
- `src/finance.ts`: időszaki pénzügyi számítások.
- `src/data.ts`: mentési formátum és validálás.
- `src/storage.ts`: hibajelzés, sérült adatok védelme és helyreállítási export.
- `src/components/`: kimutatások, párbeszédablak-akadálymentesítés, hibahatár.
- `src/redesign.css`: új vizuális rendszer és reszponzív megjelenés.
- `server/index.mjs`: önálló helyi HTTP-kiszolgáló; szigorú Host/Origin ellenőrzés, biztonsági fejlécek, statikus fájlok.
- `server/invoice-ocr.mjs`: OCR és szöveges mezőkinyerés; fejlesztői Vite-integrációval is.

Végpontok: `GET /api/health`, `POST /api/invoices/extract`. A kiszolgáló nem naplózza a számlafájlok tartalmát vagy a felismert személyes adatokat.

## Átadás és ellenőrzés

A build, a pénzügyi/adatkezelési/OCR automatikus tesztek, a helyi HTTP-védelmek és egy mesterséges PDF/PNG számla teljes felismerése ellenőrizve. A részletek és a még szükséges kiadási ellenőrzések: [docs/RELEASE.md](docs/RELEASE.md). A böngészős vizuális és teljes interakciós ellenőrzés ebben a munkamenetben nem volt végrehajtható, mert nem volt csatlakoztatott böngésző.
