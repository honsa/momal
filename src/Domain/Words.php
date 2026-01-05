<?php

declare(strict_types=1);

namespace Momal\Domain;

final class Words
{
    /** @var string[] */
    private array $words;

    private ?string $lastWord = null;

    /**
     * @param string[] $words
     */
    public function __construct(array $words = [])
    {
        $this->words = $words ?: [
            // Tiere
            'Katze', 'Hund', 'Pferd', 'Kuh', 'Schwein', 'Schaf', 'Ziege', 'Hase', 'Fuchs', 'Wolf',
            'Bär', 'Löwe', 'Tiger', 'Elefant', 'Giraffe', 'Krokodil', 'Nashorn', 'Zebra', 'Pinguin',
            'Delfin', 'Hai', 'Wal', 'Krabbe', 'Qualle', 'Schildkröte', 'Igel', 'Eichhörnchen',
            'Waschbär', 'Otter', 'Frosch', 'Eule', 'Adler', 'Papagei', 'Flamingo', 'Taube', 'Spatz',
            'Schmetterling', 'Biene', 'Ameise', 'Marienkäfer', 'Spinne',

            // Essen & Trinken
            'Pizza', 'Pasta', 'Hamburger', 'Pommes', 'Sushi', 'Salat', 'Suppe', 'Kuchen', 'Keks',
            'Schokolade', 'Eis', 'Kaffee', 'Tee', 'Limonade', 'Wasser', 'Saft', 'Banane', 'Apfel',
            'Birne', 'Erdbeere', 'Traube', 'Zitrone', 'Orange', 'Ananas', 'Kokosnuss', 'Avocado',
            'Tomate', 'Gurke', 'Karotte', 'Kartoffel', 'Zwiebel', 'Knoblauch', 'Brot', 'Brötchen',
            'Käse', 'Butter', 'Joghurt',

            // Dinge (Alltag)
            'Auto', 'Fahrrad', 'Bus', 'Zug', 'Flugzeug', 'Rakete', 'Schiff', 'Boot', 'Roller',
            'Helikopter', 'Ampel', 'Straßenschild', 'Rucksack', 'Schlüssel', 'Brille', 'Uhr',
            'Handy', 'Laptop', 'Tastatur', 'Maus', 'Kamera', 'Fernseher', 'Radio', 'Kopfhörer',
            'Mikrofon', 'Lampe', 'Kerze', 'Batterie', 'Steckdose', 'Kabel', 'Buch', 'Heft',
            'Stift', 'Radiergummi', 'Lineal', 'Schere', 'Kleber', 'Brief', 'Postkarte',
            'Zahnbürste', 'Seife', 'Shampoo', 'Handtuch', 'Kamm', 'Spiegel',

            // Kleidung
            'Hose', 'T-Shirt', 'Pullover', 'Jacke', 'Mantel', 'Kleid', 'Rock', 'Schal', 'Mütze',
            'Handschuh', 'Socken', 'Schuh', 'Stiefel', 'Gürtel', 'Krawatte', 'Hut',

            // Natur & Wetter
            'Sonne', 'Mond', 'Stern', 'Regen', 'Schnee', 'Gewitter', 'Blitz', 'Regenbogen', 'Wolke',
            'Wind', 'Nebel', 'Berg', 'Fluss', 'See', 'Meer', 'Wald', 'Baum', 'Blume', 'Gras',
            'Vulkan', 'Wüste', 'Insel', 'Wasserfall',

            // Orte & Gebäude
            'Haus', 'Wohnung', 'Schule', 'Kindergarten', 'Bibliothek', 'Krankenhaus', 'Bäckerei',
            'Supermarkt', 'Restaurant', 'Café', 'Bahnhof', 'Flughafen', 'Park', 'Spielplatz',
            'Stadion', 'Kino', 'Museum', 'Burg', 'Zelt',

            // Berufe
            'Arzt', 'Ärztin', 'Lehrer', 'Lehrerin', 'Polizist', 'Feuerwehr', 'Bäcker', 'Koch',
            'Mechaniker', 'Pilot', 'Fahrer', 'Gärtner', 'Kellner',

            // Sport & Freizeit
            'Fußball', 'Basketball', 'Tennis', 'Schwimmen', 'Tauchen', 'Skifahren', 'Snowboard',
            'Fahrradrennen', 'Joggen', 'Yoga', 'Klettern', 'Angeln', 'Camping',

            // Musik & Kunst
            'Gitarre', 'Klavier', 'Trommel', 'Geige', 'Flöte', 'Saxofon', 'Mikrofon', 'Notenblatt',
            'Pinsel', 'Farbe', 'Leinwand',

            // Gefühle & abstrakt (leichter)
            'Herz', 'Lachen', 'Traurigkeit', 'Wut', 'Angst', 'Freude', 'Überraschung',

            // Klassiker / Montagsmalen-typisch
            'Regenschirm', 'Schneemann', 'Geschenk', 'Ballon', 'Schatzkarte', 'Zauberstab',
            'Geheimnis', 'Pirat', 'Prinzessin', 'Drache', 'Einhorn', 'Monster', 'Roboter',

            // Haushalt & Küche
            'Pfanne', 'Topf', 'Teller', 'Tasse', 'Glas', 'Gabel', 'Löffel', 'Messer', 'Schneidebrett',
            'Mixer', 'Toaster', 'Kühlschrank', 'Backofen', 'Mikrowelle', 'Spülmaschine', 'Waschmaschine',
            'Staubsauger', 'Besen', 'Wischmopp', 'Eimer', 'Mülltonne',

            // Schule & Büro
            'Ranzen', 'Schulheft', 'Bleistift', 'Marker', 'Textmarker', 'Füller', 'Spitzer', 'Ordner',
            'Locher', 'Tacker', 'Büroklammer', 'Notiz', 'Kalender', 'Stempel', 'Briefumschlag',

            // Technik & Internet
            'Router', 'WLAN', 'Passwort', 'USB-Stick', 'Festplatte', 'Bildschirm', 'Drucker', 'Scanner',
            'Ladekabel', 'Powerbank', 'App', 'E-Mail', 'Browser', 'Suchmaschine',

            // Verkehr & Reisen
            'Koffer', 'Reisepass', 'Ticket', 'Landkarte', 'Kompass', 'Kreuzfahrt', 'Campingplatz',
            'Kofferraum', 'Tankstelle', 'Parkplatz', 'Bahnsteig', 'Rolltreppe',

            // Spiele & Hobbys
            'Schach', 'Brettspiel', 'Kartenspiel', 'Würfel', 'Puzzle', 'Joystick', 'Controller',
            'Buchstabe', 'Zahlen', 'Malen', 'Zeichnen', 'Basteln', 'Stricken', 'Nähen',

            // Körper & Gesundheit (neutral)
            'Hand', 'Fuß', 'Kopf', 'Nase', 'Ohr', 'Auge', 'Mund', 'Zahn', 'Herzschlag', 'Pflaster',
            'Thermometer',

            // Pflanzen
            'Kaktus', 'Rose', 'Tulpe', 'Sonnenblume', 'Klee', 'Palme', 'Efeu', 'Pilz',

            // Freizeit-Orte
            'Schwimmbad', 'Strand', 'Berge', 'Wanderweg', 'Bauernhof', 'Zoo', 'Aquarium', 'Rathaus',
            'Post', 'Polizeiwache', 'Feuerwache',

            // Tiere (mehr)
            'Dachs', 'Luchs', 'Marder', 'Iltis', 'Maulwurf', 'Biber', 'Hirsch', 'Reh', 'Elch',
            'Kamel', 'Lama', 'Alpaka', 'Gorilla', 'Affe', 'Känguru', 'Koala', 'Strauß', 'Kakadu',
            'Kranich', 'Specht', 'Schwan', 'Gans', 'Ente', 'Huhn', 'Hahn', 'Truthahn',
            'Karpfen', 'Forelle', 'Oktopus', 'Seepferdchen', 'Rochen',

            // Essen (mehr)
            'Spaghetti', 'Lasagne', 'Nudeln', 'Reis', 'Bohnen', 'Erbsen', 'Mais', 'Paprika', 'Brokkoli',
            'Spinat', 'Kürbis', 'Melone', 'Pfirsich', 'Kirsche', 'Mango', 'Kiwi', 'Honig', 'Marmelade',
            'Pfannkuchen', 'Waffel', 'Croissant', 'Torte', 'Donut',

            // Verben / Aktionen (gut zum Zeichnen)
            'laufen', 'rennen', 'springen', 'tanzen', 'singen', 'lachen', 'weinen', 'schlafen', 'essen',
            'trinken', 'lesen', 'schreiben', 'malen', 'telefonieren', 'fotografieren', 'kochen',
            'putzen', 'waschen', 'schwimmen', 'tauchen', 'klettern', 'fliegen',

            // Wetter (mehr)
            'Hagel', 'Sturm', 'Tornado', 'Hitze', 'Kälte',

            // Fantasy & Popkultur-klassisch
            'Zauberer', 'Hexe', 'Schloss', 'Ritter', 'Schatz', 'Magie', 'Superheld', 'Alien', 'UFO',

            // Fahrzeuge (mehr)
            'Motorrad', 'Traktor', 'Bagger', 'Kran', 'Feuerwehrauto', 'Polizeiauto', 'Krankenwagen',
            'U-Bahn', 'Straßenbahn', 'Segelboot',

            // Gegenstände (mehr)
            'Ball', 'Kette', 'Ring', 'Münze', 'Geldschein', 'Gesicht', 'Sternschnuppe', 'Fernglas',
            'Lupe', 'Hammer', 'Nagel', 'Schraube', 'Schraubenzieher', 'Zange', 'Säge', 'Bohrer',
            'Besenstiel',
        ];
    }

