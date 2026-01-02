<?php

declare(strict_types=1);

namespace Momal\Domain;

final class Words
{
    /** @var string[] */
    private array $words;

    /**
     * @param string[] $words
     */
    public function __construct(array $words = [])
    {
        $this->words = $words ?: [
            'Katze', 'Hund', 'Auto', 'Fahrrad', 'Sonne', 'Mond', 'Baum', 'Haus', 'Pizza', 'Gitarre',
            'Elefant', 'Regenschirm', 'Schneemann', 'Rakete', 'Schiff', 'Brille', 'Kaffee', 'Buch',
            'Schlüssel', 'Herz', 'Blume', 'Wolke', 'Kuchen', 'Handy', 'Kamera',
        ];
    }

    public function randomWord(): string
    {
        $count = \count($this->words);
        if ($count === 0) {
            // Shouldn't happen because we always have defaults, but keep it safe.
            return 'Katze';
        }

        return $this->words[\random_int(0, $count - 1)];
    }
}
