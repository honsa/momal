<?php

declare(strict_types=1);

namespace Momal\Game;

final class Player
{
    public int $score = 0;

    public readonly string $name;
    public readonly string $roomId;

    public function __construct(
        public readonly string $connectionId,
        string $name,
        string $roomId
    ) {
        $this->name = self::sanitizeName($name);
        $this->roomId = $roomId;
    }

    public function withName(string $name): self
    {
        $p = new self($this->connectionId, $name, $this->roomId);
        $p->score = $this->score;
        return $p;
    }

    public static function sanitizeName(string $name): string
    {
        $name = \trim($name);
        $name = (string)(\preg_replace('/\s+/', ' ', $name) ?? '');
        $name = \mb_substr($name, 0, 20);

        return $name !== '' ? $name : 'Spieler';
    }
}
