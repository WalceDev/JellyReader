# Propozycje ulepszeń QOL i GUI – Jellyfin Reader

Lista propozycji usprawnień dla forka **Jellyfin Reader** (faza 3 projektu):

---

### 1. Utrzymywanie podświetlenia ekranu podczas czytania (WakeLock / KeepScreenOn)
* **Cel:** Zapobieganie wygaszaniu ekranu telefonu po 30–60 sekundach bezczynności podczas czytania dłuższej strony.
* **Realizacja:** 
  * W momencie otwarcia odtwarzacza książek aktywacja flagi `FLAG_KEEP_SCREEN_ON` w Androidzie lub API Screen WakeLock w WebView.
  * Automatyczne zwalnianie blokady po zamknięciu czytnika.

---

### 2. Przewijanie stron fizycznymi przyciskami głośności (Volume Keys Navigation)
* **Cel:** Wygodne czytanie jedną ręką bez dotykania ekranu (np. w podróży lub na mrozie).
* **Realizacja:** 
  * Przechwytywanie zdarzeń `KeyEvent.KEYCODE_VOLUME_UP` (poprzednia strona) oraz `KeyEvent.KEYCODE_VOLUME_DOWN` (następna strona) w `MainActivity.kt` podczas aktywnego czytnika.
  * Opcja włączania/wyłączania tej funkcji w ustawieniach.

---

### 3. Tryb pełnoekranowy (Immersive Mode)
* **Cel:** Ukrycie systemowego paska stanu (zegarek, bateria, ikony powiadomień) oraz dolnego paska nawigacji Androida podczas czytania.
* **Realizacja:** 
  * Przełączenie okna aktywności w tryb `WindowInsetsControllerCompat` (immersive sticky) po załadowaniu czytnika.
  * Przywracanie pasków systemowych po wyjściu do biblioteki.

---

### 4. Branding i tożsamość aplikacji
* **Cel:** Wyróżnienie aplikacji w systemie jako dedykowany czytnik e-booków.
* **Realizacja:** 
  * Zmiana nazwy aplikacji w plikach `strings.xml` z *Jellyfin* na **Jellyfin Reader**.
  * Dedykowana ikona launchera (motyw książki / czytnika w kolorystyce Jellyfin).

---

### 5. Domyślny ekran startowy (Smart Start Page)
* **Cel:** Bezpośrednie wejście w książki zamiast ogólnego pulpitu serwera.
* **Realizacja:** 
  * Automatyczne przekierowanie po zalogowaniu bezpośrednio do biblioteki książek lub widoku *„Wznów czytanie”*.

---

### 6. Wygodne marginesy i kontrast w czytniku
* **Cel:** Lepsza ergonomia czytania na ekranach OLED i ekranach o zaokrąglonych rogach.
* **Realizacja:** 
  * Dodanie bezpiecznych marginesów bocznych tekstu w `reader.css`, aby tekst nie dotykał zaokrąglonych krawędzi wyświetlacza.
  * Opcjonalny motyw True AMOLED Black (#000000) dla maksymalnej oszczędności baterii.