    public function randomWord(?string $exclude = null): string
    {
        $count = \count($this->words);
        if ($count === 0) {
            // Shouldn't happen because we always have defaults, but keep it safe.
            return 'Katze';
        }

        // If we only have one word, we can't avoid repeats.
        if ($count === 1) {
            $this->lastWord = $this->words[0];

            return $this->words[0];
        }

        $excludeWord = $exclude ?? $this->lastWord;

        if ($excludeWord === null) {
            $w = $this->words[\random_int(0, $count - 1)];
            $this->lastWord = $w;

            return $w;
        }

        // Try a few times to avoid exclude word.
        for ($i = 0; $i < 10; $i++) {
            $w = $this->words[\random_int(0, $count - 1)];
            if ($w !== $excludeWord) {
                $this->lastWord = $w;

                return $w;
            }
        }

        $filtered = \array_values(\array_filter(
            $this->words,
            static fn (string $w): bool => $w !== $excludeWord
        ));

        // With $count > 1 and excludeWord taken from our list, $filtered must be non-empty.
        if ($filtered === []) {
            // If the list contains only duplicates of the excluded word, we can't avoid repeats.
            $this->lastWord = $excludeWord;

            return $excludeWord;
        }

        $w = $filtered[\random_int(0, \count($filtered) - 1)];
        $this->lastWord = $w;

        return $w;
    }
}
