<?php

declare(strict_types=1);

namespace Momal\Game;

final class Player
{
    public int $score = 0;

    public function __construct(
        public readonly string $connectionId,
        public string $name,
        public string $roomId
    ) {
        $this->name = self::sanitizeName($name);
    }

    public static function sanitizeName(string $name): string
    {
        $name = \trim($name);
        $name = \preg_replace('/\s+/', ' ', $name) ?? '';
        $name = \mb_substr($name, 0, 20);
        return $name !== '' ? $name : 'Spieler';
    }
}

