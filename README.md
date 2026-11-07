# EduKot 2.0 – Panel admina (osobna strona)

Osobny projekt Vercel – nie mieszaj go z panelem nauczyciela ani rodzica.

## Wdrożenie
1. Wgraj ten folder jako **nowy** projekt na Vercel (np. `edukot-admin`).
2. Ustaw zmienne środowiskowe (te same Redis co w nauczycielu):
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `EDUKOT_ADMIN_LOGIN` — **twój login admina**
   - `EDUKOT_ADMIN_PASSWORD` — **twoje hasło admina**
3. Opcjonalnie `EDUKOT_TEACHER_PIN` – tylko do statusu „czy PIN nauczyciela jest ustawiony”.

## Wejście
Otwórz domenę projektu i wpisz login + hasło z ENV.

## Funkcje
- podsumowanie kodów i próśb
- włączanie / wyłączanie / usuwanie pojedynczych kodów zaproszeń
- **znajdź kod** i **usuń całkowicie** z bazy
- **wyłącz wszystkie kody**
- **usuń wszystkie kody z listy**
- **usuń wszystkie oczekujące prośby** rodziców
- odrzucanie pojedynczych próśb

Kody zaproszeń = kody synchronizacji rodzica z uczniem.  
Admin korzysta z tej samej bazy Upstash co panel nauczyciela i rodziców.

## Aktualizacje
Po deployu HTML bierze się z sieci (świeża wersja).  
Jeśli widzisz starą stronę: wyczyść dane witryny albo Ctrl+Shift+R.
